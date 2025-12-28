import { SiweMessage, SiweError } from 'siwe';
import { ethers } from 'ethers';
import { v4 as uuidV4 } from 'uuid';
import { randomBytes } from 'crypto';
import { valkeyClient } from '../../../utils/valkey-glide.js';
import { TimeUnit } from '@valkey/valkey-glide';
import { Model, Types } from 'mongoose';
import {
  IPaymentCommitment,
  IHumanIDCreditsUser,
  IHumanIDCreditsPaymentSecret,
} from '../../../types.js';
import { deriveCommitmentFromSecret, generatePaymentSignature, calculatePriceInToken } from '../functions.js';
import { idvSessionUSDPrice, PAYMENT_SERVICE_SBT_MINT } from '../../../constants/misc.js';
import { logger } from '../../../utils/logger.js';

const creditsLogger = logger.child({ feature: 'holonym', subFeature: 'human-id-credits' });

/**
 * Generate and store a nonce for SIWE authentication
 * Nonces expire after 5 minutes to prevent replay attacks
 */
export async function generateNonce(): Promise<string> {
  if (!valkeyClient) {
    throw new Error('Valkey client not initialized');
  }

  // Generate a random nonce (32 bytes as hex string)
  const nonce = randomBytes(16).toString('hex');
  const key = `human-id-credits:nonce:${nonce}`;
  
  // Store nonce with 5 minute TTL (300 seconds)
  // Value is timestamp when nonce was issued
  await valkeyClient.set(key, Date.now().toString(), {
    expiry: { type: TimeUnit.Seconds, count: 300 },
  });

  return nonce;
}

/**
 * Validate and consume a nonce
 * Returns true if nonce is valid and hasn't been used, false otherwise
 * This prevents replay attacks by ensuring each nonce can only be used once
 */
export async function validateAndConsumeNonce(nonce: string): Promise<boolean> {
  if (!valkeyClient) {
    throw new Error('Valkey client not initialized');
  }

  const key = `human-id-credits:nonce:${nonce}`;
  
  // Try to get and delete the nonce atomically
  // If the nonce exists, it will be deleted (consumed)
  // If it doesn't exist, it was already used or expired
  const result = await valkeyClient.getdel(key);
  
  return result !== null;
}

/**
 * Verify SIWE message and signature
 * Also validates that the nonce was issued by the server and hasn't been used
 */
export async function verifySIWEMessage(
  siweMessage: string,
  signature: string
): Promise<{ success: boolean; error?: SiweError; address: string }> {
  const message = new SiweMessage(siweMessage);
  
  // First verify the signature
  const result = await message.verify({ signature, nonce: message.nonce });
  
  if (!result.success) {
    return { success: false, error: result.error, address: message.address };
  }

  // Then validate that the nonce was issued by us and hasn't been used
  const nonceValid = await validateAndConsumeNonce(message.nonce);
  
  if (!nonceValid) {
    return {
      success: false,
      error: { type: 'Invalid nonce', expected: '', received: message.nonce },
      address: message.address,
    };
  }

  return { success: true, address: message.address };
}

/**
 * Generate a session token (JWT-like string)
 */
export function generateSessionToken(): string {
  return uuidV4();
}

/**
 * Store session in Valkey with 1 hour TTL
 */
