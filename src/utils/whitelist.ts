import { SessionRetryWhitelist } from '../init.js'

/**
 * Gets the rate limit tier for a given blockchain address.
 * Returns 0 if the address is null or not whitelisted.
 *
 * @param address - The blockchain address to check (or null)
 * @returns Promise<number> - The tier number (0 if not whitelisted, 1 or greater for whitelisted)
 */
export async function getRateLimitTier(address: string | null): Promise<number> {
  if (!address) {
    return 0
  }

  try {
    const whitelistEntry = await SessionRetryWhitelist.findOne({ address }).exec()

    if (!whitelistEntry) {
      return 0
    }

    return whitelistEntry.tier ?? 0
  } catch (err) {
    console.error('Error fetching rate limit tier:', err)
    return 0 // Default to no whitelist on error
  }
}
