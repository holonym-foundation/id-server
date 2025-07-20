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

// 18/07/2025: Truncate, character by character in utf8 compatible way
function truncateToBytes(str, maxBytes) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  if (typeof maxBytes !== 'number' || maxBytes < 0) return '';
  if (maxBytes === 0) return '';
  
  const buffer = Buffer.from(str, 'utf8');
  if (buffer.length <= maxBytes) return str;
  
  let result = '';
  let currentBytes = 0;
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const charBytes = Buffer.from(char, 'utf8').length;
    
    if (currentBytes + charBytes <= maxBytes) {
      result += char;
      currentBytes += charBytes;
    } else {
      break;
    }
  }
  
  return result;
}