import { randomBytes } from 'crypto'
import express, { Request, Response } from 'express'
import axios from 'axios'
import { ethers } from 'ethers'
import { ObjectId } from 'mongodb'
import AWS from 'aws-sdk'
import { TimeUnit } from '@valkey/valkey-glide'
import {
  putPhoneSession,
  updatePhoneSession,
  getPhoneSessionById,
  getPhoneSessionsBySigDigest,
  getPhoneSessionByTxHash,
  getVoucherByTxHash,
  getVoucherById,
  updateVoucher,
  batchPutVouchers,
  putSandboxPhoneSession,
  getSandboxPhoneSessionById,
  getSandboxPhoneSessionsBySigDigest
} from '../_utils/dynamodb.js'
import { valkeyClient } from '../../../utils/valkey-glide.js'
import {
  sessionStatusEnum,
  supportedChainIds,
  idServerPaymentAddress,
  payPalApiUrlBase,
  SessionStatus
} from '../../../constants/misc.js'
import {
  getAccessToken as getPayPalAccessToken,
  getOrder as getPayPalOrder,
  getRefundDetails as getPayPalRefundDetails,
  capturePayPalOrder
} from '../../../utils/paypal.js'
import { makeUnknownErrorLoggable } from '../../../utils/errors.js'
import { usdToETH, usdToFTM, usdToAVAX } from '../../../utils/cmc.js'
import { getProvider } from '../../../utils/misc.js'
import { getTransaction, validateTx } from '../../orders/functions.js'

interface ValidationResult {
  status?: number
  error?: string
}

/**
 * Check blockchain for tx.
 * - Ensure recipient of tx is id-server's address.
 * - Ensure amount is > desired amount.
 * - Ensure tx is confirmed.
 */
async function validateTxForSessionPayment(
  session: Promise<AWS.DynamoDB.GetItemOutput>,
  chainId: number,
  txHash: string,
  desiredAmount: number
): Promise<ValidationResult> {
  try {
    const sessionResult = await session
    const externalOrderId = '0x' + sessionResult.Item?.id?.S
    const tx = await validateTx(false, chainId, txHash, externalOrderId, desiredAmount)
  
    if (!tx.blockHash || tx.confirmations === 0) {
      console.log('transaction has not been confirmed yet. waiting. tx:', tx)
      const receipt = await tx.wait()
      if (receipt.confirmations === 0) {
        return {
          status: 400,
          error: 'Transaction has not been confirmed yet.'
        }
      }
    }
  
    return {}
  } catch (err: any) {
    return {
      status: 400,
      error: err.message
    }
  }
}

/**
 * Check blockchain for tx.
 * - Ensure recipient of tx is id-server's address.
 * - Ensure amount is > desired amount.
 * - Ensure tx is confirmed.
 */