export async function storeSession(
  sessionToken: string,
  userId: string,
  walletAddress: string
): Promise<void> {
  if (!valkeyClient) {
    throw new Error('Valkey client not initialized');
  }

  const key = `human-id-credits:session:${sessionToken}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  const sessionData = {
    userId,
    walletAddress,
    expiresAt,
  };

  // Store with 1 hour TTL (3600 seconds)
  await valkeyClient.set(key, JSON.stringify(sessionData), {
    expiry: { type: TimeUnit.Seconds, count: 3600 },
  });
}

/**
 * Get session from Valkey
 */
export async function getSession(sessionToken: string): Promise<{
  userId: string;
  walletAddress: string;
  expiresAt: number;
} | null> {
  if (!valkeyClient) {
    throw new Error('Valkey client not initialized');
  }

  const key = `human-id-credits:session:${sessionToken}`;
  const sessionData = await valkeyClient.get(key);

  if (!sessionData) {
    return null;
  }

  try {
    return JSON.parse(sessionData as string);
  } catch (error) {
    creditsLogger.error({ error }, 'Error parsing session data');
    return null;
  }
}

/**
 * Validate session token and return user info
 */
export async function validateSessionToken(sessionToken: string): Promise<{
  userId: string;
  walletAddress: string;
  valid: boolean;
  error?: string;
}> {
  const session = await getSession(sessionToken);

  if (!session) {
    return { userId: '', walletAddress: '', valid: false, error: 'Invalid or expired session token' };
  }

  // Check if session has expired
  if (session.expiresAt < Math.floor(Date.now() / 1000)) {
    return { userId: '', walletAddress: '', valid: false, error: 'Session token has expired' };
  }

  return {
    userId: session.userId,
    walletAddress: session.walletAddress,
    valid: true,
  };
}

/**
 * Get or create HumanIDCreditsUser
 */
export async function getOrCreateCreditsUser(
  walletAddress: string,
  UserModel: Model<IHumanIDCreditsUser>
): Promise<Types.ObjectId> {
  // Normalize wallet address to lowercase
  const normalizedAddress = walletAddress.toLowerCase();

  let user = await UserModel.findOne({ walletAddress: normalizedAddress }).exec();

  if (!user) {
    user = await UserModel.create({
      walletAddress: normalizedAddress,
      createdAt: new Date(),
    });
  }

  return user._id!;
}

/**
 * Check if commitment exists in PaymentCommitments
 */
export async function commitmentExists(
  commitment: string,
  PaymentCommitmentModel: Model<IPaymentCommitment>
): Promise<boolean> {
  const exists = await PaymentCommitmentModel.findOne({ commitment }).exec();
  return exists !== null;
}

/**
 * Get commitment record
 */
export async function getCommitmentRecord(
  commitment: string,
  PaymentCommitmentModel: Model<IPaymentCommitment>
): Promise<IPaymentCommitment | null> {
  return await PaymentCommitmentModel.findOne({ commitment }).exec();
}

/**
 * Create commitment record
 */
export async function createCommitmentRecord(
  commitment: string,
  sourceType: 'user' | 'credits',
  PaymentCommitmentModel: Model<IPaymentCommitment>
): Promise<Types.ObjectId> {
  // Check if commitment already exists
  const existing = await PaymentCommitmentModel.findOne({ commitment }).exec();
  if (existing) {
    return existing._id!;
  }

  const commitmentRecord = await PaymentCommitmentModel.create({
    commitment,
    sourceType,
    createdAt: new Date(),
  });

  return commitmentRecord._id!;
}

/**
 * Rate limit secret generation by userId
 */
export async function rateLimitSecretGeneration(
  userId: string,
  maxPerHour: number = 1000,
  maxPerDay: number = 10000
): Promise<{ allowed: boolean; error?: string }> {
  if (!valkeyClient) {
    throw new Error('Valkey client not initialized');
  }

  const now = Math.floor(Date.now() / 1000);
  const hourKey = `human-id-credits:rate-limit:hour:${userId}`;
  const dayKey = `human-id-credits:rate-limit:day:${userId}`;

  // Check hourly limit
  const hourCount = await valkeyClient.incr(hourKey);
  const hourTTL = await valkeyClient.ttl(hourKey);
  if (hourTTL < 0) {
    await valkeyClient.expire(hourKey, 3600); // 1 hour
  }

  // Check daily limit
  const dayCount = await valkeyClient.incr(dayKey);
  const dayTTL = await valkeyClient.ttl(dayKey);
  if (dayTTL < 0) {
    await valkeyClient.expire(dayKey, 86400); // 24 hours
  }

  if (hourCount > maxPerHour) {
    return { allowed: false, error: `Hourly limit exceeded (${maxPerHour} secrets per hour)` };
  }

  if (dayCount > maxPerDay) {
    return { allowed: false, error: `Daily limit exceeded (${maxPerDay} secrets per day)` };
  }

  return { allowed: true };
}

/**
 * Generate batch of payment secrets
 */
export async function generatePaymentSecretsBatch(
  count: number,
  service: string,
  chainId: number,
  userId: Types.ObjectId,
  PaymentCommitmentModel: Model<IPaymentCommitment>,
  CreditsPaymentSecretModel: Model<IHumanIDCreditsPaymentSecret>
): Promise<Array<{
  secret: string;
  commitment: string;
  price: string;
  signature: string;
  timestamp: number;
}>> {
  if (count > 1000) {
    throw new Error('Batch size cannot exceed 1000 secrets');
  }

  const validServices = [PAYMENT_SERVICE_SBT_MINT];
  if (!validServices.includes(service)) {
    throw new Error(`Invalid service: ${service}`);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const price = await calculatePriceInToken(idvSessionUSDPrice, chainId);

  const secrets: Array<{
    secret: string;
    commitment: string;
    price: string;
    signature: string;
    timestamp: number;
  }> = [];

  // Generate secrets and commitments
  for (let i = 0; i < count; i++) {
    // Generate a random 32-byte secret as hex string (sans 0x prefix)
    const secretBytes = randomBytes(32);
    const secret = ethers.utils.hexlify(secretBytes).slice(2);
    const commitment = deriveCommitmentFromSecret(secret);

    // Create commitment record
    const commitmentId = await createCommitmentRecord(
      commitment,
      'credits',
      PaymentCommitmentModel
    );

    // Create payment secret record
    await CreditsPaymentSecretModel.create({
      userId,
      commitmentId,
      secret,
      chainId,
      price,
      createdAt: new Date(),
    });

    // Generate payment signature
    const signature = await generatePaymentSignature(
      price,
      commitment,
      service,
      chainId,
      timestamp
    );

    secrets.push({
      secret,
      commitment,
      price,
      signature,
      timestamp,
    });
  }

  return secrets;
}

