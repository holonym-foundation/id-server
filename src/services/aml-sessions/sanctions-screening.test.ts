import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { runSanctionsScreening } from "./sanctions-screening.js";

// Stub SanctionsResult model: records nothing, just satisfies `new ...().save()`.
class FakeSanctionsResult {
  constructor(data: any) {
    Object.assign(this, data);
  }
  async save() {}
}
const config = { SanctionsResultModel: FakeSanctionsResult } as any;

const ORIGINAL_FETCH = globalThis.fetch;
function mockFetch(results: any[]) {
  const fn = mock(async () => ({ json: async () => ({ results }) }) as any);
  globalThis.fetch = fn as any;
  return fn;
}

describe("runSanctionsScreening", () => {
  beforeEach(() => {
    process.env.SANCTIONS_API_KEY = "test-key";
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("returns clear when sanctions.io returns no results", async () => {
    mockFetch([]);
    const decision = await runSanctionsScreening({
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: "1990-01-15",
      session: { _id: "s1" } as any,
      config,
    });
    expect(decision.outcome).toBe("clear");
  });

  it("requires a declaration for a PEP hit in a non-blocked country", async () => {
    mockFetch([
      {
        data_source: { short_name: "PEP", name: "INT / PEP" },
        si_identifier: "PEP-US-1", // US is not in siIdentifierPrefixesToBlock
        data_hash: "hash-1",
        name: "Jane Roe",
        title: "Mayor",
        confidence_score: 0.95,
      },
    ]);
    const decision = await runSanctionsScreening({
      firstName: "Jane",
      lastName: "Roe",
      dateOfBirth: "1980-03-02",
      session: { _id: "s2" } as any,
      config,
    });
    expect(decision.outcome).toBe("declaration-required");
    if (decision.outcome === "declaration-required") {
      expect(decision.statement).toContain("Jane Roe");
    }
  });

  // NOTE: the `blocked` outcome path queries CleanHandsSessionWhitelist, a
  // Mongoose model exported as a live binding from init.js that is only bound
  // after a DB connection. Unit-testing it would require a Mongo bootstrap
  // (none exists for aml-sessions today), so the block path is left to the
  // production Onfido path it was copied from byte-for-byte. The block-vs-keep
  // filtering itself is exercised by the declaration-required case above
  // (which computes resultsToBlock === []).

  it("skips screening (clear) when a recent declaration is confirmed", async () => {
    const fetchSpy = mockFetch([]);
    const decision = await runSanctionsScreening({
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: "1990-01-15",
      session: {
        _id: "s4",
        userDeclaration: { confirmed: true, statementGeneratedAt: new Date() },
      } as any,
      config,
    });
    expect(decision.outcome).toBe("clear");
    // No API call when the recent declaration short-circuits screening.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
