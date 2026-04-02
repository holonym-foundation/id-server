import { ethers } from "ethers";
import { v4 as uuidV4 } from "uuid";
import { HydratedDocument, Model, Types } from "mongoose";
import { valkeyClient } from "../../utils/valkey-glide.js";
import { TimeUnit } from "@valkey/valkey-glide";
import {
  ethereumProvider,
  optimismProvider,
  optimismGoerliProvider,
  fantomProvider,
  avalancheProvider,
  auroraProvider,
  baseProvider,
  idvSessionUSDPrice,
  humanIDPaymentsABI,
  humanIDPaymentsContractAddresses,
} from "../../constants/misc.js";
import { usdToETH, usdToFTM, usdToAVAX } from "../../utils/cmc.js";
import { getProvider } from '../../utils/misc.js';
import { IPaymentRedemption, IPaymentCommitment, IHumanIDCreditsPaymentSecret, ISandboxHumanIDCreditsPaymentSecret } from "../../types.js";
import { pinoOptions, logger } from "../../utils/logger.js";

const paymentsLogger = logger.child({
  base: {
    ...pinoOptions.base,
    feature: "holonym",
    subFeature: "payments",
  },
});

/**
 * Calculate price in token for a given USD amount and chain ID
 */
export async function calculatePriceInToken(
  usdAmount: number,
  chainId: number
): Promise<string> {
  let priceInToken: number;
  
  if ([1, 10, 1313161554, 8453, 11155420].includes(chainId)) {
    priceInToken = await usdToETH(usdAmount);
  } else if (chainId === 250) {
    priceInToken = await usdToFTM(usdAmount);
  } else if (chainId === 43114) {
    priceInToken = await usdToAVAX(usdAmount);
  } else if (process.env.NODE_ENV === "development" && chainId === 420) {
    priceInToken = await usdToETH(usdAmount);
  } else {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  // Round to 18 decimal places to avoid underflow errors
  const decimals = 18;
  const multiplier = 10 ** decimals;
  const rounded = Math.round(priceInToken * multiplier) / multiplier;

  return ethers.utils.parseEther(rounded.toString()).toString();
}

/**
 * Generate EIP-191 signature for payment
 * Signs: keccak256(abi.encode(amount, commitment, service, chainId, timestamp))
 */
export async function generatePaymentSignature(
  amount: string,
  commitment: string,
  service: string,
  chainId: number,
  timestamp: number
): Promise<string> {
  if (!process.env.PAYMENTS_ORACLE_PRIVATE_KEY) {
    throw new Error("PAYMENTS_ORACLE_PRIVATE_KEY environment variable is not set");
  }

  const wallet = new ethers.Wallet(process.env.PAYMENTS_ORACLE_PRIVATE_KEY);
  
  // Create the message hash as per the contract: keccak256(abi.encode(amount, commitment, service, chainId, timestamp))
  const messageHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["uint256", "bytes32", "bytes32", "uint256", "uint256"],
      [amount, commitment, service, chainId, timestamp]
    )
  );

  // Sign with EIP-191 prefix (ethers automatically adds the prefix)
  const signature = await wallet.signMessage(ethers.utils.arrayify(messageHash));
  
  return signature;
}

/**
 * Generate EIP-191 signature for refund
 * Signs: keccak256(abi.encode(commitment, chainId, timestamp))
 */
export async function generateRefundSignature(
  commitment: string,
  chainId: number,
  timestamp: number
): Promise<string> {
  if (!process.env.PAYMENTS_ORACLE_PRIVATE_KEY) {
    throw new Error("PAYMENTS_ORACLE_PRIVATE_KEY environment variable is not set");
  }

  const wallet = new ethers.Wallet(process.env.PAYMENTS_ORACLE_PRIVATE_KEY);
  
  // Create the message hash as per the contract: keccak256(abi.encode(commitment, chainId, timestamp))
  const messageHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "uint256", "uint256"],
      [commitment, chainId, timestamp]
    )
  );

  // Sign with EIP-191 prefix (ethers automatically adds the prefix)
  const signature = await wallet.signMessage(ethers.utils.arrayify(messageHash));
  
  return signature;
}