async function validateTxForVoucherPayment(
  chainId: number,
  txHash: string,
  desiredAmount: number
): Promise<ValidationResult> {
  let tx: ethers.providers.TransactionResponse | null = await getTransaction(chainId, txHash)

  if (!tx) {
    return {
      status: 400,
      error: 'Could not find transaction with given txHash'
    }
  }

  if (idServerPaymentAddress !== tx.to?.toLowerCase()) {
    return {
      status: 400,
      error: `Invalid transaction recipient. Recipient must be ${idServerPaymentAddress}`
    }
  }

  // NOTE: This const must stay in sync with the frontend.
  // We allow a 2% margin of error.
  const expectedAmountInUSD = desiredAmount * 0.95

  let expectedAmountInToken: number
  if ([1, 10, 1313161554, 8453].includes(chainId)) {
    expectedAmountInToken = await usdToETH(expectedAmountInUSD)
  } else if (chainId === 250) {
    expectedAmountInToken = await usdToFTM(expectedAmountInUSD)
  } else if (chainId === 43114) {
    expectedAmountInToken = await usdToAVAX(expectedAmountInUSD)
  } else if (process.env.NODE_ENV === 'development' && chainId === 420) {
    expectedAmountInToken = await usdToETH(expectedAmountInUSD)
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  // Round to 18 decimal places to avoid this underflow error from ethers:
  // "fractional component exceeds decimals"
  const decimals = 18
  const multiplier = 10 ** decimals
  const rounded = Math.round(expectedAmountInToken * multiplier) / multiplier

  const expectedAmount = ethers.utils.parseEther(rounded.toString())

  if (tx.value.lt(expectedAmount)) {
    return {
      status: 400,
      error: `Invalid transaction amount. Amount must be greater than ${expectedAmount.toString()} on chain ${chainId}`
    }
  }

  if (!tx.blockHash || tx.confirmations === 0) {
    return {
      status: 400,
      error: 'Transaction has not been confirmed yet.'
    }
  }

  const voucherWithTxHash = await getVoucherByTxHash(txHash)

  if (voucherWithTxHash) {
    return {
      status: 400,
      error: 'Transaction has already been used to generate voucher'
    }
  }

  return {}
}

interface RefundResponse {
  status: number
  data: any
}

async function refundMintFeeOnChain(
  session: Promise<AWS.DynamoDB.GetItemOutput>,
  to: string
): Promise<RefundResponse> {
  const sessionResult = await session
  let provider: ethers.providers.JsonRpcProvider | null = null
  try {
    provider = getProvider(Number(sessionResult.Item?.chainId?.N))
  } catch (err: any) {
    return {
      status: 500,
      data: {
        error: err.message
      }
    }
  }

  if (!provider) {
    return {
      status: 500,
      data: {
        error: 'Could not get RPC provider'
      }
    }
  }

  const tx = await provider.getTransaction(sessionResult.Item?.txHash?.S ?? '')

  if (!tx) {
    return {
      status: 404,
      data: {
        error: 'Could not find transaction with given txHash'
      }
    }
  }

  const wallet = new ethers.Wallet(
    process.env.PAYMENTS_PRIVATE_KEY as string,
    provider
  )

  // Refund 69.1% of the transaction amount. This approximates the mint cost to
  // a fraction of a cent.
  const refundAmount = tx.value // .mul(691).div(1000);

  // Ensure wallet has enough funds to refund
  const balance = await wallet.getBalance()
  if (balance.lt(refundAmount)) {
    return {
      status: 500,
      data: {
        error:
          'Wallet does not have enough funds to refund. Please contact support.'
      }
    }
  }

  const txReq = await wallet.populateTransaction({
    to: to,
    value: refundAmount
  })

  // For some reason gas estimates from Fantom are way off. We manually increase
  // gas to avoid "transaction underpriced" error. Hopefully this is unnecessary
  // in the future. The following values happened to be sufficient at the time
  // of adding this block.
  if (Number(sessionResult.Item?.chainId?.N) === 250) {
    if (txReq.maxFeePerGas && txReq.maxPriorityFeePerGas) {
      txReq.maxFeePerGas = ethers.BigNumber.from(txReq.maxFeePerGas).mul(2)
      txReq.maxPriorityFeePerGas = ethers.BigNumber.from(
        txReq.maxPriorityFeePerGas
      ).mul(14)

      if (
        txReq.maxPriorityFeePerGas &&
        ethers.BigNumber.from(txReq.maxPriorityFeePerGas).gt(
          ethers.BigNumber.from(txReq.maxFeePerGas)
        )
      ) {
        txReq.maxPriorityFeePerGas = txReq.maxFeePerGas
      }
    }
  }

  const txResponse = await wallet.sendTransaction(txReq)

  const receipt = await txResponse.wait()

  await updatePhoneSession(
    sessionResult.Item?.id?.S ?? '',
    null,
    sessionStatusEnum.REFUNDED,
    null,
    null,
    null,
    receipt.transactionHash,
    null,
    null
  )

  return {
    status: 200,
    data: {
      txReceipt: receipt
    }
  }
}

async function refundMintFeePayPal(
  session: Promise<AWS.DynamoDB.GetItemOutput>
): Promise<RefundResponse> {
  const sessionResult = await session
  const accessToken = await getPayPalAccessToken()

  const payPalData = JSON.parse(sessionResult?.Item?.payPal?.S ?? '{}')
  const orders = payPalData.orders ?? []

  if (orders.length === 0) {
    return {
      status: 404,
      data: {
        error: 'No PayPal orders found for session'
      }
    }
  }

  let successfulOrder: any
  for (const { id: orderId } of orders) {
    const order = await getPayPalOrder(orderId, accessToken)
    if (order.status === 'COMPLETED') {
      successfulOrder = order
      break
    }
  }

  if (!successfulOrder) {
    return {
      status: 404,
      data: {
        error: 'No successful PayPal orders found for session'
      }
    }
  }

  // Get the first successful payment capture
  let capture: any
  for (const pu of successfulOrder.purchase_units) {
    for (const payment of pu.payments.captures) {
      if (payment.status === 'COMPLETED') {
        capture = payment
        break
      }
    }
  }

  if (!capture) {
    return {
      status: 404,
      data: {
        error: 'No successful PayPal payment captures found for session'
      }
    }
  }

  const paymentId = capture.id

  const url = `${payPalApiUrlBase}/v2/payments/captures/${paymentId}/refund`
  const config = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  }
  const data = {
    amount: {
      value: '2.53',
      currency_code: 'USD'
    },
    note_to_payer: 'Failed verification'
  }
  const resp = await axios.post(url, data, config)

  if (resp.data?.status !== 'COMPLETED') {
    return {
      status: 500,
      data: {
        error: 'Error refunding payment'
      }
    }
  }

  await updatePhoneSession(
    sessionResult.Item?.id?.S ?? '',
    null,
    sessionStatusEnum.REFUNDED,
    null,
    null,
    null,
    null,
    null,
    null
  )

  return {
    status: 200,
    data: {}
  }
}

