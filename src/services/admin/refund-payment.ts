import { Request, Response } from "express";
import { forceRefundPayment } from "../payments/functions.js";
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
 * Note: as of 2026-04-11 this endpoint no longer rejects already-redeemed
 * payments — `forceRefundPayment` is intentionally redemption-agnostic so
 * it can be reused by per-session refund endpoints (which always refund
 * redeemed payments). Operationally, an admin can now refund a redeemed
 * payment that the system was unable to fulfill.
 */
export async function refundPayment(req: Request, res: Response) {
  try {
    const liveConfig = getRouteHandlerConfig("live");

    const { commitment, chainId } = req.body;

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

    const result = await forceRefundPayment(commitment, chainIdNum, {
      logger: adminRefundPaymentLogger,
      environment: liveConfig.environment,
    });

    if (!result.success) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.status(200).json({
      message: "Refund processed successfully",
      commitment,
      chainId: chainIdNum,
      contractAddress: result.contractAddress,
      txHash: result.txHash,
    });
  } catch (error: any) {
    adminRefundPaymentLogger.error({ error: error.message }, "Error processing admin refund");
    return res.status(500).json({ error: error.message || "An unknown error occurred" });
  }
}
