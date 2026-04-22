import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { poseidon } from "circomlibjs-old";
import { ZKPassport } from "@zkpassport/sdk";
import {
  UserVerifications,
  VerificationCollisionMetadata,
} from "../../init.js";
import { sessionStatusEnum } from "../../constants/misc.js";
import {
  getDateAsInt,
  govIdUUID,
  sha256,
} from "../../utils/utils.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import {
  countryCodeToPrime,
} from "../../utils/constants.js";
import {
  findOneUserVerificationLast11Months,
  findOneUserVerification11Months5Days,
} from "../../utils/user-verifications.js";
import { findOneNullifierAndCredsLast5Days } from "../../utils/zk-passport-nullifier-and-creds.js";
import { issuev2ZKPassport } from "../../utils/issuance.js";
import { makeUnknownErrorLoggable } from "../../utils/errors.js";
import { rateLimitOccurrencesPerSecs } from "../../utils/rate-limiting.js";
import { getRouteHandlerConfig } from "../../init.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";

const endpointLogger = logger.child({
  msgPrefix: "[POST /zk-passport/verify-and-issue] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "zk-passport",
    feature: "holonym",
    subFeature: "gov-id",
  },
});

// Initialize ZK Passport SDK with the frontend's domain.
// The domain scopes proof validation and the uniqueIdentifier to the application.
// We use the frontend domain (id.human.tech), NOT the server's own hostname.
const zkPassportDomain = process.env.NODE_ENV === 'development' ? 'localhost' : "id.human.tech";
const zkPassport = new ZKPassport(zkPassportDomain);

/**
 * Extract credentials from ZK Passport disclosed fields.
 *
 * ZK Passport discloses: firstname, lastname, birthdate, nationality, expiry_date.
 * Middle name is not available from ZK Passport but is included (blank) in the
 * name hash for future compatibility.
 *
 * The two leaf fields are countryCode and nameDobExpireHash (a Poseidon hash of
 * nameHash, birthdate, and expirationDate).
 */
function extractCreds(
  firstName: string,
  lastName: string,
  birthdate: string,
  nationality: string,
  expirationDate: string,
) {
  const countryCode =
    countryCodeToPrime[nationality as keyof typeof countryCodeToPrime];
  const birthdateNum = birthdate ? getDateAsInt(birthdate) : 0;
  const expireDateNum = expirationDate ? getDateAsInt(expirationDate) : 0;

  const firstNameBuffer = firstName
    ? Buffer.from(firstName)
    : Buffer.alloc(1);
  // We don't currently attempt to extract the user's middle name
  const middleNameStr = ""
  const middleNameBuffer = Buffer.alloc(1);
  const lastNameBuffer = lastName
    ? Buffer.from(lastName)
    : Buffer.alloc(1);
  const nameArgs = [firstNameBuffer, middleNameBuffer, lastNameBuffer].map(
    (x) => ethers.BigNumber.from(x).toString()
  );
  const nameHash = ethers.BigNumber.from(poseidon(nameArgs)).toString();

  const nameDobExpireArgs = [
    nameHash,
    birthdateNum,
    expireDateNum,
  ].map((x) => ethers.BigNumber.from(x).toString());
  const nameDobExpire = ethers.BigNumber.from(
    poseidon(nameDobExpireArgs)
  ).toString();

  return {
    rawCreds: {
      countryCode: countryCode,
      firstName: firstName,
      middleName: middleNameStr,
      lastName: lastName,
      birthdate: birthdate,
      expirationDate: expirationDate,
    },
    derivedCreds: {
      nameDobExpireHash: {
        value: nameDobExpire,
        derivationFunction: "poseidon",
        inputFields: [
          "derivedCreds.nameHash.value",
          "rawCreds.birthdate",
          "rawCreds.expirationDate",
        ],
      },
      nameHash: {
        value: nameHash,
        derivationFunction: "poseidon",
        inputFields: [
          "rawCreds.firstName",
          "rawCreds.middleName",
          "rawCreds.lastName",
        ],
      },
    },
    fieldsInLeaf: [
      "issuer",
      "secret",
      "rawCreds.countryCode",
      "derivedCreds.nameDobExpireHash.value",
      "scope",
    ],
  };
}

/**
 * Generate the legacy ("old") UUID for cross-provider sybil detection.
 * Matches the pattern from Onfido/Sumsub: sha256(firstName + lastName + dob).
 */
function uuidOld(firstName: string, lastName: string, dob: string) {
  const uuidConstituents =
    (firstName || "") +
    (lastName || "") +
    (dob || "");
  return sha256(Buffer.from(uuidConstituents)).toString("hex");
}

