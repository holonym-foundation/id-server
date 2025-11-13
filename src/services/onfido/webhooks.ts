import { Request, Response } from "express";
import crypto from "crypto";
import { getRouteHandlerConfig } from "../../init.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";
import { pinoOptions, logger } from "../../utils/logger.js";

const webhookLogger = logger.child({
  msgPrefix: "[POST /webhooks/onfido] ",
  base: {
    ...pinoOptions.base,
    service: "onfido-webhook",
  },
});

/**
 * Verify Onfido webhook signature
 * According to Onfido docs: https://documentation.onfido.com/api/latest/#verifying-webhook-signatures
 */
function verifyWebhookSignature(
  payload: string,
  signature: string,
  webhookToken: string
): boolean {
  try {
    const hmac = crypto.createHmac("sha256", webhookToken);
    const digest = hmac.update(payload).digest("hex");
    
    // Use timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(digest)
    );
  } catch (err) {
    webhookLogger.error({ error: err }, "Error verifying webhook signature");
    return false;
  }
}

/**
 * Handle check.completed event
 */
async function handleCheckCompleted(payload: any, config: SandboxVsLiveKYCRouteHandlerConfig) {
  const { object } = payload;
  const checkId = object?.id;
  const status = object?.status;
  const result = object?.result;
  const reportIds = object?.report_ids || [];

  if (!checkId) {
    webhookLogger.warn({ payload }, "Received check.completed without check_id");
    return;
  }

  try {
    // Find the session by check_id
    const session = await config.SessionModel.findOne({
      check_id: checkId
    }).exec();

    if (!session) {
      webhookLogger.warn(
        { checkId },
        "No session found for check_id in check.completed webhook"
      );
      return;
    }

    console.log("Found session for check_id:", checkId, "session_id:", session._id);

    // Update the session with check status
    session.check_status = status;
    session.check_last_updated_at = new Date();

    await session.save();

    webhookLogger.info(
      { checkId, sessionId: session._id },
      "Successfully updated check status from webhook"
    );
  } catch (err) {
    webhookLogger.error(
      { error: err, checkId },
      "Error updating session from check.completed webhook"
    );
    throw err;
  }
}

/**
 * Main webhook handler factory
 */
function createHandleOnfidoWebhookRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      // Get the raw body for signature verification
      const rawBody = req.body.toString('utf8');
      const signature = req.headers["x-sha2-signature"] as string;

      // Parse the JSON for processing
      const body = JSON.parse(rawBody);

      if (!signature) {
        webhookLogger.warn("Webhook received without signature header");
        return res.status(401).json({ error: "Missing signature" });
      }

      // Verify the webhook signature
      const webhookToken = config.onfidoWebhookToken;
      if (!webhookToken) {
        webhookLogger.error("onfidoWebhookToken not set in config");
        return res.status(500).json({ error: "Server configuration error" });
      }

      const isValid = verifyWebhookSignature(rawBody, signature, webhookToken);
      if (!isValid) {
        webhookLogger.warn(
          { signature },
          "Invalid webhook signature - possible spoofing attempt"
        );
        return res.status(401).json({ error: "Invalid signature" });
      }

      // Parse the event - handle different payload structures
      let eventType = body?.payload.resource_type;
      let action = body?.payload.action;
      let object = body?.payload.object;

      // Handle different event types
      switch (eventType) {
        case "check":
          if (action === "check.completed") {
            await handleCheckCompleted({ object }, config);
          }
          break;

        default:
          webhookLogger.info(
            { eventType, action },
            "Unhandled webhook event type"
          );
      }

      // return 200 OK quickly to acknowledge receipt
      res.status(200).json({ received: true });
    } catch (err) {
      webhookLogger.error({ error: err }, "Error processing webhook");
      
      // Still return 200 to prevent Onfido from retrying
      // We'll rely on fallback polling for this check
      res.status(200).json({ received: true, error: "Processing error" });
    }
  }
}

async function handleOnfidoWebhookLive(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createHandleOnfidoWebhookRouteHandler(config)(req, res);
}

async function handleOnfidoWebhookSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createHandleOnfidoWebhookRouteHandler(config)(req, res);
}

export {
  handleOnfidoWebhookLive,
  handleOnfidoWebhookSandbox,
};

