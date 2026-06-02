import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { poseidon } from "circomlibjs-old";
import { HydratedDocument } from "mongoose";
import {
  UserVerifications,
  VerificationCollisionMetadata,
} from "../../../init.js";
import {
  getDateAsInt,
  sha256,
  govIdUUID,
  dateElevenMonthsFromNow,
} from "../../../utils/utils.js";
import { pinoOptions, logger } from "../../../utils/logger.js";
import { countryCodeToPrime } from "../../../utils/constants.js";
import { ISession, ISandboxSession } from "../../../types.js";

const endpointLogger = logger.child({
  msgPrefix: "[GET /idenfy/credentials] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "idenfy",
    feature: "holonym",
    subFeature: "gov-id",
  },
});

/**
 * iDenfy /api/v2/data response shape (subset we consume).
 *
 * NOTE: We don't have a real captured response from a sandbox run. The fields
 * below are based on iDenfy's documentation
 * (https://documentation.idenfy.com/api/get-verification-data).
 * Inline TODOs flag fields whose exact key name should be confirmed against
 * a real sandbox response during U11.
 */
export type IdenfyVerificationData = {
  scanRef: string;
  // status block — mirrors the webhook payload's verificationStatus structure.
  // TODO(U11): confirm exact field name; iDenfy docs use both `status` and
  // `verificationStatus` in different places.
  status?: { overall?: string; [key: string]: unknown };
  verificationStatus?: string;
  // Document/personal data extraction. iDenfy returns these under top-level
  // `data` per the sandbox response schema in
  // https://help.idenfy.com/space/DA/1302331393/Data+overview.
  data?: {
    selectedCountry?: string;          // ISO alpha-2 e.g. "US"
    docFirstName?: string;
    docLastName?: string;
    // TODO(U11): iDenfy may use `docMiddleName`, `docMiddleNames`, or none —
    // confirm against a real sandbox response. We try docMiddleName first.
    docMiddleName?: string;
    docDob?: string;                   // YYYY-MM-DD
    docExpiry?: string;                // YYYY-MM-DD
    docNationality?: string;           // ISO alpha-2 or alpha-3
    docIssuingCountry?: string;        // ISO alpha-2 or alpha-3
    docNumber?: string;
    docType?: string;                  // 'PASSPORT' | 'ID_CARD' | 'DRIVER_LICENSE' | ...
    // Address block — only populated for documents that contain address info
    // (e.g. ID cards). Field names are best-effort; passport flows may omit.
    address?: string;                  // free-form (may need parsing)
    addressManual?: string;
    docAddress?: string;
    // TODO(U11): iDenfy's structured address may also be under `parsedAddress`
    // or split across multiple fields. Map all cases when we see one.
    [key: string]: unknown;
  };
  fileUrls?: Record<string, string>;
  // Top-level timing fields per iDenfy's webhook + data API. Either may be
  // populated; we prefer finishTime (verification completion).
  finishTime?: string;
  creationTime?: string;
  [key: string]: unknown;
};

/**
 * iDenfy's /api/v2/data has been observed in documentation to present document
 * fields either flat at the top level (docFirstName, docDob, …) OR nested under
 * a `data` object, depending on account/endpoint. Until a real sandbox response
 * is captured (U11), read defensively: prefer the nested `data` object when it
 * is present and object-shaped, otherwise treat the payload itself as the field
 * bag. This prevents silently issuing empty-PII credentials if the real shape
 * turns out to be nested — which the falsy-country guard below would NOT catch.
 */
function idenfyDocFields(
  idenfyData: IdenfyVerificationData
): Record<string, unknown> {
  const root = idenfyData as Record<string, unknown>;
  if (root.data && typeof root.data === "object") {
    return root.data as Record<string, unknown>;
  }
  return root;
}

/**
 * Extract credentials from an iDenfy verification payload, normalized to the
 * shape produced by Onfido's extractCreds (see services/onfido/credentials/utils.ts:291).
 *
 * The hash composition order in `derivedCreds` MUST match Onfido's exactly —
 * ZK circuits depend on it byte-for-byte.
 */
