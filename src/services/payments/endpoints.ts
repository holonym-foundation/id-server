import { Request, Response } from "express";
import { ethers } from "ethers";
import {
  calculatePriceInToken,
  generatePaymentSignature,
  generateRefundSignature,
  getPaymentFromContract,
  storeReservationToken,
  getReservationToken,
  storeRefundPending,
  isRefundPending,
  storeRedemptionPending,
  isRedemptionPending,
  deleteRedemptionPending,
  getRedemptionRecord,
  isPaymentRedeemed,
  markPaymentAsRedeemed,
  deriveCommitmentFromSecret,
  generateReservationToken,
} from "./functions.js";
import { getRouteHandlerConfig } from "../../init.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { idvSessionUSDPrice, humanIDPaymentsContractAddresses } from "../../constants/misc.js";

const paymentsLogger = logger.child({
  base: {
    ...pinoOptions.base,
    feature: "holonym",
    subFeature: "payments",
  },
});

/**
 * GET /payments/payment-params
 * Get price and signature for a payment
 */
function createCreatePaymentParamsRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const { commitment, service, chainId } = req.query;

      if (!commitment || typeof commitment !== "string") {
        return res.status(400).json({ error: "commitment is required" });
      }
      if (!service || typeof service !== "string") {
        return res.status(400).json({ error: "service is required" });
      }
      if (chainId === undefined || chainId === null) {
        return res.status(400).json({ error: "chainId is required" });
      }
      
      const chainIdNum = typeof chainId === "number" ? chainId : Number(chainId);
      if (isNaN(chainIdNum)) {
        return res.status(400).json({ error: "chainId must be a number" });
      }
      const timestamp = Math.floor(Date.now() / 1000);

      // Calculate price in token
      const amount = await calculatePriceInToken(idvSessionUSDPrice, chainIdNum);

      // Generate signature
      const signature = await generatePaymentSignature(
        amount,
        commitment,
        service,
        chainIdNum,
        timestamp
      );

      paymentsLogger.info(
        {
          commitment,
          // We use "serviceId" here instead of "service" to avoid overwriting the datadog "service" tag.
          serviceId: service,
          chainId: chainIdNum,
          amount,
          timestamp,
          environment: config.environment
        },
        "Generated payment signature"
      );

      return res.status(200).json({
        price: amount,
        signature,
        timestamp,
        chainId: chainIdNum,
      });
    } catch (error: any) {
      paymentsLogger.error({ error: error.message }, "Error in GET /payments/payment-params");
      return res.status(500).json({ error: error.message || "An unknown error occurred" });
    }
  };
}

async function createPaymentParamsProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createCreatePaymentParamsRouteHandler(config)(req, res);
}

async function createPaymentParamsSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createCreatePaymentParamsRouteHandler(config)(req, res);
}

/**
 * POST /payments/redemption/reserve
 * Phase 1: Reserve/lock redemption (two-phase commit)
 */
function createReserveRedemptionRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      // Check API key
      const apiKey = req.headers["x-api-key"];
      if (!process.env.PAYMENT_REDEMPTION_API_KEY || !apiKey) {
        return res.status(401).json({ error: "Unauthorized. No API key found." });
      }
      if (apiKey !== process.env.PAYMENT_REDEMPTION_API_KEY) {
        return res.status(401).json({ error: "Invalid API key." });
      }

      const { secret, chainId, service } = req.body;

      if (!secret || typeof secret !== "string") {
        return res.status(400).json({ error: "secret is required" });
      }
      if (chainId === undefined || chainId === null) {
        return res.status(400).json({ error: "chainId is required" });
      }
      
      const chainIdNum = typeof chainId === "number" ? chainId : Number(chainId);
      if (isNaN(chainIdNum)) {
        return res.status(400).json({ error: "chainId must be a number" });
      }
      if (!service || typeof service !== "string") {
        return res.status(400).json({ error: "service is required" });
      }

      // Derive commitment from secret
      const commitment = deriveCommitmentFromSecret(secret);

      // Check if payment exists onchain
      const contractAddress = humanIDPaymentsContractAddresses[chainIdNum];
      if (!contractAddress) {
        return res.status(400).json({ error: `Unsupported chain ID: ${chainIdNum}` });
      }
      const payment = await getPaymentFromContract(commitment, chainIdNum, contractAddress);

      if (!payment) {
        return res.status(404).json({ error: "Payment not found onchain" });
      }

      // Validate payment
      if (payment.refunded) {
        return res.status(400).json({ error: "Payment has been refunded" });
      }

      if (payment.service.toLowerCase() !== service.toLowerCase()) {
        return res.status(400).json({ error: "Payment service does not match requested service" });
      }

      const commitmentRecord = await config.PaymentCommitmentModel.findOne({ commitment }).exec();

      // Check if already redeemed
      if (await isPaymentRedeemed(commitmentRecord, config.PaymentRedemptionModel)) {
        return res.status(400).json({ error: "Payment has already been redeemed" });
      }

      // Check if redemption is pending
      if (await isRedemptionPending(commitment, config.environment)) {
        return res.status(400).json({ error: "Redemption is already pending" });
      }

      // Check if refund is pending
      if (await isRefundPending(commitment, config.environment)) {
        return res.status(400).json({ error: "Refund is pending for this payment" });
      }

      // Insert redemption-pending record with 5 min TTL
      await storeRedemptionPending(commitment, config.environment);

      // Generate reservation token
      const reservationToken = generateReservationToken();
      await storeReservationToken(reservationToken, commitment, config.environment);

      paymentsLogger.info(
        { commitment, reservationToken, environment: config.environment },
        "Reserved redemption"
      );

      return res.status(200).json({
        reservationToken,
      });
    } catch (error: any) {
      paymentsLogger.error({ error: error.message }, "Error reserving redemption");
      return res.status(500).json({ error: error.message || "An unknown error occurred" });
    }
  };
}

