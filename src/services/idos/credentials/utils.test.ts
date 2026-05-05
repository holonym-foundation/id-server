import { describe, expect, it } from "bun:test";

import { extractCreds as extractCredsIdos } from "./utils.js";
import { extractCreds as extractCredsOnfido } from "../../onfido/credentials/utils.js";

// Build a minimal OnfidoDocumentReport-shaped fixture from logical inputs so
// both extractors get the SAME logical values via their respective input
// schemas. The point of these tests is to prove byte-for-byte parity on the
// fields the issuance circuits consume:
//   derivedCreds.nameHash.value
//   derivedCreds.streetHash.value
//   derivedCreds.addressHash.value
//   derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
//   rawCreds.countryCode
function buildOnfidoReport(input: {
  firstName: string;
  middleName?: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD
  issuingCountry: string;
  city?: string;
  state?: string;
  postcode?: string;
  street?: string;
  houseNumber?: string;
  unit?: string;
  createdAt?: string; // ISO timestamp
}) {
  return {
    properties: {
      first_name: input.firstName,
      middle_name: input.middleName,
      last_name: input.lastName,
      date_of_birth: input.dateOfBirth,
      issuing_country: input.issuingCountry,
      city: input.city,
      state: input.state,
      postcode: input.postcode,
      street: input.street,
      houseNumber: input.houseNumber,
      unit: input.unit,
      created_at: input.createdAt,
    },
  } as never;
}

function buildIdosVc(input: {
  firstName: string;
  middleName?: string;
  lastName: string;
  dateOfBirth: string;
  issuingCountry: string;
  city?: string;
  state?: string;
  postcode?: string;
  street?: string;
  houseNumber?: string;
  unit?: string;
  approvedAt?: string;
}) {
  return {
    credentialSubject: {
      firstName: input.firstName,
      middleName: input.middleName,
      familyName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      idDocumentCountry: input.issuingCountry,
      residentialAddressCity: input.city,
      residentialAddressRegion: input.state,
      residentialAddressPostalCode: input.postcode,
      residentialAddressStreet: input.street,
      residentialAddressHouseNumber: input.houseNumber,
      residentialAddressAdditionalAddressInfo: input.unit,
    },
    approvedAt: input.approvedAt,
  };
}

describe("idOS extractCreds parity with Onfido", () => {
  it("produces identical derivedCreds + countryCode for empty-address inputs (the current Onfido production path)", () => {
    const logical = {
      firstName: "Alice",
      lastName: "Smith",
      dateOfBirth: "1990-04-15",
      issuingCountry: "US",
      createdAt: "2026-04-30T12:00:00Z",
      approvedAt: "2026-04-30T12:00:00Z",
    };
    const onfido = extractCredsOnfido(buildOnfidoReport(logical));
    const idos = extractCredsIdos(buildIdosVc(logical));

    expect(idos.rawCreds.countryCode).toBe(onfido.rawCreds.countryCode);
    expect(idos.derivedCreds.nameHash.value).toBe(onfido.derivedCreds.nameHash.value);
    expect(idos.derivedCreds.streetHash.value).toBe(
      onfido.derivedCreds.streetHash.value
    );
    expect(idos.derivedCreds.addressHash.value).toBe(
      onfido.derivedCreds.addressHash.value
    );
    expect(idos.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value).toBe(
      onfido.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
    );
  });

  it("matches Onfido when middleName is provided", () => {
    const logical = {
      firstName: "Alice",
      middleName: "Beth",
      lastName: "Smith",
      dateOfBirth: "1990-04-15",
      issuingCountry: "US",
    };
    const onfido = extractCredsOnfido(buildOnfidoReport(logical));
    const idos = extractCredsIdos(buildIdosVc(logical));
    expect(idos.derivedCreds.nameHash.value).toBe(onfido.derivedCreds.nameHash.value);
  });

  it("matches Onfido when middleName is missing (Buffer.alloc(1) convention)", () => {
    const logical = {
      firstName: "Alice",
      lastName: "Smith",
      dateOfBirth: "1990-04-15",
      issuingCountry: "GB",
    };
    const onfido = extractCredsOnfido(buildOnfidoReport(logical));
    const idos = extractCredsIdos(buildIdosVc(logical));
    expect(idos.derivedCreds.nameHash.value).toBe(onfido.derivedCreds.nameHash.value);
  });

  it("matches Onfido when address fields are populated identically", () => {
    const logical = {
      firstName: "Alice",
      lastName: "Smith",
      dateOfBirth: "1990-04-15",
      issuingCountry: "US",
      city: "Seattle",
      state: "WA",
      postcode: "98101",
      street: "Pine St",
      houseNumber: "100",
      unit: "apt 5",
    };
    const onfido = extractCredsOnfido(buildOnfidoReport(logical));
    const idos = extractCredsIdos(buildIdosVc(logical));

    expect(idos.derivedCreds.streetHash.value).toBe(onfido.derivedCreds.streetHash.value);
    expect(idos.derivedCreds.addressHash.value).toBe(onfido.derivedCreds.addressHash.value);
    expect(idos.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value).toBe(
      onfido.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
    );
  });
});

