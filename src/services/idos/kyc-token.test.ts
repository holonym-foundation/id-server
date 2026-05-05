import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import crypto from "crypto";
import jwt from "jsonwebtoken";

mock.module("../../utils/rate-limiting.js", () => ({
  rateLimitOccurrencesPerSecs: async () => ({ limitExceeded: false, count: 0 }),
}));
mock.module("../../utils/logger.js", () => ({
  default: { error: () => {}, info: () => {}, warn: () => {} },
}));

const { signKycToken, issueKycTokenProd, issueKycTokenSandbox } = await import(
  "./kyc-token.js"
);

const TEST_CLIENT_ID = "fbd6e29d-c69a-4d3d-a5b4-0afb64d70215";
let TEST_PRIVATE_KEY_PEM = "";
let TEST_PUBLIC_KEY_PEM = "";

beforeAll(() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp521r1", // P-521 (matches ES512)
  });
  TEST_PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  TEST_PUBLIC_KEY_PEM = publicKey.export({ type: "spki", format: "pem" }) as string;
});

function clearEnv() {
  delete process.env.IDOS_JWT_PRIVATE_KEY;
  delete process.env.IDOS_JWT_PRIVATE_KEY_SANDBOX;
  delete process.env.IDOS_FRACTAL_CLIENT_ID;
  delete process.env.IDOS_FRACTAL_CLIENT_ID_SANDBOX;
}

function setProdEnv() {
  process.env.IDOS_JWT_PRIVATE_KEY = TEST_PRIVATE_KEY_PEM;
  process.env.IDOS_FRACTAL_CLIENT_ID = TEST_CLIENT_ID;
}

function makeRes() {
  let statusCode = 0;
  let body: unknown = null;
  return {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

describe("signKycToken", () => {
  beforeEach(() => {
    clearEnv();
    setProdEnv();
  });
  afterEach(clearEnv);

  it("signs a valid ES512 JWT with the canonical payload", () => {
    const token = signKycToken("live");
    const decoded = jwt.verify(token, TEST_PUBLIC_KEY_PEM, {
      algorithms: ["ES512"],
    }) as Record<string, unknown>;

    expect(decoded.clientId).toBe(TEST_CLIENT_ID);
    expect(decoded.kyc).toBe(true);
    expect(decoded.level).toBe("basic+idos");
    expect(decoded.state).toBe("optional");
    expect(decoded.walletAddress).toBeUndefined();
    expect(decoded.externalUserId).toBeUndefined();
  });

  it("includes optional walletAddress and externalUserId when provided", () => {
    const token = signKycToken("live", {
      walletAddress: "0x" + "ab".repeat(20),
      externalUserId: "user-42",
    });
    const decoded = jwt.verify(token, TEST_PUBLIC_KEY_PEM, {
      algorithms: ["ES512"],
    }) as Record<string, unknown>;

    expect(decoded.walletAddress).toBe("0x" + "ab".repeat(20));
    expect(decoded.externalUserId).toBe("user-42");
  });

  it("falls back to prod key/clientId when sandbox-specific env vars are not set", () => {
    const token = signKycToken("sandbox");
    const decoded = jwt.verify(token, TEST_PUBLIC_KEY_PEM, {
      algorithms: ["ES512"],
    }) as Record<string, unknown>;

    expect(decoded.clientId).toBe(TEST_CLIENT_ID);
  });

  it("throws when IDOS_JWT_PRIVATE_KEY is missing", () => {
    delete process.env.IDOS_JWT_PRIVATE_KEY;
    expect(() => signKycToken("live")).toThrow(/IDOS_JWT_PRIVATE_KEY/);
  });

  it("throws when IDOS_FRACTAL_CLIENT_ID is missing", () => {
    delete process.env.IDOS_FRACTAL_CLIENT_ID;
    expect(() => signKycToken("live")).toThrow(/IDOS_FRACTAL_CLIENT_ID/);
  });

  it("throws when IDOS_JWT_PRIVATE_KEY is not PEM-formatted", () => {
    process.env.IDOS_JWT_PRIVATE_KEY = "not-a-pem-key";
    expect(() => signKycToken("live")).toThrow(/PEM-encoded/);
  });
});

describe("issueKycToken HTTP handler", () => {
  beforeEach(() => {
    clearEnv();
    setProdEnv();
  });
  afterEach(clearEnv);

  it("returns 200 + token on a valid empty body", async () => {
    const res = makeRes();
    await issueKycTokenProd(
      { body: {} } as never,
      res as never
    );
    expect(res.statusCode).toBe(200);
    expect((res.body as { token: string }).token).toBeTypeOf("string");
  });

  it("returns 200 + token on a valid body with optional fields", async () => {
    const res = makeRes();
    await issueKycTokenProd(
      {
        body: {
          walletAddress: "0x" + "cd".repeat(20),
          externalUserId: "u1",
        },
      } as never,
      res as never
    );
    expect(res.statusCode).toBe(200);
    const { token } = res.body as { token: string };
    const decoded = jwt.verify(token, TEST_PUBLIC_KEY_PEM, {
      algorithms: ["ES512"],
    }) as Record<string, unknown>;
    expect(decoded.walletAddress).toBe("0x" + "cd".repeat(20));
    expect(decoded.externalUserId).toBe("u1");
  });

  it("returns 400 on a malformed walletAddress", async () => {
    const res = makeRes();
    await issueKycTokenProd(
      { body: { walletAddress: "0xnothex" } } as never,
      res as never
    );
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/walletAddress/);
  });

  it("returns 400 on a non-string externalUserId", async () => {
    const res = makeRes();
    await issueKycTokenProd(
      { body: { externalUserId: 42 } } as never,
      res as never
    );
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/externalUserId/);
  });

  it("returns 500 with config-specific message when env vars missing", async () => {
    delete process.env.IDOS_JWT_PRIVATE_KEY;
    const res = makeRes();
    await issueKycTokenProd({ body: {} } as never, res as never);
    expect(res.statusCode).toBe(500);
    expect((res.body as { error: string }).error).toMatch(/not configured/);
  });

  it("sandbox handler signs with sandbox-prefixed env vars when set", async () => {
    const sandboxKp = crypto.generateKeyPairSync("ec", {
      namedCurve: "secp521r1",
    });
    process.env.IDOS_JWT_PRIVATE_KEY_SANDBOX = sandboxKp.privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string;
    process.env.IDOS_FRACTAL_CLIENT_ID_SANDBOX = "sandbox-client-id";

    const res = makeRes();
    await issueKycTokenSandbox({ body: {} } as never, res as never);
    expect(res.statusCode).toBe(200);

    const { token } = res.body as { token: string };
    const decoded = jwt.verify(
      token,
      sandboxKp.publicKey.export({ type: "spki", format: "pem" }) as string,
      { algorithms: ["ES512"] }
    ) as Record<string, unknown>;
    expect(decoded.clientId).toBe("sandbox-client-id");
  });
});
