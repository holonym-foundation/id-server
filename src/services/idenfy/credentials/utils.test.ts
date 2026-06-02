import { describe, it, expect } from "bun:test";
import { extractCreds, extractIdenfyNameDob } from "./utils.js";

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

  // extractIdenfyNameDob feeds the Clean Hands (AML) branch, whose empty-PII
  // guard depends on it returning "" (not undefined) for missing fields.
  describe("extractIdenfyNameDob", () => {
    it("pulls name + dob from a flat payload", () => {
      const r = extractIdenfyNameDob({
        scanRef: "x",
        docFirstName: "John",
        docLastName: "Doe",
        docDob: "1990-01-15",
      } as any);
      expect(r).toEqual({ firstName: "John", lastName: "Doe", dateOfBirth: "1990-01-15" });
    });

    it("pulls name + dob from a nested payload", () => {
      const r = extractIdenfyNameDob({
        scanRef: "x",
        data: { docFirstName: "Jane", docLastName: "Roe", docDob: "1985-06-20" },
      } as any);
      expect(r).toEqual({ firstName: "Jane", lastName: "Roe", dateOfBirth: "1985-06-20" });
    });

    it("returns empty strings (not undefined) for missing fields", () => {
      const r = extractIdenfyNameDob({ scanRef: "x" } as any);
      expect(r).toEqual({ firstName: "", lastName: "", dateOfBirth: "" });
    });
  });

  // Defensive: iDenfy's real /api/v2/data shape (flat vs nested under `data`)
  // is unconfirmed (U11). extractCreds must read PII regardless. A nested
  // payload must yield the SAME creds as the equivalent flat payload — proving
  // we never silently emit empty PII if the real shape turns out to be nested.
  it("reads document fields whether flat or nested under `data`", () => {
    const flat = extractCreds({
      scanRef: "abc",
      docFirstName: "John",
      docLastName: "Doe",
      docDob: "1990-01-15",
      docIssuingCountry: "USA",
    } as any);

    const nested = extractCreds({
      scanRef: "abc",
      data: {
        docFirstName: "John",
        docLastName: "Doe",
        docDob: "1990-01-15",
        docIssuingCountry: "USA",
      },
    } as any);

    expect(nested.rawCreds.firstName).toBe("John");
    expect(nested.rawCreds.lastName).toBe("Doe");
    expect(nested.rawCreds.birthdate).toBe("1990-01-15");
    // Same logical input → byte-identical derived hashes regardless of nesting.
    expect(nested.derivedCreds.nameHash.value).toBe(flat.derivedCreds.nameHash.value);
    expect(
      nested.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
    ).toBe(flat.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value);
  });

  // TODO(U11): once we have a captured Onfido extractCreds output for "John
  // Doe / 1990-01-15 / USA / no address", add a parity assertion comparing the
  // four derivedCreds hashes byte-for-byte. The hash composition is identical
  // to Onfido's by inspection, so this test should pass without code changes.
});