/**
 * Get payment details from smart contract
 */
export async function getPaymentFromContract(
  commitment: string,
  chainId: number,
  contractAddress: string
): Promise<{
  commitment: string;
  service: string;
  timestamp: number;
  sender: string;
  amount: string;
  refunded: boolean;
} | null> {
  try {
    const provider = getProvider(chainId);
    const contract = new ethers.Contract(
      contractAddress,
      humanIDPaymentsABI,
      provider
    );

    const payment = await contract.payments(commitment);
    
    // Check if payment exists (amount > 0)
    if (payment.amount.toString() === "0") {
      return null;
    }

    return {
      commitment: payment.commitment,
      service: payment.service,
      timestamp: payment.timestamp.toNumber(),
      sender: payment.sender,
      amount: payment.amount.toString(),
      refunded: payment.refunded,
    };
  } catch (error: any) {
    paymentsLogger.error({ error: error.message, commitment, chainId }, "Error getting payment from contract");
    throw error;
  }
}

/**
 * Store reservation token in valkey with TTL (5 minutes)
 */
export async function storeReservationToken(
  token: string,
  commitment: string,
  environment: "sandbox" | "live"
): Promise<void> {
  if (!valkeyClient) {
    throw new Error("Valkey client not initialized");
  }

  const prefix = environment === "sandbox" ? "sandbox:" : "";
  const key = `${prefix}payment:reservation:${token}`;
  // TTL: 5 minutes (300 seconds)
  await valkeyClient.set(key, commitment, { expiry: { type: TimeUnit.Seconds, count: 5 * 60 } });
}

/**
 * Get and delete reservation token from valkey
 */
export async function getReservationToken(
  token: string,
  environment: "sandbox" | "live"
): Promise<string | null> {
  if (!valkeyClient) {
    throw new Error("Valkey client not initialized");
  }

  const prefix = environment === "sandbox" ? "sandbox:" : "";
  const key = `${prefix}payment:reservation:${token}`;
  const commitment = await valkeyClient.get(key);
  
  if (commitment) {
    // Delete the token after reading
    await valkeyClient.del([key]);
    return commitment as string;
  }
  
  return null;
}

/**
 * Store refund-pending record in valkey with TTL (10 minutes)
 */
export async function storeRefundPending(
  commitment: string,
  environment: "sandbox" | "live"
): Promise<void> {
  if (!valkeyClient) {
    throw new Error("Valkey client not initialized");
  }

  const prefix = environment === "sandbox" ? "sandbox:" : "";
  const key = `${prefix}payment:refund-pending:${commitment}`;
  // TTL: 10 minutes (600 seconds)
  await valkeyClient.set(key, "1", { expiry: { type: TimeUnit.Seconds, count: 10 * 60 } });
}

/**
 * Check if refund is pending
 */
export async function isRefundPending(
  commitment: string,
  environment: "sandbox" | "live"
): Promise<boolean> {
  if (!valkeyClient) {
    throw new Error("Valkey client not initialized");
  }

  const prefix = environment === "sandbox" ? "sandbox:" : "";
  const key = `${prefix}payment:refund-pending:${commitment}`;
  const exists = await valkeyClient.exists([key]);
  return exists > 0;
}

/**
 * Store redemption-pending record in valkey with TTL (5 minutes)
 */
export async function storeRedemptionPending(
  commitment: string,
  environment: "sandbox" | "live"
): Promise<void> {
  if (!valkeyClient) {
    throw new Error("Valkey client not initialized");
  }

  const prefix = environment === "sandbox" ? "sandbox:" : "";
  const key = `${prefix}payment:redemption-pending:${commitment}`;
  // TTL: 5 minutes (300 seconds)
  // TODO: Use SET NX (set-if-not-exists) to make this atomic with the isRedemptionPending()
  // check. Currently, two concurrent requests can both pass isRedemptionPending() before
  // either writes, allowing double reservation. With NX, only the first SET succeeds.
  await valkeyClient.set(key, "1", { expiry: { type: TimeUnit.Seconds, count: 5 * 60 } });
}

