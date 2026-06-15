import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import axios from "axios";

// ---------------------------------------------------------------------------
// Controllable Valkey fake. functions.ts imports `valkeyClient` from
// ../../utils/valkey-glide.js; bun:test has no jest-style auto-mock, so we
// replace that module with a fake whose lock state we can manipulate per test.
// The specifier matches the one functions.ts uses so both resolve to the same
// module path.
// ---------------------------------------------------------------------------
const lockStore = new Set<string>();

const fakeValkey = {
  set: async (key: string, _val: string, opts: any) => {
    if (opts?.conditionalSet === "onlyIfDoesNotExist") {
      if (lockStore.has(key)) return null; // NX fails — lock already held
      lockStore.add(key);
      return "OK";
    }
    lockStore.add(key);
    return "OK";
  },
  del: async (keys: string[]) => {
    for (const k of keys) lockStore.delete(k);
  },
  exists: async (keys: string[]) => keys.filter((k) => lockStore.has(k)).length,
};

mock.module("../../utils/valkey-glide.js", () => ({ valkeyClient: fakeValkey }));

const functions = await import("./functions.js");
const {
  getIdenfyStatusForSession,
  tryAcquireIdenfyRecreateLock,
  releaseIdenfyRecreateLock,
} = functions;

// ---------------------------------------------------------------------------
// axios stub: createIdenfyToken hits /api/v2/token, fetchIdenfyStatus hits
// /api/v2/status. Branch on URL. Counters let tests assert whether the
// (billed) token mint was actually attempted.
// ---------------------------------------------------------------------------
let originalPost: typeof axios.post;
let tokenCalls = 0;
let statusToReturn: string | null = null; // value /api/v2/status returns
let tokenShouldThrow = false;
let mintedSeq = 0;

beforeEach(() => {
  originalPost = axios.post;
  lockStore.clear();
  tokenCalls = 0;
  statusToReturn = null;
  tokenShouldThrow = false;
  mintedSeq = 0;
  process.env.IDENFY_API_KEY = "test-key";
  process.env.IDENFY_API_SECRET = "test-secret";
  process.env.IDENFY_SANDBOX_API_KEY = "sandbox-key";
  process.env.IDENFY_SANDBOX_API_SECRET = "sandbox-secret";

  (axios as any).post = async (url: string) => {
    if (url.endsWith("/api/v2/token")) {
      tokenCalls += 1;
      if (tokenShouldThrow) throw new Error("iDenfy token API down");
      mintedSeq += 1;
      return {
        data: { authToken: `AUTH_NEW_${mintedSeq}`, scanRef: `SCAN_NEW_${mintedSeq}` },
      };
    }
    if (url.endsWith("/api/v2/status")) {
      return { data: { scanRef: "SCAN_OLD", status: statusToReturn } };
    }
    throw new Error(`unexpected axios.post to ${url}`);
  };
});

afterEach(() => {
  (axios as any).post = originalPost;
});

// A fake config whose IdenfySessionModel records updates and can return a
// re-read document for the lock-miss path.
function makeConfig(
  environment: "sandbox" | "live",
  reReadDoc?: any,
  updateMatchedCount: number = 1
) {
  const updates: Array<{ filter: any; update: any }> = [];
  return {
    config: {
      environment,
      IdenfySessionModel: {
        updateOne: async (filter: any, update: any) => {
          updates.push({ filter, update });
          return {
            matchedCount: updateMatchedCount,
            modifiedCount: updateMatchedCount,
          };
        },
        findById: (_id: any) => ({
          exec: async () => (reReadDoc ? { toObject: () => reReadDoc } : null),
        }),
      },
    } as any,
    updates,
  };
}

function expiredSession(overrides: Partial<any> = {}) {
  return {
    _id: "idenfy-row-1",
    sigDigest: "sig",
    idenfyAuthToken: "AUTH_OLD",
    idenfyScanRef: "SCAN_OLD",
    idenfyVerificationStatus: "EXPIRED",
    status: "failed",
    createdByFlow: "gov-id",
    createdBySessionId: "parent-session-1",
    recreationCount: 0,
    ...overrides,
  } as any;
}

describe("tryAcquireIdenfyRecreateLock / releaseIdenfyRecreateLock", () => {
  it("first acquire succeeds, second (held) fails, release frees it", async () => {
    expect(await tryAcquireIdenfyRecreateLock("row-1", "live")).toBe(true);
    expect(await tryAcquireIdenfyRecreateLock("row-1", "live")).toBe(false);
    await releaseIdenfyRecreateLock("row-1", "live");
    expect(await tryAcquireIdenfyRecreateLock("row-1", "live")).toBe(true);
  });

  it("sandbox and live use distinct keys", async () => {
    expect(await tryAcquireIdenfyRecreateLock("row-1", "live")).toBe(true);
    // sandbox key is different, so it is still free
    expect(await tryAcquireIdenfyRecreateLock("row-1", "sandbox")).toBe(true);
  });
});

