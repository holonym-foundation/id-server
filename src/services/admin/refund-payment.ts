import { Request, Response } from "express";
import {
  forceRefundPayment,
  getRedemptionRecord,
  isPaymentRedeemed,
  isRedemptionPending,
} from "../payments/functions.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { getRouteHandlerConfig } from "../../init.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";

const adminRefundPaymentLogger = logger.child({
  base: {
    ...pinoOptions.base,
    feature: "holonym",
    subFeature: "admin-refund-payment",
  },
});

type RedemptionInspection = {
  environment: "sandbox" | "live";
  commitmentRecordFound: boolean;
  redeemed: boolean;
  service?: string;
  fulfillmentReceipt?: string;
  redeemedAt?: Date;
};

/**
 * Look up a commitment's redemption state in one environment.
 *
 * `isPaymentRedeemed` is the canonical predicate (it requires `redeemedAt` to
 * be set); `getRedemptionRecord` is only consulted for the operator-facing
 * details, and only once the predicate has already said "redeemed", so the two
 * cannot report different answers.
 */
async function inspectRedemption(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  commitment: string
): Promise<RedemptionInspection> {
  const commitmentRecord = await config.PaymentCommitmentModel.findOne({
    commitment,
  }).exec();
  const redeemed = await isPaymentRedeemed(
    commitmentRecord,
    config.PaymentRedemptionModel
  );

  const inspection: RedemptionInspection = {
    environment: config.environment,
    commitmentRecordFound: commitmentRecord !== null,
    redeemed,
  };

  if (!redeemed) return inspection;

  const redemption = await getRedemptionRecord(
    commitment,
    config.PaymentRedemptionModel,
    config.PaymentCommitmentModel
  );
  inspection.service = redemption?.service;
  inspection.fulfillmentReceipt = redemption?.fulfillmentReceipt;
  inspection.redeemedAt = redemption?.redeemedAt;
  return inspection;
}

function describeRedemption(inspection: RedemptionInspection): string {
  const details = [
    `environment: ${inspection.environment}`,
    inspection.service ? `service: ${inspection.service}` : null,
    inspection.fulfillmentReceipt
      ? `fulfillment receipt: ${inspection.fulfillmentReceipt}`
      : null,
  ].filter(Boolean);
  return details.join(", ");
}

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
 *
 * The check covers both environments. Payment contracts are keyed by chain
 * only (`humanIDPaymentsContractAddresses`), so a sandbox-redeemed payment
 * sits on the same real chain and is just as refundable here, but its
 * redemption lives in the Sandbox* collections — checking only "live" would
 * miss it. That was the other half of the #236 read-path confusion.
 */
export async function refundPayment(req: Request, res: Response) {
  try {
    const liveConfig = getRouteHandlerConfig("live");
    const sandboxConfig = getRouteHandlerConfig("sandbox");

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

    // Every commitment we write today is lowercase (ethers-derived, or a
    // client-supplied string that must match one to be redeemable), while the
    // Mongo lookup is a case-sensitive string match — so lowercasing the input
    // is what makes an uppercase commitment find its record instead of looking
    // unredeemed. Note the schema does not enforce lowercase storage, so this
    // does not help if a record was somehow stored uppercase; normalizing at
    // every commitment boundary (fix 1 of internal-docs#236) is what would.
    const normalizedCommitment = commitment.toLowerCase();

    const inspections = await Promise.all([
      inspectRedemption(liveConfig, normalizedCommitment),
      inspectRedemption(sandboxConfig, normalizedCommitment),
    ]);
    const redeemedIn = inspections.filter((i) => i.redeemed);
    const redeemed = redeemedIn.length > 0;
    const commitmentRecordFound = inspections.some((i) => i.commitmentRecordFound);
    const overrideRequested = allowRedeemed === true || allowRedeemed === "true";

    const auditBase = {
      commitment: normalizedCommitment,
      chainId: chainIdNum,
      redeemed,
      redeemedIn: redeemedIn.map((i) => i.environment),
      commitmentRecordFound,
      fulfillmentReceipts: redeemedIn.map((i) => i.fulfillmentReceipt),
    };

    if (redeemed && !overrideRequested) {
      adminRefundPaymentLogger.info(
        auditBase,
        "Admin force-refund rejected: payment has already been redeemed"
      );
      return res.status(400).json({
        error:
          `Payment has already been redeemed (${redeemedIn.map(describeRedemption).join("; ")}). ` +
          "Verify the service was actually not delivered, then retry with " +
          '"allowRedeemed": true to refund anyway.',
        redemptions: redeemedIn.map((i) => ({
          environment: i.environment,
          service: i.service,
          fulfillmentReceipt: i.fulfillmentReceipt,
          redeemedAt: i.redeemedAt,
        })),
      });
    }

    // A redemption in flight in either environment must also block the refund.
    // `forceRefundPayment` only checks the environment it is given, and the
    // pending keys are environment-prefixed.
    if (await isRedemptionPending(normalizedCommitment, "sandbox")) {
      adminRefundPaymentLogger.info(
        auditBase,
        "Admin force-refund rejected: redemption is pending in the sandbox environment"
      );
      return res.status(400).json({
        error: "Redemption is pending for this payment in the sandbox environment",
      });
    }

    // No commitment record in either environment is not the same as "not
    // redeemed" — it can also mean the bookkeeping row was never written (e.g.
    // a failed PUT /payment-secrets), in which case a delivered service would
    // leave no redemption to find. Refunding is still the common, correct
    // action here, but the audit trail has to be able to tell the two apart.
    if (!commitmentRecordFound) {
      adminRefundPaymentLogger.warn(
        auditBase,
        "Admin force-refund: no PaymentCommitment record in either environment; " +
          "redemption state is unknown, not confirmed-unredeemed"
      );
    }

    const result = await forceRefundPayment(normalizedCommitment, chainIdNum, {
      logger: adminRefundPaymentLogger,
      environment: liveConfig.environment,
    });

    const overrideUsed = redeemed && overrideRequested;

    if (!result.success) {
      adminRefundPaymentLogger.error(
        { ...auditBase, overrideUsed, status: result.status, error: result.error },
        "Admin force-refund failed"
      );
      return res.status(result.status).json({ error: result.error });
    }

    const successPayload = {
      ...auditBase,
      overrideUsed,
      contractAddress: result.contractAddress,
      txHash: result.txHash,
    };
    if (overrideUsed) {
      adminRefundPaymentLogger.warn(
        successPayload,
        "Admin force-refund completed on an already-redeemed payment (override used)"
      );
    } else {
      adminRefundPaymentLogger.info(successPayload, "Admin force-refund completed");
    }

    return res.status(200).json({
      message: "Refund processed successfully",
      commitment: normalizedCommitment,
      chainId: chainIdNum,
      contractAddress: result.contractAddress,
      txHash: result.txHash,
      redeemed,
      redeemedIn: redeemedIn.map((i) => i.environment),
      commitmentRecordFound,
      overrideUsed,
    });
  } catch (error: any) {
    adminRefundPaymentLogger.error({ error: error.message }, "Error processing admin refund");
    return res.status(500).json({ error: error.message || "An unknown error occurred" });
  }
}
