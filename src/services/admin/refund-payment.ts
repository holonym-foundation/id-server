import { Request, Response } from "express";
import { ethers } from "ethers";
import {
  getPaymentFromContract,
  isPaymentRedeemed,
  isRedemptionPending,
  isRefundPending,
  storeRefundPending,
} from "../payments/functions.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { getProvider } from '../../utils/misc.js';
import { humanIDPaymentsABI, humanIDPaymentsContractAddresses } from "../../constants/misc.js";
import { getRouteHandlerConfig } from "../../init.js";

const adminRefundPaymentLogger = logger.child({
  base: {
    ...pinoOptions.base,
    feature: "holonym",
    subFeature: "admin-refund-payment",
  },
});

const liveConfig = getRouteHandlerConfig("live");

/**
 * POST /admin/payments/refund
 * Admin-initiated refund (force refund)
 */
export async function refundPayment(req: Request, res: Response) {
  try {
    const { commitment, chainId } = req.body;

    // Check API key
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

    // Check if payment exists onchain
    const contractAddress = humanIDPaymentsContractAddresses[chainIdNum];
    if (!contractAddress) {
      return res.status(400).json({ error: `Unsupported chain ID: ${chainIdNum}` });
    }
    const payment = await getPaymentFromContract(commitment, chainIdNum, contractAddress);

    if (!payment) {
      return res.status(404).json({ error: "Payment not found onchain" });
    }

    if (payment.refunded) {
      return res.status(400).json({ error: "Payment has already been refunded" });
    }

    // Check if payment is redeemed (offchain)
    if (await isPaymentRedeemed(commitment, liveConfig.PaymentRedemptionModel)) {
      return res.status(400).json({ error: "Payment has already been redeemed" });
    }

    // Check if redemption is pending
    if (await isRedemptionPending(commitment, liveConfig.environment)) {
      return res.status(400).json({ error: "Redemption is pending for this payment" });
    }

    // Check if refund is pending
    if (await isRefundPending(commitment, liveConfig.environment)) {
      return res.status(400).json({ error: "Refund is already pending" });
    }

    // Insert refund-pending record with 10 min TTL to prevent race conditions
    await storeRefundPending(commitment, liveConfig.environment);

    // Call forceRefund on contract using admin wallet
    const provider = getProvider(chainIdNum);
    const adminPrivateKey = process.env.PAYMENTS_ADMIN_PRIVATE_KEY;
    if (!adminPrivateKey) {
      return res.status(500).json({ error: "Missing payments admin private key" });
    }
    // Connect admin wallet
    const adminWallet = new ethers.Wallet(adminPrivateKey, provider);

    // Connect to contract
    const contract = new ethers.Contract(contractAddress, humanIDPaymentsABI, adminWallet);

    let txHash: string | undefined;
    try {
      const tx = await contract.forceRefund(commitment);
      txHash = tx.hash;
      adminRefundPaymentLogger.info(
        { commitment, chainId: chainIdNum, txHash },
        "forceRefund transaction sent"
      );
      await tx.wait();
    } catch (err: any) {
      adminRefundPaymentLogger.error(
        { commitment, chainId: chainIdNum, error: err?.message || err },
        "Error calling forceRefund"
      );
      return res.status(500).json({ error: "Contract call failed", details: err?.message || String(err) });
    }
    adminRefundPaymentLogger.info(
      { commitment, chainId: chainIdNum, txHash },
      "Admin force refund completed successfully"
    );

    return res.status(200).json({
      message: "Refund processed successfully",
      commitment,
      chainId: chainIdNum,
      contractAddress,
      txHash,
    });
  } catch (error: any) {
    adminRefundPaymentLogger.error({ error: error.message }, "Error processing admin refund");
    return res.status(500).json({ error: error.message || "An unknown error occurred" });
  }
}

