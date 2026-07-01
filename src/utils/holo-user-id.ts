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
 * divergence would break resolution now that the query fallback is removed
 * (Phase 3). Keep both in step when changing the header name.
 */
export const HOLO_USER_ID_HEADER = "X-Holo-User-Id";

/**
 * Resolve the caller's holoUserId / sigDigest from the `X-Holo-User-Id`
 * request header.
 *
 * Phase 3 of the rollout: the header is now the only accepted source — the
 * query-param fallback has been removed, so the identifier can never re-enter
 * a URL. Returns `undefined` when the header is absent, empty/whitespace-only,
 * or duplicated (Express joins repeated headers with ", ", and a legitimate
 * holoUserId never contains a comma); callers treat `undefined` as a missing
 * identifier and return their existing 400.
 *
 * The header value is returned as-is (untrimmed) so downstream validation
 * (length/type checks) and authorization comparisons against
 * `session.sigDigest` are unchanged.
 */
export function resolveHoloUserId(req: Request): string | undefined {
  const headerValue = req.header(HOLO_USER_ID_HEADER);
  if (
    typeof headerValue === "string" &&
    headerValue.trim().length > 0 &&
    !headerValue.includes(",")
  ) {
    return headerValue;
  }
  return undefined;
}
