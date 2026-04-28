---
module: kyc-issuance
date: 2026-04-28
problem_type: security_issue
component: authentication
severity: high
related_components:
  - zk-passport
  - onfido
  - sumsub
tags:
  - sandbox
  - kyc
  - sybil-resistance
  - userverifications
  - zk-passport
  - onfido
  - sumsub
symptoms:
  - "Sandbox KYC issuance writes to the live UserVerifications collection, polluting prod sybil-resistance state"
  - "Sandbox off-chain attestation endpoint returns ALREADY_REGISTERED for identities only present in live data"
  - "A user who verified in live cannot exercise the sandbox flow with the same passport"
root_cause: scope_issue
resolution_type: code_fix
---

# Sandbox KYC endpoints leak into the live UserVerifications collection

## Problem

There is only one global `UserVerifications` mongoose model (`src/init.ts:270`) — there is no `SandboxUserVerifications`. Several sandbox KYC issuance paths wrote to it unconditionally, and one even returned `ALREADY_REGISTERED` errors against it. That meant sandbox runs polluted live sybil-resistance state, and live verifications could block sandbox flows for the same identity.

## Symptoms

- Sandbox runs of `POST /zk-passport/verify-and-issue`, `POST /off-chain-attestations/zk-passport`, `GET /onfido/credentials/v3/...`, and `GET /sumsub/credentials/v3/...` all created `UserVerifications` documents in the same collection used by live.
- Sandbox off-chain attestation also returned `409 ALREADY_REGISTERED` when the identity was present in the live collection — sandbox flows were unrunnable for any previously-verified identity.

## Solution

Gate every `UserVerifications` write and every cross-collection existing-user check on `config.environment === "live"`. Sandbox-specific collections (sandbox `OffChainAttestation`, `Session`, `ZkPassportSession`, `NullifierAndCreds`) are already separate via `getRouteHandlerConfig("sandbox")`, so per-flow sandbox state (per-address attestation dedup, nullifier-recovery within 5 days) keeps working.

Files changed:

- `src/services/zk-passport/verify-and-issue.ts` — wrap `saveUserToDb(uuidV2)` in `if (config.environment === "live")`. The two `findUserVerification` "already registered" checks were already gated.
- `src/services/zk-passport/off-chain-attestation.ts` — wrap both Dedup #2 (`findUserVerification` + `ALREADY_REGISTERED` response) and the `new UserVerifications({...}).save()` write in `if (config.environment === "live")`.
- `src/services/onfido/credentials/v3.ts` — wrap `saveUserToDb(uuidNew, check_id)` in `if (config.environment == "live")`. Existing-user check was already gated.
- `src/services/sumsub/credentials/v3.ts` — wrap `saveUserToDb(uuidNew, applicantId)` in `if (config.environment === "live")`. Existing-user check was already gated.

Onfido v1/v2 do not need the same fix — `src/routes/onfido.ts:23-24` only mounts them on the prod router.

Pattern in the diff:

```ts
// Before
const dbResponse = await saveUserToDb(uuidNew, check_id);
if (dbResponse.error) return res.status(400).json(dbResponse);

// After
if (config.environment === "live") {
  const dbResponse = await saveUserToDb(uuidNew, check_id);
  if (dbResponse.error) return res.status(400).json(dbResponse);
}
```

## Why This Works

Sandbox and live share a single `UserVerifications` collection, so writes from sandbox sessions leak into live sybil state and reads from sandbox can see live data. Gating both the read and write on environment makes sandbox behave as a true sandbox: it never observes or mutates the live identity store. Sandbox-specific collections continue to provide per-environment dedup so the sandbox flow remains internally consistent (recovery branches, per-address attestation dedup).

The original gating was inconsistent: existing-user checks were gated on `live` in most places, but the corresponding writes were not — half-fixing the issue and leaving the more harmful side (writes) unguarded.

## Prevention

- When adding a new KYC issuance path, the rule is: any `UserVerifications` read or write must be gated on `config.environment === "live"`. Sandbox writes to the global collection are always a bug.
- Audit checklist for any new sandbox/live-paired endpoint: grep for `UserVerifications`, `findUserVerification`, and `saveUserToDb` in the handler; each call site must either be inside an `environment === "live"` branch or use a sandbox-specific model from `config`.
- Longer-term: introduce a `SandboxUserVerifications` model so sandbox can run its own sybil resistance independently. Until then, sandbox provides no cross-flow sybil resistance — that's an accepted trade-off documented here.
- Note: AML sessions (`src/services/aml-sessions/endpoints.ts:2389,2823`) still call `saveUserToDb(uuid)` unconditionally. They were not in the scope of this fix but likely have the same bug — audit before relying on AML sandbox.
