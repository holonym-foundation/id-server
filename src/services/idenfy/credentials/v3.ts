import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getRouteHandlerConfig } from "../../../init.js";
import { pinoOptions, logger } from "../../../utils/logger.js";
import { sessionStatusEnum } from "../../../constants/misc.js";
import { findUserVerification } from "../../../utils/user-verifications.js";
import {
  dateElevenMonthsAgo,
  dateFiveDaysAgo,
} from "../../../utils/utils.js";
import { failSession } from "../../../utils/sessions.js";
import { findOneNullifierAndCredsLast5Days } from "../../../utils/nullifier-and-creds.js";
import { issuev2KYC } from "../../../utils/issuance.js";
import {
  toAlreadyRegisteredStr,
  makeUnknownErrorLoggable,
} from "../../../utils/errors.js";
import {
  extractCreds,
  uuidOldFromIdenfyData,
  uuidNewFromIdenfyData,
  saveCollisionMetadata,
  saveUserToDb,
  updateSessionStatus,
} from "./utils.js";
import { fetchIdenfyVerificationData } from "../data.js";
import { fetchIdenfyStatus } from "../status.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../../types.js";

const endpointLoggerV3 = logger.child({
  msgPrefix: "[GET /idenfy/v3/credentials] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "idenfy",
    feature: "holonym",
    subFeature: "gov-id",
  },
});

/**
 * Credentials V3 endpoint for iDenfy.
 *
 * Mirrors the Sumsub/Onfido v3 pattern:
 *   - Supports 5-day reissue window via NullifierAndCreds lookup.
 *   - Sybil resistance via shared govIdUUID (cross-provider).
 *   - Credential format identical to Onfido output (byte-for-byte).
 */
