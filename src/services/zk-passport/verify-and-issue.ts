import { Request, Response } from "express";
import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { poseidon } from "circomlibjs-old";
import { ZKPassport } from "@zkpassport/sdk";
import {
  UserVerifications,
  VerificationCollisionMetadata,
} from "../../init.js";
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
} from "../../utils/user-verifications.js";
import { issuev2KYC } from "../../utils/issuance.js";
import { makeUnknownErrorLoggable } from "../../utils/errors.js";
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
const zkPassportDomain = process.env.ZK_PASSPORT_DOMAIN || "id.human.tech";
const zkPassport = new ZKPassport(zkPassportDomain);

/**
 * Extract credentials from ZK Passport disclosed fields.
 *
 * CRITICAL: The output structure MUST match Onfido's/Sumsub's extractCreds exactly.
 * The rawCreds, derivedCreds, and fieldsInLeaf must be identical in shape
 * and field order, or ZKP circuits will break.
 *
 * ZK Passport discloses: firstname, lastname, dateOfBirth, nationality (alpha-3).
 * Address fields and middle name are not available from ZK Passport, so they default
 * to empty/zero (same behavior as Onfido/Sumsub when fields are missing).
 */
function extractCreds(
  firstName: string,
  lastName: string,
  birthdate: string,
  nationality: string,
) {
  const countryCode =
    countryCodeToPrime[nationality as keyof typeof countryCodeToPrime];
  const birthdateNum = birthdate ? getDateAsInt(birthdate) : 0;

  const firstNameBuffer = firstName
    ? Buffer.from(firstName)
    : Buffer.alloc(1);
  // ZK Passport doesn't disclose middle names
  const middleNameStr = "";
  const middleNameBuffer = Buffer.alloc(1);
  const lastNameBuffer = lastName
    ? Buffer.from(lastName)
    : Buffer.alloc(1);
  const nameArgs = [firstNameBuffer, middleNameBuffer, lastNameBuffer].map(
    (x) => ethers.BigNumber.from(x).toString()
  );
  const nameHash = ethers.BigNumber.from(poseidon(nameArgs)).toString();

  // ZK Passport doesn't disclose address fields
  const cityStr = "";
  const subdivisionStr = "";
  const cityBuffer = Buffer.alloc(1);
  const subdivisionBuffer = Buffer.alloc(1);
  const streetNumber = 0;
  const streetNameStr = "";
  const streetNameBuffer = Buffer.alloc(1);
  const streetUnit = 0;
  const addrArgs = [streetNumber, streetNameBuffer, streetUnit].map((x) =>
    ethers.BigNumber.from(x).toString()
  );
  const streetHash = ethers.BigNumber.from(poseidon(addrArgs)).toString();
  const zipCode = 0;
  const addressArgs = [cityBuffer, subdivisionBuffer, zipCode, streetHash].map(
    (x) => ethers.BigNumber.from(x)
  );
  const addressHash = ethers.BigNumber.from(poseidon(addressArgs)).toString();

  // Not including expiration date (matching Onfido/Sumsub behavior)
  const expireDateStr = "";
  const expireDateNum = 0;
  const nameDobAddrExpireArgs = [
    nameHash,
    birthdateNum,
    addressHash,
    expireDateNum,
  ].map((x) => ethers.BigNumber.from(x).toString());
  const nameDobAddrExpire = ethers.BigNumber.from(
    poseidon(nameDobAddrExpireArgs)
  ).toString();

  // completedAt is today's date (verification just happened)
  const completedAt = new Date().toISOString().split("T")[0];

  return {
    rawCreds: {
      countryCode: countryCode,
      firstName: firstName,
      middleName: middleNameStr,
      lastName: lastName,
      city: cityStr,
      subdivision: subdivisionStr,
      zipCode: 0,
      streetNumber: streetNumber,
      streetName: streetNameStr,
      streetUnit: streetUnit,
      completedAt: completedAt,
      birthdate: birthdate,
      expirationDate: expireDateStr,
    },
    derivedCreds: {
      nameDobCitySubdivisionZipStreetExpireHash: {
        value: nameDobAddrExpire,
        derivationFunction: "poseidon",
        inputFields: [
          "derivedCreds.nameHash.value",
          "rawCreds.birthdate",
          "derivedCreds.addressHash.value",
          "rawCreds.expirationDate",
        ],
      },
      streetHash: {
        value: streetHash,
        derivationFunction: "poseidon",
        inputFields: [
          "rawCreds.streetNumber",
          "rawCreds.streetName",
          "rawCreds.streetUnit",
        ],
      },
      addressHash: {
        value: addressHash,
        derivationFunction: "poseidon",
        inputFields: [
          "rawCreds.city",
          "rawCreds.subdivision",
          "rawCreds.zipCode",
          "derivedCreds.streetHash.value",
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
      "derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value",
      "rawCreds.completedAt",
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
 * POST /zk-passport/verify-and-issue
 *
 * Single request/response endpoint for ZK Passport verification and credential issuance.
 * No sessions — a valid ZK Passport proof is sufficient for authentication.
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
    try {
      const { proofs, queryResult, nullifier: issuanceNullifier } = req.body;

      // --- Validate request body ---

      if (!proofs || !Array.isArray(proofs) || proofs.length === 0) {
        return res.status(400).json({ error: "Missing or invalid proofs array" });
      }

      if (!queryResult || typeof queryResult !== "object") {
        return res.status(400).json({ error: "Missing or invalid queryResult" });
      }

      if (!issuanceNullifier) {
        return res.status(400).json({ error: "Missing nullifier (issuance nullifier)" });
      }

      try {
        BigInt(issuanceNullifier);
      } catch {
        return res.status(400).json({
          error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`,
        });
      }

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
          error: "ZK Passport proof verification failed.",
        });
      }

      if (!verificationResult.verified) {
        endpointLogger.error(
          { queryResultErrors: verificationResult.queryResultErrors },
          "ZK Passport proof verification returned verified=false"
        );
        return res.status(400).json({
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

      const nationalityStr = nationality || "";

      if (nationalityStr && !countryCodeToPrime[nationalityStr as keyof typeof countryCodeToPrime]) {
        endpointLogger.warn(
          { nationality: nationalityStr },
          "ZK Passport nationality not found in countryCodeToPrime"
        );
      }

      // --- Sybil resistance: same logic as Onfido/Sumsub ---
      // Store name+DOB hash in UserVerifications.govId.uuidV2 to prevent the
      // same person from verifying via both ZK Passport and KYC.

      const uuidV1 = uuidOld(firstName, lastName, dob);
      const uuidV2 = govIdUUID(firstName, lastName, dob);

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

      const creds = extractCreds(firstName, lastName, dob, nationalityStr);

      // Sign with the ZK Passport–specific issuer key (NOT the KYC issuer key)
      const response = issuev2KYC(
        config.zkPassportIssuerPrivateKey,
        issuanceNullifier,
        creds,
      );
      response.metadata = creds;

      endpointLogger.info(
        { uuidV2, uniqueIdentifier: verificationResult.uniqueIdentifier },
        "Issuing ZK Passport credentials"
      );

      return res.status(200).json(response);
    } catch (err: any) {
      if (err.status && err.error) {
        return res.status(err.status).json(err);
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
