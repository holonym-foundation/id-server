import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import axios from "axios";

// NOTE: bun:test doesn't ship a jest-style module mocker out of the box, so
// these tests stub axios at the instance level and assert on the request
// shape via a captured spy. Skip cleanly if axios.post can't be replaced.

describe("createIdenfyToken", () => {
  const ORIGINAL_ENV = { ...process.env };
  let originalPost: typeof axios.post;

  beforeEach(() => {
    originalPost = axios.post;
    process.env.IDENFY_API_KEY = "test-key";
    process.env.IDENFY_API_SECRET = "test-secret";
    process.env.IDENFY_SANDBOX_API_KEY = "sandbox-key";
    process.env.IDENFY_SANDBOX_API_SECRET = "sandbox-secret";
  });

  afterEach(() => {
    (axios as any).post = originalPost;
    process.env = { ...ORIGINAL_ENV };
  });

  it("hits the correct endpoint with HTTP Basic auth and returns parsed payload", async () => {
    let capturedUrl = "";
    let capturedAuthHeader = "";
    let capturedBody: any = null;
    (axios as any).post = async (url: string, body: any, opts: any) => {
      capturedUrl = url;
      capturedAuthHeader = opts?.headers?.Authorization;
      capturedBody = body;
      return {
        data: {
          authToken: "AUTH123",
          scanRef: "SCAN123",
          expiryTime: 600,
          redirectUrl: "https://ui.idenfy.com/?authToken=AUTH123",
        },
      };
    };

    const { createIdenfyToken } = await import("./token.js");
    const result = await createIdenfyToken({ clientId: "client-1" });

    expect(result.authToken).toBe("AUTH123");
    expect(result.scanRef).toBe("SCAN123");
    expect(capturedUrl).toBe("https://ivs.idenfy.com/api/v2/token");
    expect(capturedBody).toEqual({
      clientId: "client-1",
      theme: "dd51a655-ecaa-47f4-8096-747cadad183f",
    });
    const expected = `Basic ${Buffer.from("test-key:test-secret").toString("base64")}`;
    expect(capturedAuthHeader).toBe(expected);
  });

  it("uses sandbox credentials when sandbox=true", async () => {
    let capturedAuthHeader = "";
    (axios as any).post = async (_url: string, _body: any, opts: any) => {
      capturedAuthHeader = opts?.headers?.Authorization;
      return { data: { authToken: "A", scanRef: "S" } };
    };

    const { createIdenfyToken } = await import("./token.js");
    await createIdenfyToken({ clientId: "x", sandbox: true });

    const expected = `Basic ${Buffer.from("sandbox-key:sandbox-secret").toString("base64")}`;
    expect(capturedAuthHeader).toBe(expected);
  });

  it("throws if api credentials are missing", async () => {
    delete process.env.IDENFY_API_KEY;
    delete process.env.IDENFY_API_SECRET;
    const { createIdenfyToken } = await import("./token.js");
    await expect(createIdenfyToken({ clientId: "x" })).rejects.toThrow();
  });

  it("throws on missing authToken/scanRef in response", async () => {
    (axios as any).post = async () => ({ data: { foo: "bar" } });
    const { createIdenfyToken } = await import("./token.js");
    await expect(createIdenfyToken({ clientId: "x" })).rejects.toThrow();
  });
});