describe("getIdenfyStatusForSession — EXPIRED recovery", () => {
  it("cached EXPIRED under cap mints a fresh session and returns it (not EXPIRED)", async () => {
    const { config, updates } = makeConfig("live");
    const result: any = await getIdenfyStatusForSession(config, expiredSession());

    expect(tokenCalls).toBe(1);
    expect(result.idenfyAuthToken).toBe("AUTH_NEW_1");
    expect(result.idenfyScanRef).toBe("SCAN_NEW_1");
    expect(result.status).toBe("in_progress");
    expect(result.idenfyVerificationStatus).toBeNull();
    expect(result.recreationCount).toBe(1);

    // persisted: $set new token + $inc recreationCount, conditional on old scanRef
    expect(updates.length).toBe(1);
    expect(updates[0].update.$set.idenfyAuthToken).toBe("AUTH_NEW_1");
    expect(updates[0].update.$inc).toEqual({ recreationCount: 1 });
    expect(updates[0].filter.idenfyScanRef).toBe("SCAN_OLD");

    // lock was released
    expect(await tryAcquireIdenfyRecreateLock("idenfy-row-1", "live")).toBe(true);
  });

  it("freshly fetched EXPIRED persists an EXPIRED sentinel, then recovers, never writing failed", async () => {
    statusToReturn = "EXPIRED";
    const { config, updates } = makeConfig("live");
    // no cached verification status -> falls through to /api/v2/status poll
    const result: any = await getIdenfyStatusForSession(
      config,
      expiredSession({ idenfyVerificationStatus: undefined, status: "in_progress" })
    );

    expect(tokenCalls).toBe(1);
    expect(result.idenfyAuthToken).toBe("AUTH_NEW_1");
    // First write is the sentinel (verification-status only — NOT status:failed),
    // so concurrent pollers + the cap short-circuit see authoritative state.
    expect(updates[0].update.$set).toEqual({ idenfyVerificationStatus: "EXPIRED" });
    // Second write is the re-mint.
    expect(updates[1].update.$set.idenfyAuthToken).toBe("AUTH_NEW_1");
    expect(updates[1].update.$set.status).toBe("in_progress");
    // The row is never left in status:"failed".
    expect(updates.some((u) => u.update.$set && u.update.$set.status === "failed")).toBe(false);
  });

  it("0-match re-mint returns persisted peer state, not the orphaned billed token", async () => {
    // Simulate the TTL-overrun race: our updateOne matches 0 rows because a peer
    // already re-minted and advanced the scanRef. The re-read returns the peer's
    // fresh row; we must return THAT, not our just-minted (orphaned) token.
    const peerRow = expiredSession({
      idenfyVerificationStatus: null,
      status: "in_progress",
      idenfyAuthToken: "AUTH_PEER",
      idenfyScanRef: "SCAN_PEER",
      recreationCount: 1,
    });
    const { config } = makeConfig("live", peerRow, 0); // updateOne matchedCount = 0
    const result: any = await getIdenfyStatusForSession(config, expiredSession());

    expect(tokenCalls).toBe(1); // a token was minted (billed) ...
    expect(result.idenfyAuthToken).toBe("AUTH_PEER"); // ... but we return the persisted peer token
    expect(result.idenfyAuthToken).not.toBe("AUTH_NEW_1"); // never the orphaned one
    // lock released even on the 0-match path
    expect(await tryAcquireIdenfyRecreateLock("idenfy-row-1", "live")).toBe(true);
  });

  it("at the cap, returns EXPIRED and does NOT mint", async () => {
    const { config, updates } = makeConfig("live");
    const result: any = await getIdenfyStatusForSession(
      config,
      expiredSession({ recreationCount: 10 })
    );

    expect(tokenCalls).toBe(0);
    expect(result.idenfyVerificationStatus).toBe("EXPIRED");
    expect(updates.length).toBe(0);
  });

  it("overshoot self-heals: recreationCount > cap still returns EXPIRED", async () => {
    const { config } = makeConfig("live");
    const result: any = await getIdenfyStatusForSession(
      config,
      expiredSession({ recreationCount: 11 })
    );
    expect(tokenCalls).toBe(0);
    expect(result.idenfyVerificationStatus).toBe("EXPIRED");
  });

  it("lock-miss (peer minting) returns pending with the stale token withheld", async () => {
    // Simulate a peer holding the lock for this row.
    await tryAcquireIdenfyRecreateLock("idenfy-row-1", "live");
    // Re-read still shows expired (peer hasn't written yet).
    const { config } = makeConfig("live", expiredSession());
    const result: any = await getIdenfyStatusForSession(config, expiredSession());

    expect(tokenCalls).toBe(0); // did not mint a second session
    expect(result.idenfyVerificationStatus).toBeNull(); // pending, not EXPIRED
    expect(result.idenfyAuthToken).toBeNull(); // stale token withheld
    expect(result.idenfyScanRef).toBeNull();
  });

  it("lock-miss returns the refreshed row when the peer already re-minted", async () => {
    await tryAcquireIdenfyRecreateLock("idenfy-row-1", "live");
    const refreshed = expiredSession({
      idenfyVerificationStatus: null,
      status: "in_progress",
      idenfyAuthToken: "AUTH_PEER",
      idenfyScanRef: "SCAN_PEER",
      recreationCount: 1,
    });
    const { config } = makeConfig("live", refreshed);
    const result: any = await getIdenfyStatusForSession(config, expiredSession());

    expect(tokenCalls).toBe(0);
    expect(result.idenfyAuthToken).toBe("AUTH_PEER");
    expect(result.status).toBe("in_progress");
  });

  it("iDenfy token API error returns EXPIRED, does not mutate, and releases the lock", async () => {
    tokenShouldThrow = true;
    const { config, updates } = makeConfig("live");
    const result: any = await getIdenfyStatusForSession(config, expiredSession());

    expect(tokenCalls).toBe(1);
    expect(result.idenfyVerificationStatus).toBe("EXPIRED");
    expect(updates.length).toBe(0); // no row mutation on failure
    // lock released despite the error
    expect(await tryAcquireIdenfyRecreateLock("idenfy-row-1", "live")).toBe(true);
  });
});