function createGetCredentialsV3(config: SandboxVsLiveKYCRouteHandlerConfig) {
  const sandbox = config.environment === "sandbox";

  return async (req: Request, res: Response) => {
    try {
      const _id = req.params._id;
      const issuanceNullifier = req.params.nullifier;

      try {
        BigInt(issuanceNullifier);
      } catch (err) {
        return res.status(400).json({
          error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`,
        });
      }

      let objectId: ObjectId;
      try {
        objectId = new ObjectId(_id);
      } catch (err) {
        return res.status(400).json({ error: "Invalid _id" });
      }

      const session = await config.SessionModel.findOne({ _id: objectId }).exec();
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (session.status === sessionStatusEnum.VERIFICATION_FAILED) {
        endpointLoggerV3.error(
          {
            idenfySessionId: session.idenfySessionId,
            session_status: session.status,
            failure_reason: session.verificationFailureReason,
          },
          "Session verification previously failed"
        );
        return res.status(400).json({
          error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
        });
      }

      // Step 1 — nullifier lookup branch (5-day reissue window).
      const nullifierAndCreds = await findOneNullifierAndCredsLast5Days(
        config.NullifierAndCredsModel,
        issuanceNullifier
      );
      const scanRefFromNullifier =
        (nullifierAndCreds?.idvSessionIds as any)?.idenfy?.scanRef;
      if (scanRefFromNullifier) {
        // Re-verify the cached scan is still APPROVED. A session that was
        // APPROVED → cached → later flipped to DENIED/SUSPECTED/EXPIRED
        // (status flap, manual review, fraud flag) must not re-issue creds
        // via this nullifier-reuse path.
        const statusResp = await fetchIdenfyStatus({
          scanRef: scanRefFromNullifier,
          sandbox,
        });
        const overall = statusResp.status;
        if (overall !== "APPROVED") {
          endpointLoggerV3.warn(
            { scanRef: scanRefFromNullifier, overall },
            "Nullifier-reuse branch: cached scan is no longer APPROVED; rejecting"
          );
          return res
            .status(400)
            .json({ error: `Verification not approved (status: ${overall ?? "unknown"})` });
        }

        const idenfyData = await fetchIdenfyVerificationData({
          scanRef: scanRefFromNullifier,
          sandbox,
        });

        const uuidOld = uuidOldFromIdenfyData(idenfyData);
        const uuidNew = uuidNewFromIdenfyData(idenfyData);

        if (config.environment === "live") {
          const user = await findUserVerification(uuidNew, "govId", {
            issuedAt: { after: dateElevenMonthsAgo(), before: dateFiveDaysAgo() },
            expiresAt: { after: new Date() },
          });
          if (user) {
            await saveCollisionMetadata(uuidOld, uuidNew, scanRefFromNullifier);
            endpointLoggerV3.error(
              { uuidV2: uuidNew },
              "User has already registered"
            );
            await failSession(session, toAlreadyRegisteredStr(user._id.toString()));
            return res
              .status(400)
              .json({ error: toAlreadyRegisteredStr(user._id.toString()) });
          }
        }

        const creds = extractCreds(idenfyData);
        const response = issuev2KYC(config.issuerPrivateKey, issuanceNullifier, creds);
        response.metadata = creds;

        endpointLoggerV3.info(
          { uuidV2: uuidNew, scanRef: scanRefFromNullifier },
          "Issuing credentials (nullifier lookup)"
        );

        await updateSessionStatus(
          config.SessionModel,
          scanRefFromNullifier,
          sessionStatusEnum.ISSUED
        );

        return res.status(200).json(response);
      }

      // Step 2 — session lookup branch.
      // Read scanRef from the standalone IIdenfySession via session.idenfySessionId.
      if (!session.idenfySessionId) {
        return res
          .status(400)
          .json({ error: "Unexpected: No idenfySessionId on session" });
      }
      const idenfySessionDoc = await config.IdenfySessionModel.findById(
        session.idenfySessionId
      ).exec();
      if (!idenfySessionDoc?.idenfyScanRef) {
        return res
          .status(400)
          .json({ error: "Unexpected: No idenfyScanRef on idenfy session" });
      }
      const scanRef = idenfySessionDoc.idenfyScanRef;

      // Webhook must have moved the session to IN_PROGRESS (APPROVED).
      // If still NEEDS_PAYMENT or otherwise pre-IN_PROGRESS, the verification
      // hasn't completed yet — return 400 (matches Onfido v3's behavior;
      // frontend retry policy treats 4xx alike, only retrying 429). Do NOT
      // flip session to VERIFICATION_FAILED.
      if (session.status !== sessionStatusEnum.IN_PROGRESS) {
        return res.status(400).json({
          error: `Verification not complete. Session status: '${session.status}'`,
        });
      }

      const idenfyData = await fetchIdenfyVerificationData({ scanRef, sandbox });

      // Defensive: data.ts already verifies scanRef equality, but keep the
      // explicit assertion for symmetry with Sumsub's review-validation step.
      if (idenfyData.scanRef !== scanRef) {
        endpointLoggerV3.error(
          { scanRef, returnedScanRef: idenfyData.scanRef },
          "iDenfy /api/v2/data scanRef does not match session"
        );
        return res
          .status(400)
          .json({ error: "iDenfy data scanRef does not match session scanRef" });
      }

      const statusResp = await fetchIdenfyStatus({ scanRef, sandbox });
      const overall = statusResp.status;
      if (overall !== "APPROVED") {
        const reason = `iDenfy verificationStatus is '${overall}'`;
        await failSession(session, reason);
        return res.status(400).json({ error: reason });
      }

      const creds = extractCreds(idenfyData);
      const uuidOld = uuidOldFromIdenfyData(idenfyData);
      const uuidNew = uuidNewFromIdenfyData(idenfyData);

      if (config.environment === "live") {
        const user = await findUserVerification(uuidNew, "govId", {
          issuedAt: { after: dateElevenMonthsAgo() },
          expiresAt: { after: new Date() },
        });
        if (user) {
          await saveCollisionMetadata(uuidOld, uuidNew, scanRef);
          endpointLoggerV3.error(
            { uuidV2: uuidNew },
            "User has already registered"
          );
          await failSession(session, toAlreadyRegisteredStr(user._id.toString()));
          return res
            .status(400)
            .json({ error: toAlreadyRegisteredStr(user._id.toString()) });
        }
      }

      // Store UUID for Sybil resistance. Skipped in sandbox so sandbox runs
      // do not pollute the live UserVerifications collection (matches Onfido
      // v3 sandbox semantics — see services/onfido/credentials/v3.ts:262).
      if (config.environment === "live") {
        const dbResponse = await saveUserToDb(uuidNew, scanRef);
        if ((dbResponse as any).error)
          return res.status(400).json(dbResponse);
      }

      const response = issuev2KYC(config.issuerPrivateKey, issuanceNullifier, creds);
      response.metadata = creds;

      endpointLoggerV3.info({ uuidV2: uuidNew, scanRef }, "Issuing credentials");

      const newNullifierAndCreds = new config.NullifierAndCredsModel({
        holoUserId: session.sigDigest,
        issuanceNullifier,
        uuidV2: uuidNew,
        idvSessionIds: {
          idenfy: { scanRef },
        },
      });
      await newNullifierAndCreds.save();

      await updateSessionStatus(
        config.SessionModel,
        scanRef,
        sessionStatusEnum.ISSUED
      );

      return res.status(200).json(response);
    } catch (err: any) {
      if (err.status && err.error) {
        return res.status(err.status).json(err);
      }
      endpointLoggerV3.error(
        { error: makeUnknownErrorLoggable(err) },
        "Unexpected error occurred"
      );
      return res.status(500).json({ error: "An unexpected error occurred." });
    }
  };
}

export async function getCredentialsV3Prod(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createGetCredentialsV3(config)(req, res);
}

export async function getCredentialsV3Sandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createGetCredentialsV3(config)(req, res);
}
