# Off-Chain Attestations

Off-chain attestations bind a verification result to a wallet address without writing anything on-chain. The address holds an attestation record in id-server's DB for a fixed lifetime; consumers query it by address.

Currently the only attestation type is `zk-passport`, issued from a verified ZK Passport proof.

## Routing

| Environment | Base path |
| --- | --- |
| Live    | `/off-chain-attestations` |
| Sandbox | `/sandbox/off-chain-attestations` |

Sandbox is functionally identical to live but reads/writes a separate Mongo collection (`sandboxoffchainattestations`).

## Endpoints

### `POST /off-chain-attestations/zk-passport`

Verifies a ZK Passport proof and, on success, creates an off-chain attestation for the given address. Lifetime is **7 days** from issuance.

Request body:

```json
{
  "address": "0x...",
  "zkp": {
    "proofs": [ /* zkPassport proofs array */ ],
    "queryResult": { /* zkPassport queryResult */ }
  }
}
```

`queryResult` must disclose at least `firstname`, `lastname`, and `birthdate`. `nationality` (or `issuing_country`) is optional but, if present, must be a supported country.

Responses:

- `201 Created` — attestation issued. Returns the attestation (see shape below).
- `400` — bad request. Codes: `MISSING_ADDRESS`, `INVALID_ADDRESS`, `ZK_PASSPORT_UNSUPPORTED_DOCUMENT`, plus uncoded validation errors (missing `zkp.proofs`, missing `zkp.queryResult`, undisclosed required fields). ZK Passport verification failures return a code from `classifyZkPassportError`.
- `409 Conflict` — codes:
  - `ALREADY_ATTESTED` — this address already has an unexpired zk-passport attestation.
  - `ALREADY_REGISTERED` — the disclosed identity (name + DOB) already has an unexpired `UserVerifications.govId` record from any flow within the last 11 months.
  - `CONCURRENT_REQUEST` — another in-flight request holds the address or passport lock; retry shortly.
- `429` — rate-limited. Limit is 10 POSTs per IP per 24h.
- `500` — DB write failure or unexpected error.

Side effect on success: a `UserVerifications` record is also written with `govId.createdByFlow = "free-zk-passport"` and the same `issuedAt` / `expiresAt` as the attestation. This blocks the same identity from re-verifying via this or other gov-id flows until expiry.

### `GET /off-chain-attestations/zk-passport?address=0x...`

Returns the **most recent** zk-passport attestation for `address`, expired or not. Callers decide whether an expired attestation means "reverify."

Responses:

- `200 OK` — attestation document (see shape below).
- `400` — codes: `MISSING_ADDRESS`, `INVALID_ADDRESS`.
- `404` — code: `NOT_FOUND`. No zk-passport attestation exists for this address.
- `500` — unexpected error.

### Attestation response shape

```json
{
  "address": "0x...",            // lowercased checksum-validated address
  "attestationType": "zk-passport",
  "payload": {
    "uniqueIdentifier": "..."    // zkPassport proof's uniqueIdentifier
  },
  "issuedAt": "2026-04-27T...Z",
  "expiresAt": "2026-05-04T...Z"
}
```

Consumers should treat `expiresAt <= now` as "needs reverification."

## DB schema

Collection: `offchainattestations` (live) / `sandboxoffchainattestations` (sandbox). Mongoose model `OffChainAttestation` / `SandboxOffChainAttestation`.

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | Mongo default. |
| `address` | String, required, lowercased | Wallet address the attestation is bound to. |
| `attestationType` | String, required | Discriminator. Currently only `"zk-passport"`. |
| `payload` | Mixed (subdoc), optional | Type-specific disclosed fields. For `zk-passport`: `{ uniqueIdentifier }`. |
| `issuedAt` | Date, defaults to `Date.now` | Set after the dedup lock is acquired, so it reflects the actual issuance time. |
| `expiresAt` | Date, required | `issuedAt + 7 days` for `zk-passport`. |

Index: `{ address: 1, attestationType: 1 }` (non-unique — multiple expired records per address are expected).

There is no TTL index; expired records are kept and filtered by `expiresAt > now` in queries.

## Dedup model

Two layers of dedup run inside Redis locks (`address` lock + `uniqueIdentifier` lock, both with a 30s TTL):

1. **Address dedup** — one unexpired attestation per `(address, attestationType)`.
2. **Identity dedup** — one unexpired `UserVerifications.govId` record per `uuidV2 = govIdUUID(firstName, lastName, dob)` within the last 11 months, across all gov-id flows.

The pre-lock check at the top of `POST` is an optimization; the authoritative checks run after the locks are held.
