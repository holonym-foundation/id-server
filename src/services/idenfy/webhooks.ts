import { Request, Response } from "express";
import crypto from "crypto";
import { getRouteHandlerConfig } from "../../init.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";
import { sessionStatusEnum } from "../../constants/misc.js";
import { pinoOptions, logger } from "../../utils/logger.js";

/**
 * iDenfy webhook payload (top-level fields we consume).
 *
 * Per iDenfy docs (https://documentation.idenfy.com/api/result-callbacks):
 *   - clientId: partner-supplied identifier (we use session._id.toString()).
 *   - scanRef: durable iDenfy session id (matches Session.idenfyScanRef).
 *   - status.overall: 'APPROVED' | 'DENIED' | 'SUSPECTED' | 'EXPIRED' | 'ACTIVE'.
 *   - additionalSteps: optional sub-status.
 *
 * The exact header name for the HMAC signature is `Idenfy-Signature` per the
 * docs landing page. Some integrations alternatively use lower-case
 * `idenfy-signature`; Express normalizes header names to lower-case so we
 * read with bracket-access in lower-case.
 *
 * TODO(U11): confirm exact header name against a real sandbox webhook.
 */
type IdenfyWebhookPayload = {
  clientId?: string;
  scanRef: string;
  externalRef?: string;
  status?: {
    overall?: "APPROVED" | "DENIED" | "SUSPECTED" | "EXPIRED" | "ACTIVE" | string;
    autoFace?: string;
    manualFace?: string;
    autoDocument?: string;
    manualDocument?: string;
    suspicionReasons?: string[];
    mismatchTags?: string[];
    fraudTags?: string[];
    additionalSteps?: Record<string, unknown>;
  };
  data?: Record<string, unknown>;
  fileUrls?: Record<string, string>;
  [key: string]: unknown;
};

const webhookLogger = logger.child({
  msgPrefix: "[POST /idenfy/webhook] ",
  base: {
    ...pinoOptions.base,
    service: "idenfy-webhook",
  },
});

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

/**
 * Map iDenfy status.overall → internal session status.
 *
 * Mirrors Sumsub's mapping convention (services/sumsub/webhooks.ts):
 *   - APPROVED → IN_PROGRESS (the credentials/v3 endpoint moves to ISSUED
 *     after re-fetching via /api/v2/data and issuing creds — same pattern as
 *     Sumsub's GREEN flow).
 *   - DENIED / SUSPECTED / EXPIRED → VERIFICATION_FAILED.
 *   - ACTIVE / unknown → no status change (still in progress).
 */
function mapIdenfyStatusToSessionStatus(overall: string | undefined): {
  newStatus?: string;
  failureReason?: string;
} {
  switch (overall) {
    case "APPROVED":
      return { newStatus: sessionStatusEnum.IN_PROGRESS };
    case "DENIED":
      return {
        newStatus: sessionStatusEnum.VERIFICATION_FAILED,
        failureReason: "iDenfy: verification denied",
      };
    case "SUSPECTED":
      return {
        newStatus: sessionStatusEnum.VERIFICATION_FAILED,
        failureReason: "iDenfy: verification suspected",
      };
    case "EXPIRED":
      return {
        newStatus: sessionStatusEnum.VERIFICATION_FAILED,
        failureReason: "iDenfy: verification expired",
      };
    default:
      return {};
  }
}

/**
 * Main webhook handler factory.
 */
