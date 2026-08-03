import { Request, Response } from "express";
import {
  forceRefundPayment,
  getRedemptionRecord,
  isPaymentRedeemed,
} from "../payments/functions.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { getRouteHandlerConfig } from "../../init.js";

const adminRefundPaymentLogger = logger.child({
  base: {
    ...pinoOptions.base,
    feature: "holonym",
    subFeature: "admin-refund-payment",
  },
});

/**
 * POST /admin/payments/refund
 * Admin-initiated force refund. Authorized via ADMIN_API_KEY_LOW_PRIVILEGE.
 *
 * `forceRefundPayment` is intentionally redemption-agnostic so it can be
 * reused by per-session refund endpoints (which always refund redeemed
 * payments). This endpoint therefore does its own redemption check: an
 * already-redeemed payment is rejected unless the caller passes
 * `allowRedeemed: true`, which preserves the 2026-04-11 use case (refunding
 * a redeemed payment the system was unable to fulfill) while making it a
 * deliberate act rather than the default. Support refunded two fulfilled
 * payments in the incident tracked by internal-docs#236 because nothing on
 * this path flagged them as redeemed.
 */
export async function refundPayment(req: Request, res: Response) {
  try {
    const liveConfig = getRouteHandlerConfig("live");

    const { commitment, chainId, allowRedeemed } = req.body;

    const apiKey = req.headers["x-api-key"];
    if (!process.env.ADMIN_API_KEY_LOW_PRIVILEGE || !apiKey) {
      return res.status(401).json({ error: "Unauthorized. No API key found." });
    }
    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    if (!commitment || typeof commitment !== "string") {
      return res.status(400).json({ error: "commitment is required" });
    }
    if (chainId === undefined || chainId === null) {
      return res.status(400).json({ error: "chainId is required" });
    }
    const chainIdNum = typeof chainId === "number" ? chainId : Number(chainId);
    if (isNaN(chainIdNum)) {
      return res.status(400).json({ error: "chainId must be a number" });
    }

    // Commitment records are stored lowercase, and the Mongo lookup is a
    // case-sensitive string match, so an uppercase commitment would silently
    // miss the record and make the payment look unredeemed.
    const normalizedCommitment = commitment.toLowerCase();

    const commitmentRecord = await liveConfig.PaymentCommitmentModel.findOne({
      commitment: normalizedCommitment,
    }).exec();
    const redeemed = await isPaymentRedeemed(
      commitmentRecord,
      liveConfig.PaymentRedemptionModel
    );
    const overrideRequested = allowRedeemed === true || allowRedeemed === "true";

    if (redeemed && !overrideRequested) {
      const redemption = await getRedemptionRecord(
        normalizedCommitment,
        liveConfig.PaymentRedemptionModel,
        liveConfig.PaymentCommitmentModel
      );
      adminRefundPaymentLogger.info(
        {
          commitment: normalizedCommitment,
          chainId: chainIdNum,
          fulfillmentReceipt: redemption?.fulfillmentReceipt,
          service: redemption?.service,
          redeemedAt: redemption?.redeemedAt,
        },
        "Admin force-refund rejected: payment has already been redeemed"
      );
      return res.status(400).json({
        error:
          "Payment has already been redeemed" +
          (redemption?.fulfillmentReceipt
            ? ` (fulfillment receipt: ${redemption.fulfillmentReceipt})`
            : "") +
          ". Verify the service was actually not delivered, then retry with " +
          '"allowRedeemed": true to refund anyway.',
        redemption: {
          service: redemption?.service,
          fulfillmentReceipt: redemption?.fulfillmentReceipt,
          redeemedAt: redemption?.redeemedAt,
        },
      });
    }

    const result = await forceRefundPayment(normalizedCommitment, chainIdNum, {
      logger: adminRefundPaymentLogger,
      environment: liveConfig.environment,
    });

    if (!result.success) {
      return res.status(result.status).json({ error: result.error });
    }

    adminRefundPaymentLogger.info(
      {
        commitment: normalizedCommitment,
        chainId: chainIdNum,
        contractAddress: result.contractAddress,
        txHash: result.txHash,
        redeemed,
        overrideUsed: redeemed && overrideRequested,
      },
      "Admin force-refund completed"
    );

    return res.status(200).json({
      message: "Refund processed successfully",
      commitment: normalizedCommitment,
      chainId: chainIdNum,
      contractAddress: result.contractAddress,
      txHash: result.txHash,
      redeemed,
    });
  } catch (error: any) {
    adminRefundPaymentLogger.error({ error: error.message }, "Error processing admin refund");
    return res.status(500).json({ error: error.message || "An unknown error occurred" });
  }
}