/**
 * ENDPOINT.
 *
 * Creates a session.
 */
export async function postSession(req: Request, res: Response): Promise<Response> {
  try {
    const sigDigest = req.body.sigDigest as string
    if (!sigDigest) {
      return res.status(400).json({ error: 'sigDigest is required' })
    }

    // We started using ObjectId on Feb 25, 2025
    const id = new ObjectId().toString()
    await putPhoneSession(
      id,
      sigDigest,
      sessionStatusEnum.NEEDS_PAYMENT,
      null,
      null,
      0,
      null,
      null
    )

    return res.status(201).json({
      id,
      sigDigest,
      sessionStatus: sessionStatusEnum.NEEDS_PAYMENT,
      numAttempts: 0
    })
  } catch (err) {
    const error = err as Error
    console.log('postSession: Error:', makeUnknownErrorLoggable(error))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}

interface PostSessionConfig {
  getPhoneSessionsBySigDigest: (
    sigDigest: string
  ) => Promise<AWS.DynamoDB.QueryOutput>
  putPhoneSession: (
    id: string,
    sigDigest: string,
    sessionStatus: string,
    chainId: string | null,
    txHash: string | null,
    numAttempts: number | null,
    refundTxHash: string | null,
    payPal: string | null
  ) => Promise<AWS.DynamoDB.PutItemOutput>
}

/**
 * Factory function to create postSessionV2 handler
 */
function createPostSessionV2(config: PostSessionConfig) {
  return async function postSessionV2(
    req: Request,
    res: Response
  ): Promise<Response> {
    try {
      const sigDigest = req.body.sigDigest as string
      if (!sigDigest) {
        return res.status(400).json({ error: 'sigDigest is required' })
      }

      // Only allow a user to create up to 2 sessions
      const existingSessions =
        await config.getPhoneSessionsBySigDigest(sigDigest)
      const sessionsResult = await existingSessions
      const sessions = sessionsResult?.Items ? sessionsResult.Items : []
      const filteredSessions = sessions.filter((session) =>
        (
          [
            sessionStatusEnum.IN_PROGRESS,
            sessionStatusEnum.VERIFICATION_FAILED,
            sessionStatusEnum.ISSUED
          ] as SessionStatus[]
        ).includes(session.sessionStatus?.S as SessionStatus)
      )

      if (filteredSessions.length >= 2) {
        return res.status(400).json({
          error: 'User has reached the maximum number of sessions (2)'
        })
      }

      // We started using ObjectId on Feb 25, 2025
      const id = new ObjectId().toString()
      await config.putPhoneSession(
        id,
        sigDigest,
        sessionStatusEnum.IN_PROGRESS,
        null,
        null,
        0,
        null,
        null
      )

      return res.status(201).json({
        id,
        sigDigest,
        sessionStatus: sessionStatusEnum.IN_PROGRESS,
        numAttempts: 0
      })
    } catch (err) {
      const error = err as Error
      console.log('postSession: Error:', makeUnknownErrorLoggable(error))
      return res.status(500).json({ error: 'An unknown error occurred' })
    }
  }
}

export const postSessionV2 = createPostSessionV2({
  getPhoneSessionsBySigDigest,
  putPhoneSession
})

export const postSessionV2Sandbox = createPostSessionV2({
  getPhoneSessionsBySigDigest: getSandboxPhoneSessionsBySigDigest,
  putPhoneSession: putSandboxPhoneSession
})

/**
 * ENDPOINT.
 */
export async function createPayPalOrder(
  req: Request,
  res: Response
): Promise<Response> {
  try {
    const id = req.params.id as string

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const accessToken = await getPayPalAccessToken()

    const url = `${payPalApiUrlBase}/v2/checkout/orders`
    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: 'USD',
            value: '5.00'
          }
        }
      ]
    }
    const config = {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      }
    }

    const resp = await axios.post(url, body, config)

    const order = resp.data

    console.log('session?.Item?.payPal?.S', session?.Item?.payPal?.S)
    const sessionPayPalData = JSON.parse(session?.Item?.payPal?.S ?? '{}')

    if ((sessionPayPalData?.orders ?? []).length > 0) {
      sessionPayPalData.orders.push({
        id: order.id,
        createdAt: new Date().getTime().toString()
      })
    } else {
      sessionPayPalData.orders = [
        {
          id: order.id,
          createdAt: new Date().getTime().toString()
        }
      ]
    }

    await updatePhoneSession(
      id,
      null,
      null,
      null,
      null,
      null,
      null,
      JSON.stringify(sessionPayPalData),
      null
    )

    return res.status(201).json(order)
  } catch (err: any) {
    console.log('createPayPalOrder: Error:', makeUnknownErrorLoggable(err))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}

