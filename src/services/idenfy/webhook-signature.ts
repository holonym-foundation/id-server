import crypto from "crypto";

/**
 * Verify HMAC-SHA256 over the raw request body using the configured signing
 * key. Returns true on a constant-time match.
 *
 * iDenfy delivers the signature as a hex string in the Idenfy-Signature
 * header.
 */
export function verifyIdenfyWebhookSignature(
  rawBody: Buffer | string,
  signature: string,
  signingKey: string
): boolean {
  if (!signature || !signingKey) return false;

  const hmac = crypto.createHmac("sha256", signingKey);
  hmac.update(rawBody);
  const computed = hmac.digest("hex");

  let provided: Buffer;
  let expected: Buffer;
  try {
    provided = Buffer.from(signature, "hex");
    expected = Buffer.from(computed, "hex");
  } catch {
    return false;
  }

  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}
