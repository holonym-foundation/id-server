import assert from 'assert'
import axios from 'axios'
// import { issue as issuev0, getAddress } from 'holonym-wasm-issuer'
import {
  issue as issuev2,
  // getAddress as getAddressv1
} from 'holonym-wasm-issuer-v2'
import express, { Request, Response, NextFunction } from 'express'
import { valkeyClient } from '../../utils/valkey-glide.js'
import { makeUnknownErrorLoggable } from '../../utils/errors.js'
import {
  addNumber,
  numberExists,
  getNumber,
  putPhoneSession,
  updatePhoneSession,
  getPhoneSessionById,
  putNullifierAndCreds,
  getNullifierAndCredsByNullifier,
  getSandboxPhoneSessionById,
  updateSandboxPhoneSession
  // putSandboxNullifierAndCreds,
  // getSandboxNullifierAndCredsByNullifier
} from './_utils/dynamodb.js'
import {
  failPhoneSession,
  setPhoneSessionIssued,
  failSandboxPhoneSession,
  setSandboxPhoneSessionIssued
} from './_utils/sessions-utils.js'
import { timestampIsWithinLast5Days } from './_utils/misc.js'
import { begin, verify } from './_utils/otp.js'
import { sessionStatusEnum } from '../../constants/misc.js'
import {
  maxAttemptsPerSession,
  ERROR_MESSAGES
} from '../../constants/phone.js'
import PhoneNumber from 'libphonenumber-js'
import AWS from 'aws-sdk'

const MAX_FRAUD_SCORE = 75 // ipqualityscore.com defines fraud score. This constant will be used to only allow phone numbers with a <= fraud score.

const PRIVKEY = process.env.PHONE_NUMBER_PRIVKEY as string
// const ADDRESS = getAddressv1(PRIVKEY)

const SANDBOX_PRIVKEY = process.env.PHONE_NUMBER_SANDBOX_PRIVKEY as string
// const SANDBOX_ADDRESS = SANDBOX_PRIVKEY ? getAddressv1(SANDBOX_PRIVKEY) : null

const MAX_SENDS_PER_30_DAYS = 20

if (typeof PRIVKEY !== 'string') {
  throw new Error('PHONE_NUMBER_PRIVKEY is not a string')
}
if (typeof SANDBOX_PRIVKEY !== 'string') {
  throw new Error('PHONE_NUMBER_SANDBOX_PRIVKEY is not a string')
}

/**
 * ENDPOINT.
 * 
 * Sends a new code to number (E.164 format e.g. +13109273149)
 */