/**
 * ENDPOINT.
 */
export async function payment(req: Request, res: Response): Promise<Response> {
  try {
    const id = req.params.id as string
    const chainId = Number(req.body.chainId)
    const txHash = req.body.txHash as string
    if (!chainId || supportedChainIds.indexOf(chainId) === -1) {
      return res.status(400).json({
        error: `Missing chainId. chainId must be one of ${supportedChainIds.join(
          ', '
        )}`
      })
    }
    if (!txHash) {
      return res.status(400).json({ error: 'txHash is required' })
    }

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: 'Session not found' })
    }

    if (session?.Item?.txHash?.S) {
      return res
        .status(400)
        .json({ error: 'Session is already associated with a transaction' })
    }

    const validationResult = await validateTxForSessionPayment(
      getPhoneSessionById(id),
      chainId,
      txHash,
      5
    )
    if (validationResult.error) {
      console.log(
        `Invalid transaction (chainId==${chainId}, txHash==${txHash}). Error:`,
        validationResult.error
      )
      return res
        .status(validationResult.status ?? 400)
        .json({ error: validationResult.error })
    }

    await updatePhoneSession(
      id,
      null,
      sessionStatusEnum.IN_PROGRESS,
      chainId.toString(),
      txHash,
      null,
      null,
      null,
      null
    )

    return res.status(200).json({ success: true })
  } catch (err: any) {
    console.log('phone/sessions/payment: Error:', makeUnknownErrorLoggable(err))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}

/**
 * ENDPOINT.
 */
