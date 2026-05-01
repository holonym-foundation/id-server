import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Mock the SDK before importing our wrapper so we never hit the network.
const initMock = mock(async (config: unknown) => ({
  __config: config,
  getAccessGrants: mock(async () => ({ grants: [], totalCount: 0 })),
  getCredentialSharedContentDecrypted: mock(async () => "{}"),
  getCredentialSharedFromIDOS: mock(async () => undefined),
}));

mock.module("@idos-network/consumer", () => ({
  idOSConsumer: { init: initMock },
}));

const { listGrants, decryptCredential, __resetIdosConsumerForTests } =
  await import("./consumer.js");

const VALID_SIGNER_HEX = "00".repeat(64); // 128 hex chars
const VALID_RECIPIENT_KEY = "test-recipient-encryption-key";

describe("idOS consumer wrapper", () => {
  beforeEach(() => {
    __resetIdosConsumerForTests();
    initMock.mockClear();
    delete process.env.IDOS_SIGNER;
    delete process.env.IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY;
    delete process.env.IDOS_NODE_URL;
    delete process.env.IDOS_CHAIN_ID;
  });

  afterEach(() => {
    __resetIdosConsumerForTests();
  });

  it("throws when IDOS_SIGNER is missing", async () => {
    process.env.IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY = VALID_RECIPIENT_KEY;
    await expect(listGrants({})).rejects.toThrow(/IDOS_SIGNER/);
  });

  it("throws when IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY is missing", async () => {
    process.env.IDOS_SIGNER = VALID_SIGNER_HEX;
    await expect(listGrants({})).rejects.toThrow(
      /IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY/
    );
  });

  it("throws when IDOS_SIGNER has wrong length", async () => {
    process.env.IDOS_SIGNER = "deadbeef"; // valid hex but only 4 bytes
    process.env.IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY = VALID_RECIPIENT_KEY;
    await expect(listGrants({})).rejects.toThrow(/128-character hex/);
  });

  it("throws when IDOS_SIGNER contains non-hex characters", async () => {
    process.env.IDOS_SIGNER = "z".repeat(128);
    process.env.IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY = VALID_RECIPIENT_KEY;
    await expect(listGrants({})).rejects.toThrow(/128-character hex/);
  });

  it("calls idOSConsumer.init with parsed signer + recipient key", async () => {
    process.env.IDOS_SIGNER = VALID_SIGNER_HEX;
    process.env.IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY = VALID_RECIPIENT_KEY;

    await listGrants({});

    expect(initMock).toHaveBeenCalledTimes(1);
    const config = initMock.mock.calls[0]?.[0] as {
      consumerSigner: { secretKey: Uint8Array };
      recipientEncryptionPrivateKey: string;
      nodeUrl?: string;
      chainId?: string;
    };
    expect(config.recipientEncryptionPrivateKey).toBe(VALID_RECIPIENT_KEY);
    expect(config.consumerSigner.secretKey).toBeInstanceOf(Uint8Array);
    expect(config.consumerSigner.secretKey.length).toBe(64);
    expect(config.nodeUrl).toBeUndefined();
    expect(config.chainId).toBeUndefined();
  });

  it("forwards optional IDOS_NODE_URL and IDOS_CHAIN_ID overrides", async () => {
    process.env.IDOS_SIGNER = VALID_SIGNER_HEX;
    process.env.IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY = VALID_RECIPIENT_KEY;
    process.env.IDOS_NODE_URL = "https://node.example";
    process.env.IDOS_CHAIN_ID = "idos-test-1";

    await decryptCredential("00000000-0000-0000-0000-000000000001");

    expect(initMock).toHaveBeenCalledTimes(1);
    const config = initMock.mock.calls[0]?.[0] as {
      nodeUrl?: string;
      chainId?: string;
    };
    expect(config.nodeUrl).toBe("https://node.example");
    expect(config.chainId).toBe("idos-test-1");
  });

  it("memoizes the consumer instance across calls", async () => {
    process.env.IDOS_SIGNER = VALID_SIGNER_HEX;
    process.env.IDOS_RECIPIENT_ENCRYPTION_PRIVATE_KEY = VALID_RECIPIENT_KEY;

    await listGrants({});
    await listGrants({});
    await decryptCredential("00000000-0000-0000-0000-000000000001");

    expect(initMock).toHaveBeenCalledTimes(1);
  });
});