async function reserveRedemptionProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createReserveRedemptionRouteHandler(config)(req, res);
}

async function reserveRedemptionSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createReserveRedemptionRouteHandler(config)(req, res);
}

/**
 * POST /payments/redemption/complete
 * Phase 2: Complete redemption (two-phase commit)
 */
function createCompleteRedemptionRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      // Check API key
      const apiKey = req.headers["x-api-key"];
      if (!process.env.PAYMENT_REDEMPTION_API_KEY || !apiKey) {
        return res.status(401).json({ error: "Unauthorized. No API key found." });
      }
      if (apiKey !== process.env.PAYMENT_REDEMPTION_API_KEY) {
        return res.status(401).json({ error: "Invalid API key." });
      }

      const { reservationToken, service, fulfillmentReceipt } = req.body;

      if (!reservationToken || typeof reservationToken !== "string") {
        return res.status(400).json({ error: "reservationToken is required" });
      }
      if (!service || typeof service !== "string") {
        return res.status(400).json({ error: "service is required" });
      }

      // Get commitment from reservation token
      const commitment = await getReservationToken(reservationToken, config.environment);

      if (!commitment) {
        return res.status(400).json({ error: "Invalid or expired reservation token" });
      }

      const commitmentRecord = await config.PaymentCommitmentModel.findOne({ commitment }).exec();

      // Check if already redeemed
      if (await isPaymentRedeemed(commitmentRecord, config.PaymentRedemptionModel)) {
        return res.status(400).json({ error: "Payment has already been redeemed" });
      }

      // Mark as redeemed
      await markPaymentAsRedeemed(
        commitmentRecord,
        config.PaymentRedemptionModel,
        service,
        fulfillmentReceipt
      );

      // For analytics purposes, if the secret was created by a partner, we log the partner userId
      let creditsPartnerUserId = undefined;
      if (commitmentRecord?.sourceType === 'credits') {
        const creditsPaymentSecret = await config.HumanIDCreditsPaymentSecretModel.findOne({
          commitmentId: commitmentRecord._id
        }).exec();
        if (creditsPaymentSecret) {
          creditsPartnerUserId = creditsPaymentSecret.userId.toString();
        }
      }

      paymentsLogger.info(
        {
          commitment,
          // We use "serviceId" here instead of "service" to avoid overwriting the datadog "service" tag.
          serviceId: service,
          fulfillmentReceipt,
          environment: config.environment,
          creditsPartnerUserId
        },
        "Completed redemption"
      );

      return res.status(200).json({
        message: "Redemption completed",
        commitment,
      });
    } catch (error: any) {
      paymentsLogger.error({ error: error.message }, "Error completing redemption");
      return res.status(500).json({ error: error.message || "An unknown error occurred" });
    }
  };
}

async function completeRedemptionProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createCompleteRedemptionRouteHandler(config)(req, res);
}

async function completeRedemptionSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createCompleteRedemptionRouteHandler(config)(req, res);
}

/**
 * POST /payments/redemption/cancel
 * Cancel a reserved redemption (cleanup on error)
 */
function createCancelRedemptionRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      // Check API key
      const apiKey = req.headers["x-api-key"];
      if (!process.env.PAYMENT_REDEMPTION_API_KEY || !apiKey) {
        return res.status(401).json({ error: "Unauthorized. No API key found." });
      }
      if (apiKey !== process.env.PAYMENT_REDEMPTION_API_KEY) {
        return res.status(401).json({ error: "Invalid API key." });
      }

      const { reservationToken } = req.body;

      if (!reservationToken || typeof reservationToken !== "string") {
        return res.status(400).json({ error: "reservationToken is required" });
      }

      // Get commitment from reservation token (this also deletes the token)
      const commitment = await getReservationToken(reservationToken, config.environment);

      if (!commitment) {
        return res.status(400).json({ error: "Invalid or expired reservation token" });
      }

      // Delete the redemption-pending record
      await deleteRedemptionPending(commitment, config.environment);

      paymentsLogger.info(
        { commitment, reservationToken, environment: config.environment },
        "Cancelled redemption reservation"
      );

      return res.status(200).json({
        message: "Redemption reservation cancelled",
        commitment,
      });
    } catch (error: any) {
      paymentsLogger.error({ error: error.message }, "Error cancelling redemption");
      return res.status(500).json({ error: error.message || "An unknown error occurred" });
    }
  };
}

