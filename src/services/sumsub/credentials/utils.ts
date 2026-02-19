import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { poseidon } from "circomlibjs-old";
import { Model } from "mongoose";
import {
  Session,
  UserVerifications,
  VerificationCollisionMetadata,
} from "../../../init.js";
import {
  getDateAsInt,
  sha256,
  govIdUUID,
} from "../../../utils/utils.js";
import { pinoOptions, logger } from "../../../utils/logger.js";
import {
  countryCodeToPrime,
} from "../../../utils/constants.js";
import { ISession, ISandboxSession } from "../../../types.js";

const endpointLogger = logger.child({
  msgPrefix: "[GET /sumsub/credentials] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "sumsub",
    feature: "holonym",
    subFeature: "gov-id",
  },
});

/**
 * Validate that the Sumsub review is complete and approved.
 * See: https://docs.sumsub.com/reference/get-applicant-data (review object)
 */
export function validateSumsubReview(applicantData: any) {
  const reviewAnswer = applicantData?.review?.reviewResult?.reviewAnswer;

  if (!reviewAnswer) {
    return {
      error: "Sumsub review has not been completed yet.",
      log: {
        msg: "Review not completed",
        data: {
          applicantId: applicantData?.id,
          reviewStatus: applicantData?.review?.reviewStatus,
        },
      },
    };
  }

  if (reviewAnswer !== "GREEN") {
    const rejectLabels = applicantData?.review?.reviewResult?.rejectLabels || [];
    const moderationComment = applicantData?.review?.reviewResult?.moderationComment || "";
    return {
      error: `Verification failed. Review answer: ${reviewAnswer}. ${moderationComment || rejectLabels.join(", ") || ""}`.trim(),
      log: {
        msg: "Review not approved",
        data: {
          applicantId: applicantData?.id,
          reviewAnswer,
          rejectLabels,
          moderationComment,
        },
      },
    };
  }

  return { success: true };
}

/**
 * Extract credentials from Sumsub applicant data.
 *
 * CRITICAL: The output structure MUST match Onfido's extractCreds exactly.
 * The rawCreds, derivedCreds, and fieldsInLeaf must be identical in shape
 * and field order, or ZKP circuits will break.
 *
 * Sumsub field mapping (see https://docs.sumsub.com/reference/get-applicant-data):
 * - Names: info.firstNameEn || info.firstName (prefer English transliteration)
 * - DOB: info.dob (YYYY-MM-DD)
 * - Country: info.country (alpha-3, already in countryCodeToPrime)
 * - Address: info.addresses[0] — town, state, postCode, street, buildingNumber, flatNumber
 * - Review date: review.reviewDate (YYYY-MM-DD HH:MI:SS)
 * - Expiration: info.idDocs[0].validUntil (YYYY-MM-DD)
 *
 * fixedInfo contains applicant-submitted data (same schema as info but lacks idDocs).
 * info contains OCR-extracted data. We prefer info (document-extracted) with fixedInfo fallback.
 */
