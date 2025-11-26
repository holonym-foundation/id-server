/**
 * @param timestamp - Unix timestamp in milliseconds
 */
export function timestampIsWithinLast5Days(
  timestamp: number | string | undefined
): boolean {
  if (!timestamp) return false
  const timestampNum =
    typeof timestamp === 'string' ? parseInt(timestamp) : timestamp
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).getTime()
  return timestampNum >= fiveDaysAgo
}
