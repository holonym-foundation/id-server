import { Request, Response } from "express";
import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import {
  zkPassport,
  classifyZkPassportError,
  formatDateOfBirth,
} from "./verify-and-issue.js";
import { UserVerifications } from "../../init.js";
import { govIdUUID, dateElevenMonthsAgo } from "../../utils/utils.js";
import { countryCodeToPrime } from "../../utils/constants.js";
import { findUserVerification } from "../../utils/user-verifications.js";
import { makeUnknownErrorLoggable } from "../../utils/errors.js";
import { rateLimitOccurrencesPerSecs } from "../../utils/rate-limiting.js";
import { acquireLock, releaseLock } from "../../utils/locks.js";
import { getRouteHandlerConfig } from "../../init.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";

const ATTESTATION_TYPE_ZK_PASSPORT = "zk-passport";

// Off-chain attestation lifetime: 1 week (per ticket #524)
const ATTESTATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Max time a single POST is expected to take (verify + DB writes). The lock
// auto-expires after this so a crashed handler cannot deadlock the address.
const LOCK_TTL_MS = 30_000;

const endpointLogger = logger.child({
  msgPrefix: "[off-chain-attestations/zk-passport] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "zk-passport",
    feature: "holonym",
    subFeature: "gov-id-free-tier",
  },
});

function shapeAttestation(doc: any) {
  return {
    address: doc.address,
    attestationType: doc.attestationType,
    payload: doc.payload,
    issuedAt: doc.issuedAt,
    expiresAt: doc.expiresAt,
  };
}

