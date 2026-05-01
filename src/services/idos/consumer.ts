// idOS consumer SDK wrapper. Single lazily-initialized consumer instance shared
// across the credentials endpoint and any future idOS-side reads.
//
// Required env vars (only validated on first use so id-server can still boot
// without idOS configured during local dev):
//   IDOS_SIGNER                            hex-encoded nacl.sign secret key
//                                          (64 bytes / 128 hex chars).
//   IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY  consumer-side encryption private key.
//   IDOS_NODE_URL (optional)               override Kwil node URL (defaults to
//                                          the SDK's mainnet node).
//   IDOS_CHAIN_ID (optional)               override Kwil chain id.
//
// SDK surface confirmed against @idos-network/consumer@1.1.0 dist types
// (idOSConsumer.init, getAccessGrants, getCredentialSharedContentDecrypted,
// getCredentialSharedFromIDOS, verifyCredential).

import nacl from "tweetnacl";
import {
  idOSConsumer as idOSConsumerClass,
  type idOSCredential,
  type idOSGrant,
} from "@idos-network/consumer";

let consumerPromise: Promise<idOSConsumerClass> | null = null;

function readSignerKeyPair(): nacl.SignKeyPair {
  const hex = process.env.IDOS_SIGNER;
  if (!hex) {
    throw new Error("IDOS_SIGNER environment variable is not set");
  }

  // nacl secret keys are 64 bytes => 128 hex chars. Validate before parsing
  // so a malformed env var fails with a clear message rather than a cryptic
  // length mismatch from inside tweetnacl.
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== 128) {
    throw new Error(
      "IDOS_SIGNER must be a 128-character hex string (64-byte nacl sign secret key)"
    );
  }

  return nacl.sign.keyPair.fromSecretKey(Buffer.from(hex, "hex"));
}

function readRecipientEncryptionKey(): string {
  const key = process.env.IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY environment variable is not set"
    );
  }
  return key;
}

async function getConsumer(): Promise<idOSConsumerClass> {
  if (!consumerPromise) {
    const consumerSigner = readSignerKeyPair();
    const recipientEncryptionPrivateKey = readRecipientEncryptionKey();

    consumerPromise = idOSConsumerClass
      .init({
        consumerSigner,
        recipientEncryptionPrivateKey,
        ...(process.env.IDOS_NODE_URL ? { nodeUrl: process.env.IDOS_NODE_URL } : {}),
        ...(process.env.IDOS_CHAIN_ID ? { chainId: process.env.IDOS_CHAIN_ID } : {}),
      })
      .catch((err) => {
        // Reset on failure so a transient init error doesn't poison subsequent
        // calls.
        consumerPromise = null;
        throw err;
      });
  }

  return consumerPromise;
}

/**
 * Page through access grants the consumer has been given. The SDK's
 * `GetAccessGrantsGrantedInput` only filters by user_id (UUID) — call sites
 * that want to filter by data_id, owner address, or grantee should do so
 * post-fetch.
 *
 * @param params - SDK pagination + optional user_id filter
 *                 ({ user_id: string|null, page: number, size: number }).
 *                 user_id is the idOS user UUID, not an EVM address.
 */
export async function listGrants(
  params: { user_id?: string | null; page?: number; size?: number } = {}
): Promise<{ grants: idOSGrant[]; totalCount: number }> {
  const consumer = await getConsumer();
  return consumer.getAccessGrants(params);
}

/**
 * Decrypt the shared content for a granted credential. The SDK returns the
 * decrypted credential content as a JSON string (parse downstream).
 */
export async function decryptCredential(dataId: string): Promise<string> {
  const consumer = await getConsumer();
  return consumer.getCredentialSharedContentDecrypted(dataId);
}

/**
 * Fetch the granted credential metadata + ciphertext (without decrypting).
 * Useful when the caller needs `original_issuer_auth_public_key` to verify
 * the credential's signature before decryption.
 */
export async function getSharedCredential(
  dataId: string
): Promise<idOSCredential | undefined> {
  const consumer = await getConsumer();
  return consumer.getCredentialSharedFromIDOS(dataId);
}

/**
 * Test-only helper: clear the cached consumer instance so the next call
 * re-reads env vars. Used by unit tests that mutate process.env.
 */
export function __resetIdosConsumerForTests() {
  consumerPromise = null;
}

export type { idOSCredential, idOSGrant };