// app.post('/send/v4', async (req: Request, res: Response) => {
export async function sendCode(req: Request, res: Response) {
  try {
    const number = req.body.number as string
    const sessionId = req.body.sessionId as string

    if (!number) {
      return res.status(400).send('Missing number')
    }
    if (!sessionId) {
      return res.status(400).send('Missing sessionId')
    }

    const session = await getPhoneSessionById(sessionId)

    if (!session?.Item) {
      return res.status(400).send('Invalid sessionId')
    }

    if (session.Item.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS) {
      return res
        .status(400)
        .send(
          `Session status is ${session.Item.sessionStatus.S}. Expected ${sessionStatusEnum.IN_PROGRESS}.`
        )
    }

    if (Number(session.Item.numAttempts.N) >= maxAttemptsPerSession) {
      await failPhoneSession(sessionId, 'Session has reached max attempts')
      return res.status(400).send('Session has reached max attempts')
    }

    const isRegistered = await getIsRegisteredWithinLast11Months(number)

    if (isRegistered) {
      console.log(
        `/send/v4: Number has been registered already. Number: ${number}. sessionId: ${sessionId}`
      )

      return res.status(400).send(`Number has been registered already!`)
    }

    // Rate limiting
    if (!valkeyClient) {
      throw new Error('valkeyClient is not defined')
    }
    const ip =
      (req.headers['x-forwarded-for'] as string) ??
      (req.socket.remoteAddress as string)
    const key = `NUM_SENDS_BY_IP:${ip}`
    const count = await valkeyClient.incr(key)
    const ttl = await valkeyClient.ttl(key)
    // -2 means the key does not exist. -1 means the key is not set to expire.
    if (ttl < 0) {
      await valkeyClient.expire(key, 60 * 60 * 24 * 30)
    }
    if (count > MAX_SENDS_PER_30_DAYS) {
      return res
        .status(429)
        .json({ error: `${ERROR_MESSAGES.TOO_MANY_ATTEMPTS_IP} ${ip}` })
    }

    const countryCode = getCountryFromPhoneNumber(number)

    // Some countries have a disproportionate amount of spam. Until we find a better solution, we block them
    if (['ID', 'IN', 'MM', 'BI', 'BO'].includes(countryCode)) {
      return res.status(400).json({
        error: `Unsupported country, '${countryCode}'`
      })
    }

    const response = await axios.get<{ fraud_score?: number }>(
      `https://ipqualityscore.com/api/json/phone/${process.env.IPQUALITYSCORE_APIKEY}/${number}?country[]=${countryCode}`
    )
    if (!('fraud_score' in response?.data)) {
      console.error(`Invalid response: ${JSON.stringify(response)}`)
      return res
        .status(500)
        .send({ error: 'Received invalid response from ipqualityscore' })
    }

    const isSafe = (response.data.fraud_score ?? 100) <= MAX_FRAUD_SCORE

    if (!isSafe) {
      console.log(
        `Phone number ${number} could not be determined to belong to a unique human`
      )
      await failPhoneSession(
        sessionId,
        `Phone number ${number} could not be determined to belong to a unique human`
      )
      return res.status(400).send({
        error: `Phone number could not be determined to belong to a unique human. sessionId: ${sessionId}`
      })
    }

    console.log('sending to ', number)
    await begin(number, countryCode)

    const attempts = Number(session.Item.numAttempts.N) + 1
    await updatePhoneSession(
      sessionId,
      null,
      null,
      null,
      null,
      attempts,
      null,
      null,
      null
    )

    return res.sendStatus(200)
  } catch (err: any) {
    const error = err as Error
    if (error.message.includes(ERROR_MESSAGES.TOO_MANY_ATTEMPTS_COUNTRY)) {
      return res.status(400).json({ error: error.message })
      // @ts-ignore
    } else if (axios.isAxiosError(err) && err.response) {
      console.error('Error sending code (1)', err.response.data)
      console.error('Error sending code (2)', err.response.status)
      console.error('Error sending code (3)', err.response.headers)
      // @ts-ignore
    } else if (axios.isAxiosError(err) && err.request) {
      console.error('Error sending code', err.request)
    } else {
      console.error('Error sending code', err)
    }

    return res.status(500).send('An unknown error occurred while sending OTP')
  }
}

/**
 * ENDPOINT.
 * 
 * Sandbox version of /send/v4 - does not send OTP or set cache
 */
// app.post('/sandbox/send/v4', async (req: Request, res: Response) => {
export async function sendCodeSandbox(req: Request, res: Response) {
  try {
    const number = req.body.number as string
    const sessionId = req.body.sessionId as string

    if (!number) {
      return res.status(400).send('Missing number')
    }
    if (!sessionId) {
      return res.status(400).send('Missing sessionId')
    }

    const session = await getSandboxPhoneSessionById(sessionId)

    if (!session?.Item) {
      return res.status(400).send('Invalid sessionId')
    }

    if (session.Item.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS) {
      return res
        .status(400)
        .send(
          `Session status is ${session.Item.sessionStatus.S}. Expected ${sessionStatusEnum.IN_PROGRESS}.`
        )
    }

    if (Number(session.Item.numAttempts.N) >= maxAttemptsPerSession) {
      await failSandboxPhoneSession(
        sessionId,
        'Session has reached max attempts'
      )
      return res.status(400).send('Session has reached max attempts')
    }

    // Update attempt count
    const attempts = Number(session.Item.numAttempts.N) + 1
    await updateSandboxPhoneSession(
      sessionId,
      null,
      null,
      null,
      null,
      attempts,
      null,
      null,
      null
    )

    // Return success without actually sending OTP or setting cache
    return res
      .status(200)
      .json({ success: true, message: 'Sandbox mode: OTP not sent' })
  } catch (err) {
    console.log('phone/sendCodeSandbox: Error:', makeUnknownErrorLoggable(err))
    return res.status(500).send('An unknown error occurred')
  }
}

function getIsRegistered(phoneNumber: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    numberExists(phoneNumber, (err, result) => {
      console.log('is registered', result)
      if (err) {
        reject(err)
        return
      }

      if (result && !process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
        resolve(true)
        return
      }
      resolve(false)
    })
  })
}

