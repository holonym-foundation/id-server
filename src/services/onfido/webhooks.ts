import { Request, Response } from "express";
import crypto from "crypto";
import { IDVSessions } from "../../init.js";
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
async function handleCheckCompleted(payload: any) {
  const { object } = payload;
  const checkId = object?.id;
  const status = object?.status;
  const result = object?.result;
  const reportIds = object?.report_ids || [];

  if (!checkId) {
    webhookLogger.warn({ payload }, "Received check.completed without check_id");
    return;
  }

  webhookLogger.info(
    { checkId, status, result, reportIds },
    "Processing check.completed webhook"
  );

  try {
    // Find the session with this check_id and update it
    const session = await IDVSessions.findOneAndUpdate(
      { "onfido.checks.check_id": checkId },
      {
        $set: {
          "onfido.checks.$.status": status,
          "onfido.checks.$.result": result,
          "onfido.checks.$.report_ids": reportIds,
          "onfido.checks.$.webhookReceivedAt": new Date(),
        },
      },
      { new: true }
    ).exec();

    if (!session) {
      webhookLogger.warn(
        { checkId },
        "No session found for check_id in check.completed webhook"
      );
      return;
    }

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
 * Handle report.completed event
 */
async function handleReportCompleted(payload: any) {
  const { object } = payload;
  const reportId = object?.id;

  if (!reportId) {
    webhookLogger.warn({ payload }, "Received report.completed without report_id");
    return;
  }

  webhookLogger.info(
    { reportId },
    "Processing report.completed webhook"
  );

  try {
    // Find the session with this report_id in its report_ids array
    const session = await IDVSessions.findOne({
      "onfido.checks.report_ids": reportId,
    }).exec();

    if (!session) {
      webhookLogger.warn(
        { reportId },
        "No session found for report_id in report.completed webhook"
      );
      return;
    }

    // Find the specific check in the array that contains this report_id
    const checkIndex = session.onfido?.checks?.findIndex(
      (c: any) => c.report_ids?.includes(reportId)
    );

    if (checkIndex === undefined || checkIndex === -1) {
      webhookLogger.warn({ reportId }, "Check not found in session.onfido.checks");
      return;
    }

    // Add the report to completed_reports if it doesn't exist
    const completedReports = session.onfido?.checks?.[checkIndex]?.completed_reports || [];
    if (!completedReports.includes(reportId)) {
      completedReports.push(reportId);
    }

    // Update the session
    if (session.onfido?.checks?.[checkIndex]) {
      session.onfido.checks[checkIndex].completed_reports = completedReports;
      session.onfido.checks[checkIndex].webhookReceivedAt = new Date();
    }

    await session.save();

    webhookLogger.info(
      { reportId, sessionId: session._id },
      "Successfully marked report as completed"
    );
  } catch (err) {
    webhookLogger.error(
      { error: err, reportId },
      "Error updating session from report.completed webhook"
    );
    throw err;
  }
}

/**
 * Main webhook handler
 */
export async function handleOnfidoWebhook(req: Request, res: Response) {
  try {
    // Get the raw body for signature verification
    const rawBody = req.body.toString('utf8');
    const signature = req.headers["x-sha2-signature"] as string;

    // Parse the JSON for processing
    const payload = JSON.parse(rawBody);

    // Debug logging
    webhookLogger.info({
      headers: req.headers,
      signature: signature,
      rawBody: rawBody,
      payload: payload
    }, "Webhook received");

    if (!signature) {
      webhookLogger.warn("Webhook received without signature header");
      return res.status(401).json({ error: "Missing signature" });
    }

    // Verify the webhook signature
    const webhookToken = process.env.ONFIDO_WEBHOOK_TOKEN;
    if (!webhookToken) {
      webhookLogger.error("ONFIDO_WEBHOOK_TOKEN environment variable not set");
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

    // Parse the event
    const eventType = payload?.resource_type;

    webhookLogger.info({ eventType }, "Processing webhook event");

    // Handle different event types
    switch (eventType) {
      case "check":
        if (payload.action === "check.completed") {
          await handleCheckCompleted(payload);
        }
        break;

      case "report":
        if (payload.action === "report.completed") {
          await handleReportCompleted(payload);
        }
        break;

      default:
        webhookLogger.info(
          { eventType, action: payload?.action },
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

