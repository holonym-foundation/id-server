import express, { Request, Response } from 'express'
import {
  numberExists,
  deleteNumber,
  updatePhoneSession,
  getPhoneSessionById,
  getPhoneSessionsBySigDigest,
  getPhoneSessionByTxHash
} from '../_utils/dynamodb.js'
import { sessionStatusEnum } from '../../../constants/misc.js'
import AWS from 'aws-sdk'
import { makeUnknownErrorLoggable } from '../../../utils/errors.js'

/**
 * ENDPOINT.
 *
 * Returns all sessions that belong to a user.
 */
export async function userSessions(req: Request, res: Response): Promise<Response> {
  try {
    const apiKey = req.headers['x-api-key'] as string

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: 'Invalid API key.' })
    }

    const id = req.body.id as string
    const txHash = req.body.txHash as string

    if (!id && !txHash) {
      return res.status(400).json({ error: 'id or txHash is required' })
    }

    let sessions: AWS.DynamoDB.AttributeMap[] = []

    if (id) {
      const session = await getPhoneSessionById(id)

      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }

      const data = await getPhoneSessionsBySigDigest(
        session.Item?.sigDigest?.S ?? ''
      )
      sessions = data?.Items ?? []
    }

    if (txHash) {
      const session = await getPhoneSessionByTxHash(txHash)

      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }

      const data = await getPhoneSessionsBySigDigest(session.sigDigest?.S ?? '')
      sessions = data?.Items ?? []
    }

    return res.status(200).json(
      sessions.map((session) => ({
        id: session.id?.S,
        sessionStatus: session.sessionStatus?.S,
        txHash: session.txHash?.S,
        chainId: session.chainId?.N,
        refundTxHash: session.refundTxHash?.S,
        numAttempts: session.numAttempts?.N,
        payPal: session?.payPal?.S
      }))
    )
  } catch (err) {
    const error = err as Error
    console.log('admin/user-sessions: Error:', makeUnknownErrorLoggable(error))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}

/**
 * ENDPOINT.
 *
 * Set a session's status to failed.
 */
export async function failSession(req: Request, res: Response): Promise<Response> {
  try {
    const apiKey = req.headers['x-api-key'] as string

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: 'Invalid API key.' })
    }

    const id = req.body.id as string

    if (!id) {
      return res.status(400).json({ error: 'id is required in request body' })
    }

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: 'Session not found' })
    }

    if (
      session.Item.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS &&
      session.Item.sessionStatus.S !== sessionStatusEnum.ISSUED
    ) {
      return res.status(400).json({
        error: `Session status is ${session.Item.sessionStatus.S}. Expected ${sessionStatusEnum.IN_PROGRESS} or ${sessionStatusEnum.ISSUED}.`
      })
    }

    await updatePhoneSession(
      id,
      null,
      sessionStatusEnum.VERIFICATION_FAILED,
      null,
      null,
      null,
      null,
      null,
      'Unknown'
    )

    return res.status(200).json({
      success: true
    })
  } catch (err) {
    const error = err as Error
    console.log('admin/fail-session: Error:', makeUnknownErrorLoggable(error))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}

// TODO: Use redis for this
const deletionRateLimit = {
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 100,
  current: 0,
  lastReset: Date.now()
}

/**
 * ENDPOINT.
 */
export async function deletePhoneNumber(
  req: Request,
  res: Response
): Promise<Response> {
  try {
    const apiKey = req.headers['x-api-key'] as string

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: 'Invalid API key.' })
    }

    const number = req.body.number as string

    if (!number) {
      return res
        .status(400)
        .json({ error: '`number` is required in request body' })
    }

    const exists = await new Promise<boolean>((resolve, reject) => {
      numberExists(number, (err, exists) => {
        if (err) {
          reject(err)
          return
        }
        resolve(exists)
      })
    })

    if (!exists) {
      return res.status(404).json({ error: 'Number not found' })
    }

    // We don't worry about time of use time of check here, for the rate limit,
    // because we assume the API key is secure. Rate limit is just an extra layer.
    if (deletionRateLimit.current >= deletionRateLimit.max) {
      if (
        Date.now() - deletionRateLimit.lastReset >
        deletionRateLimit.windowMs
      ) {
        deletionRateLimit.current = 0
        deletionRateLimit.lastReset = Date.now()
      } else {
        return res.status(429).json({ error: 'Rate limit exceeded' })
      }
    }
    deletionRateLimit.current++

    await new Promise<void>((resolve, reject) => {
      deleteNumber(number, (err, result) => {
        if (err) {
          reject(err)
          return
        }
        resolve()
      })
    })

    return res.status(200).json({
      message: `Deleted number ${number}`
    })
  } catch (err) {
    const error = err as Error
    console.log('admin/delete-phone-number: Error:', makeUnknownErrorLoggable(error))
    return res.status(500).json({ error: 'An unknown error occurred' })
  }
}
