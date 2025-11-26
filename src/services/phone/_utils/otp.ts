import 'dotenv/config'
import crypto from 'crypto'
import Messente from 'messente_api'
import { ERROR_MESSAGES } from '../../../constants/phone.js'
import { valkeyClient } from '../../../utils/valkey-glide.js'
import { TimeUnit } from '@valkey/valkey-glide'

const OTP_EXPIRY = 60 * 5 // 5 minutes

const client = Messente.ApiClient.instance
const basicAuth = client.authentications['basicAuth']
basicAuth.username = process.env.MESSENTE_API_USERNAME
basicAuth.password = process.env.MESSENTE_API_PASSWORD
const api = new Messente.OmnimessageApi()

const MAX_COUNTRY_ATTEMPTS_PER_MINUTE = 10
const MAX_COUNTRY_ATTEMPTS_PER_HOUR = 300

const getOTP = (): string =>
  crypto.randomInt(0, 1000000).toString().padStart(6, '0')

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
  // -2 means the key does not exist. -1 means the key is not set to expire.
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

const cacheOTP = async (phoneNumber: string, otp: string): Promise<void> => {
  if (!valkeyClient) {
    throw new Error('valkeyClient is not defined')
  }
  await valkeyClient.set(`OTP:${phoneNumber}`, otp, { expiry: { type: TimeUnit.Seconds, count: OTP_EXPIRY } })
}

const checkOTP = async (phoneNumber: string, otp: string): Promise<boolean> => {
  if (!valkeyClient) {
    throw new Error('valkeyClient is not defined')
  }
  const cachedOTP = await valkeyClient.get(`OTP:${phoneNumber}`)

  if (!cachedOTP) throw new Error(ERROR_MESSAGES.OTP_NOT_FOUND)
  if (cachedOTP !== otp) throw new Error(ERROR_MESSAGES.OTP_DOES_NOT_MATCH)

  // If we got here it was successful. Clear and return true
  await valkeyClient.del([`OTP:${phoneNumber}`])
  return true
}

const sendOTP = async (phoneNumber: string, otp: string): Promise<void> => {
  const text = `${otp} is your verification code`
  const sender = 'Holonym'

  // const viber = Messente.Viber.constructFromObject({text, sender});
  // const whatsappText = Messente.WhatsAppText.constructFromObject({text});
  // const whatsapp = Messente.WhatsApp.constructFromObject({text:whatsappText});
  const sms = Messente.SMS.constructFromObject({ text, sender })

  const omnimessage = Messente.Omnimessage.constructFromObject({
    messages: [sms /*,viber*/],
    to: phoneNumber
  })

  api.sendOmnimessage(omnimessage, (error: any, data: any, response: any) => {
    console.error('error?', error)
    console.log('data', data)
    // console.log('response', response)
  })
}

export async function begin(
  phoneNumber: string,
  countryCode: string
): Promise<void> {
  const otp = getOTP()
  await cacheRequestFromCountry(countryCode)
  await cacheOTP(phoneNumber, otp)
  await sendOTP(phoneNumber, otp)
}

export async function verify(
  phoneNumber: string,
  otp: string
): Promise<boolean> {
  return await checkOTP(phoneNumber, otp)
}
// todo: fallbacks: viber -> whatsapp -> sms? or sms -> viber -> whatsapp? or sms -> whatsapp -> viber? SMS is most expensive but also what our users expect. Perhaps do viber or whatsapp if SMS doesn't deliver??
// todo: delivery webhook
