import crypto from "crypto";
import { valkeyClient } from "./valkey-glide.js";

/**
 * Acquire a short-lived distributed lock via Valkey/Redis.
 *
 * Uses SET key token NX PX ttlMs so only one caller can hold the lock at a
 * time. Returns the token on success (pass it to releaseLock), or null if
 * the lock is already held.
 */
export async function acquireLock(
  key: string,
  ttlMs: number
): Promise<string | null> {
  if (!valkeyClient) {
    throw new Error("valkeyClient is not defined");
  }
  const token = crypto.randomBytes(16).toString("hex");
  const result = await valkeyClient.customCommand([
    "SET",
    key,
    token,
    "NX",
    "PX",
    String(ttlMs),
  ]);
  return result === "OK" ? token : null;
}

// Compare-and-delete: only releases the lock if the stored token still
// matches ours. Prevents a slow request from releasing a lock another
// request has since acquired (after its own TTL expiry).
const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export async function releaseLock(key: string, token: string): Promise<void> {
  if (!valkeyClient) return;
  try {
    await valkeyClient.customCommand([
      "EVAL",
      RELEASE_SCRIPT,
      "1",
      key,
      token,
    ]);
  } catch {
    // Best-effort release. The lock's PX TTL will expire it anyway.
  }
}