/**
 * Check if redemption is pending
 */
export async function isRedemptionPending(
  commitment: string,
  environment: "sandbox" | "live"
): Promise<boolean> {
  if (!valkeyClient) {
    throw new Error("Valkey client not initialized");
  }

  const prefix = environment === "sandbox" ? "sandbox:" : "";
  const key = `${prefix}payment:redemption-pending:${commitment}`;
  const exists = await valkeyClient.exists([key]);
  return exists > 0;
}

/**
 * Delete redemption-pending record from valkey
 */
export async function deleteRedemptionPending(
  commitment: string,
  environment: "sandbox" | "live"
): Promise<void> {
  if (!valkeyClient) {
    throw new Error("Valkey client not initialized");
  }

  const prefix = environment === "sandbox" ? "sandbox:" : "";
  const key = `${prefix}payment:redemption-pending:${commitment}`;
  await valkeyClient.del([key]);
}

/**
 * Get redemption record by commitment
 * Uses aggregation pipeline to efficiently join PaymentCommitment and PaymentRedemption in a single query
 */
export async function getRedemptionRecord(
  commitment: string,
  PaymentRedemptionModel: any,
  PaymentCommitmentModel: Model<IPaymentCommitment>
): Promise<IPaymentRedemption | null> {
  // Use aggregation pipeline to join PaymentCommitment and PaymentRedemption in a single query
  const pipeline = [
    // Stage 1: Match PaymentCommitment by commitment string
    {
      $match: { commitment }
    },
    // Stage 2: Lookup PaymentRedemption by commitmentId
    {
      $lookup: {
        from: PaymentRedemptionModel.collection.name,
        localField: '_id',
        foreignField: 'commitmentId',
        as: 'redemption'
      }
    },
    // Stage 3: Unwind redemption array (should have 0 or 1 element)
    {
      $unwind: {
        path: '$redemption',
        preserveNullAndEmptyArrays: false // Only return if redemption exists
      }
    },
    // Stage 4: Replace root with redemption document
    {
      $replaceRoot: { newRoot: '$redemption' }
    }
  ];

  const results = await PaymentCommitmentModel.aggregate(pipeline).exec();
  return results.length > 0 ? (results[0] as IPaymentRedemption) : null;
}

/**
 * Check if payment is redeemed
 * Uses PaymentCommitment collection to look up commitmentId, then queries PaymentRedemption
 */
export async function isPaymentRedeemed(
  commitmentRecord: HydratedDocument<IPaymentCommitment> | null,
  PaymentRedemptionModel: any
): Promise<boolean> {
  if (!commitmentRecord || !commitmentRecord._id) {
    return false;
  }

  // Query PaymentRedemption by commitmentId
  const redemption = await PaymentRedemptionModel.findOne({ 
    commitmentId: commitmentRecord._id,
    redeemedAt: { $exists: true, $ne: null }
  }).exec();
  
  return redemption !== null;
}

/**
 * Mark payment as redeemed
 * Uses PaymentCommitment collection to look up or create commitmentId, then creates/updates PaymentRedemption
 */
export async function markPaymentAsRedeemed(
  commitmentRecord: HydratedDocument<IPaymentCommitment> | null,
  PaymentRedemptionModel: any,
  service?: string,
  fulfillmentReceipt?: string
): Promise<void> {
  if (!commitmentRecord || !commitmentRecord._id) {
    throw new Error('Commitment record not found');
  }

  // Create or update PaymentRedemption using commitmentId
  const updateData: any = {
    commitmentId: commitmentRecord._id,
    redeemedAt: new Date(),
  };
  if (service) {
    updateData.service = service;
  }
  if (fulfillmentReceipt) {
    updateData.fulfillmentReceipt = fulfillmentReceipt;
  }
  
  await PaymentRedemptionModel.findOneAndUpdate(
    { commitmentId: commitmentRecord._id },
    updateData,
    { upsert: true, new: true }
  );
}

