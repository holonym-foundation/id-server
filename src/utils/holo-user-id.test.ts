import { describe, it, expect } from "bun:test";
import type { Request } from "express";
import { resolveHoloUserId, HOLO_USER_ID_HEADER } from "./holo-user-id.js";

/** Minimal Express-request stub exposing a case-insensitive `.header()`. */
function makeReq(headers: Record<string, string> = {}): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    header(name: string) {
      return lower[name.toLowerCase()];
    },
  } as unknown as Request;
}

describe("resolveHoloUserId", () => {
  it("returns the header value when present", () => {
    const req = makeReq({ [HOLO_USER_ID_HEADER]: "abc" });
    expect(resolveHoloUserId(req)).toBe("abc");
  });

  it("returns undefined when the header is absent (no query fallback in Phase 3)", () => {
    const req = makeReq();
    expect(resolveHoloUserId(req)).toBeUndefined();
  });

  it("returns undefined for an empty-string header", () => {
    const req = makeReq({ [HOLO_USER_ID_HEADER]: "" });
    expect(resolveHoloUserId(req)).toBeUndefined();
  });

  it("returns undefined for a whitespace-only header", () => {
    const req = makeReq({ [HOLO_USER_ID_HEADER]: "   " });
    expect(resolveHoloUserId(req)).toBeUndefined();
  });

  it("returns undefined for a duplicated (comma-joined) header", () => {
    // Express joins repeated headers with ", "; a real holoUserId never has a comma.
    const req = makeReq({ [HOLO_USER_ID_HEADER]: "aaa, bbb" });
    expect(resolveHoloUserId(req)).toBeUndefined();
  });

  it("is case-insensitive on the header name", () => {
    const req = makeReq({ "x-holo-user-id": "abc" });
    expect(resolveHoloUserId(req)).toBe("abc");
  });

  it("does not trim the returned value (preserves downstream length checks)", () => {
    const padded = " abc ";
    const req = makeReq({ [HOLO_USER_ID_HEADER]: padded });
    expect(resolveHoloUserId(req)).toBe(padded);
  });
});
