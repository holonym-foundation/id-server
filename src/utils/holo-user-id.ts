import type { Request } from "express";

/**
 * The request header through which the frontend transmits the user's
 * holoUserId / sigDigest. Moving this value out of URL query strings keeps it
 * out of browser history, proxy/CDN access logs, and monitoring pipelines
 * (see internal-docs #1505).
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
 */
export function resolveHoloUserId<T>(
  req: Request,
  fallback: T
): string | T {
  const headerValue = req.header(HOLO_USER_ID_HEADER);
  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    return headerValue;
  }
  return fallback;
}
