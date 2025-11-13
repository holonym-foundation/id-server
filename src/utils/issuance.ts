import { issue as holonymIssueV2 } from "holonym-wasm-issuer-v2";

type Creds = {
  rawCreds: {
    countryCode: number
  } & any
  derivedCreds: {
    nameDobCitySubdivisionZipStreetExpireHash: {
      value: string
    }
  } & any
}

export function issuev2KYC(holonymIssuerPrivkey: string, issuanceNullifier: string, creds: Creds) {
  return JSON.parse(
    holonymIssueV2(
      holonymIssuerPrivkey,
      issuanceNullifier,
      creds.rawCreds.countryCode.toString(),
      creds.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
    )
  );
}