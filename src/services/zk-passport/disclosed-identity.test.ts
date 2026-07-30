import { describe, it, expect } from "bun:test";
import {
  extractDisclosedIdentity,
  formatDisclosedName,
} from "./disclosed-identity.js";

/**
 * Build a queryResult in the shape the ZK Passport SDK returns.
 *
 * The SDK discloses the single MRZ name zone and splits it on "<<", so the
 * firstname/lastname it reports are derived, not independent fields. Each
 * fixture below notes the MRZ name zone it corresponds to.
 */
function queryResult(fields: {
  firstname?: string;
  lastname?: string;
  birthdate?: string;
  nationality?: string;
}) {
  const result: any = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) result[key] = { disclose: { result: value } };
  }
  return result;
}

describe("extractDisclosedIdentity", () => {
  it("accepts a conventional two-part name", () => {
    // MRZ name zone: DOE<<JOHN<PAUL<<<<<
    const identity = extractDisclosedIdentity(
      queryResult({
        firstname: "JOHN",
        lastname: "DOE",
        birthdate: "1990-01-01",
        nationality: "USA",
      }),
    );

    expect(identity.hasRequiredFields).toBe(true);
    expect(identity.firstName).toBe("JOHN");
    expect(identity.lastName).toBe("DOE");
    expect(identity.dobRaw).toBe("1990-01-01");
    expect(identity.nationality).toBe("USA");
  });

  it("accepts a mononym holder, whose firstname is empty", () => {
    // MRZ name zone: SUKARNO<<<<<<<<<<<<<
    // Per ICAO 9303 a single legal name goes in the primary identifier
    // (surname) position, so the SDK parses firstname as "". This is the
    // production case that was being rejected: the proof verifies and the name
    // is disclosed, there simply are no given names.
    const identity = extractDisclosedIdentity(
      queryResult({
        firstname: "",
        lastname: "SUKARNO",
        birthdate: "1901-06-06",
        nationality: "IDN",
      }),
    );

    expect(identity.hasRequiredFields).toBe(true);
    expect(identity.firstName).toBe("");
    expect(identity.lastName).toBe("SUKARNO");
  });

  it("accepts a name zone with no << separator, whose lastname is empty", () => {
    // Everything parses into firstname when the separator is absent.
    const identity = extractDisclosedIdentity(
      queryResult({
        firstname: "SUKARNO",
        lastname: "",
        birthdate: "1901-06-06",
      }),
    );

    expect(identity.hasRequiredFields).toBe(true);
    expect(identity.firstName).toBe("SUKARNO");
    expect(identity.lastName).toBe("");
  });

  it("rejects a proof that discloses no name at all", () => {
    const identity = extractDisclosedIdentity(
      queryResult({ firstname: "", lastname: "", birthdate: "1990-01-01" }),
    );

    expect(identity.hasRequiredFields).toBe(false);
  });

  it("rejects a proof missing date of birth", () => {
    const identity = extractDisclosedIdentity(
      queryResult({ firstname: "JOHN", lastname: "DOE" }),
    );

    expect(identity.hasRequiredFields).toBe(false);
  });

  it("normalizes absent disclosures to empty strings", () => {
    const identity = extractDisclosedIdentity({});

    expect(identity.firstName).toBe("");
    expect(identity.lastName).toBe("");
    expect(identity.dobRaw).toBeUndefined();
    expect(identity.nationality).toBeUndefined();
    expect(identity.hasRequiredFields).toBe(false);
  });

  it("tolerates a null or undefined queryResult", () => {
    expect(extractDisclosedIdentity(null).hasRequiredFields).toBe(false);
    expect(extractDisclosedIdentity(undefined).hasRequiredFields).toBe(false);
  });
});

describe("formatDisclosedName", () => {
  it("joins both components", () => {
    expect(formatDisclosedName("JOHN", "DOE")).toBe("JOHN DOE");
  });

  it("emits no leading space for a mononym holder", () => {
    // A leading space would be sent to the sanctions screen as " SUKARNO".
    expect(formatDisclosedName("", "SUKARNO")).toBe("SUKARNO");
  });

  it("emits no trailing space when lastname is empty", () => {
    expect(formatDisclosedName("SUKARNO", "")).toBe("SUKARNO");
  });
});