function getIsRegisteredWithinLast11Months(
  phoneNumber: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    getNumber(phoneNumber, (err, result) => {
      console.log('result', result)
      if (err) {
        reject(err)
        return
      }

      if (
        result?.Item?.insertedAt?.N &&
        !process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING
      ) {
        const now = new Date()
        const insertedAt = new Date(parseInt(result.Item.insertedAt.N))

        // If the number was inserted within the last 11 months, it is considered registered
        if (
          now.getTime() - insertedAt.getTime() <
          1000 * 60 * 60 * 24 * 30 * 11
        ) {
          resolve(true)
          return
        } else {
          resolve(false)
          return
        }
      }
      resolve(false)
    })
  })
}

function getIsRegisteredWithinLast11MonthsAndNotLast5Days(
  phoneNumber: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    getNumber(phoneNumber, (err, result) => {
      if (err) {
        reject(err)
        return
      }

      if (
        result?.Item?.insertedAt?.N &&
        !process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING
      ) {
        const now = new Date()
        const insertedAt = new Date(parseInt(result.Item.insertedAt.N))

        console.log('insertedAt', insertedAt)

        const insertedWithinLast11Months =
          now.getTime() - insertedAt.getTime() < 1000 * 60 * 60 * 24 * 30 * 11
        const insertedOver5DaysAgo =
          now.getTime() - insertedAt.getTime() > 1000 * 60 * 60 * 24 * 5
        if (insertedWithinLast11Months && insertedOver5DaysAgo) {
          resolve(true)
          return
        } else {
          resolve(false)
          return
        }
      }
      resolve(false)
    })
  })
}

/**
 * ENDPOINT.
 * 
 * v6 is similar to v5, except it allows a user to get their signed credentials again
 * up to 5 days after initial issuance if they provide the same nullifier
 */