export function extractCreds(idenfyData: IdenfyVerificationData) {
  // Document fields may be flat or nested under `data` (see idenfyDocFields).
  const data = idenfyDocFields(idenfyData);

  // Country code parity with Onfido (services/onfido/credentials/utils.ts:292):
  // Onfido reads `issuing_country` from the document report, so iDenfy must
  // use the same logical value — issuing country, not nationality. Both
  // Onfido and `countryCodeToPrime` are keyed by ISO 3166-1 alpha-2 (despite
  // some Onfido docs implying alpha-3), so passing iDenfy's alpha-2 code
  // through directly preserves byte-parity for ZK circuit inputs.
  // TODO(U11): confirm exact iDenfy field name on a real /api/v2/data
  // response — `docIssuingCountry` is the documented primary; fall back to
  // `selectedCountry`.
  const country =
    (data.docIssuingCountry as string) ||
    (data.selectedCountry as string) ||
    "";
  const countryCode =
    countryCodeToPrime[country as keyof typeof countryCodeToPrime];

  // Fail loud if iDenfy returns a code that isn't in our lookup table —
  // silently issuing creds with countryCode=undefined would diverge from
  // Onfido's behavior (it short-circuits with an error, see Onfido utils:136)
  // and break ZK circuit inputs downstream.
  if (country && !countryCode) {
    throw new Error(
      `iDenfy: unknown country code "${country}" — not present in countryCodeToPrime`
    );
  }

  const firstNameStr = (data.docFirstName as string) ?? "";
  const middleNameStr = (data.docMiddleName as string) ?? "";
  const lastNameStr = (data.docLastName as string) ?? "";

  const birthdate = (data.docDob as string) ?? "";
  const birthdateNum = birthdate ? getDateAsInt(birthdate) : 0;

  // Address fields. iDenfy doesn't ship a structured address consistently
  // (depends on document type). We set empty defaults — same convention as
  // Onfido for non-address-supporting documents.
  // TODO(U11): if iDenfy provides parsed structured address (city/state/zip)
  // for ID cards, populate these from the right keys.
  const cityStr = "";
  const subdivisionStr = "";
  const zipCode = 0;
  const streetNumber = 0;
  const streetNameStr = "";
  const streetUnit = 0;

  // Completed at: prefer iDenfy's documented `creationTime` / `finishTime`
  // (per webhook payload). Top-level fields on the data response sometimes
  // include `finishTime` (ISO). Fall back to "" matching Onfido's pattern.
  // TODO(U11): pick the right field.
  const finishTime = idenfyData?.finishTime;
  const creationTime = idenfyData?.creationTime;
  const completedAtRaw = finishTime || creationTime || "";
  const completedAtStr = completedAtRaw ? completedAtRaw.split("T")[0] : "";

  // Expiration date: not currently included in issued credentials (see Onfido
  // utils.ts:347). Match that behavior for parity.
  const expireDateStr = "";
  const expireDateNum = expireDateStr ? getDateAsInt(expireDateStr) : 0;

  // Compute derived credential hashes (must match Onfido's exactly).
  const firstNameBuffer = firstNameStr ? Buffer.from(firstNameStr) : Buffer.alloc(1);
  const middleNameBuffer = middleNameStr ? Buffer.from(middleNameStr) : Buffer.alloc(1);
  const lastNameBuffer = lastNameStr ? Buffer.from(lastNameStr) : Buffer.alloc(1);
  const nameArgs = [firstNameBuffer, middleNameBuffer, lastNameBuffer].map(
    (x) => ethers.BigNumber.from(x).toString()
  );
  const nameHash = ethers.BigNumber.from(poseidon(nameArgs)).toString();

  const cityBuffer = cityStr ? Buffer.from(cityStr) : Buffer.alloc(1);
  const subdivisionBuffer = subdivisionStr
    ? Buffer.from(subdivisionStr)
    : Buffer.alloc(1);
  const streetNameBuffer = streetNameStr
    ? Buffer.from(streetNameStr)
    : Buffer.alloc(1);
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
      zipCode: zipCode,
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
 * Generate the legacy ("old") UUID from iDenfy verification data.
 * Matches Onfido/Sumsub: sha256(firstName + lastName + dob).
 */
export function uuidOldFromIdenfyData(idenfyData: IdenfyVerificationData) {
  const data = idenfyDocFields(idenfyData);
  const firstName = (data.docFirstName as string) || "";
  const lastName = (data.docLastName as string) || "";
  const dob = (data.docDob as string) || "";
  const uuidConstituents = firstName + lastName + dob;
  return sha256(Buffer.from(uuidConstituents)).toString("hex");
}

/**
 * Generate the current ("new") UUID from iDenfy verification data using the
 * shared govIdUUID function (cross-provider Sybil resistance).
 */
export function uuidNewFromIdenfyData(idenfyData: IdenfyVerificationData) {
  const data = idenfyDocFields(idenfyData);
  const firstName = (data.docFirstName as string) || "";
  const lastName = (data.docLastName as string) || "";
  const dob = (data.docDob as string) || "";
  return govIdUUID(firstName, lastName, dob);
}

export async function saveCollisionMetadata(
  uuid: string,
  uuidV2: string,
  scanRef: string
) {
  try {
    const collisionMetadataDoc = new VerificationCollisionMetadata({
      uuid,
      uuidV2,
      timestamp: new Date(),
      scanRef,
    });
    await collisionMetadataDoc.save();
  } catch (err) {
    endpointLogger.error({ error: err, scanRef }, "Error recording collision metadata");
  }
}

export async function saveUserToDb(uuidV2: string, scanRef: string) {
  const userVerificationsDoc = new UserVerifications({
    govId: {
      uuidV2,
      sessionId: scanRef,
      issuedAt: new Date(),
      expiresAt: dateElevenMonthsFromNow(),
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
 * Update the parent Session row's status (e.g. -> ISSUED).
 *
 * Takes the live session document directly rather than looking it up. The
 * Session schema has no scanRef field of its own — scanRef lives on the
 * standalone IdenfySession collection (see ee3e0aa) — so a `findOne({
 * idenfyScanRef })` on SessionModel would silently return null. Callers
 * already hold the session document, so pass it in.
 */
export async function updateSessionStatus(
  session: HydratedDocument<ISession | ISandboxSession>,
  status: string,
  failureReason?: string
) {
  try {
    session.status = status;
    if (failureReason) session.verificationFailureReason = failureReason;
    await session.save();
  } catch (err) {
    endpointLogger.error(
      { error: err, sessionId: session._id?.toString(), status },
      "Error updating session status"
    );
  }
}