describe("getIdenfyStatusForSession — non-EXPIRED behavior unchanged", () => {
  it("cached APPROVED returns as-is, no lock, no token call", async () => {
    const { config, updates } = makeConfig("live");
    const result: any = await getIdenfyStatusForSession(
      config,
      expiredSession({ idenfyVerificationStatus: "APPROVED", status: "complete" })
    );
    expect(tokenCalls).toBe(0);
    expect(result.idenfyVerificationStatus).toBe("APPROVED");
    expect(updates.length).toBe(0);
    // no lock was taken for a plain status read
    expect(lockStore.size).toBe(0);
  });

  it("cached DENIED returns as-is, no recovery", async () => {
    const { config } = makeConfig("live");
    const result: any = await getIdenfyStatusForSession(
      config,
      expiredSession({ idenfyVerificationStatus: "DENIED", status: "failed" })
    );
    expect(tokenCalls).toBe(0);
    expect(result.idenfyVerificationStatus).toBe("DENIED");
  });

  it("cached SUSPECTED returns as-is, no recovery, no lock", async () => {
    const { config, updates } = makeConfig("live");
    const result: any = await getIdenfyStatusForSession(
      config,
      expiredSession({ idenfyVerificationStatus: "SUSPECTED", status: "failed" })
    );
    expect(tokenCalls).toBe(0);
    expect(result.idenfyVerificationStatus).toBe("SUSPECTED");
    expect(updates.length).toBe(0);
    expect(lockStore.size).toBe(0);
  });

  it("non-terminal fetched status (ACTIVE) persists and returns without minting or locking", async () => {
    statusToReturn = "ACTIVE";
    const { config, updates } = makeConfig("live");
    const result: any = await getIdenfyStatusForSession(
      config,
      expiredSession({ idenfyVerificationStatus: undefined, status: "in_progress" })
    );
    expect(tokenCalls).toBe(0);
    expect(result.idenfyVerificationStatus).toBe("ACTIVE");
    expect(updates.length).toBe(1);
    expect(updates[0].update.$set.idenfyVerificationStatus).toBe("ACTIVE");
    expect(lockStore.size).toBe(0); // no recreate lock for a plain poll
  });

  it("fetched APPROVED sets status complete", async () => {
    statusToReturn = "APPROVED";
    const { config, updates } = makeConfig("live");
    const result: any = await getIdenfyStatusForSession(
      config,
      expiredSession({ idenfyVerificationStatus: undefined, status: "in_progress" })
    );
    expect(result.idenfyVerificationStatus).toBe("APPROVED");
    expect(updates[0].update.$set.status).toBe("complete");
  });
});

describe("getIdenfyStatusForSession — Clean Hands (AML) shares the same path", () => {
  // The /session-status/v2 endpoint resolves both SessionModel (gov-id) and
  // AMLChecksSessionModel (clean-hands) and calls getIdenfyStatusForSession for
  // either — recovery keys on createdBySessionId, not the flow, so no code fork.
  it("a clean-hands EXPIRED row recovers identically to gov-id", async () => {
    const { config, updates } = makeConfig("live");
    const result: any = await getIdenfyStatusForSession(
      config,
      expiredSession({
        createdByFlow: "clean-hands",
        createdBySessionId: "aml-session-1",
      })
    );

    expect(tokenCalls).toBe(1);
    expect(result.idenfyAuthToken).toBe("AUTH_NEW_1");
    expect(result.status).toBe("in_progress");
    expect(result.recreationCount).toBe(1);
    expect(updates[0].update.$inc).toEqual({ recreationCount: 1 });
  });

  it("recreating one flow's row does not touch another row's lock", async () => {
    const govConfig = makeConfig("live");
    await getIdenfyStatusForSession(
      govConfig.config,
      expiredSession({ _id: "gov-row", createdBySessionId: "gov-parent" })
    );

    // The gov row's lock was acquired and released; a clean-hands row with a
    // different _id is independently lockable.
    expect(await tryAcquireIdenfyRecreateLock("gov-row", "live")).toBe(true);
    expect(await tryAcquireIdenfyRecreateLock("ch-row", "live")).toBe(true);
  });
});
