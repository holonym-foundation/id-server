import { issue as holonymIssueV2 } from "holonym-wasm-issuer-v2";

/**
 * @typedef {Object} Creds
 * @property {Object} rawCreds
 * @property {string | number} rawCreds.countryCode
 * @property {Object} derivedCreds
 * @property {Object} derivedCreds.nameDobCitySubdivisionZipStreetExpireHash
 * @property {string} derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
 */

/**
 * @param {string} issuanceNullifier 
 * @param {Creds} creds
 */
export function issuev2KYC(issuanceNullifier, creds) {
  return JSON.parse(
    holonymIssueV2(
      process.env.HOLONYM_ISSUER_PRIVKEY,
      issuanceNullifier,
      creds.rawCreds.countryCode.toString(),
      creds.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
    )
  );
}