export function extractCreds(applicantData: any) {
  const info = applicantData?.info || {};
  const fixedInfo = applicantData?.fixedInfo || {};

  // Names — prefer English transliteration (*En fields), fall back to base fields
  const firstNameStr = info.firstNameEn || info.firstName || fixedInfo.firstNameEn || fixedInfo.firstName || "";
  const middleNameStr = info.middleNameEn || info.middleName || fixedInfo.middleNameEn || fixedInfo.middleName || "";
  const lastNameStr = info.lastNameEn || info.lastName || fixedInfo.lastNameEn || fixedInfo.lastName || "";

  // Country code (alpha-3 from Sumsub, e.g. "USA", "DEU")
  const country = info.country || fixedInfo.country || "";
  const countryCode = countryCodeToPrime[country as keyof typeof countryCodeToPrime];

  // Date of birth (YYYY-MM-DD)
  const birthdate = info.dob || fixedInfo.dob || "";
  const birthdateNum = birthdate ? getDateAsInt(birthdate) : 0;

  // Address — from info.addresses[0] or fixedInfo.addresses[0]
  const address = info.addresses?.[0] || fixedInfo.addresses?.[0] || {};
  const cityStr = address.town || address.townEn || "";
  const subdivisionStr = address.state || "";
  const zipCode = Number(address.postCode ?? 0);
  const streetNumber = Number(address.buildingNumber ?? 0);
  const streetNameStr = address.streetEn || address.street || "";
  const streetUnit = address.flatNumber != null && !isNaN(Number(address.flatNumber))
    ? Number(address.flatNumber)
    : 0;

  // Completed at — review date (YYYY-MM-DD HH:MI:SS → take date part)
  const reviewDate = applicantData?.review?.reviewDate || "";
  const completedAtStr = reviewDate ? reviewDate.split(" ")[0] : "";

  // Expiration date — from idDocs[0].validUntil
  // Note: Onfido currently sets expirationDate to "" (not included in creds).
  // We match that behavior for parity.
  const expireDateStr = "";
  const expireDateNum = expireDateStr ? getDateAsInt(expireDateStr) : 0;

  // Compute derived credential hashes (must match Onfido's exactly)
  const firstNameBuffer = firstNameStr ? Buffer.from(firstNameStr) : Buffer.alloc(1);
  const middleNameBuffer = middleNameStr ? Buffer.from(middleNameStr) : Buffer.alloc(1);
  const lastNameBuffer = lastNameStr ? Buffer.from(lastNameStr) : Buffer.alloc(1);
  const nameArgs = [firstNameBuffer, middleNameBuffer, lastNameBuffer].map(
    (x) => ethers.BigNumber.from(x).toString()
  );
  const nameHash = ethers.BigNumber.from(poseidon(nameArgs)).toString();

  const cityBuffer = cityStr ? Buffer.from(cityStr) : Buffer.alloc(1);
  const subdivisionBuffer = subdivisionStr ? Buffer.from(subdivisionStr) : Buffer.alloc(1);
  const streetNameBuffer = streetNameStr ? Buffer.from(streetNameStr) : Buffer.alloc(1);
  const addrArgs = [streetNumber, streetNameBuffer, streetUnit].map((x) =>
    ethers.BigNumber.from(x).toString()
  );
  const streetHash = ethers.BigNumber.from(poseidon(addrArgs)).toString();
  const addressArgs = [cityBuffer, subdivisionBuffer, zipCode, streetHash].map(
    (x) => ethers.BigNumber.from(x)
  );
  const addressHash = ethers.BigNumber.from(poseidon(addressArgs)).toString();
  const nameDobAddrExpireArgs = [
    nameHash,
    birthdateNum,
    addressHash,
    expireDateNum,
  ].map((x) => ethers.BigNumber.from(x).toString());
  const nameDobAddrExpire = ethers.BigNumber.from(
    poseidon(nameDobAddrExpireArgs)
  ).toString();

  return {
    rawCreds: {
      countryCode: countryCode,
      firstName: firstNameStr,
      middleName: middleNameStr,
      lastName: lastNameStr,
      city: cityStr,
      subdivision: subdivisionStr,
      zipCode: address.postCode ?? 0,
      streetNumber: streetNumber,
      streetName: streetNameStr,
      streetUnit: streetUnit,
      completedAt: completedAtStr,
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
 * Generate the legacy ("old") UUID from Sumsub applicant data.
 * Matches the pattern of uuidOldFromOnfidoReport: sha256(firstName + lastName + dob).
 * Used to catch Sybil attempts from users who originally verified via Onfido
 * and have their UUID stored in govId.uuid (the old schema).
 */
export function uuidOldFromSumsubApplicant(applicantData: any) {
  const info = applicantData?.info || {};
  const fixedInfo = applicantData?.fixedInfo || {};
  const firstName = info.firstNameEn || info.firstName || fixedInfo.firstNameEn || fixedInfo.firstName || "";
  const lastName = info.lastNameEn || info.lastName || fixedInfo.lastNameEn || fixedInfo.lastName || "";
  const dob = info.dob || fixedInfo.dob || "";
  const uuidConstituents = (firstName || "") + (lastName || "") + (dob || "");
  return sha256(Buffer.from(uuidConstituents)).toString("hex");
}

/**
 * Generate the current ("new") UUID from Sumsub applicant data using the same
 * govIdUUID function as Onfido, ensuring cross-provider Sybil resistance.
 */
export function uuidNewFromSumsubApplicant(applicantData: any) {
  const info = applicantData?.info || {};
  const fixedInfo = applicantData?.fixedInfo || {};
  const firstName = info.firstNameEn || info.firstName || fixedInfo.firstNameEn || fixedInfo.firstName || "";
  const lastName = info.lastNameEn || info.lastName || fixedInfo.lastNameEn || fixedInfo.lastName || "";
  const dob = info.dob || fixedInfo.dob || "";
  return govIdUUID(firstName, lastName, dob);
}

export async function saveCollisionMetadata(
  uuid: string,
  uuidV2: string,
  applicantId: string,
) {
  try {
    const collisionMetadataDoc = new VerificationCollisionMetadata({
      uuid: uuid,
      uuidV2: uuidV2,
      timestamp: new Date(),
      sumsub_applicant_id: applicantId,
    });

    await collisionMetadataDoc.save();
  } catch (err) {
    console.log("Error recording collision metadata", err);
  }
}

export async function saveUserToDb(uuidV2: string, applicantId: string) {
  const userVerificationsDoc = new UserVerifications({
    govId: {
      uuidV2: uuidV2,
      sessionId: applicantId,
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

export async function updateSessionStatus(
  SessionModel: Model<ISession | ISandboxSession>,
  applicantId: string,
  status: string,
  failureReason?: string
) {
  try {
    const metaSession = await SessionModel.findOne({ sumsub_applicant_id: applicantId }).exec();
    if (!metaSession) throw new Error("Session not found");
    metaSession.status = status;
    if (failureReason) metaSession.verificationFailureReason = failureReason;
    await metaSession.save();
  } catch (err) {
    console.log("sumsub/credentials: Error updating session status", err);
  }
}
