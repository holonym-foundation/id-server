import { Request, Response } from "express";
import { getRouteHandlerConfig } from "../../init.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";
import { verifySumsubWebhookSignature } from "../../utils/sumsub.js";
import { sessionStatusEnum } from "../../constants/misc.js";
import { pinoOptions, logger } from "../../utils/logger.js";

/**
 * Sumsub webhook payload types.
 * See: https://docs.sumsub.com/docs/user-verification-webhooks
 */
type SumsubWebhookReviewResult = {
  reviewAnswer: "GREEN" | "RED" | "YELLOW";
  reviewRejectType?: "FINAL" | "RETRY";
  rejectLabels?: string[];
  moderationComment?: string;
  clientComment?: string;
  buttonIds?: string[];
};

type SumsubWebhookPayload = {
  applicantId: string;
  inspectionId: string;
  correlationId: string;
  levelName: string;
  externalUserId: string;
  type: string;
  sandboxMode: boolean;
  reviewStatus: string;
  createdAtMs: string;
  clientId: string;
  applicantType?: "individual" | "company";
  reviewResult?: SumsubWebhookReviewResult;
  reviewMode?: string;
};

const webhookLogger = logger.child({
  msgPrefix: "[POST /sumsub/webhooks] ",
  base: {
    ...pinoOptions.base,
    service: "sumsub-webhook",
  },
});

/**
 * Handle applicantReviewed event — verification complete.
 *
 * reviewResult shape:
 *   reviewAnswer: "GREEN" | "RED"
 *   reviewRejectType: "FINAL" | "RETRY" (only when RED)
 *   rejectLabels: string[] (only when RED)
 *   moderationComment: string (only when RED)
 *   clientComment: string (only when RED)
 */
async function handleApplicantReviewed(
  payload: SumsubWebhookPayload,
  config: SandboxVsLiveKYCRouteHandlerConfig
) {
  const { applicantId, externalUserId, reviewResult, reviewStatus } = payload;

  if (!applicantId) {
    webhookLogger.warn({ payload }, "applicantReviewed missing applicantId");
    return;
  }

  const reviewAnswer = reviewResult?.reviewAnswer;
  const reviewRejectType = reviewResult?.reviewRejectType;

  try {
    // Look up session by sumsub_applicant_id
    const session = await config.SessionModel.findOne({
      sumsub_applicant_id: applicantId,
      idvProvider: "sumsub",
    }).exec();

    if (!session) {
      webhookLogger.warn(
        { applicantId, externalUserId },
        "No session found for applicantId in applicantReviewed webhook"
      );
      return;
    }

    if (reviewAnswer === "YELLOW") {
      webhookLogger.error(
        { applicantId, externalUserId, reviewResult },
        "Received YELLOW reviewAnswer — requires manual intervention"
      );
      return;
    }

    session.sumsub_review_status = reviewStatus;
    session.sumsub_review_answer = reviewAnswer;
    session.sumsub_last_updated_at = new Date();

    if (
      reviewAnswer === "RED" &&
      // IMPORTANT: Do not update the session status until the review is complete.
      // SumSub will sometimes set "reviewAnswer" to "RED" during precheck and then later update it to "GREEN".
      reviewStatus === "completed"
    ) {
      session.status = sessionStatusEnum.VERIFICATION_FAILED;

      const rejectLabels = reviewResult?.rejectLabels || [];
      const moderationComment = reviewResult?.moderationComment || "";
      session.verificationFailureReason =
        moderationComment || rejectLabels.join(", ") || "Verification rejected";
    }

    await session.save();

    webhookLogger.info(
      {
        applicantId,
        sessionId: session._id,
        reviewAnswer,
        reviewRejectType,
      },
      "Updated session from applicantReviewed webhook"
    );
  } catch (err) {
    webhookLogger.error(
      { error: err, applicantId },
      "Error updating session from applicantReviewed webhook"
    );
    throw err;
  }
}

/**
 * Handle applicantPending event — verification submitted, awaiting review.
 */
async function handleApplicantPending(
  payload: SumsubWebhookPayload,
  config: SandboxVsLiveKYCRouteHandlerConfig
) {
  const { applicantId, reviewStatus } = payload;

  if (!applicantId) {
    webhookLogger.warn({ payload }, "applicantPending missing applicantId");
    return;
  }

  try {
    const session = await config.SessionModel.findOne({
      sumsub_applicant_id: applicantId,
      idvProvider: "sumsub",
    }).exec();

    if (!session) {
      webhookLogger.warn(
        { applicantId },
        "No session found for applicantId in applicantPending webhook"
      );
      return;
    }

    session.sumsub_review_status = reviewStatus;
    session.sumsub_last_updated_at = new Date();
    await session.save();

    webhookLogger.info(
      { applicantId, sessionId: session._id },
      "Updated session from applicantPending webhook"
    );
  } catch (err) {
    webhookLogger.error(
      { error: err, applicantId },
      "Error updating session from applicantPending webhook"
    );
    throw err;
  }
}

/**
 * Main webhook handler factory.
 */
function createHandleSumsubWebhookRouteHandler(
  config: SandboxVsLiveKYCRouteHandlerConfig
) {
  return async (req: Request, res: Response) => {
    try {
      // req.body is a Buffer (from express.raw middleware)
      const rawBody = req.body.toString("utf8");
      const signature = req.headers["x-payload-digest"] as string;
      const algorithm =
        (req.headers["x-payload-digest-alg"] as string) || "HMAC_SHA256_HEX";

      if (!signature) {
        webhookLogger.warn("Webhook received without x-payload-digest header");
        return res.status(401).json({ error: "Missing signature" });
      }

      const webhookSecret = config.sumsubWebhookSecret;
      if (!webhookSecret) {
        webhookLogger.error("sumsubWebhookSecret not set in config");
        return res.status(500).json({ error: "Server configuration error" });
      }

      const isValid = verifySumsubWebhookSignature(
        rawBody,
        signature,
        webhookSecret,
        algorithm
      );
      if (!isValid) {
        webhookLogger.warn(
          { signature, algorithm },
          "Invalid webhook signature - possible spoofing attempt"
        );
        return res.status(401).json({ error: "Invalid signature" });
      }

      const body = JSON.parse(rawBody) as SumsubWebhookPayload;
      const eventType = body.type;

      webhookLogger.info({ eventType, applicantId: body.applicantId }, "Received Sumsub webhook");

      switch (eventType) {
        case "applicantReviewed":
          await handleApplicantReviewed(body, config);
          break;

        case "applicantPending":
          await handleApplicantPending(body, config);
          break;

        default:
          webhookLogger.info(
            { eventType },
            "Unhandled Sumsub webhook event type"
          );
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      webhookLogger.error({ error: err }, "Error processing Sumsub webhook");

      // Return 200 to prevent Sumsub from retrying
      return res.status(200).json({ received: true, error: "Processing error" });
    }
  };
}

async function handleSumsubWebhookLive(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createHandleSumsubWebhookRouteHandler(config)(req, res);
}

// TODO: Add sandbox webhooks endpoint. Use source keys to distinguish between
// sandbox and production: https://docs.sumsub.com/docs/source-keys

export { handleSumsubWebhookLive };