function createPostOffChainAttestation(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const { address: rawAddress, zkp } = req.body ?? {};

      // --- Validate request body ---

      if (!rawAddress || typeof rawAddress !== "string") {
        return res.status(400).json({
          code: "MISSING_ADDRESS",
          error: "address is required",
        });
      }

      let address: string;
      try {
        address = ethers.utils.getAddress(rawAddress).toLowerCase();
      } catch {
        return res.status(400).json({
          code: "INVALID_ADDRESS",
          error: "address is not a valid Ethereum address",
        });
      }

      const proofs = zkp?.proofs;
      const queryResult = zkp?.queryResult;

      if (!proofs || !Array.isArray(proofs) || proofs.length === 0) {
        return res.status(400).json({ error: "Missing or invalid zkp.proofs array" });
      }
      if (!queryResult || typeof queryResult !== "object") {
        return res.status(400).json({ error: "Missing or invalid zkp.queryResult" });
      }

      // --- Rate limit (per IP) ---

      const ip = (req.headers["x-forwarded-for"] ?? req.socket.remoteAddress) as string;
      const { limitExceeded } = await rateLimitOccurrencesPerSecs(
        `NUM_REQUESTS_BY_IP:zk-passport-off-chain:${ip}`,
        10,
        60 * 60 * 24,
      );
      if (limitExceeded) {
        endpointLogger.warn({ ip }, "Rate limit exceeded");
        return res.status(429).json({
          error: "Too many attempts. Please try again tomorrow.",
        });
      }

      // --- Pre-verify Dedup #1 (cheap optimization) ---
      //
      // Authoritative Dedup #1 re-runs inside the lock below. This early
      // check just avoids an expensive verify() call when the address
      // obviously already has an active attestation.

      const now = new Date();
      const existingForAddress = await config.OffChainAttestationModel.findOne({
        address,
        attestationType: ATTESTATION_TYPE_ZK_PASSPORT,
        expiresAt: { $gt: now },
      }).exec();
      if (existingForAddress) {
        return res.status(409).json({
          code: "ALREADY_ATTESTED",
          error:
            "This address already has an active zk-passport off-chain attestation.",
        });
      }

      // --- Verify ZK Passport proof ---

      let verificationResult;
      try {
        verificationResult = await zkPassport.verify({ proofs, queryResult });
      } catch (err) {
        endpointLogger.error(
          { error: makeUnknownErrorLoggable(err) },
          "ZK Passport verification threw"
        );
        return res.status(400).json({
          code: classifyZkPassportError(err),
          error: "ZK Passport proof verification failed.",
        });
      }

      if (!verificationResult.verified) {
        return res.status(400).json({
          code: classifyZkPassportError(verificationResult.queryResultErrors),
          error: "ZK Passport proof verification failed.",
          details: verificationResult.queryResultErrors,
        });
      }

      // --- Extract disclosed fields ---

      const firstName = queryResult.firstname?.disclose?.result;
      const lastName = queryResult.lastname?.disclose?.result;
      const dobRaw = queryResult.birthdate?.disclose?.result;
      const nationality =
        queryResult.nationality?.disclose?.result ??
        queryResult.issuing_country?.disclose?.result;

      if (!firstName || !lastName || !dobRaw) {
        return res.status(400).json({
          error:
            "ZK Passport proof must disclose at least firstname, lastname, and dateOfBirth.",
        });
      }

      const dob = formatDateOfBirth(dobRaw);
      const nationalityStr = nationality ?? "";

      if (
        nationalityStr &&
        !countryCodeToPrime[nationalityStr as keyof typeof countryCodeToPrime]
      ) {
        return res.status(400).json({
          code: "ZK_PASSPORT_UNSUPPORTED_DOCUMENT",
          error: `Unsupported country (${nationalityStr}) from ZK Passport proof`,
        });
      }

      const uuidV2 = govIdUUID(firstName, lastName, dob);
      const uniqueIdentifier = verificationResult.uniqueIdentifier;

      // --- Acquire locks ---
      //
      // Two locks protect the dedup-check + write section below:
      //   - address lock: prevents two concurrent requests for the same
      //     wallet address from both passing Dedup #1.
      //   - uniqueIdentifier lock: prevents two concurrent requests whose
      //     proofs reference the same passport (even from different
      //     addresses) from both passing Dedup #2.
      //
      // uniqueIdentifier comes from the verified ZK Passport proof, so it
      // cannot be spoofed by the caller. Both locks auto-expire after
      // LOCK_TTL_MS in case the handler crashes.
      const addressLockKey = `lock:off-chain-attestation:zk-passport:address:${address}`;
      const uniqueIdLockKey = `lock:off-chain-attestation:zk-passport:uniqueIdentifier:${uniqueIdentifier}`;

      const addressLockToken = await acquireLock(addressLockKey, LOCK_TTL_MS);
      if (!addressLockToken) {
        return res.status(409).json({
          code: "CONCURRENT_REQUEST",
          error:
            "Another attestation request is in progress for this address. Please retry in a few seconds.",
        });
      }

      let uniqueIdLockToken: string | null = null;

      try {
        uniqueIdLockToken = await acquireLock(uniqueIdLockKey, LOCK_TTL_MS);
        if (!uniqueIdLockToken) {
          return res.status(409).json({
            code: "CONCURRENT_REQUEST",
            error:
              "Another attestation request is in progress for this passport. Please retry in a few seconds.",
          });
        }

        // --- Dedup #1 (authoritative, inside lock) ---

        const existingForAddress = await config.OffChainAttestationModel.findOne({
          address,
          attestationType: ATTESTATION_TYPE_ZK_PASSPORT,
          expiresAt: { $gt: now },
        }).exec();
        if (existingForAddress) {
          return res.status(409).json({
            code: "ALREADY_ATTESTED",
            error:
              "This address already has an active zk-passport off-chain attestation.",
          });
        }

        // --- Dedup #2: name+DOB already registered (cross-flow sybil check) ---
        //
        // Checks for an _unexpired_ verification from the last 11 months. Expired
        // verifications are ignored. If there is no explicit expiry (legacy docs),
        // the verification is treated as unexpired.
        //
        // Skipped in sandbox: sandbox must not consult or contend with the live
        // UserVerifications collection, otherwise a previously-verified identity
        // cannot exercise the sandbox flow.

        if (config.environment === "live") {
          const existingUser = await findUserVerification(uuidV2, "govId", {
            issuedAt: { after: dateElevenMonthsAgo() },
            expiresAt: { after: new Date() },
          });
          if (existingUser) {
            endpointLogger.info({ uuidV2 }, "Off-chain dedup: identity already registered");
            return res.status(409).json({
              code: "ALREADY_REGISTERED",
              error: `This identity has already been verified (user ID ${existingUser._id}).`,
            });
          }
        }

        // Fresh timestamps captured after the lock is held, so the attestation's
        // issuedAt / expiresAt reflect the actual issuance time (not the stale
        // `now` captured before zkPassport.verify()).
        const issuedAt = new Date();
        const expiresAt = new Date(issuedAt.getTime() + ATTESTATION_TTL_MS);

        // --- Persist UserVerifications (blocks future free + paid re-verifications) ---
        //
        // Skipped in sandbox so sandbox runs neither block live verifications
        // for the same identity nor get blocked by them.

        if (config.environment === "live") {
          try {
            await new UserVerifications({
              govId: {
                uuidV2,
                sessionId: null,
                issuedAt,
                expiresAt,
                // By specifying which flow this UserVerification record came from, we have
                // the option of allowing users to verify again via a different (e.g., paid)
                // flow in the future.
                createdByFlow: "free-zk-passport",
              },
            }).save();
          } catch (err) {
            endpointLogger.error(
              { error: makeUnknownErrorLoggable(err) },
              "Failed to save UserVerifications"
            );
            return res.status(500).json({ error: "Failed to save verification." });
          }
        }

        // --- Persist the off-chain attestation ---

        const doc = new config.OffChainAttestationModel({
          address,
          attestationType: ATTESTATION_TYPE_ZK_PASSPORT,
          payload: {
            uniqueIdentifier,
          },
          issuedAt,
          expiresAt,
        });

        try {
          await doc.save();
        } catch (err) {
          endpointLogger.error(
            { error: makeUnknownErrorLoggable(err) },
            "Failed to save off-chain attestation"
          );
          return res.status(500).json({ error: "Failed to save attestation." });
        }

        endpointLogger.info(
          { address, uuidV2 },
          "Issued zkPassport off-chain attestation"
        );

        return res.status(201).json(shapeAttestation(doc));
      } finally {
        if (uniqueIdLockToken) {
          await releaseLock(uniqueIdLockKey, uniqueIdLockToken);
        }
        await releaseLock(addressLockKey, addressLockToken);
      }
    } catch (err: any) {
      endpointLogger.error(
        { error: makeUnknownErrorLoggable(err) },
        "Unexpected error in POST /off-chain-attestations/zk-passport"
      );
      return res.status(500).json({
        error: "An unexpected error occurred. Please try again later.",
      });
    }
  };
}

