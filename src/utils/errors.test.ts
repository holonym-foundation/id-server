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
});
