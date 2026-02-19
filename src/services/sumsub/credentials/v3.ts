import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import {
  getRouteHandlerConfig,
} from "../../../init.js";
import { pinoOptions, logger } from "../../../utils/logger.js";
import { sessionStatusEnum } from "../../../constants/misc.js";
import {
  getSumsubApplicantData,
  getSumsubDuplicateCheck,
} from "../../../utils/sumsub.js";
import {
  findOneUserVerificationLast11Months,
  findOneUserVerification11Months5Days,
} from "../../../utils/user-verifications.js";
import { failSession } from "../../../utils/sessions.js";
import { findOneNullifierAndCredsLast5Days } from "../../../utils/nullifier-and-creds.js";
import { issuev2KYC } from "../../../utils/issuance.js";
import { toAlreadyRegisteredStr, makeUnknownErrorLoggable } from "../../../utils/errors.js";
import {
  validateSumsubReview,
  uuidOldFromSumsubApplicant,
  uuidNewFromSumsubApplicant,
  extractCreds,
  saveCollisionMetadata,
  saveUserToDb,
  updateSessionStatus,
} from "./utils.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../../types.js";

const endpointLoggerV3 = logger.child({
  msgPrefix: "[GET /sumsub/v3/credentials] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "sumsub",
    feature: "holonym",
    subFeature: "gov-id",
  },
});

/**
 * Credentials V3 endpoint for Sumsub.
 * Mirrors the Onfido v3 credentials endpoint pattern:
 * - Supports 5-day reissue window via NullifierAndCreds lookup
 * - Sybil resistance via govIdUUID (cross-provider) + Sumsub SIMILAR_SEARCH (defense-in-depth)
 * - Credential format identical to Onfido output
 */