export async function paymentV2(req: Request, res: Response): Promise<Response> {
  try {
    if (req.body.chainId && req.body.txHash) {
      return payment(req, res)
    }

    const id = req.params.id as string
    const orderId = req.body.orderId as string

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' })
    }

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: 'Session not found' })
    }

    if (session.Item.sessionStatus?.S !== sessionStatusEnum.NEEDS_PAYMENT) {
      return res.status(400).json({
        error: `Session status is '${session.Item.sessionStatus?.S}'. Expected '${sessionStatusEnum.NEEDS_PAYMENT}'`
      })
    }

    const payPalData = JSON.parse(session?.Item?.payPal?.S ?? '{}')

    const filteredOrders = (payPalData?.orders ?? []).filter(
      (order: any) => order.id === orderId
    )
    if (filteredOrders.length === 0) {
      return res.status(400).json({
        error: `Order ${orderId} is not associated with session ${id}`
      })
    }

    const order = await capturePayPalOrder(orderId)

    if (order.status !== 'COMPLETED') {
      return res.status(400).json({
        error: `Order ${orderId} has status ${order.status}. Must be COMPLETED`
      })
    }

    const expectedAmountInUSD = 5

    let successfulOrder: any
    for (const pu of order.purchase_units) {
      for (const payment of pu.payments.captures) {
        if (payment.status === 'COMPLETED') {
          if (Number(payment.amount.value) >= expectedAmountInUSD) {
            successfulOrder = order
          }
          break
        }
      }
    }

    if (!successfulOrder) {
      return res.status(400).json({
        error: `Order ${orderId} does not have a successful payment capture with amount >= ${expectedAmountInUSD}`
      })
    }

    await updatePhoneSession(
      id,
      null,
      sessionStatusEnum.IN_PROGRESS,
      null,
      null,
      null,
      null,
      null,
      null
    )

    return res.status(200).json({ success: true })
  } catch (err: any) {
    console.log('phone/sessions/paymentV2: Error:', makeUnknownErrorLoggable(err))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}

/**
 * ENDPOINT.
 */
export async function paymentV3(req: Request, res: Response): Promise<Response> {
  try {
    const apiKey = req.headers['x-api-key'] as string

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: 'Invalid API key.' })
    }

    const id = req.params.id as string
    const chainId = Number(req.body.chainId)
    const txHash = req.body.txHash as string
    if (!chainId || supportedChainIds.indexOf(chainId) === -1) {
      return res.status(400).json({
        error: `Missing chainId. chainId must be one of ${supportedChainIds.join(
          ', '
        )}`
      })
    }
    if (!txHash) {
      return res.status(400).json({ error: 'txHash is required' })
    }

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: 'Session not found' })
    }

    if (session?.Item?.txHash?.S) {
      return res
        .status(400)
        .json({ error: 'Session is already associated with a transaction' })
    }

    const validationResult = await validateTxForSessionPayment(
      getPhoneSessionById(id),
      chainId,
      txHash,
      3
    )
    if (
      validationResult.error &&
      !validationResult.error.includes('Invalid transaction data')
    ) {
      return res
        .status(validationResult.status ?? 400)
        .json({ error: validationResult.error })
    }

    await updatePhoneSession(
      id,
      null,
      sessionStatusEnum.IN_PROGRESS,
      chainId.toString(),
      txHash,
      null,
      null,
      null,
      null
    )

    return res.status(200).json({ success: true })
  } catch (err: any) {
    console.log('phone/sessions/paymentV3: Error:', makeUnknownErrorLoggable(err))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}

/**
 * ENDPOINT.
 *
 * Allows a user to request a refund for a failed verification session.
 */