async function saveCollisionMetadata(
  uuid: string,
  uuidV2: string,
) {
  try {
    const collisionMetadataDoc = new VerificationCollisionMetadata({
      uuid: uuid,
      uuidV2: uuidV2,
      timestamp: new Date(),
      // No session ID for ZK Passport — verification is session-less
    });
    await collisionMetadataDoc.save();
  } catch (err) {
    endpointLogger.error({ error: err }, "Error recording collision metadata");
  }
}

/**
 * Store the user verification in the same UserVerifications collection as Onfido/Sumsub.
 * This prevents the same identity (same name + DOB) from verifying via both ZK Passport
 * and traditional KYC within the 11-month window.
 */
async function saveUserToDb(uuidV2: string) {
  const userVerificationsDoc = new UserVerifications({
    govId: {
      uuidV2: uuidV2,
      // sessionId is null for ZK Passport entries — verification is session-less
      sessionId: null,
      issuedAt: new Date(),
    },
  });
  try {
    await userVerificationsDoc.save();
  } catch (err) {
    endpointLogger.error(
      { error: err },
      "An error occurred while saving user verification to database"
    );
    return {
      error:
        "An error occurred while trying to save object to database. Please try again.",
    };
  }
  return { success: true };
}

/**
 * Format the date of birth from ZK Passport.
 *
 * ZK Passport returns dateOfBirth as a Date object from queryResult.birthdate?.disclose?.result.
 * We need it as a "YYYY-MM-DD" string to match Onfido/Sumsub format.
 */
