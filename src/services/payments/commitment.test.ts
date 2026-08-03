import { describe, it, expect } from "bun:test";
import { ethers } from "ethers";
import {
  normalizeCommitment,
  createCommitmentRecord,
  INVALID_COMMITMENT_MESSAGE,
} from "./commitment.js";

// Same derivation as deriveCommitmentFromSecret in ./functions.js (which can't
// be imported here without dragging in env-dependent module init).
function deriveCommitment(secret: string): string {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(secret));
}

const VALID_LOWERCASE =
  "0x6fbc0fcf0000000000000000000000000000000000000000000000000000c9c2" as const;

describe("normalizeCommitment", () => {
  it("returns a valid lowercase commitment unchanged", () => {
    expect(normalizeCommitment(VALID_LOWERCASE)).toBe(VALID_LOWERCASE);

    const derived = deriveCommitment("test");
    expect(normalizeCommitment(derived)).toBe(derived);
  });

  it("lowercases uppercase hex digits", () => {
    const upper = "0x" + VALID_LOWERCASE.slice(2).toUpperCase();
    expect(normalizeCommitment(upper)).toBe(VALID_LOWERCASE);
  });

  it("lowercases mixed/checksummed-style case", () => {
    const mixed =
      "0x6FbC0fCf0000000000000000000000000000000000000000000000000000C9c2";
    expect(normalizeCommitment(mixed)).toBe(mixed.toLowerCase());
  });

  it("normalizes an uppercased derived commitment back to the derived value (issue #236 scenario)", () => {
    const derived = deriveCommitment("some payment secret");
    const uppercased = "0x" + derived.slice(2).toUpperCase();
    expect(normalizeCommitment(uppercased)).toBe(derived);
  });

  it("rejects an uppercase 0X prefix", () => {
    const upperPrefix = "0X" + VALID_LOWERCASE.slice(2);
    expect(normalizeCommitment(upperPrefix)).toBeNull();
  });

  it("rejects hex without the 0x prefix", () => {
    expect(normalizeCommitment(VALID_LOWERCASE.slice(2))).toBeNull();
  });

  it("rejects wrong lengths", () => {
    expect(normalizeCommitment(VALID_LOWERCASE.slice(0, -1))).toBeNull(); // 63 chars
    expect(normalizeCommitment(VALID_LOWERCASE + "a")).toBeNull(); // 65 chars
    expect(normalizeCommitment("0x")).toBeNull();
    expect(normalizeCommitment("")).toBeNull();
  });

  it("rejects non-hex characters", () => {
    expect(normalizeCommitment(VALID_LOWERCASE.slice(0, -1) + "g")).toBeNull();
  });

  it("rejects whitespace-padded values (no trimming)", () => {
    expect(normalizeCommitment(` ${VALID_LOWERCASE}`)).toBeNull();
    expect(normalizeCommitment(`${VALID_LOWERCASE}\n`)).toBeNull();
  });

  it("rejects non-string values", () => {
    expect(normalizeCommitment(null)).toBeNull();
    expect(normalizeCommitment(undefined)).toBeNull();
    expect(normalizeCommitment(123)).toBeNull();
    expect(normalizeCommitment({})).toBeNull();
    // Express yields arrays for repeated query params
    expect(normalizeCommitment([VALID_LOWERCASE])).toBeNull();
  });

  it("exports a stable error message for endpoint 400s", () => {
    expect(INVALID_COMMITMENT_MESSAGE).toBe(
      "commitment must be a 0x-prefixed 32-byte hex string"
    );
  });
});

describe("createCommitmentRecord", () => {
  function stubModel() {
    const calls = { findOne: [] as any[], create: [] as any[] };
    const model = {
      findOne(query: any) {
        calls.findOne.push(query);
        return { exec: async () => null };
      },
      async create(doc: any) {
        calls.create.push(doc);
        return doc;
      },
    };
    return { model: model as any, calls };
  }

  it("throws on a malformed commitment before touching the model", async () => {
    const { model, calls } = stubModel();
    await expect(
      createCommitmentRecord("not-a-commitment", "user", model)
    ).rejects.toThrow(INVALID_COMMITMENT_MESSAGE);
    expect(calls.findOne).toHaveLength(0);
    expect(calls.create).toHaveLength(0);
  });

  it("queries and persists the lowercased commitment", async () => {
    const { model, calls } = stubModel();
    const upper = "0x" + VALID_LOWERCASE.slice(2).toUpperCase();
    const record = await createCommitmentRecord(upper, "user", model);
    expect(calls.findOne[0]).toEqual({ commitment: VALID_LOWERCASE });
    expect(calls.create[0].commitment).toBe(VALID_LOWERCASE);
    expect(record.commitment).toBe(VALID_LOWERCASE);
  });

  it("returns an existing record without creating a duplicate", async () => {
    const { model, calls } = stubModel();
    const existing = {
      commitment: VALID_LOWERCASE,
      sourceType: "user" as const,
      createdAt: new Date(0),
    };
    model.findOne = (query: any) => {
      calls.findOne.push(query);
      return { exec: async () => existing };
    };
    const record = await createCommitmentRecord(VALID_LOWERCASE, "user", model);
    expect(record).toBe(existing);
    expect(calls.create).toHaveLength(0);
  });
});