// app.get(
//   '/getCredentials/v6/:number/:code/:country/:sessionId/:nullifier',
//   async (req: Request, res: Response) => {
export async function getCredentials(req: Request, res: Response) {
  req.setTimeout(10000)
  console.log('getCredentials v6 was called for number', req.params.number)

  const issuanceNullifier = req.params.nullifier
  const sessionId = req.params.sessionId

  try {
    const _number = BigInt(issuanceNullifier)
  } catch (err) {
    return res.status(400).json({
      error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`
    })
  }

  try {
    const session = await getPhoneSessionById(sessionId)

    if (!session) {
      return res.status(400).send('Invalid sessionId')
    }

    if (
      session.Item?.sessionStatus.S === sessionStatusEnum.VERIFICATION_FAILED
    ) {
      return res.status(400).send({
        error: `Session status is ${
          session.Item.sessionStatus.S
        }. Expected ${sessionStatusEnum.IN_PROGRESS}. Failure reason: ${
          session.Item?.failureReason?.S ?? 'Unknown'
        }`
      })
    }

    // First, check if the user is looking up their credentials using their nullifier
    const phoneByNullifierResult =
      await getNullifierAndCredsByNullifier(issuanceNullifier)
    const phoneByNullifier = phoneByNullifierResult?.Item?.phoneNumber?.S
    const createdAt = phoneByNullifierResult?.Item?.createdAt?.N
    if (phoneByNullifier && timestampIsWithinLast5Days(createdAt)) {
      console.log('getCredentials/v6: Got phone number from nullifier lookup')
      const isRegistered =
        await getIsRegisteredWithinLast11MonthsAndNotLast5Days(
          phoneByNullifier
        )

      if (isRegistered) {
        console.log(
          `Number has been registered already. Number: ${phoneByNullifier}. sessionId: ${sessionId}`
        )

        await failPhoneSession(
          sessionId,
          'Number has been registered already'
        )

        return res.status(400).send({
          error: 'Number has been registered already!'
        })
      }

      // Note that we don't need to validate the phone number again.

      const phoneNumber = phoneByNullifier.replace('+', '')
      const creds = JSON.parse(
        issuev2(PRIVKEY, issuanceNullifier, phoneNumber, '0')
      )

      await setPhoneSessionIssued(sessionId)

      if (!process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
        addNumber(phoneByNullifier)
      }

      return res.send(creds)
    }

    if (session.Item?.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS) {
      return res.status(400).send({
        error: `Session status is ${session.Item?.sessionStatus.S}. Expected ${sessionStatusEnum.IN_PROGRESS}.`
      })
    }

    const result = await verify(req.params.number, req.params.code)

    if (!result) {
      await failPhoneSession(
        sessionId,
        'Could not verify number with given code'
      )

      return res
        .status(400)
        .send({ error: 'Could not verify number with given code' })
    }

    const isRegistered = await getIsRegisteredWithinLast11Months(
      req.params.number
    )

    if (isRegistered) {
      console.log(
        `Number has been registered already. Number: ${req.params.number}. sessionId: ${sessionId}`
      )

      await failPhoneSession(sessionId, 'Number has been registered already')

      return res.status(400).send({
        error: 'Number has been registered already!'
      })
    }

    const phoneNumber = req.params.number.replace('+', '')
    const creds = JSON.parse(
      issuev2(PRIVKEY, issuanceNullifier, phoneNumber, '0')
    )

    await setPhoneSessionIssued(sessionId)

    // Allow disabling of Sybil resistance for testing this script can be tested more than once ;)
    if (!process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
      addNumber(req.params.number)
    }

    await putNullifierAndCreds(issuanceNullifier, req.params.number)

    return res.send(creds)
  } catch (err) {
    console.log(`getCredentials v6: error for session ${sessionId}`, makeUnknownErrorLoggable(err))

    const error = err as Error

    // We do not set session status to VERIFICATION_FAILED if the error was simply
    // due to rate limiting requests from the user's country or if user inputted incorrect
    // OTP.
    const acceptableErrors: string[] = [
      ERROR_MESSAGES.OTP_DOES_NOT_MATCH,
      ERROR_MESSAGES.OTP_NOT_FOUND,
      ERROR_MESSAGES.TOO_MANY_ATTEMPTS_COUNTRY,
      ERROR_MESSAGES.TOO_MANY_ATTEMPTS_IP
    ]
    if (!acceptableErrors.includes(error.message)) {
      await failPhoneSession(sessionId, error.message)
    }

    if (error.message === ERROR_MESSAGES.OTP_NOT_FOUND) {
      return res.status(400).send({ error: ERROR_MESSAGES.OTP_NOT_FOUND })
    }
    if (error.message === ERROR_MESSAGES.OTP_DOES_NOT_MATCH) {
      return res
        .status(400)
        .send({ error: ERROR_MESSAGES.OTP_DOES_NOT_MATCH })
    }

    return res.status(500).send({
      error: `An unknown error occurred. Could not verify number with given code. sessionId: ${req.params.sessionId}`
    })
  }

}

// Sandbox version of /getCredentials/v6 - does not check cache or call production APIs
// app.get(
//   '/sandbox/getCredentials/v6/:number/:code/:country/:sessionId/:nullifier',
//   async (req: Request, res: Response) => {
export async function getCredentialsSandbox(req: Request, res: Response) {
  req.setTimeout(10000)
  console.log(
    'getCredentials v6 sandbox was called for number',
    req.params.number
  )

  const issuanceNullifier = req.params.nullifier
  const sessionId = req.params.sessionId

  if (!SANDBOX_PRIVKEY) {
    return res.status(500).json({
      error: 'SANDBOX_PRIVKEY not configured'
    })
  }

  try {
    const _number = BigInt(issuanceNullifier)
  } catch (err) {
    return res.status(400).json({
      error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`
    })
  }

  try {
    const session = await getSandboxPhoneSessionById(sessionId)

    if (!session?.Item) {
      return res.status(400).send('Invalid sessionId')
    }

    if (
      session.Item.sessionStatus.S === sessionStatusEnum.VERIFICATION_FAILED
    ) {
      return res.status(400).send({
        error: `Session status is ${
          session.Item.sessionStatus.S
        }. Expected ${sessionStatusEnum.IN_PROGRESS}. Failure reason: ${
          session.Item?.failureReason?.S ?? 'Unknown'
        }`
      })
    }

    // In sandbox mode, there's no need to do the lookup via nullifier.
    // const phoneByNullifierResult =
    //   await getSandboxNullifierAndCredsByNullifier(issuanceNullifier)
    // const phoneByNullifier = phoneByNullifierResult?.Item?.phoneNumber?.S
    // const createdAt = phoneByNullifierResult?.Item?.createdAt?.N
    // if (phoneByNullifier && timestampIsWithinLast5Days(createdAt ? parseInt(createdAt) : undefined)) {
    //   console.log('getCredentials/v6/sandbox: Got phone number from nullifier lookup')

    //   // Note: In sandbox mode, we don't check if number is registered

    //   const phoneNumber = phoneByNullifier.replace('+', '')
    //   const creds = JSON.parse(
    //     issuev2(SANDBOX_PRIVKEY, issuanceNullifier, phoneNumber, '0')
    //   )

    //   await setSandboxPhoneSessionIssued(sessionId)

    //   return res.send(creds)
    // }

    if (session.Item.sessionStatus.S !== sessionStatusEnum.IN_PROGRESS) {
      return res.status(400).send({
        error: `Session status is ${session.Item.sessionStatus.S}. Expected ${sessionStatusEnum.IN_PROGRESS}.`
      })
    }

    // In sandbox mode, we don't verify the OTP - we just accept any code
    // This allows testing without actually sending/receiving OTPs

    // Note: In sandbox mode, we don't check if number is registered

    const phoneNumber = req.params.number.replace('+', '')
    const creds = JSON.parse(
      issuev2(SANDBOX_PRIVKEY, issuanceNullifier, phoneNumber, '0')
    )

    await setSandboxPhoneSessionIssued(sessionId)

    // await putSandboxNullifierAndCreds(issuanceNullifier, req.params.number)

    return res.send(creds)
  } catch (err) {
    console.log(
      `getCredentials v6 sandbox: error for session ${sessionId}`,
      makeUnknownErrorLoggable(err)
    )

    // We do not set session status to VERIFICATION_FAILED for sandbox mode
    // since we're not doing real verification

    return res.status(500).send({
      error: `An unknown error occurred. sessionId: ${req.params.sessionId}`
    })
  }
}

