// Allowed idOS credential issuers. Used by the credentials endpoint to
// verify the issuer signature on a granted credential before normalizing
// fields. Keeping this small and explicit means an attacker who has
// somehow surfaced a valid grant cannot smuggle in a credential signed by
// an unknown issuer.
//
// The shape matches @idos-network/credentials/types `AvailableIssuerType`
// (specifically the `CustomIssuerType` variant: { issuer, publicKeyMultibase
// }). Real values come from env so prod / staging / sandbox can each pin
// their own issuer set without a code change.
//
// Env vars:
//   IDOS_ALLOWED_ISSUERS_JSON          JSON array of {issuer,
//                                      publicKeyMultibase}. Wins over the
//                                      single-issuer pair below.
//   IDOS_ALLOWED_ISSUER                Single issuer DID/identifier.
//   IDOS_ALLOWED_ISSUER_PUBLIC_KEY     Multibase-encoded public key for
//                                      IDOS_ALLOWED_ISSUER.
//
// At least one issuer must be configured before the credentials endpoint
// will accept a credential — see assertAllowedIssuersConfigured below.

import type { AvailableIssuerType } from "@idos-network/consumer";

interface CustomIssuerType {
  issuer: string;
  publicKeyMultibase: string;
}

let cached: AvailableIssuerType[] | null = null;

function parseFromJsonEnv(): CustomIssuerType[] | null {
  const raw = process.env.IDOS_ALLOWED_ISSUERS_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("IDOS_ALLOWED_ISSUERS_JSON must be a JSON array");
    }
    for (const entry of parsed) {
      if (
        !entry ||
        typeof entry.issuer !== "string" ||
        typeof entry.publicKeyMultibase !== "string"
      ) {
        throw new Error(
          "IDOS_ALLOWED_ISSUERS_JSON entries must be { issuer: string, publicKeyMultibase: string }"
        );
      }
    }
    return parsed as CustomIssuerType[];
  } catch (err) {
    throw new Error(
      `IDOS_ALLOWED_ISSUERS_JSON could not be parsed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

function parseFromPairEnv(): CustomIssuerType[] | null {
  const issuer = process.env.IDOS_ALLOWED_ISSUER;
  const publicKeyMultibase = process.env.IDOS_ALLOWED_ISSUER_PUBLIC_KEY;
  if (!issuer || !publicKeyMultibase) return null;
  return [{ issuer, publicKeyMultibase }];
}

export function getAllowedIssuers(): AvailableIssuerType[] {
  if (cached) return cached;
  const issuers = parseFromJsonEnv() ?? parseFromPairEnv();
  if (!issuers || issuers.length === 0) {
    throw new Error(
      "No idOS allowed issuers configured. Set IDOS_ALLOWED_ISSUERS_JSON or both IDOS_ALLOWED_ISSUER and IDOS_ALLOWED_ISSUER_PUBLIC_KEY."
    );
  }
  cached = issuers as unknown as AvailableIssuerType[];
  return cached;
}

/** Test-only: clear the cache so subsequent calls re-read env vars. */
export function __resetIdosAllowedIssuersForTests() {
  cached = null;
}