/**
 * Derive commitment from secret (keccak256 hash of the secret)
 */
export function deriveCommitmentFromSecret(secret: string): string {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(secret));
}

/**
 * Verify commitment secret by hashing it and comparing with commitment
 */
export function verifyCommitmentSecret(
  secret: string,
  commitment: string
): boolean {
  // Commitment should be keccak256 hash of the secret
  const derivedCommitment = deriveCommitmentFromSecret(secret);
  return derivedCommitment.toLowerCase() === commitment.toLowerCase();
}

/**
 * Generate a unique reservation token
 */
export function generateReservationToken(): string {
  return uuidV4();
}

/**
 * Check if commitment exists in PaymentCommitments collection
 * This is a helper function for the unified commitment storage system
 */
export async function commitmentExists(
  commitment: string,
  PaymentCommitmentModel: Model<IPaymentCommitment>
): Promise<boolean> {
  const exists = await PaymentCommitmentModel.findOne({ commitment }).exec();
  return exists !== null;
}

/**
 * Get commitment record from PaymentCommitments collection
 */
export async function getCommitmentRecord(
  commitment: string,
  PaymentCommitmentModel: Model<IPaymentCommitment>
): Promise<IPaymentCommitment | null> {
  return await PaymentCommitmentModel.findOne({ commitment }).exec();
}

/**
 * Create commitment record in PaymentCommitments collection
 */
export async function createCommitmentRecord(
  commitment: string,
  sourceType: 'user' | 'credits',
  PaymentCommitmentModel: Model<IPaymentCommitment>
): Promise<IPaymentCommitment> {
  // Check if commitment already exists
  const existing = await PaymentCommitmentModel.findOne({ commitment }).exec();
  if (existing) {
    return existing;
  }
  return await PaymentCommitmentModel.create({
    commitment,
    sourceType,
    createdAt: new Date(),
  });
}

// ─── Extracted Redemption Business Logic ────────────────────────────────────
// These functions encapsulate the core reserve/complete/cancel logic so it can
// be called both from the HTTP payment endpoints and from session creation
// endpoints (Phase 2 of payment-before-verification).

/**
 * Minimal config needed for redemption operations.
 * A subset of SandboxVsLiveKYCRouteHandlerConfig.
 */
export type RedemptionConfig = {
  environment: "sandbox" | "live";
  PaymentCommitmentModel: Model<IPaymentCommitment>;
  PaymentRedemptionModel: any;
  HumanIDCreditsPaymentSecretModel: Model<IHumanIDCreditsPaymentSecret | ISandboxHumanIDCreditsPaymentSecret>;
};

export type ReserveRedemptionResult = {
  reservationToken: string;
  commitment: string;
};

export type CompleteRedemptionResult = {
  commitment: string;
  creditsPartnerUserId?: string;
};

/**
 * Reserve a payment for redemption (two-phase commit, phase 1).
 *
 * Derives commitment from secret, validates the onchain payment, checks it hasn't
 * been redeemed/refunded, and stores a reservation in Valkey with 5min TTL.
 *
 * @throws Error if payment not found, already redeemed/refunded, or pending
 */