export async function refund(req: Request, res: Response): Promise<Response> {
  const id = req.params.id as string
  const to = req.body.to as string

  const mutexKey = `sessionRefundMutexLock:${id}`

  try {
    if (!to || to.length !== 42) {
      return res.status(400).json({
        error:
          'to is required and must be a 42-character hexstring (including 0x)'
      })
    }

    if (!valkeyClient) {
      throw new Error('valkeyClient is not defined')
    }

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: 'Session not found' })
    }

    if (
      session.Item.sessionStatus.S !== sessionStatusEnum.VERIFICATION_FAILED
    ) {
      return res
        .status(400)
        .json({ error: 'Only failed verifications can be refunded.' })
    }

    if (session.Item.refundTxHash?.S) {
      return res
        .status(400)
        .json({ error: 'Session has already been refunded.' })
    }

    // Create mutex. We use mutex here so that only one refund request
    // per session can be processed at a time. Otherwise, if the user
    // spams this refund endpoint, we could send multiple transactions
    // before the first one is confirmed.
    const mutex = await valkeyClient.get(mutexKey)
    if (mutex) {
      return res.status(400).json({ error: 'Refund already in progress' })
    }
    await valkeyClient.set(mutexKey, 'locked', { expiry: { type: TimeUnit.Seconds, count: 60 } })

    // Perform refund logic
    const response = await refundMintFeeOnChain(getPhoneSessionById(id), to)

    // Delete mutex
    await valkeyClient.del([mutexKey])

    // Return response
    return res.status(response.status).json(response.data)
  } catch (err: any) {
    // Delete mutex. We have this here in case an unknown error occurs above.
    try {
      if (valkeyClient) await valkeyClient.del([mutexKey])
    } catch (err: any) {
      console.log('Error encountered while deleting mutex', err)
    }

    console.log('phone/sessions/refund: Error:', makeUnknownErrorLoggable(err))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}

/**
 * ENDPOINT.
 */
export async function refundV2(req: Request, res: Response): Promise<Response> {
  if (req.body.to) {
    return refund(req, res)
  }

  const id = req.params.id as string

  const mutexKey = `sessionRefundMutexLock:${id}`

  try {
    if (!valkeyClient) {
      throw new Error('valkeyClient is not defined')
    }

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: 'Session not found' })
    }

    if (
      session.Item.sessionStatus?.S !== sessionStatusEnum.VERIFICATION_FAILED
    ) {
      return res
        .status(400)
        .json({ error: 'Only failed verifications can be refunded.' })
    }

    if (session.Item.refundTxHash?.S) {
      return res
        .status(400)
        .json({ error: 'Session has already been refunded.' })
    }

    // Create mutex. We use mutex here so that only one refund request
    // per session can be processed at a time. Otherwise, if the user
    // spams this refund endpoint, we could send multiple transactions
    // before the first one is confirmed.
    const mutex = await valkeyClient.get(mutexKey)
    if (mutex) {
      return res.status(400).json({ error: 'Refund already in progress' })
    }
    await valkeyClient.set(mutexKey, 'locked', { expiry: { type: TimeUnit.Seconds, count: 60 } })

    // Perform refund logic
    const response = await refundMintFeePayPal(getPhoneSessionById(id))

    // Delete mutex
    await valkeyClient.del([mutexKey])

    // Return response
    return res.status(response.status).json(response.data)
  } catch (err: any) {
    // Delete mutex. We have this here in case an unknown error occurs above.
    try {
      if (valkeyClient) {
        await valkeyClient.del([mutexKey])
      }
    } catch (err) {
      console.log('Error encountered while deleting mutex', err)
    }

    console.log('phone/sessions/refundV2: Error:', makeUnknownErrorLoggable(err))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}

interface GetSessionsConfig {
  getPhoneSessionById: (id: string) => Promise<AWS.DynamoDB.GetItemOutput>
  getPhoneSessionsBySigDigest: (
    sigDigest: string
  ) => Promise<AWS.DynamoDB.QueryOutput>
}

/**
 * Factory function to create getSessions handler
 */
function createGetSessions(config: GetSessionsConfig) {
  return async function getSessions(
    req: Request,
    res: Response
  ): Promise<Response> {
    try {
      const sigDigest = req.query.sigDigest as string
      const id = req.query.id as string

      if (!sigDigest && !id) {
        return res.status(400).json({ error: 'sigDigest or id is required' })
      }

      let sessions: AWS.DynamoDB.AttributeMap[]
      if (id) {
        const session = await config.getPhoneSessionById(id)
        const sessionResult = await session
        sessions = sessionResult?.Item ? [sessionResult.Item] : []
      } else {
        const storedSessions =
          await config.getPhoneSessionsBySigDigest(sigDigest)
        const sessionsResult = await storedSessions
        sessions = sessionsResult?.Items ? sessionsResult.Items : []
      }

      return res.status(200).json(sessions)
    } catch (err) {
      const error = err as Error
      console.log('GET /sessions: Error:', makeUnknownErrorLoggable(error))
      return res.status(500).json({ error: 'An unknown error occurred' })
    }
  }
}