function getCountryFromPhoneNumber(phoneNumber: string): string {
  try {
    const parsedPhoneNumber = PhoneNumber(phoneNumber)
    if (!parsedPhoneNumber) {
      throw new Error('Could not parse phone number')
    }
    const countryCode = parsedPhoneNumber.country

    if (!countryCode) {
      throw new Error('Could not determine country code from phone number')
    }

    return countryCode
  } catch (err) {
    console.error('Error parsing phone number:', err)
    throw err
  }
}

// Express error handling
// app.use(function (err: Error, req: Request, res: Response, next: NextFunction) {
//   console.log('error: ', err)
//   const status = (err as any).status || 500
//   res.status(status).send(err)
//   return
// })

/* Functions */

// async function credsFromNumber(phoneNumberWithPlus: string): Promise<string> {
//   console.log('credsFromNumber was called with number ', phoneNumberWithPlus)
//   const phoneNumber = phoneNumberWithPlus.replace('+', '')
//   return issuev0(PRIVKEY, phoneNumber, '0')
// }

// function registerAndGetCredentialsIfSafe(
//   version: string,
//   phoneNumber: string,
//   country: string,
//   next: (err: any) => void,
//   callback: (credentials: string) => void
// ): void {
//   // let credsFromNumber = version == "v2" ? credsFromNumberV2 : credsFromNumberDeprecating
//   console.log('registerAndGetCredentialsIfSafe was called')
//   assert(phoneNumber && country)
//   try {
//     registerIfSafe(phoneNumber, country, next, (isSafe) => {
//       if (!isSafe) {
//         console.log(
//           `phone number ${phoneNumber} could not be determined to belong to a unique human`
//         )
//         next('phone number could not be determined to belong to a unique human')
//       } else {
//         credsFromNumber(phoneNumber).then((creds) => callback(creds))
//       }
//     })
//   } catch (error) {
//     console.error('error', error)
//     next(error)
//   }
// }

// function registerIfSafe(
//   phoneNumber: string,
//   country: string,
//   next: (err: any) => void,
//   callback: (isSafe: boolean) => void
// ): void {
//   try {
//     assert(phoneNumber && country)
//     axios
//       .get<{ fraud_score?: number }>(
//         `https://ipqualityscore.com/api/json/phone/${process.env.IPQUALITYSCORE_APIKEY}/${phoneNumber}?country[]=${country}`
//       )
//       .then((response) => {
//         if (!('fraud_score' in response?.data)) {
//           next(`Invalid response: ${JSON.stringify(response)} `)
//           return
//         }
//         numberExists(phoneNumber, (err, result) => {
//           console.log('is registered', result)
//           if (result && !process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
//             next('Number has been registered already!')
//             return
//           }
//           // Allow disabling of Sybil resistance for testing this script can be tested more than once ;)
//           if (!process.env.DISABLE_SYBIL_RESISTANCE_FOR_TESTING) {
//             addNumber(phoneNumber)
//           }
//           callback((response.data.fraud_score ?? 100) <= MAX_FRAUD_SCORE)
//         })
//       })
//       .catch((err) => next(err))
//   } catch (err) {
//     next(err)
//   }
// }