async function cancelRedemptionProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createCancelRedemptionRouteHandler(config)(req, res);
}

async function cancelRedemptionSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createCancelRedemptionRouteHandler(config)(req, res);
}

/**
 * POST /payments/refund/request
 * Get refund signature (user-initiated)
 */
function createRequestRefundRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const { secret, timestamp, chainId } = req.body;

      if (!secret || typeof secret !== "string") {
        return res.status(400).json({ error: "secret is required" });
      }
      if (chainId === undefined || chainId === null) {
        return res.status(400).json({ error: "chainId is required" });
      }
      
      const chainIdNum = typeof chainId === "number" ? chainId : Number(chainId);
      if (isNaN(chainIdNum)) {
        return res.status(400).json({ error: "chainId must be a number" });
      }
      if (!timestamp || typeof timestamp !== "number") {
        return res.status(400).json({ error: "timestamp is required and must be a number" });
      }

      // Derive commitment from secret
      const commitment = deriveCommitmentFromSecret(secret);

      const commitmentRecord = await config.PaymentCommitmentModel.findOne({ commitment }).exec();

      // Check if payment is redeemed
      if (await isPaymentRedeemed(commitmentRecord, config.PaymentRedemptionModel)) {
        return res.status(400).json({ error: "Payment has already been redeemed" });
      }

      // Check if redemption is pending
      if (await isRedemptionPending(commitment, config.environment)) {
        return res.status(400).json({ error: "Redemption is pending for this payment" });
      }

      // Check if refund is pending
      if (await isRefundPending(commitment, config.environment)) {
        return res.status(400).json({ error: "Refund is already pending" });
      }

      // Insert refund-pending record with 10 min TTL
      await storeRefundPending(commitment, config.environment);

      // Generate signature
      const signature = await generateRefundSignature(commitment, chainIdNum, timestamp);

      paymentsLogger.info(
        { commitment, chainId: chainIdNum, timestamp, environment: config.environment },
        "Generated refund signature"
      );

      return res.status(200).json({
        signature,
      });
    } catch (error: any) {
      paymentsLogger.error({ error: error.message }, "Error requesting refund");
      return res.status(500).json({ error: error.message || "An unknown error occurred" });
    }
  };
}

async function requestRefundProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createRequestRefundRouteHandler(config)(req, res);
}

async function requestRefundSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createRequestRefundRouteHandler(config)(req, res);
}

/**
 * GET /payments/status
 * Check payment status (redeemed, unredeemed, or pending)
 */
function createPaymentStatusRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const { commitment, chainId } = req.query;

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

      // Validate chainId and get contract address
      const contractAddress = humanIDPaymentsContractAddresses[chainIdNum];
      if (!contractAddress) {
        return res.status(400).json({ error: `Unsupported chain ID: ${chainIdNum}` });
      }

      // Check if payment exists onchain
      const payment = await getPaymentFromContract(commitment, chainIdNum, contractAddress);

      if (!payment) {
        return res.status(404).json({ error: "Payment not found onchain" });
      }

      const commitmentRecord = await config.PaymentCommitmentModel.findOne({ commitment }).exec();

      // Check if already redeemed
      if (await isPaymentRedeemed(commitmentRecord, config.PaymentRedemptionModel)) {
        return res.status(200).json({ status: "redeemed" });
      }

      // Check if redemption is pending
      if (await isRedemptionPending(commitment, config.environment)) {
        return res.status(200).json({ status: "pending-redemption" });
      }

      // Check if refund is pending
      if (await isRefundPending(commitment, config.environment)) {
        return res.status(200).json({ status: "pending-refund" });
      }

      // Payment exists but no redemption or pending operations
      return res.status(200).json({ status: "unredeemed" });
    } catch (error: any) {
      paymentsLogger.error({ error: error.message }, "Error checking payment status");
      return res.status(500).json({ error: error.message || "An unknown error occurred" });
    }
  };
}

async function paymentStatusProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPaymentStatusRouteHandler(config)(req, res);
}

async function paymentStatusSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPaymentStatusRouteHandler(config)(req, res);
}

export {
  createPaymentParamsProd,
  createPaymentParamsSandbox,
  reserveRedemptionProd,
  reserveRedemptionSandbox,
  completeRedemptionProd,
  completeRedemptionSandbox,
  cancelRedemptionProd,
  cancelRedemptionSandbox,
  requestRefundProd,
  requestRefundSandbox,
  paymentStatusProd,
  paymentStatusSandbox,
};