describe("idOS extractCreds — input handling", () => {
  it("normalizes ISO 8601 dateOfBirth to YYYY-MM-DD before hashing", () => {
    const isoTs = extractCredsIdos(
      buildIdosVc({
        firstName: "A",
        lastName: "B",
        dateOfBirth: "1990-04-15T00:00:00.000Z",
        issuingCountry: "US",
      })
    );
    const dateOnly = extractCredsIdos(
      buildIdosVc({
        firstName: "A",
        lastName: "B",
        dateOfBirth: "1990-04-15",
        issuingCountry: "US",
      })
    );
    expect(isoTs.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value).toBe(
      dateOnly.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
    );
    expect(isoTs.rawCreds.birthdate).toBe("1990-04-15");
  });

  it("falls back to nationality when idDocumentCountry is absent", () => {
    const result = extractCredsIdos({
      credentialSubject: {
        firstName: "A",
        familyName: "B",
        dateOfBirth: "1990-04-15",
        nationality: "DE",
      },
    });
    // Onfido produces this same code for issuingCountry "DE".
    const onfidoForDe = extractCredsOnfido(
      buildOnfidoReport({
        firstName: "A",
        lastName: "B",
        dateOfBirth: "1990-04-15",
        issuingCountry: "DE",
      })
    );
    expect(result.rawCreds.countryCode).toBe(onfidoForDe.rawCreds.countryCode);
  });

  it("uses approvedAt for completedAt, falling back to issuanceDate", () => {
    const withApproved = extractCredsIdos({
      credentialSubject: {
        firstName: "A",
        familyName: "B",
        dateOfBirth: "1990-04-15",
        idDocumentCountry: "US",
      },
      approvedAt: "2026-04-30T12:34:56Z",
      issuanceDate: "2026-01-01T00:00:00Z",
    });
    expect(withApproved.rawCreds.completedAt).toBe("2026-04-30");

    const withIssuance = extractCredsIdos({
      credentialSubject: {
        firstName: "A",
        familyName: "B",
        dateOfBirth: "1990-04-15",
        idDocumentCountry: "US",
      },
      issuanceDate: "2026-01-01T00:00:00Z",
    });
    expect(withIssuance.rawCreds.completedAt).toBe("2026-01-01");
  });

  it("emits the Onfido-compatible fieldsInLeaf list", () => {
    const result = extractCredsIdos(
      buildIdosVc({
        firstName: "A",
        lastName: "B",
        dateOfBirth: "1990-04-15",
        issuingCountry: "US",
      })
    );
    expect(result.fieldsInLeaf).toEqual([
      "issuer",
      "secret",
      "rawCreds.countryCode",
      "derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value",
      "rawCreds.completedAt",
      "scope",
    ]);
  });
});
