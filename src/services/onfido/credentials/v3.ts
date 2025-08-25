import { Request, Response } from "express";
import { HydratedDocument } from "mongoose";
import {
  NullifierAndCreds,
} from "../../../init.js";
import { pinoOptions, logger } from "../../../utils/logger.js";
import { sessionStatusEnum } from "../../../constants/misc.js";
import {
  getOnfidoCheck,
  getOnfidoReports,
  deleteOnfidoApplicant,
} from "../../../utils/onfido.js";
import {
  findOneUserVerificationLast11Months,
  findOneUserVerification11Months5Days
} from "../../../utils/user-verifications.js"
import { getSessionById, failSession } from "../../../utils/sessions.js";
import { findOneNullifierAndCredsLast5Days } from "../../../utils/nullifier-and-creds.js";
import { issuev2KYC } from "../../../utils/issuance.js";
import { toAlreadyRegisteredStr } from "../../../utils/errors.js"
import { upgradeV3Logger, ValidationResult } from "./error-logger.js";
import {
  validateCheck,
  validateReports,
  onfidoValidationToUserErrorMessage,
  uuidOldFromOnfidoReport,
  uuidNewFromOnfidoReport,
  extractCreds,
  saveCollisionMetadata,
  saveUserToDb,
  getSession,
  updateSessionStatus,
} from "./utils.js"
import { ISession, OnfidoDocumentReport, OnfidoReport } from "../../../types.js";

const endpointLoggerV3 = upgradeV3Logger(logger.child({
  msgPrefix: "[GET /onfido/v3/credentials] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "onfido",
    feature: "holonym",
    subFeature: "gov-id",
  },
}));

/**
 * ENDPOINT
 *
 * Allows user to retrieve their signed verification info.
 * 
 * Compared to the v1 and v2 endpoints, this one allows the user to get their
 * credentials up to 5 days after initial issuance, if they provide the
 * same nullifier.
 */
