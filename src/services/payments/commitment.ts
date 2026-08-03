import type { Model } from "mongoose";
import type { IPaymentCommitment } from "../../types.js";

export const INVALID_COMMITMENT_MESSAGE =
  "commitment must be a 0x-prefixed 32-byte hex string";

/**
 * Validate that a value is a 0x-prefixed 32-byte hex string (a payment
 * commitment) and return it lowercased. Returns null for anything else.
 * NEVER apply this to payment secrets: commitments are keccak256 of the
 * secret's exact UTF-8 string, so changing a secret's case changes the digest.
 */
export function normalizeCommitment(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    return null;
  }
  return raw.toLowerCase();
}

/**
 * Create commitment record in PaymentCommitments collection
 */
export async function createCommitmentRecord(
  commitment: string,
  sourceType: 'user' | 'credits',
  PaymentCommitmentModel: Model<IPaymentCommitment>
): Promise<IPaymentCommitment> {
  // Guard against ever persisting a non-lowercase or malformed commitment,
  // which would bypass the case-sensitive unique index on `commitment`.
  const normalized = normalizeCommitment(commitment);
  if (!normalized) {
    throw new Error(`Invalid commitment format: ${INVALID_COMMITMENT_MESSAGE}`);
  }
  // Check if commitment already exists
  const existing = await PaymentCommitmentModel.findOne({ commitment: normalized }).exec();
  if (existing) {
    return existing;
  }
  return await PaymentCommitmentModel.create({
    commitment: normalized,
    sourceType,
    createdAt: new Date(),
  });
}