export const getSessions = createGetSessions({
  getPhoneSessionById,
  getPhoneSessionsBySigDigest
})

export const getSessionsSandbox = createGetSessions({
  getPhoneSessionById: getSandboxPhoneSessionById,
  getPhoneSessionsBySigDigest: getSandboxPhoneSessionsBySigDigest
})

/**
 * ENDPOINT.
 *
 * Allows a user to generate a voucher for bypassing the session payment.
 */
export async function generateVoucher(req: Request, res: Response): Promise<Response> {
  try {
    const chainId = Number(req.body.chainId)
    const txHash = req.body.txHash as string
    const numberOfVouchers = Number(req.body.numberOfVouchers)
    if (!chainId || supportedChainIds.indexOf(chainId) === -1) {
      return res.status(400).json({
        error: `Missing chainId. chainId must be one of ${supportedChainIds.join(
          ', '
        )}`
      })
    }
    if (!txHash) {
      return res.status(400).json({ error: 'txHash is required' })
    }
    if (!numberOfVouchers || numberOfVouchers < 0) {
      return res
        .status(400)
        .json({ error: 'valid numberOfVouchers is required' })
    }
    const totalAmount = 5 * numberOfVouchers
    const validationResult = await validateTxForVoucherPayment(
      chainId,
      txHash,
      totalAmount
    )
    console.log('validationresul', validationResult)
    if (validationResult.error) {
      return res
        .status(validationResult.status ?? 400)
        .json({ error: validationResult.error })
    }
    const voucherIds: string[] = []
    const voucherItems: AWS.DynamoDB.WriteRequest[] = []
    for (let i = 0; i < numberOfVouchers; i++) {
      const id = randomBytes(32).toString('hex')
      voucherIds.push(id)
      voucherItems.push({
        PutRequest: {
          Item: {
            id: { S: `${id}` },
            isRedeemed: { BOOL: false },
            sessionId: { S: `${null}` },
            txHash: { S: `${txHash}` }
          }
        }
      })
    }
    await batchPutVouchers(voucherItems)
    return res.status(201).json({
      voucherIds
    })
  } catch (err) {
    const error = err as Error
    console.log('generateVoucher: Error:', makeUnknownErrorLoggable(error))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}

/**
 * ENDPOINT.
 *
 * Allows a user to redeem a valid voucher for bypassing the session payment.
 */
export async function redeemVoucher(req: Request, res: Response): Promise<Response> {
  try {
    const id = req.params.id as string
    const voucherId = req.body.voucherId as string

    if (!voucherId) {
      return res.status(400).json({ error: 'voucherId is required' })
    }

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const voucher = await getVoucherById(voucherId)
    if (!voucher?.Item) {
      return res.status(404).json({ error: 'voucher is invalid' })
    }
    if (voucher.Item.isRedeemed.BOOL) {
      return res.status(404).json({ error: 'voucher is already redeemed' })
    }
    await updatePhoneSession(
      id,
      null,
      sessionStatusEnum.IN_PROGRESS,
      null,
      null,
      null,
      null,
      null,
      null
    )

    await updateVoucher(voucherId, true, id, null)
    return res.status(200).json({ success: true })
  } catch (err: any) {
    console.log('phone/sessions/redeemVoucher: Error:', makeUnknownErrorLoggable(err))

    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}

export async function isVoucherRedeemed(
  req: Request,
  res: Response
): Promise<Response> {
  try {
    const voucherId = req.body.voucherId as string

    if (!voucherId) {
      return res.status(400).json({ error: 'voucherId is required' })
    }

    const voucher = await getVoucherById(voucherId)
    if (!voucher?.Item) {
      return res.status(404).json({ error: 'voucher is invalid' })
    }
    if (voucher.Item.isRedeemed.BOOL) {
      return res.status(200).json({ isRedeemed: true })
    } else {
      return res.status(200).json({ isRedeemed: false })
    }
  } catch (err) {
    const error = err as Error
    console.log('phone/sessions/isVoucherRedeemed: Error:', makeUnknownErrorLoggable(error))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}
