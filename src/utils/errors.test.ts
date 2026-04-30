import { describe, it, expect } from "bun:test";
import { isAlreadyRegisteredFailure, toAlreadyRegisteredStr } from "./errors.js";

describe("isAlreadyRegisteredFailure", () => {
  it("returns true for the canonical writer's output (round-trip pin)", () => {
    expect(isAlreadyRegisteredFailure(toAlreadyRegisteredStr("abc"))).toBe(true);
  });

  it("returns true for the prefix without a userId suffix", () => {
    expect(isAlreadyRegisteredFailure("User has already registered")).toBe(true);
  });

  it("returns false for unrelated failure reasons", () => {
    expect(isAlreadyRegisteredFailure("User failed liveness check")).toBe(false);
  });

  it("returns false for null, undefined, and empty strings", () => {
    expect(isAlreadyRegisteredFailure(null)).toBe(false);
    expect(isAlreadyRegisteredFailure(undefined)).toBe(false);
    expect(isAlreadyRegisteredFailure("")).toBe(false);
  });

  it("detects phone sybil prefix from failPhoneSession", () => {
    // Mirrors services/phone/check-number.ts:463
    expect(isAlreadyRegisteredFailure("Number has been registered already")).toBe(true);
    expect(isAlreadyRegisteredFailure("Number has been registered already!")).toBe(true);
  });

  it("detects biometrics sybil prefix from FaceTec duplicate-match path", () => {
    // Mirrors services/facetec/{credentials,v2/no-sybils/credentials,enrollment-3d}.js
    expect(
      isAlreadyRegisteredFailure(
        "Face scan failed as highly matching duplicates are found."
      )
    ).toBe(true);
  });

  it("detects cross-provider sybil reason", () => {
    // services/zk-passport/verify-and-issue.ts:514
    expect(
      isAlreadyRegisteredFailure(
        "User has already registered (cross-provider sybil check)"
      )
    ).toBe(true);
  });
});
