import { describe, it } from "bun:test";

// TODO(U11): integration-style tests for getCredentialsV3Prod /
// getCredentialsV3Sandbox handlers. These require a mocked SessionModel,
// NullifierAndCredsModel, axios stub for fetchIdenfyVerificationData, and a
// stub issuerPrivateKey-aware issuev2KYC. The existing id-server test
// infrastructure does not yet provide these fixtures (see absence of
// services/sumsub/credentials/v3.test.ts and services/onfido/credentials/v3.test.ts).
//
// Coverage to add when fixtures land:
//   - happy path: APPROVED session + valid scanRef → 200 with v2KYC shape
//   - nullifier reuse within 5 days → cached creds, no re-fetch
//   - invalid ObjectId → 400
//   - invalid nullifier → 400
//   - VERIFICATION_FAILED session → 400
//   - session status != IN_PROGRESS → 404 "verification not complete"
//   - scanRef mismatch from /api/v2/data → 400 + alarming log
//   - verificationStatus != APPROVED → 400 + failSession
//   - sandbox + live parity for the same scenarios

describe("getCredentialsV3 (idenfy)", () => {
  it.skip("integration tests deferred to U11 (no mock infra in id-server)", () => {
    // Placeholder so the test file is non-empty and visible to bun test.
  });
});
