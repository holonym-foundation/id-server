// POST /idos/kyc-token — issues a freshly signed Fractal KYC JWT for the
// frontend to embed in the Kraken iframe URL
// (https://verify.fractal.id/kyc?token=...).
//
// Required env vars (validated lazily on first request):
//   IDOS_JWT_PRIVATE_KEY       PEM-encoded ES512 private key Fractal trusts.
//   IDOS_FRACTAL_CLIENT_ID     Fractal-issued client id (UUID).
//
// Sandbox parity is achieved by reading sandbox-specific overrides
// (IDOS_JWT_PRIVATE_KEY_SANDBOX, IDOS_FRACTAL_CLIENT_ID_SANDBOX) when present,
// falling back to the prod values otherwise.
//
// Per the parent plan (U9) the JWT has *no expiration* — tokens persist until
// Fractal rotates the clientId. If short-lived tokens become required later,
// add `expiresIn` to the jwt.sign call (single seam at signKycToken).

import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

import logger from "../../utils/logger.js";
import { rateLimitOccurrencesPerSecs } from "../../utils/rate-limiting.js";

type Environment = "live" | "sandbox";

// Fractal rejects "basic+uniqueness+idos" with "Can't create KYC session
// with both KYC and Uniqueness" — kyc: true already implies KYC, and the
// "+uniqueness" component must be a separate session. We keep `kyc: true`
// + `level: "basic+idos"` (KYC + idOS profile creation) and skip the
// uniqueness check at this layer; uniqueness is enforced by the
// downstream sybil-resistance UUID + UserVerifications insert in
// `services/idos/credentials/v3.ts`.
interface KycTokenPayload {
  clientId: string;
  kyc: true;
  level: "basic+idos";
  state: "optional";
  walletAddress?: string;
  externalUserId?: string;
}

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_EXTERNAL_USER_ID_LEN = 256;

function readJwtPrivateKey(env: Environment): string {
  const key =
    env === "sandbox"
      ? process.env.IDOS_JWT_PRIVATE_KEY_SANDBOX || process.env.IDOS_JWT_PRIVATE_KEY
      : process.env.IDOS_JWT_PRIVATE_KEY;
  if (!key) {
    throw new Error("IDOS_JWT_PRIVATE_KEY environment variable is not set");
  }
  // Crude but useful sanity check: a valid PEM begins with "-----BEGIN".
  // Helps catch the case where the env var was set to a path or a base64
  // blob without the PEM wrapper.
  if (!key.includes("-----BEGIN")) {
    throw new Error(
      "IDOS_JWT_PRIVATE_KEY does not look like a PEM-encoded private key (missing -----BEGIN header)"
    );
  }
  return key;
}

function readClientId(env: Environment): string {
  const id =
    env === "sandbox"
      ? process.env.IDOS_FRACTAL_CLIENT_ID_SANDBOX || process.env.IDOS_FRACTAL_CLIENT_ID
      : process.env.IDOS_FRACTAL_CLIENT_ID;
  if (!id) {
    throw new Error("IDOS_FRACTAL_CLIENT_ID environment variable is not set");
  }
  return id;
}

/**
 * Sign a Fractal KYC JWT. Exported for unit testing; the HTTP handler below
 * is the real entry point.
 */
export function signKycToken(
  env: Environment,
  opts: { walletAddress?: string; externalUserId?: string } = {}
): string {
  const payload: KycTokenPayload = {
    clientId: readClientId(env),
    kyc: true,
    level: "basic+liveness+idos",
    state: "optional",
    ...(opts.walletAddress ? { walletAddress: opts.walletAddress } : {}),
    ...(opts.externalUserId ? { externalUserId: opts.externalUserId } : {}),
  };

  return jwt.sign(payload, readJwtPrivateKey(env), { algorithm: "ES512" });
}

function validateBody(body: unknown):
  | { ok: true; walletAddress?: string; externalUserId?: string }
  | { ok: false; error: string } {
  if (body === null || body === undefined) return { ok: true };
  if (typeof body !== "object") {
    return { ok: false, error: "Body must be a JSON object" };
  }

  const { walletAddress, externalUserId } = body as {
    walletAddress?: unknown;
    externalUserId?: unknown;
  };

  if (walletAddress !== undefined) {
    if (typeof walletAddress !== "string" || !HEX_ADDRESS_RE.test(walletAddress)) {
      return {
        ok: false,
        error: "walletAddress must be a 0x-prefixed 20-byte hex string",
      };
    }
  }

  if (externalUserId !== undefined) {
    if (
      typeof externalUserId !== "string" ||
      externalUserId.length === 0 ||
      externalUserId.length > MAX_EXTERNAL_USER_ID_LEN
    ) {
      return {
        ok: false,
        error: `externalUserId must be a non-empty string up to ${MAX_EXTERNAL_USER_ID_LEN} chars`,
      };
    }
  }

  return {
    ok: true,
    walletAddress: walletAddress as string | undefined,
    externalUserId: externalUserId as string | undefined,
  };
}

function createKycTokenRouteHandler(env: Environment) {
  return async (req: Request, res: Response) => {
    try {
      const validated = validateBody(req.body);
      if (!validated.ok) {
        return res.status(400).json({ error: validated.error });
      }

      // Best-effort rate limit so an unauthenticated caller can't burn a
      // large number of JWTs against this endpoint. The Fractal token has
      // no expiration but each one ties up a Fractal-side client-side
      // session quota, so high request volume still hurts.
      const limit = await rateLimitOccurrencesPerSecs(
        env === "sandbox" ? "idos-kyc-token-sandbox" : "idos-kyc-token",
        500,
        60
      );
      if (limit.limitExceeded) {
        return res
          .status(429)
          .json({ error: "Too many token requests. Please try again shortly." });
      }

      const token = signKycToken(env, {
        walletAddress: validated.walletAddress,
        externalUserId: validated.externalUserId,
      });

      return res.status(200).json({ token });
    } catch (err: unknown) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err), env },
        "Failed to issue idOS KYC token"
      );

      // Don't leak env-var validation messages to the client. The startup-
      // error case (PEM missing/malformed) deserves a clearer message — give
      // a specific 500 in that case so ops can spot the misconfig.
      const isConfigError =
        err instanceof Error &&
        (err.message.includes("IDOS_JWT_PRIVATE_KEY") ||
          err.message.includes("IDOS_FRACTAL_CLIENT_ID"));
      if (isConfigError) {
        return res
          .status(500)
          .json({ error: "idOS token signing is not configured on this server" });
      }

      return res.status(500).json({ error: "Failed to issue token" });
    }
  };
}

export const issueKycTokenProd = createKycTokenRouteHandler("live");
export const issueKycTokenSandbox = createKycTokenRouteHandler("sandbox");