function createHandleIdenfyWebhookRouteHandler(
  config: SandboxVsLiveKYCRouteHandlerConfig
) {
  return async (req: Request, res: Response) => {
    // Body must arrive as raw bytes — the raw-body middleware is mounted on
    // /idenfy/webhook (and the sandbox parallel) for exactly this reason.
    // If we got anything else (string or parsed JSON), the middleware order
    // is broken and HMAC verification cannot be safe — re-serializing JSON
    // would produce different bytes than iDenfy signed (key ordering,
    // whitespace, escaping), causing silent 401 storms. Fail closed.
    if (!Buffer.isBuffer(req.body)) {
      webhookLogger.error(
        { bodyType: typeof req.body },
        "iDenfy webhook received non-Buffer body — raw-body middleware misconfigured"
      );
      return res.status(500).json({ error: "Webhook middleware misconfigured" });
    }
    const rawBody: Buffer = req.body;

    // TODO(U11): the exact header name is documented as `Idenfy-Signature`
    // on the docs landing page. Express lower-cases all incoming headers.
    const signature = (req.headers["idenfy-signature"] as string) || "";
    const signingKey = config.idenfyWebhookSigningKey;

    if (!signingKey) {
      webhookLogger.error(
        { environment: config.environment },
        "iDenfy webhook signing key not configured for this environment"
      );
      return res.status(500).json({ error: "Server configuration error" });
    }

    if (!signature) {
      webhookLogger.warn("iDenfy webhook received without Idenfy-Signature header");
      return res.status(401).json({ error: "Missing signature" });
    }

    const isValid = verifyIdenfyWebhookSignature(rawBody, signature, signingKey);
    if (!isValid) {
      webhookLogger.warn(
        { signaturePresent: !!signature },
        "Invalid iDenfy webhook signature - possible spoofing attempt"
      );
      return res.status(401).json({ error: "Invalid signature" });
    }

    let body: IdenfyWebhookPayload;
    try {
      const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
      body = JSON.parse(text) as IdenfyWebhookPayload;
    } catch (err) {
      webhookLogger.warn({ error: err }, "Malformed iDenfy webhook body");
      return res.status(400).json({ error: "Malformed body" });
    }

    const scanRef = body.scanRef;
    const overall = body.status?.overall;

    if (!scanRef) {
      // Do not log the full body — iDenfy webhooks carry KYC PII
      // (data.docFirstName/docLastName/docDob/docNumber/docNationality/address).
      // HMAC has already passed by this point, so any payload here is a real
      // KYC document, not attacker noise.
      webhookLogger.warn(
        {
          overall,
          clientId: (body as { clientId?: unknown }).clientId,
          payloadKeys: Object.keys(body ?? {}),
        },
        "iDenfy webhook missing scanRef"
      );
      return res.status(400).json({ error: "Missing scanRef" });
    }

    webhookLogger.info(
      { scanRef, overall, environment: config.environment },
      "Received iDenfy webhook"
    );

    try {
      const idenfySession = await config.IdenfySessionModel.findOne({
        idenfyScanRef: scanRef,
      }).exec();

      if (!idenfySession) {
        webhookLogger.warn(
          { scanRef },
          "No iDenfy session found for scanRef in webhook"
        );
        return res.status(404).json({ error: "Session not found" });
      }

      const { failureReason } = mapIdenfyStatusToSessionStatus(overall);

      // Map raw iDenfy status to standalone-collection lifecycle.
      // APPROVED → 'complete'; DENIED/SUSPECTED/EXPIRED → 'failed'; else unchanged.
      let nextLifecycle: string | undefined;
      if (overall === "APPROVED") nextLifecycle = "complete";
      else if (overall === "DENIED" || overall === "SUSPECTED" || overall === "EXPIRED") {
        nextLifecycle = "failed";
      }

      // Idempotency: if already in the matching terminal state, no-op.
      if (
        nextLifecycle &&
        idenfySession.status === nextLifecycle &&
        idenfySession.idenfyVerificationStatus === overall
      ) {
        webhookLogger.info(
          { scanRef, idenfySessionId: idenfySession._id, overall },
          "iDenfy webhook is idempotent no-op (status already set)"
        );
        return res.status(200).json({ received: true });
      }

      if (overall) {
        idenfySession.idenfyVerificationStatus = overall;
      }
      if (nextLifecycle) {
        idenfySession.status = nextLifecycle;
      }
      if (failureReason) {
        idenfySession.verificationFailureReason = failureReason;
      }
      if (overall || nextLifecycle || failureReason) {
        await idenfySession.save();
        webhookLogger.info(
          {
            scanRef,
            idenfySessionId: idenfySession._id,
            overall,
            nextLifecycle,
          },
          "Updated iDenfy session from webhook"
        );
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      webhookLogger.error(
        { error: err, scanRef },
        "Error processing iDenfy webhook"
      );
      // Return 500 so iDenfy retries the delivery — a transient DB blip must
      // not silently strand the user's session. HMAC has already verified the
      // payload at this point, so we know the retry will be a legitimate
      // re-delivery from iDenfy.
      return res
        .status(500)
        .json({ received: false, error: "Processing error" });
    }
  };
}

export async function handleIdenfyWebhookLive(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createHandleIdenfyWebhookRouteHandler(config)(req, res);
}

export async function handleIdenfyWebhookSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createHandleIdenfyWebhookRouteHandler(config)(req, res);
}