function createGetCredentialsV3(config: SandboxVsLiveKYCRouteHandlerConfig) {
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

      let objectId = null;
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
            applicantId: session.sumsub_applicant_id,
            session_status: session.status,
            failure_reason: session.verificationFailureReason,
          },
          "Session verification previously failed"
        );
        return res.status(400).json({
          error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
        });
      }

      // First, check if the user is looking up their credentials using their nullifier
      const nullifierAndCreds = await findOneNullifierAndCredsLast5Days(
        config.NullifierAndCredsModel,
        issuanceNullifier
      );
      const applicantIdFromNullifier = nullifierAndCreds?.idvSessionIds?.sumsub?.applicantId;
      if (applicantIdFromNullifier) {
        const applicantData = await getSumsubApplicantData(
          config.environment,
          applicantIdFromNullifier,
        );

        if (!applicantData) {
          endpointLoggerV3.error(
            { applicantId: applicantIdFromNullifier },
            "Failed to get Sumsub applicant data during nullifier lookup"
          );
          return res.status(400).json({
            error: "Unexpected error: Failed to retrieve Sumsub applicant data while executing lookup from nullifier branch.",
          });
        }

        // Note: validation of the Sumsub review is unnecessary here. The applicant ID
        // should not have been stored if the review didn't pass validation.

        // Get UUIDs
        const uuidOld = uuidOldFromSumsubApplicant(applicantData);
        const uuidNew = uuidNewFromSumsubApplicant(applicantData);

        // Assert user hasn't registered yet (extra safety — see Onfido v3 creds issuance route for rationale)
        if (config.environment === "live") {
          const user = await findOneUserVerification11Months5Days(uuidOld, uuidNew);
          if (user) {
            await saveCollisionMetadata(uuidOld, uuidNew, applicantIdFromNullifier);
            endpointLoggerV3.error(
              { uuidV2: uuidNew },
              "User has already registered"
            );
            await failSession(session, toAlreadyRegisteredStr(user._id.toString()));
            return res.status(400).json({ error: toAlreadyRegisteredStr(user._id.toString()) });
          }
        }

        const creds = extractCreds(applicantData);
        const response = issuev2KYC(config.issuerPrivateKey, issuanceNullifier, creds);
        response.metadata = creds;

        endpointLoggerV3.info(
          { uuidV2: uuidNew, applicantId: applicantIdFromNullifier },
          "Issuing credentials (nullifier lookup)"
        );

        await updateSessionStatus(
          config.SessionModel,
          applicantIdFromNullifier,
          sessionStatusEnum.ISSUED
        );

        return res.status(200).json(response);
      }

      // No nullifier match — use session's applicant ID
      const applicantId = session.sumsub_applicant_id;
      if (!applicantId) {
        return res.status(400).json({ error: "Unexpected: No sumsub_applicant_id in session" });
      }

      // If the session isn't in progress, we do not issue credentials. If the session is ISSUED,
      // then the lookup via nullifier should have worked above.
      if (session.status !== sessionStatusEnum.IN_PROGRESS) {
        return res.status(400).json({
          error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
        });
      }

      const applicantData = await getSumsubApplicantData(
        config.environment,
        applicantId,
      );

      if (!applicantData) {
        endpointLoggerV3.error(
          { applicantId },
          "Failed to get Sumsub applicant data"
        );
        return res.status(400).json({
          error: "Unexpected error: Failed to retrieve Sumsub applicant data.",
        });
      }

      // Validate that the review is complete and approved
      const reviewValidation = validateSumsubReview(applicantData);
      if (!reviewValidation.success) {
        endpointLoggerV3.error(
          reviewValidation.log?.data,
          reviewValidation.log?.msg || "Sumsub review validation failed"
        );
        await failSession(session, reviewValidation.error as string);
        return res.status(400).json({ error: reviewValidation.error });
      }

      // Sumsub-native duplicate check (defense-in-depth on top of govIdUUID)
      // See: https://docs.sumsub.com/reference/get-duplicate-applicants-check-result
      if (config.environment === "live") {
        try {
          const duplicateCheck = await getSumsubDuplicateCheck(
            config.environment,
            applicantId,
          );
          if (duplicateCheck?.answer === "RED") {
            const duplicateApplicants = duplicateCheck.similarSearchInfo?.duplicateApplicantHits || [];
            endpointLoggerV3.error(
              { applicantId, duplicateApplicants },
              "Sumsub duplicate check failed — applicant is a duplicate"
            );
            await failSession(session, "Duplicate applicant detected by Sumsub");
            return res.status(400).json({
              error: "Verification failed: duplicate applicant detected.",
            });
          }
        } catch (err) {
          // Log but don't block issuance if the duplicate check API fails.
          // Our own govIdUUID check below still provides Sybil resistance.
          endpointLoggerV3.warn(
            { applicantId, error: makeUnknownErrorLoggable(err) },
            "Sumsub duplicate check API call failed — proceeding with govIdUUID check only"
          );
        }
      }

      const creds = extractCreds(applicantData);
      const uuidOld = uuidOldFromSumsubApplicant(applicantData);
      const uuidNew = uuidNewFromSumsubApplicant(applicantData);

      // Assert user hasn't registered yet
      if (config.environment === "live") {
        const user = await findOneUserVerificationLast11Months(uuidOld, uuidNew);
        if (user) {
          await saveCollisionMetadata(uuidOld, uuidNew, applicantId);
          endpointLoggerV3.error(
            { uuidV2: uuidNew },
            "User has already registered"
          );
          await failSession(session, toAlreadyRegisteredStr(user._id.toString()));
          return res.status(400).json({ error: toAlreadyRegisteredStr(user._id.toString()) });
        }
      }

      // Store UUID for Sybil resistance
      const dbResponse = await saveUserToDb(uuidNew, applicantId);
      if (dbResponse.error) return res.status(400).json(dbResponse);

      const response = issuev2KYC(config.issuerPrivateKey, issuanceNullifier, creds);
      response.metadata = creds;

      endpointLoggerV3.info({ uuidV2: uuidNew, applicantId }, "Issuing credentials");

      // Store nullifier-creds mapping for 5-day reissue window
      const newNullifierAndCreds = new config.NullifierAndCredsModel({
        holoUserId: session.sigDigest,
        issuanceNullifier,
        uuidV2: uuidNew,
        idvSessionIds: {
          sumsub: {
            applicantId,
          },
        },
      });
      await newNullifierAndCreds.save();

      await updateSessionStatus(config.SessionModel, applicantId, sessionStatusEnum.ISSUED);

      // NOTE: Sumsub does not support immediate applicant deletion like Onfido.
      // Sumsub offers "deactivate" and "reset" endpoints, but neither guarantees
      // immediate PII removal (30-day window per their privacy notice).
      // See: https://docs.sumsub.com/reference/deactivate-applicant-profile

      return res.status(200).json(response);
    } catch (err: any) {
      if (err.status && err.error) {
        return res.status(err.status).json(err);
      }

      endpointLoggerV3.error(
        {
          error: makeUnknownErrorLoggable(err),
        },
        "Unexpected error occurred"
      );

      return res.status(500).json({
        error: "An unexpected error occurred.",
      });
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
