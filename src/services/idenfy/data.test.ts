import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import axios from "axios";

describe("fetchIdenfyVerificationData", () => {
  const ORIGINAL_ENV = { ...process.env };
  let originalPost: typeof axios.post;

  beforeEach(() => {
    originalPost = axios.post;
    process.env.IDENFY_API_KEY = "k";
    process.env.IDENFY_API_SECRET = "s";
  });

  afterEach(() => {
    (axios as any).post = originalPost;
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns parsed data when scanRef matches and status is present", async () => {
    (axios as any).post = async () => ({
      data: {
        scanRef: "abc",
        status: { overall: "APPROVED" },
        data: { docFirstName: "A" },
      },
    });
    const { fetchIdenfyVerificationData } = await import("./data.js");
    const result = await fetchIdenfyVerificationData({ scanRef: "abc" });
    expect(result.scanRef).toBe("abc");
    expect(result.status?.overall).toBe("APPROVED");
  });

  it("throws on scanRef mismatch", async () => {
    (axios as any).post = async () => ({
      data: { scanRef: "different", status: { overall: "APPROVED" } },
    });
    const { fetchIdenfyVerificationData } = await import("./data.js");
    await expect(
      fetchIdenfyVerificationData({ scanRef: "abc" })
    ).rejects.toThrow(/scanRef mismatch/i);
  });

  it("returns data even when overall status is absent (status comes from /api/v2/status, not /api/v2/data)", async () => {
    (axios as any).post = async () => ({ data: { scanRef: "abc" } });
    const { fetchIdenfyVerificationData } = await import("./data.js");
    const result = await fetchIdenfyVerificationData({ scanRef: "abc" });
    expect(result.scanRef).toBe("abc");
  });

  it("throws when credentials are missing", async () => {
    delete process.env.IDENFY_API_KEY;
    delete process.env.IDENFY_API_SECRET;
    const { fetchIdenfyVerificationData } = await import("./data.js");
    await expect(
      fetchIdenfyVerificationData({ scanRef: "abc" })
    ).rejects.toThrow();
  });

  it("throws on missing scanRef arg", async () => {
    const { fetchIdenfyVerificationData } = await import("./data.js");
    await expect(
      fetchIdenfyVerificationData({ scanRef: "" })
    ).rejects.toThrow();
  });
});
