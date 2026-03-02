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

type ZkPassportCreds = {
  rawCreds: {
    countryCode: number
  } & any
  derivedCreds: {
    nameDobExpireHash: {
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

export function issuev2ZKPassport(holonymIssuerPrivkey: string, issuanceNullifier: string, creds: ZkPassportCreds) {
  return JSON.parse(
    holonymIssueV2(
      holonymIssuerPrivkey,
      issuanceNullifier,
      creds.rawCreds.countryCode.toString(),
      creds.derivedCreds.nameDobExpireHash.value
    )
  );
}
