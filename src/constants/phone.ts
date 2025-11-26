export const maxAttemptsPerSession = 3

export const ERROR_MESSAGES = {
  OTP_NOT_FOUND: 'OTP not found',
  OTP_DOES_NOT_MATCH: 'OTP does not match',
  TOO_MANY_ATTEMPTS_COUNTRY: 'Too many recent attempts from country',
  TOO_MANY_ATTEMPTS_IP: 'Too many recent attempts from IP address'
} as const
