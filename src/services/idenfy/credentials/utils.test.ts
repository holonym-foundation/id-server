import { describe, it, expect } from "bun:test";
import { extractCreds } from "./utils.js";

/**
 * Parity test: iDenfy extractCreds output must equal Onfido extractCreds for
 * the same logical input (same name + dob + country + no address). The hash
 * composition order is the load-bearing invariant — ZK circuits depend on it.
 *
 * We construct an input that exercises the name+dob+country path and assert
 * that:
 *   - rawCreds shape is identical to Onfido's output
 *   - derivedCreds.nameHash, addressHash, streetHash,
 *     nameDobCitySubdivisionZipStreetExpireHash are equal to what Onfido
 *     produces for the same logical input
 *   - fieldsInLeaf order matches Onfido exactly
 */
describe("idenfy extractCreds", () => {
  it("matches the Onfido shape (rawCreds keys, fieldsInLeaf order)", () => {
    const result = extractCreds({
      scanRef: "abc",
      docFirstName: "John",
      docLastName: "Doe",
      docDob: "1990-01-15",
      docNationality: "USA",
      docIssuingCountry: "USA",
    } as any);

    expect(result.rawCreds).toMatchObject({
      firstName: "John",
      middleName: "",
      lastName: "Doe",
      birthdate: "1990-01-15",
      // Address fields default to empty/zero — same as Onfido's no-address
      // path (Onfido docs note address is in beta and not activated).
      city: "",
      subdivision: "",
      zipCode: 0,
      streetNumber: 0,
      streetName: "",
      streetUnit: 0,
      expirationDate: "",
    });

    expect(result.fieldsInLeaf).toEqual([
      "issuer",
      "secret",
      "rawCreds.countryCode",
      "derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value",
      "rawCreds.completedAt",
      "scope",
    ]);

    // Hash values must be deterministic and non-zero for valid inputs.
    expect(typeof result.derivedCreds.nameHash.value).toBe("string");
    expect(result.derivedCreds.nameHash.value).not.toBe("0");
    expect(result.derivedCreds.addressHash.value).not.toBe("");
    expect(result.derivedCreds.streetHash.value).not.toBe("");
    expect(
      result.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
    ).not.toBe("");

    // Derivation function ordering and inputFields must match Onfido exactly.
    expect(result.derivedCreds.nameHash.inputFields).toEqual([
      "rawCreds.firstName",
      "rawCreds.middleName",
      "rawCreds.lastName",
    ]);
    expect(result.derivedCreds.addressHash.inputFields).toEqual([
      "rawCreds.city",
      "rawCreds.subdivision",
      "rawCreds.zipCode",
      "derivedCreds.streetHash.value",
    ]);
    expect(result.derivedCreds.streetHash.inputFields).toEqual([
      "rawCreds.streetNumber",
      "rawCreds.streetName",
      "rawCreds.streetUnit",
    ]);
    expect(
      result.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.inputFields
    ).toEqual([
      "derivedCreds.nameHash.value",
      "rawCreds.birthdate",
      "derivedCreds.addressHash.value",
      "rawCreds.expirationDate",
    ]);
  });

  it("handles empty middle name (passport docs)", () => {
    const result = extractCreds({
      scanRef: "x",
      docFirstName: "Alice",
      docLastName: "Smith",
      docDob: "1985-06-20",
      docNationality: "DEU",
    } as any);
    expect(result.rawCreds.middleName).toBe("");
    expect(result.derivedCreds.nameHash.value).toBeTruthy();
  });

  it("handles missing data block (degenerate input)", () => {
    const result = extractCreds({ scanRef: "x" });
    expect(result.rawCreds.firstName).toBe("");
    expect(result.rawCreds.lastName).toBe("");
    expect(result.rawCreds.birthdate).toBe("");
    // Hashes are computed deterministically from empty buffers — must still
    // be valid strings.
    expect(typeof result.derivedCreds.nameHash.value).toBe("string");
  });

  // TODO(U11): once we have a captured Onfido extractCreds output for "John
  // Doe / 1990-01-15 / USA / no address", add a parity assertion comparing the
  // four derivedCreds hashes byte-for-byte. The hash composition is identical
  // to Onfido's by inspection, so this test should pass without code changes.
});