export async function getCredentialsV3(req: Request, res: Response) {
  try {
    // Caller must specify a session ID and a nullifier. We first lookup the user's creds
    // using the nullifier. If no hit, then we lookup the credentials using the session ID.
    const _id = req.params._id;
    const issuanceNullifier = req.params.nullifier;
    
    try {
      const _number = BigInt(issuanceNullifier)
    } catch (err) {
      return res.status(400).json({
        error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`
      });
    }

    // if (process.env.ENVIRONMENT == "dev") {
    //   const creds = newDummyUserCreds;
    //   const response = issuev2KYC(issuanceNullifier, creds);
    //   response.metadata = newDummyUserCreds;
    //   return res.status(200).json(response);
    // }

    // const { session, error: getSessionError } = await getSessionById(_id);
    const getSessionResult = await getSessionById(_id);
    if (getSessionResult.error) {
      return res.status(400).json({ error: getSessionResult.error });
    }
    const session = getSessionResult.session as HydratedDocument<ISession>;

    if (session.status === sessionStatusEnum.VERIFICATION_FAILED) {
      endpointLoggerV3.verificationPreviouslyFailed(session.check_id as string, session)
      return res.status(400).json({
        error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
      });
    }

    // First, check if the user is looking up their credentials using their nullifier
    const nullifierAndCreds = await findOneNullifierAndCredsLast5Days(issuanceNullifier);
    const checkIdFromNullifier = nullifierAndCreds?.idvSessionIds?.onfido?.check_id
    if (checkIdFromNullifier) {
      const check = await getOnfidoCheck(checkIdFromNullifier);
      
      if (!check) {
        endpointLoggerV3.failedToGetCheck(checkIdFromNullifier);
        return res.status(400).json({
          error: "Unexpected error: Failed to retrieve Onfido check while executing lookup from nullifier branch."
        });
      }

      const reports = await getOnfidoReports(check.report_ids);

      if (!reports || reports.length == 0) {
        endpointLoggerV3.failedToGetReports(checkIdFromNullifier, check.report_ids);
        return res.status(400).json({
          error: "Unexpected error: Failed to retrieve Onfido reports while executing lookup from nullifier branch."
        });
      }

      // Note that validation of the Onfido checks and reports is unnecessary here. The
      // Onfido check ID should not have been stored if the corresponding checks and
      // reports didn't pass validation.

      const documentReport = reports.find((report) => report.name == "document");

      if (!documentReport) {
        endpointLoggerV3.noDocumentReport(reports)
        return res.status(400).json({
          error: "Unexpected error: Failed to get Onfido document report while executing lookup from nullifier branch."
        });
      }

      // Get UUID
      const uuidOld = uuidOldFromOnfidoReport(documentReport);
      const uuidNew = uuidNewFromOnfidoReport(documentReport);

      // Assert user hasn't registered yet.
      // This step is not strictly necessary since we are only considering nullifiers
      // from the last 5 days (in the nullifierAndCreds query above) and the user
      // is only getting the credentials+nullifier that they were already issued.
      // However, we keep it here to be extra safe.
      const user = await findOneUserVerification11Months5Days(uuidOld, uuidNew);
      if (user) {
        await saveCollisionMetadata(uuidOld, uuidNew, checkIdFromNullifier, documentReport);
        endpointLoggerV3.alreadyRegistered(uuidNew);
        await failSession(session, toAlreadyRegisteredStr(user._id.toString()))
        return res.status(400).json({ error: toAlreadyRegisteredStr(user._id.toString()) });
      }

      const creds = extractCreds(documentReport);
      const response = issuev2KYC(issuanceNullifier, creds);
      response.metadata = creds;

      endpointLoggerV3.info({ uuidV2: uuidNew, check_id: checkIdFromNullifier }, "Issuing credentials");

      await updateSessionStatus(checkIdFromNullifier, sessionStatusEnum.ISSUED);

      return res.status(200).json(response);
    }

    const check_id = session.check_id;
    if (!check_id) {
      return res.status(400).json({ error: "Unexpected: No onfido check_id in session" });
    }

    // If the session isn't in progress, we do not issue credentials. If the session is ISSUED,
    // then the lookup via nullifier should have worked above.
    if (session.status !== sessionStatusEnum.IN_PROGRESS) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
      });
    }

    const check = await getOnfidoCheck(check_id);
    const validationResultCheck = validateCheck(check);
    if (!validationResultCheck.success && !validationResultCheck.hasReports) {
      endpointLoggerV3.checkValidationFailed(validationResultCheck as ValidationResult)
      await failSession(session, validationResultCheck.error as string)
      return res.status(400).json({
        error: validationResultCheck.error,
        details: validationResultCheck.log?.data
      });
    }

    const reports = await getOnfidoReports(check.report_ids) as Array<OnfidoReport>;
    if (!validationResultCheck.success && (!reports || reports.length == 0)) {
      endpointLoggerV3.noReportsFound(check_id, check.report_ids)

      await failSession(session, "No onfido reports found")
      return res.status(400).json({ error: "No reports found" });
    }
    const reportsValidation = validateReports(reports, session);
    if (validationResultCheck.error || reportsValidation.error) {
      const userErrorMessage = onfidoValidationToUserErrorMessage(
        reportsValidation,
        validationResultCheck
      )
      endpointLoggerV3.verificationFailed(check_id, reportsValidation)
      await failSession(session, userErrorMessage)

      throw {
        status: 400,
        error: userErrorMessage,
        details: {
          reasons: reportsValidation.reasons,
        },
      };
    }

    const documentReport = reports.find((report) => report.name == "document") as OnfidoDocumentReport; 
    if (!documentReport) {
      endpointLoggerV3.noDocumentReport(reports)
      return res.status(400).json({
        error: "Unexpected error: Failed to get Onfido document report while executing lookup from nullifier branch."
      });
    }
    // Get UUID
    const uuidOld = uuidOldFromOnfidoReport(documentReport);
    const uuidNew = uuidNewFromOnfidoReport(documentReport);

    // We started using a new UUID generation method on May 24, 2024, but we still
    // want to check the database for the old UUIDs too.

    // Assert user hasn't registered yet
    const user = await findOneUserVerificationLast11Months(uuidOld, uuidNew);
    if (user) {
      await saveCollisionMetadata(uuidOld, uuidNew, check_id, documentReport);

      endpointLoggerV3.alreadyRegistered(uuidNew);
      await failSession(session, toAlreadyRegisteredStr(user._id.toString()))
      return res.status(400).json({ error: toAlreadyRegisteredStr(user._id.toString()) });
    }

    // Store UUID for Sybil resistance
    const dbResponse = await saveUserToDb(uuidNew, check_id);
    if (dbResponse.error) return res.status(400).json(dbResponse);

    const creds = extractCreds(documentReport);
    const response = issuev2KYC(issuanceNullifier, creds);
    response.metadata = creds;

    endpointLoggerV3.info({ uuidV2: uuidNew, check_id }, "Issuing credentials");

    // It's important that an Onfido check ID gets associated with a nullifier ONLY
    // if the Onfido check results in successful issuance. Otherwise, a user might
    // fail verification with one session, pass with another, and when they query this
    // endpoint, they might not be able to get creds because their initial session failed.
    const newNullifierAndCreds = new NullifierAndCreds({
      holoUserId: session.sigDigest,
      issuanceNullifier,
      uuidV2: uuidNew,
      idvSessionIds: {
        onfido: {
          check_id,
        },
      },
    });
    await newNullifierAndCreds.save();

    await updateSessionStatus(check_id, sessionStatusEnum.ISSUED);

    return res.status(200).json(response);
  } catch (err: any) {
    // If this is our custom error, use its properties
    if (err.status && err.error) {
      return res.status(err.status).json(err);
    }

    // Otherwise, log the unexpected error
    endpointLoggerV3.unexpected(err)

    return res.status(500).json({
      error: "An unexpected error occurred.",
    });
  }
}
