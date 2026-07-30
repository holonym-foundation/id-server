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
 *
 * birthdate is a `Date` in the fixtures because that is what the extraction
 * actually sees: it arrives as an ISO string over the wire, and verify()
 * mutates it back into a Date in place before we read it.
 */
function queryResult(fields: {
  firstname?: string;
  lastname?: string;
  birthdate?: Date | string;
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
    const dob = new Date(Date.UTC(1990, 0, 1));
    const identity = extractDisclosedIdentity(
      queryResult({
        firstname: "JOHN",
        lastname: "DOE",
        birthdate: dob,
        nationality: "USA",
      }),
    );

    expect(identity.hasRequiredFields).toBe(true);
    expect(identity.firstName).toBe("JOHN");
    expect(identity.lastName).toBe("DOE");
    expect(identity.dobRaw).toBe(dob);
    expect(identity.nationality).toBe("USA");
  });

  it("preserves the birthdate as the Date that verify() left in place", () => {
    // verify() calls formatQueryResultDates(queryResult), which converts the
    // over-the-wire ISO string into a Date by mutating the object in place.
    // Extraction must hand that Date through untouched — formatDateOfBirth()
    // returns strings unchanged, so a string here would put a timestamped
    // birthdate into credentials and govIdUUID().
    const dob = new Date(Date.UTC(1901, 5, 6));
    const identity = extractDisclosedIdentity(
      queryResult({ firstname: "", lastname: "SUKARNO", birthdate: dob }),
    );

    expect(identity.dobRaw).toBeInstanceOf(Date);
    expect(identity.dobRaw).toBe(dob);
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
        birthdate: new Date(Date.UTC(1901, 5, 6)),
        nationality: "IDN",
      }),
    );

    expect(identity.hasRequiredFields).toBe(true);
    expect(identity.firstName).toBe("");
    expect(identity.lastName).toBe("SUKARNO");
  });

  it("accepts a name carried by firstname alone", () => {
    // Contract test, not an observed SDK shape: the guard is symmetric because
    // nothing downstream cares which component carries the name. (The SDK's
    // split cannot actually produce this — see the both-empty case below.)
    const identity = extractDisclosedIdentity(
      queryResult({
        firstname: "SUKARNO",
        lastname: "",
        birthdate: new Date(Date.UTC(1901, 5, 6)),
      }),
    );

    expect(identity.hasRequiredFields).toBe(true);
    expect(identity.firstName).toBe("SUKARNO");
    expect(identity.lastName).toBe("");
  });

  it("rejects a name zone with no << separator, which parses to both-empty", () => {
    // When the name zone contains no "<<" the SDK's split yields "" for both
    // components, so there is no name to key an identity on.
    const identity = extractDisclosedIdentity(
      queryResult({
        firstname: "",
        lastname: "",
        birthdate: new Date(Date.UTC(1990, 0, 1)),
      }),
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
