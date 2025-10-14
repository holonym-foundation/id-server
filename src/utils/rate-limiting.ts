import logger from './logger.js'
import { valkeyClient } from './valkey-glide.js'

const TEN = 10
const THIRTY_DAYS_IN_SECS = 60 * 60 * 24 * 30

// Define tier limits mapping
const TIER_LIMITS: Record<number, number> = {
  0: 10,  // default/non-whitelisted
  1: 12,  // tier 1 whitelisted
  2: 15,
  // Future tiers can be added here. If added, be sure to also update the db schema
  // 3: 30,
}

/**
 * Simple IP-based rate limiter.
 * Limits the number of requests from IP to 10 requests per 30 days
 * for the given subKey.
 */
async function rateLimit(ip: string, subKey: string) {
  const key = `NUM_REQUESTS_BY_IP:${subKey}:${ip}`
  return rateLimitOccurrencesPerSecs(key, TEN, THIRTY_DAYS_IN_SECS)
}

/**
 * Rate limiter that applies different limits based on tier.
 *
 * @param tier - The rate limit tier (0 for default, 1+ for whitelisted)
 * @param ip - The IP address to rate limit
 * @param subKey - The subkey for the rate limit (e.g., 'kyc-sessions')
 * @returns Object with count, limitExceeded, and maxForTier
 */
async function rateLimitByTier(tier: 0 | 1 | 2, ip: string, subKey: string) {
  const maxForTier = TIER_LIMITS[tier]
  const key = `NUM_REQUESTS_BY_IP:${subKey}:${ip}`

  const result = await rateLimitOccurrencesPerSecs(key, maxForTier, THIRTY_DAYS_IN_SECS)

  return {
    ...result,
    maxForTier
  }
}

/**
 * Simple rate limiter.
 * Limits the number of occurrences of key to i occurrences per n seconds.
 */
async function rateLimitOccurrencesPerSecs(
  key: string,
  i: number,
  n: number
) {
  if (!valkeyClient) {
    throw new Error('valkeyClient is not defined')
  }

  // Rate limiting
  const count = await valkeyClient.incr(key);
  const ttl = await valkeyClient.ttl(key);
  // -2 means the key does not exist. -1 means the key is not set to expire.
  if (ttl < 0) {
    await valkeyClient.expire(key, n);
  }
  if (count > i) {
    return {
      count,
      limitExceeded: true
    }
  }

  return {
    count,
    limitExceeded: false
  }
}

/**
 * Onfido has a 400 requests / minute rate limit. To allow requests
 * for existing onfido sessions to go through, we want new sessions
 * to be rate limited before, e.g., queries for onfido checks are
 * rate limited.
 * 
 * Run this function before calls to Onfido that occur early in the
 * verification flow
 */
async function onfidoSDKTokenAndApplicantRateLimiter() {
  // onfido's rate limit is 400, so limiting early requests to 350 gives us
  // room to make API requests associated with later parts of the flow.
  const maxOccurrences = 250
  const result = await rateLimitOccurrencesPerSecs(
    'onfido-api',
    maxOccurrences,
    60
  )

  if (result.limitExceeded) {
    logger.warn(
      {
        rateLimitKey: 'onfido-api',
        count: result.count,
      },
      'Rate limit exceeded (pre-emptive Onfido rate limiter)'
    )
  }

  return result
}

export {
  rateLimit,
  rateLimitByTier,
  rateLimitOccurrencesPerSecs,
  onfidoSDKTokenAndApplicantRateLimiter
}
