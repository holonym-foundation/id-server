import { describe, it, expect } from "bun:test";
import crypto from "crypto";
import { verifyIdenfyWebhookSignature } from "./webhook-signature.js";

describe("verifyIdenfyWebhookSignature", () => {
  const signingKey = "test-signing-key-12345";

  function sign(body: string): string {
    return crypto.createHmac("sha256", signingKey).update(body).digest("hex");
  }

  it("returns true for valid signature on raw body", () => {
    const body = JSON.stringify({ scanRef: "abc", status: { overall: "APPROVED" } });
    const signature = sign(body);
    expect(verifyIdenfyWebhookSignature(body, signature, signingKey)).toBe(true);
  });

  it("returns false for tampered body", () => {
    const body = JSON.stringify({ scanRef: "abc", status: { overall: "APPROVED" } });
    const signature = sign(body);
    const tampered = JSON.stringify({ scanRef: "abc", status: { overall: "DENIED" } });
    expect(verifyIdenfyWebhookSignature(tampered, signature, signingKey)).toBe(false);
  });

  it("returns false for empty signature", () => {
    expect(verifyIdenfyWebhookSignature("body", "", signingKey)).toBe(false);
  });

  it("returns false for empty signing key", () => {
    expect(verifyIdenfyWebhookSignature("body", "abc", "")).toBe(false);
  });

  it("returns false for non-hex signature", () => {
    const body = "body";
    expect(
      verifyIdenfyWebhookSignature(body, "not-hex-####", signingKey)
    ).toBe(false);
  });

  it("validates Buffer body", () => {
    const body = Buffer.from(JSON.stringify({ scanRef: "abc" }));
    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(body)
      .digest("hex");
    expect(verifyIdenfyWebhookSignature(body, signature, signingKey)).toBe(true);
  });
});

// TODO(U11): integration tests for createHandleIdenfyWebhookRouteHandler
// covering: APPROVED → IN_PROGRESS, DENIED → VERIFICATION_FAILED, idempotent
// double-delivery, out-of-order warning. Requires a mocked SessionModel,
// which the existing test infra doesn't yet provide for unit-level webhook
// tests. Pattern follows services/sumsub/webhooks.test.ts (does not exist
// today either).
