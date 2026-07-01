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
  it("returns the header value when present, ignoring the fallback", () => {
    const req = makeReq({ [HOLO_USER_ID_HEADER]: "abc" });
    expect(resolveHoloUserId(req, "xyz")).toBe("abc");
  });

  it("returns the fallback when the header is absent", () => {
    const req = makeReq();
    expect(resolveHoloUserId(req, "xyz")).toBe("xyz");
  });

  it("treats an empty-string header as absent and falls back", () => {
    const req = makeReq({ [HOLO_USER_ID_HEADER]: "" });
    expect(resolveHoloUserId(req, "xyz")).toBe("xyz");
  });

  it("treats a whitespace-only header as absent and falls back", () => {
    const req = makeReq({ [HOLO_USER_ID_HEADER]: "   " });
    expect(resolveHoloUserId(req, "xyz")).toBe("xyz");
  });

  it("returns the header value even when the fallback is undefined", () => {
    const req = makeReq({ [HOLO_USER_ID_HEADER]: "abc" });
    expect(resolveHoloUserId(req, undefined)).toBe("abc");
  });

  it("returns the (undefined) fallback when neither header nor query value exists", () => {
    const req = makeReq();
    expect(resolveHoloUserId(req, undefined)).toBeUndefined();
  });

  it("treats a duplicated (comma-joined) header as absent and falls back", () => {
    // Express joins repeated headers with ", "; a real holoUserId never has a comma.
    const req = makeReq({ [HOLO_USER_ID_HEADER]: "aaa, bbb" });
    expect(resolveHoloUserId(req, "xyz")).toBe("xyz");
  });

  it("is case-insensitive on the header name", () => {
    const req = makeReq({ "x-holo-user-id": "abc" });
    expect(resolveHoloUserId(req, "xyz")).toBe("abc");
  });

  it("does not trim the returned value (preserves downstream length checks)", () => {
    const padded = " abc ";
    const req = makeReq({ [HOLO_USER_ID_HEADER]: padded });
    expect(resolveHoloUserId(req, "xyz")).toBe(padded);
  });
});
