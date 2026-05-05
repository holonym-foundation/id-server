// idOS-side equivalent of services/onfido/credentials/utils.ts:extractCreds.
//
// LOAD-BEARING INVARIANT: for the same logical inputs (firstName, middleName,
// lastName, dateOfBirth, country, address fields) this extractor MUST produce
// the same `nameHash`, `streetHash`, `addressHash`, and
// `nameDobCitySubdivisionZipStreetExpireHash` as the Onfido extractor.
// Downstream ZK circuits assume that invariant — see the parity test in
// utils.test.ts and the source of truth at
// id-server/src/services/onfido/credentials/utils.ts:291.
//
// The shape of the decrypted idOS credential is the
// `VerifiableCredential<VerifiableCredentialSubject>` JSON published by
// @idos-network/credentials/types. `getCredentialSharedContentDecrypted`
// returns the decrypted JSON content as a string, which the caller parses
// before handing the parsed object here.

import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { poseidon } from "circomlibjs-old";

import { getDateAsInt } from "../../../utils/utils.js";
import { countryCodeToPrime } from "../../../utils/constants.js";

/**
 * Subset of @idos-network/credentials/types `VerifiableCredentialSubject`
 * we read from. Only fields we map are listed; idOS may attach others which
 * we deliberately ignore.
 */
export interface IdosCredentialSubject {
  firstName?: string;
  middleName?: string;
  familyName?: string; // Onfido equivalent: last_name
  /** ISO date string (YYYY-MM-DD or full ISO 8601). */
  dateOfBirth?: string;
  /** ISO 3166-1 alpha-2 country code of the verified document. */
  idDocumentCountry?: string;
  /** Optional fallback when idDocumentCountry is missing. */
  nationality?: string;
  /** Optional ID document expiry; not consumed in the v1 hash composition. */
  idDocumentDateOfExpiry?: string;
  // Address fields are flattened on the serialized VC (see
  // @idos-network/credentials/types index.d.mts).
  residentialAddressStreet?: string;
  residentialAddressHouseNumber?: string;
  residentialAddressAdditionalAddressInfo?: string;
  residentialAddressRegion?: string;
  residentialAddressCity?: string;
  residentialAddressPostalCode?: string;
  residentialAddressCountry?: string;
}

export interface IdosVerifiableCredential {
  credentialSubject: IdosCredentialSubject;
  /** Approval / completion timestamp (ISO 8601). */
  approvedAt?: string;
  /** Falls back to `approvedAt` when missing. */
  issuanceDate?: string;
}

/** Convert "2026-04-30T00:00:00.000Z" or "2026-04-30" to "2026-04-30". */
function isoDateOnly(d: string | undefined): string {
  if (!d) return "";
  const ix = d.indexOf("T");
  return ix === -1 ? d : d.slice(0, ix);
}

function bufOrEmpty(s: string): Buffer {
  return s ? Buffer.from(s) : Buffer.alloc(1);
}

function parseStreetUnit(unit: string | undefined): number {
  if (!unit) return 0;
  if (unit.includes("apt ")) {
    const n = Number(unit.replace("apt ", ""));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(unit);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map a decrypted idOS verifiable credential into the `{ rawCreds,
 * derivedCreds, fieldsInLeaf }` shape the Holonym KYC pipeline (issuev2KYC,
 * downstream circuits) consumes — byte-compatible with Onfido's extractCreds
 * for equivalent inputs.
 */
export function extractCreds(vc: IdosVerifiableCredential) {
  const subject: IdosCredentialSubject = vc?.credentialSubject ?? {};

  // Country: prefer the issuing-document country (matches Onfido's
  // `issuing_country`), fall back to the holder's nationality. Empty country
  // produces countryCode === undefined which would propagate; we coerce to 0
  // to match Onfido's behavior of returning `countryCodeToPrime[undefined]`
  // (which is also undefined and treated as 0 downstream by toString()).
  const countryRaw =
    (subject.idDocumentCountry || subject.nationality || "").toUpperCase();
  const countryCode =
    countryCodeToPrime[countryRaw as keyof typeof countryCodeToPrime];

  const birthdate = isoDateOnly(subject.dateOfBirth);
  const birthdateNum = birthdate ? getDateAsInt(birthdate) : 0;

  const firstNameStr = subject.firstName ?? "";
  const firstNameBuffer = bufOrEmpty(firstNameStr);
  const middleNameStr = subject.middleName ?? "";
  const middleNameBuffer = bufOrEmpty(middleNameStr);
  // idOS uses `familyName`; map to Onfido's `last_name`.
  const lastNameStr = subject.familyName ?? "";
  const lastNameBuffer = bufOrEmpty(lastNameStr);

  const nameArgs = [firstNameBuffer, middleNameBuffer, lastNameBuffer].map(
    (x) => ethers.BigNumber.from(x).toString()
  );
  const nameHash = ethers.BigNumber.from(poseidon(nameArgs)).toString();

  const cityStr = subject.residentialAddressCity ?? "";
  const cityBuffer = bufOrEmpty(cityStr);
  const subdivisionStr = subject.residentialAddressRegion ?? "";
  const subdivisionBuffer = bufOrEmpty(subdivisionStr);
  const streetNumber = Number(subject.residentialAddressHouseNumber ?? 0) || 0;
  const streetNameStr = subject.residentialAddressStreet ?? "";
  const streetNameBuffer = bufOrEmpty(streetNameStr);
  const streetUnit = parseStreetUnit(
    subject.residentialAddressAdditionalAddressInfo
  );

  const addrArgs = [streetNumber, streetNameBuffer, streetUnit].map((x) =>
    ethers.BigNumber.from(x).toString()
  );
  const streetHash = ethers.BigNumber.from(poseidon(addrArgs)).toString();

  const zipCode = Number(subject.residentialAddressPostalCode ?? 0) || 0;
  const addressArgs = [cityBuffer, subdivisionBuffer, zipCode, streetHash].map(
    (x) => ethers.BigNumber.from(x)
  );
  const addressHash = ethers.BigNumber.from(poseidon(addressArgs)).toString();

  // Onfido currently zeros out expirationDate (see comment at
  // services/onfido/credentials/utils.ts:346). Mirror exactly so the
  // composite hash stays byte-compatible. If expiry is ever included, both
  // extractors must change in lockstep.
  const expireDateSr = "";
  const expireDateNum = expireDateSr ? getDateAsInt(expireDateSr) : 0;

  const nameDobAddrExpireArgs = [
    nameHash,
    birthdateNum,
    addressHash,
    expireDateNum,
  ].map((x) => ethers.BigNumber.from(x).toString());
  const nameDobAddrExpire = ethers.BigNumber.from(
    poseidon(nameDobAddrExpireArgs)
  ).toString();

  const completedAt = isoDateOnly(vc.approvedAt ?? vc.issuanceDate);

  return {
    rawCreds: {
      countryCode: countryCode ?? 0,
      firstName: firstNameStr,
      middleName: middleNameStr,
      lastName: lastNameStr,
      city: cityStr,
      subdivision: subdivisionStr,
      zipCode: subject.residentialAddressPostalCode ?? 0,
      streetNumber: streetNumber,
      streetName: streetNameStr,
      streetUnit: streetUnit,
      completedAt,
      birthdate,
      expirationDate: expireDateSr,
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