function formatDateOfBirth(dob: Date | string): string {
  if (typeof dob === "string") return dob;
  const d = new Date(dob);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Map ZKPassport SDK error shapes to our structured error codes so the
 * frontend can render PRD §4.2 UX (unsupported doc, PFM failure, generic).
 */
function classifyZkPassportError(err: unknown): string {
  const msg =
    typeof err === "string"
      ? err
      : (err as any)?.message || JSON.stringify(err ?? "");
  const lower = (msg || "").toLowerCase();
  if (lower.includes("face match") || lower.includes("pfm") || lower.includes("private face match")) {
    return "ZK_PASSPORT_PFM_FAILED";
  }
  if (lower.includes("unsupported") || lower.includes("not supported") || lower.includes("document")) {
    return "ZK_PASSPORT_UNSUPPORTED_DOCUMENT";
  }
  return "ZK_PASSPORT_VERIFICATION_FAILED";
}

/**
 * POST /zk-passport/verify-and-issue
 *
 * Single request/response endpoint for ZK Passport verification and credential issuance.
 * No sessions — only a valid ZK Passport proof is needed.
 *
 * Request body: { proofs, queryResult, nullifier }
 * - proofs: Array of ZK Passport proof results
 * - queryResult: ZK Passport query result with disclosed fields
 * - nullifier: The issuance nullifier (same role as in Onfido/Sumsub credential endpoints)
 *
 * Response: Signed credentials (same format as Onfido/Sumsub)
 */
function createVerifyAndIssue(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    let session: any = null;
    try {
      const {
        sid,
        holoUserId,
        proofs,
        queryResult,
        nullifier: issuanceNullifier,
      } = req.body;

      // --- Validate request body ---

      if (!sid || typeof sid !== "string") {
        return res.status(400).json({
          code: "MISSING_SESSION_ID",
          error: "sid is required",
        });
      }

      if (!holoUserId || typeof holoUserId !== "string") {
        return res.status(401).json({
          code: "UNAUTHORIZED",
          error: "holoUserId is required",
        });
      }

      if (!proofs || !Array.isArray(proofs) || proofs.length === 0) {
        return res.status(400).json({ error: "Missing or invalid proofs array" });
      }

      if (!queryResult || typeof queryResult !== "object") {
        return res.status(400).json({ error: "Missing or invalid queryResult" });
      }

      if (!issuanceNullifier) {
        return res.status(400).json({ error: "Missing nullifier (issuance nullifier)" });
      }

      // --- Load + gate the session ---

      let sessionObjectId: ObjectId;
      try {
        sessionObjectId = new ObjectId(sid);
      } catch {
        return res.status(400).json({
          code: "INVALID_SESSION_ID",
          error: "Invalid sid",
        });
      }

      session = await config.ZkPassportSessionModel.findOne({ _id: sessionObjectId }).exec();
      if (!session) {
        return res.status(404).json({
          code: "SESSION_NOT_FOUND",
          error: "Session not found",
        });
      }

      // Bind caller to session owner. Without this, any party who learns a
      // victim's IN_PROGRESS sid could flip it to ISSUED using their own
      // proof — burning the victim's $3 and receiving creds bound to the
      // attacker's own issuanceNullifier.
      if (session.sigDigest !== holoUserId) {
        return res.status(401).json({
          code: "UNAUTHORIZED",
          error: "Session does not belong to this user",
        });
      }

      // Allow both IN_PROGRESS and ISSUED at this point so the 5-day
      // nullifier+uniqueIdentifier recovery branch below can idempotently
      // re-fetch creds. Post-recovery-branch, we re-tighten to IN_PROGRESS
      // only so a different nullifier/passport cannot mint a second
      // credential on an already-issued paid session.
      if (
        session.status !== sessionStatusEnum.IN_PROGRESS &&
        session.status !== sessionStatusEnum.ISSUED
      ) {
        return res.status(400).json({
          code: "SESSION_NOT_ELIGIBLE",
          error: `Session is not eligible for verification (status: ${session.status})`,
        });
      }

      try {
        BigInt(issuanceNullifier);
      } catch {
        return res.status(400).json({
          error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`,
        });
      }

      // --- Rate limiting ---

      const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress) as string;
      const { limitExceeded } = await rateLimitOccurrencesPerSecs(
        `NUM_REQUESTS_BY_IP:zk-passport-verify:${ip}`,
        10,
        60 * 60 * 24, // 1 day
      );
      if (limitExceeded) {
        endpointLogger.warn({ ip }, "Rate limit exceeded");
        return res.status(429).json({
          error: "Too many ZK Passport verification attempts. Please try again tomorrow.",
        });
      }

      // --- Lookup nullifier in NullifierAndCreds (5-day recovery window) ---

      const nullifierAndCreds = await findOneNullifierAndCredsLast5Days(
        config.ZkPassportNullifierAndCredsModel,
        issuanceNullifier,
      );

      // --- Verify ZK Passport proofs server-side ---

      endpointLogger.info("Verifying ZK Passport proofs");

      let verificationResult;
      try {
        verificationResult = await zkPassport.verify({
          proofs,
          queryResult,
        });
      } catch (err) {
        endpointLogger.error(
          { error: makeUnknownErrorLoggable(err) },
          "ZK Passport verification threw an error"
        );
        return res.status(400).json({
          code: classifyZkPassportError(err),
          error: "ZK Passport proof verification failed.",
        });
      }

      if (!verificationResult.verified) {
        endpointLogger.error(
          { queryResultErrors: verificationResult.queryResultErrors },
          "ZK Passport proof verification returned verified=false"
        );
        const code = classifyZkPassportError(verificationResult.queryResultErrors);
        return res.status(400).json({
          code,
          error: "ZK Passport proof verification failed.",
          details: verificationResult.queryResultErrors,
        });
      }

      // --- Extract disclosed fields ---

      const firstName = queryResult.firstname?.disclose?.result;
      const lastName = queryResult.lastname?.disclose?.result;
      const dobRaw = queryResult.birthdate?.disclose?.result;
      const nationality = queryResult.nationality?.disclose?.result
        ?? queryResult.issuing_country?.disclose?.result;

      if (!firstName || !lastName || !dobRaw) {
        endpointLogger.error(
          { firstName: !!firstName, lastName: !!lastName, dob: !!dobRaw },
          "ZK Passport proof does not disclose required fields (firstname, lastname, dateOfBirth)"
        );
        return res.status(400).json({
          error:
            "ZK Passport proof must disclose at least firstname, lastname, and dateOfBirth.",
        });
      }

      const dob = formatDateOfBirth(dobRaw);

      if (!nationality) {
        endpointLogger.warn(
          "ZK Passport proof does not disclose nationality or issuing_country. Using empty country."
        );
      }

      const nationalityStr = nationality ?? "";

      if (nationalityStr && !countryCodeToPrime[nationalityStr as keyof typeof countryCodeToPrime]) {
        endpointLogger.warn(
          { nationality: nationalityStr },
          "ZK Passport nationality not found in countryCodeToPrime"
        );

        return res.status(400).json({
          code: "ZK_PASSPORT_UNSUPPORTED_DOCUMENT",
          error: `Unsupported country (${nationalityStr}) from ZK Passport proof`,
        });
      }

      // --- Sybil resistance: same logic as Onfido/Sumsub ---
      // Store name+DOB hash in UserVerifications.govId.uuidV2 to prevent the
      // same person from verifying via both ZK Passport and regular KYC.

      const uuidV1 = uuidOld(firstName, lastName, dob);
      const uuidV2 = govIdUUID(firstName, lastName, dob);

      // --- Recovery branch: re-issue credentials if same nullifier seen within 5 days ---

      if (nullifierAndCreds?.zkPassportUniqueIdentifier) {
        if (nullifierAndCreds.zkPassportUniqueIdentifier !== verificationResult.uniqueIdentifier) {
          return res.status(400).json({
            error: "The passport used does not match the one from the original issuance.",
          });
        }

        // Recovery: same passport, same nullifier. Re-issue credentials.
        // Extra safety: check 11mo-5day window (same as Onfido/Sumsub recovery).
        if (config.environment === "live") {
          const existingUser = await findOneUserVerification11Months5Days(uuidV1, uuidV2);
          if (existingUser) {
            await saveCollisionMetadata(uuidV1, uuidV2);
            return res.status(400).json({
              error: `User has already registered. User ID: ${existingUser._id}`,
            });
          }
        }

        const creds = extractCreds(firstName, lastName, dob, nationalityStr, "");
        const response = issuev2ZKPassport(config.zkPassportIssuerPrivateKey, issuanceNullifier, creds);
        response.metadata = creds;

        endpointLogger.info(
          { uuidV2, uniqueIdentifier: verificationResult.uniqueIdentifier, sid: session._id },
          "Re-issuing ZK Passport credentials (recovery branch)"
        );

        // Idempotent re-issuance within 5 days. Keep session status ISSUED.
        if (session && session.status !== sessionStatusEnum.ISSUED) {
          session.status = sessionStatusEnum.ISSUED;
          try { await session.save(); } catch { /* non-fatal */ }
        }

        return res.status(200).json(response);
      }

      // --- Normal first-time flow ---

      // No nullifier match means this is a fresh issuance, not a recovery
      // re-fetch. An already-ISSUED session reaching this point would mint
      // a second credential on one paid session — reject.
      if (session.status !== sessionStatusEnum.IN_PROGRESS) {
        return res.status(400).json({
          code: "SESSION_NOT_ELIGIBLE",
          error: `Session is not eligible for fresh issuance (status: ${session.status})`,
        });
      }

      if (config.environment === "live") {
        const existingUser = await findOneUserVerificationLast11Months(uuidV1, uuidV2);
        if (existingUser) {
          await saveCollisionMetadata(uuidV1, uuidV2);
          endpointLogger.error(
            { uuidV2 },
            "User has already registered (cross-provider sybil check)"
          );
          return res.status(400).json({
            error: `User has already registered. User ID: ${existingUser._id}`,
          });
        }
      }

      // Store UUID for sybil resistance
      const dbResponse = await saveUserToDb(uuidV2);
      if (dbResponse.error) return res.status(400).json(dbResponse);

      // --- Extract credentials and issue ---

      const creds = extractCreds(firstName, lastName, dob, nationalityStr, "");

      // Sign with the ZK Passport–specific issuer key (NOT the KYC issuer key)
      const response = issuev2ZKPassport(
        config.zkPassportIssuerPrivateKey,
        issuanceNullifier,
        creds,
      );
      response.metadata = creds;

      // Store nullifier + uniqueIdentifier for 5-day recovery window
      const newNullifierAndCreds = new config.ZkPassportNullifierAndCredsModel({
        issuanceNullifier,
        uuidV2,
        zkPassportUniqueIdentifier: verificationResult.uniqueIdentifier,
      });
      await newNullifierAndCreds.save();

      endpointLogger.info(
        { uuidV2, uniqueIdentifier: verificationResult.uniqueIdentifier, sid: session._id },
        "Issuing ZK Passport credentials"
      );

      // Flip session to ISSUED. This is the one-verify-per-payment gate for
      // future verify-and-issue calls (the 5-day nullifier recovery window
      // allows idempotent re-fetches via the branch above).
      session.status = sessionStatusEnum.ISSUED;
      try { await session.save(); } catch (err) {
        endpointLogger.error(
          { error: makeUnknownErrorLoggable(err), sid: session._id },
          "Failed to flip zkPassport session to ISSUED — creds were issued but session state is stale",
        );
      }

      return res.status(200).json(response);
    } catch (err: any) {
      if (err.status && err.error) {
        return res.status(err.status).json({ error: err.error });
      }

      endpointLogger.error(
        { error: makeUnknownErrorLoggable(err) },
        "Unexpected error in verify-and-issue"
      );

      return res.status(500).json({
        error: "An unexpected error occurred. Please try again later.",
      });
    }
  };
}

export async function verifyAndIssueProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createVerifyAndIssue(config)(req, res);
}

export async function verifyAndIssueSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createVerifyAndIssue(config)(req, res);
}
