import 'dotenv/config'
import twilio from 'twilio'
import { ERROR_MESSAGES } from '../../../constants/phone.js'
import { valkeyClient } from '../../../utils/valkey-glide.js'

// Validate required env vars at startup so misconfiguration fails loudly
if (!process.env.TWILIO_ACCOUNT_SID) throw new Error('TWILIO_ACCOUNT_SID env var is required')
if (!process.env.TWILIO_AUTH_TOKEN) throw new Error('TWILIO_AUTH_TOKEN env var is required')
if (!process.env.TWILIO_VERIFY_SERVICE_SID) throw new Error('TWILIO_VERIFY_SERVICE_SID env var is required')

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)
const VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID

const MAX_COUNTRY_ATTEMPTS_PER_MINUTE = 10
const MAX_COUNTRY_ATTEMPTS_PER_HOUR = 300

const cacheRequestFromCountry = async (countryCode: string): Promise<void> => {
  if (!valkeyClient) {
    throw new Error('valkeyClient is not defined')
  }
  const minuteKey = `country_requests_minutes:minute:${countryCode}`
  const hourKey = `country_requests_minutes:hour:${countryCode}`
  const countMinute = await valkeyClient.incr(minuteKey)
  const countHour = await valkeyClient.incr(hourKey)

  const minuteTTL = await valkeyClient.ttl(minuteKey)
  const hourTTL = await valkeyClient.ttl(hourKey)
  if (minuteTTL < 0) {
    await valkeyClient.expire(minuteKey, 60)
  }
  if (hourTTL < 0) {
    await valkeyClient.expire(hourKey, 3600)
  }

  if (
    countMinute > MAX_COUNTRY_ATTEMPTS_PER_MINUTE ||
    countHour > MAX_COUNTRY_ATTEMPTS_PER_HOUR
  ) {
    throw new Error(
      `${ERROR_MESSAGES.TOO_MANY_ATTEMPTS_COUNTRY} ${countryCode}`
    )
  }
}

export async function begin(
  phoneNumber: string,
  countryCode: string
): Promise<void> {
  await cacheRequestFromCountry(countryCode)
  await client.verify.v2.services(VERIFY_SERVICE_SID).verifications.create({
    to: phoneNumber,
    channel: 'sms'
  })
}

export async function verify(
  phoneNumber: string,
  otp: string
): Promise<boolean> {
  try {
    const check = await client.verify.v2
      .services(VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phoneNumber, code: otp })

    if (check.status === 'approved') return true
    // 'pending' = code submitted but wrong
    if (check.status === 'pending') throw new Error(ERROR_MESSAGES.OTP_DOES_NOT_MATCH)
    // Any other status (canceled, expired) = no valid verification
    throw new Error(ERROR_MESSAGES.OTP_NOT_FOUND)
  } catch (err: any) {
    // Twilio 20404: no verification exists for this number — treat as OTP_NOT_FOUND
    // so getCredentials error handling doesn't mark the session VERIFICATION_FAILED
    if (err.status === 404 || err.code === 20404) {
      throw new Error(ERROR_MESSAGES.OTP_NOT_FOUND)
    }
    // Twilio 60202: max check attempts reached — treat as wrong code
    if (err.code === 60202) {
      throw new Error(ERROR_MESSAGES.OTP_DOES_NOT_MATCH)
    }
    // Re-throw our own errors and anything else as-is
    throw err
  }
}