export async function reserveRedemption({
  secret,
  chainId,
  service,
  config,
}: {
  secret: string;
  chainId: number;
  service: string;
  config: RedemptionConfig;
}): Promise<ReserveRedemptionResult> {
  // Derive commitment from secret
  const commitment = deriveCommitmentFromSecret(secret);

  // Check if payment exists onchain
  const contractAddress = humanIDPaymentsContractAddresses[chainId];
  if (!contractAddress) {
    throw new PaymentError(`Unsupported chain ID: ${chainId}`, 400);
  }
  const payment = await getPaymentFromContract(commitment, chainId, contractAddress);

  if (!payment) {
    throw new PaymentError("Payment not found onchain", 404);
  }

  // Validate payment
  if (payment.refunded) {
    throw new PaymentError("Payment has been refunded", 400);
  }

  if (payment.service.toLowerCase() !== service.toLowerCase()) {
    throw new PaymentError("Payment service does not match requested service", 400);
  }

  const commitmentRecord = await config.PaymentCommitmentModel.findOne({ commitment }).exec();

  // Check if already redeemed
  if (await isPaymentRedeemed(commitmentRecord, config.PaymentRedemptionModel)) {
    throw new PaymentError("Payment has already been redeemed", 400);
  }

  // Check if redemption is pending
  if (await isRedemptionPending(commitment, config.environment)) {
    throw new PaymentError("Redemption is already pending", 400);
  }

  // Check if refund is pending
  if (await isRefundPending(commitment, config.environment)) {
    throw new PaymentError("Refund is pending for this payment", 400);
  }

  // Insert redemption-pending record with 5 min TTL
  // TODO: Use SET NX (set-if-not-exists) to make this atomic with the isRedemptionPending()
  // check. Currently, two concurrent requests can both pass isRedemptionPending() before
  // either writes, allowing double reservation. With NX, only the first SET succeeds.
  await storeRedemptionPending(commitment, config.environment);

  // Generate reservation token
  const reservationToken = generateReservationToken();
  await storeReservationToken(reservationToken, commitment, config.environment);

  paymentsLogger.info(
    { commitment, reservationToken, environment: config.environment },
    "Reserved redemption"
  );

  return { reservationToken, commitment };
}

/**
 * Complete a reserved redemption (two-phase commit, phase 2).
 *
 * Retrieves commitment from reservation token, checks not already redeemed,
 * and marks the payment as redeemed in MongoDB.
 *
 * @throws Error if reservation token is invalid/expired or payment already redeemed
 */
export async function completeRedemption({
  reservationToken,
  service,
  fulfillmentReceipt,
  config,
}: {
  reservationToken: string;
  service: string;
  fulfillmentReceipt?: string;
  config: RedemptionConfig;
}): Promise<CompleteRedemptionResult> {
  // Get commitment from reservation token
  const commitment = await getReservationToken(reservationToken, config.environment);

  if (!commitment) {
    throw new PaymentError("Invalid or expired reservation token", 400);
  }

  const commitmentRecord = await config.PaymentCommitmentModel.findOne({ commitment }).exec();

  // Check if already redeemed
  if (await isPaymentRedeemed(commitmentRecord, config.PaymentRedemptionModel)) {
    throw new PaymentError("Payment has already been redeemed", 400);
  }

  // Mark as redeemed
  await markPaymentAsRedeemed(
    commitmentRecord,
    config.PaymentRedemptionModel,
    service,
    fulfillmentReceipt
  );

  // For analytics purposes, if the secret was created by a partner, log the partner userId
  let creditsPartnerUserId: string | undefined;
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
      serviceId: service,
      fulfillmentReceipt,
      environment: config.environment,
      creditsPartnerUserId
    },
    "Completed redemption"
  );

  return { commitment, creditsPartnerUserId };
}

/**
 * Cancel a reserved redemption (cleanup on error).
 *
 * Retrieves commitment from reservation token and deletes the redemption-pending record.
 *
 * @throws Error if reservation token is invalid/expired
 */
export async function cancelRedemption({
  reservationToken,
  config,
}: {
  reservationToken: string;
  config: Pick<RedemptionConfig, "environment">;
}): Promise<{ commitment: string }> {
  // Get commitment from reservation token (this also deletes the token)
  const commitment = await getReservationToken(reservationToken, config.environment);

  if (!commitment) {
    throw new PaymentError("Invalid or expired reservation token", 400);
  }

  // Delete the redemption-pending record
  await deleteRedemptionPending(commitment, config.environment);

  paymentsLogger.info(
    { commitment, reservationToken, environment: config.environment },
    "Cancelled redemption reservation"
  );

  return { commitment };
}

/**
 * Custom error class for payment operations with HTTP status code.
 */
export class PaymentError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "PaymentError";
    this.statusCode = statusCode;
  }
}

