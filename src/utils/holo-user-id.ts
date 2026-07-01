import type { Request } from "express";

/**
 * The request header through which the frontend transmits the user's
 * holoUserId / sigDigest. Moving this value out of URL query strings keeps it
 * out of browser history, proxy/CDN access logs, and monitoring pipelines
 * (see internal-docs #1505).
 *
 * NOTE: this literal is duplicated in the frontend at
 * frontend/src/lib/frontend/holoUserIdHeader.ts (the two repos deploy
 * independently and share no package). They MUST stay in sync — a silent
 * divergence would break resolution once the Phase 2/3 query fallback is
 * removed. Keep both in step when changing the header name.
 */
export const HOLO_USER_ID_HEADER = "X-Holo-User-Id";

/**
 * Resolve the caller's holoUserId / sigDigest, preferring the
 * `X-Holo-User-Id` request header and falling back to the value the handler
 * previously read from the query string.
 *
 * Phase 1 of the rollout is intentionally additive: the header takes
 * precedence when present, but requests that still send only the query param
 * continue to work unchanged. A present-but-empty (or whitespace-only) header
 * is treated as absent so a client cannot lock itself out by sending an empty
 * value.
 *
 * The header value is returned as-is (untrimmed) so downstream validation
 * (length/type checks) and authorization comparisons against
 * `session.sigDigest` behave identically to the query-sourced value.
 *
 * A duplicated header is ignored: Express joins repeated header values with
 * ", ", and a legitimate holoUserId (64 hex chars) never contains a comma, so
 * a comma-bearing value is treated as absent and we fall back to the query
 * param. This mirrors how the query path rejects a duplicated `?sigDigest=a&b`
 * (an array) rather than trusting an ambiguous value.
 */
export function resolveHoloUserId<T>(
  req: Request,
  fallback: T
): string | T {
  const headerValue = req.header(HOLO_USER_ID_HEADER);
  if (
    typeof headerValue === "string" &&
    headerValue.trim().length > 0 &&
    !headerValue.includes(",")
  ) {
    return headerValue;
  }
  return fallback;
}
