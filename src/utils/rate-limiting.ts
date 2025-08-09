import { valkeyClient } from './valkey-glide.js'

const MAX_REQUESTS_PER_30_DAYS = 15
const THIRTY_DAYS_IN_SECS = 60 * 60 * 24 * 30

/**
 * Simple IP-based rate limiter.
 * Limits the number of requests from IP to 10 requests per 30 days
 * for the given subKey.
 */
async function rateLimit(ip: string, subKey: string) {
  if (!valkeyClient) {
    throw new Error('valkeyClient is not defined')
  }

  // Rate limiting
  const key = `NUM_REQUESTS_BY_IP:${subKey}:${ip}`;
  const count = await valkeyClient.incr(key);
  const ttl = await valkeyClient.ttl(key);
  // -2 means the key does not exist. -1 means the key is not set to expire.
  if (ttl < 0) {
    await valkeyClient.expire(key, THIRTY_DAYS_IN_SECS);
  }
  if (count > MAX_REQUESTS_PER_30_DAYS) {
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

export {
  rateLimit
}