function createGetOffChainAttestation(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const rawAddress = (req.query.address ?? "") as string;
      if (!rawAddress || typeof rawAddress !== "string") {
        return res.status(400).json({
          code: "MISSING_ADDRESS",
          error: "address query parameter is required",
        });
      }

      let address: string;
      try {
        address = ethers.utils.getAddress(rawAddress).toLowerCase();
      } catch {
        return res.status(400).json({
          code: "INVALID_ADDRESS",
          error: "address is not a valid Ethereum address",
        });
      }

      // Latest zk-passport attestation for this address (expired or not).
      // The caller decides whether expired means "reverify".
      const doc = await config.OffChainAttestationModel.findOne({
        address,
        attestationType: ATTESTATION_TYPE_ZK_PASSPORT,
      })
        .sort({ issuedAt: -1 })
        .exec();

      if (!doc) {
        return res.status(404).json({
          code: "NOT_FOUND",
          error: "No off-chain attestation for this address",
        });
      }

      return res.status(200).json(shapeAttestation(doc));
    } catch (err: any) {
      endpointLogger.error(
        { error: makeUnknownErrorLoggable(err) },
        "Unexpected error in GET /off-chain-attestations/zk-passport"
      );
      return res.status(500).json({
        error: "An unexpected error occurred. Please try again later.",
      });
    }
  };
}

export async function postZkPassportOffChainAttestationProd(req: Request, res: Response) {
  return createPostOffChainAttestation(getRouteHandlerConfig("live"))(req, res);
}
export async function postZkPassportOffChainAttestationSandbox(req: Request, res: Response) {
  return createPostOffChainAttestation(getRouteHandlerConfig("sandbox"))(req, res);
}
export async function getZkPassportOffChainAttestationProd(req: Request, res: Response) {
  return createGetOffChainAttestation(getRouteHandlerConfig("live"))(req, res);
}
export async function getZkPassportOffChainAttestationSandbox(req: Request, res: Response) {
  return createGetOffChainAttestation(getRouteHandlerConfig("sandbox"))(req, res);
}
