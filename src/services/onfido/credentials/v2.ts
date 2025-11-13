import { Request, Response } from "express";
import { pinoOptions, logger } from "../../../utils/logger.js";
import {
  newDummyUserCreds,
  countryCodeToPrime,
} from "../../../utils/constants.js";
import { sessionStatusEnum } from "../../../constants/misc.js";
import {
  getOnfidoCheck,
  getOnfidoReports,
  deleteOnfidoApplicant,
} from "../../../utils/onfido.js";
import {
  findOneUserVerificationLast11Months,
} from "../../../utils/user-verifications.js";
import { issuev2KYC } from "../../../utils/issuance.js";
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
import { OnfidoDocumentReport, OnfidoReport } from "../../../types.js";
import { getRouteHandlerConfig } from "../../../init.js";

const prodConfig = getRouteHandlerConfig("live")

const endpointLogger = logger.child({
  msgPrefix: "[GET /onfido/credentials] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "onfido",
    feature: "holonym",
    subFeature: "gov-id",
  },
});

/**
 * ENDPOINT
 *
 * Allows user to retrieve their signed verification info
 */
export async function getCredentialsV2(req: Request, res: Response) {
  try {
    const issuanceNullifier = req.params.nullifier;

    if (process.env.ENVIRONMENT == "dev") {
      const creds = newDummyUserCreds;
      const response = issuev2KYC(prodConfig.issuerPrivateKey, issuanceNullifier, creds);
      response.metadata = newDummyUserCreds;
      return res.status(200).json(response);
    }

    const check_id = req.query.check_id as string | undefined;
    if (!check_id) {
      throw {
        status: 400,
        error: "No check_id specified",
        details: null,
      };
    }

    const metaSession = await getSession(check_id);
    if (metaSession.status !== sessionStatusEnum.IN_PROGRESS) {
      if (metaSession.status === sessionStatusEnum.VERIFICATION_FAILED) {
        endpointLogger.error(
          {
            check_id,
            session_status: metaSession.status,
            failure_reason: metaSession.verificationFailureReason,
            tags: ["action:validateSession", "error:verificationFailed"],
          },
          "Session verification previously failed"
        );

        throw {
          status: 400,
          error: `Verification failed. Reason(s): ${metaSession.verificationFailureReason}`,
          details: null,
        };
      }

      throw {
        status: 400,
        error: `Session status is '${metaSession.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
        details: null,
      };
    }

    const check = await getOnfidoCheck(prodConfig.onfidoAPIKey, check_id);
    const validationResultCheck = validateCheck(check);
    if (!validationResultCheck.success && !validationResultCheck.hasReports) {
      endpointLogger.error(
        validationResultCheck.log?.data,
        validationResultCheck.log?.msg,
        {
          tags: ["action:validateSession", "error:verificationFailed"],
        }
      );
      await updateSessionStatus(
        prodConfig.SessionModel,
        check_id,
        sessionStatusEnum.VERIFICATION_FAILED,
        validationResultCheck.error
      );
      throw {
        status: 400,
        error: validationResultCheck.error,
        details: validationResultCheck.log?.data,
      };
    }

    const reports = await getOnfidoReports(prodConfig.onfidoAPIKey, check.report_ids);
    if (!validationResultCheck.success && (!reports || reports.length == 0)) {
      endpointLogger.error(
        {
          check_id,
          report_ids: check.report_ids ?? "unknown",
          tags: ["action:getReports", "error:noReportsFound"],
        },
        "No reports found"
      );

      await updateSessionStatus(
        prodConfig.SessionModel,
        check_id,
        sessionStatusEnum.VERIFICATION_FAILED,
        "No reports found"
      );
      throw {
        status: 400,
        error: "No reports found",
        details: null,
      };
    }

    const reportsValidation = validateReports(reports as OnfidoReport[], metaSession);
    if (validationResultCheck.error || reportsValidation.error) {
      const userErrorMessage = onfidoValidationToUserErrorMessage(
        reportsValidation,
        validationResultCheck
      )

      endpointLogger.error(
        {
          check_id,
          detailed_reasons: reportsValidation.reasons,
          tags: ["action:validateVerification", "error:verificationFailed"],
        },
        "Verification failed"
      );

      await updateSessionStatus(
        prodConfig.SessionModel,
        check_id,
        sessionStatusEnum.VERIFICATION_FAILED,
        userErrorMessage
      );

      throw {
        status: 400,
        error: userErrorMessage,
        details: {
          reasons: reportsValidation.reasons,
        },
      };
    }

    const documentReport = reports?.find((report) => report.name == "document") as OnfidoDocumentReport | undefined;
    if (!documentReport) {
      throw {
        status: 400,
        error: "No document report found",
        details: null,
      };
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

      endpointLogger.error(
        {
          uuidV2: uuidNew,
          tags: [
            "action:registeredUserCheck",
            "error:userAlreadyRegistered",
            "stage:registration",
          ],
        },
        "User has already registered"
      );
      await updateSessionStatus(
        prodConfig.SessionModel,
        check_id,
        sessionStatusEnum.VERIFICATION_FAILED,
        `User has already registered. User ID: ${user._id}`
      );
      return res
        .status(400)
        .json({ error: `User has already registered. User ID: ${user._id}` });
    }

    // Store UUID for Sybil resistance
    const dbResponse = await saveUserToDb(uuidNew, check_id);
    if (dbResponse.error) return res.status(400).json(dbResponse);

    const creds = extractCreds(documentReport);

    const response = issuev2KYC(prodConfig.issuerPrivateKey, issuanceNullifier, creds);
    response.metadata = creds;

    await deleteOnfidoApplicant(prodConfig.onfidoAPIKey, check.applicant_id);

    endpointLogger.info({ uuidV2: uuidNew, check_id }, "Issuing credentials");

    await updateSessionStatus(prodConfig.SessionModel, check_id, sessionStatusEnum.ISSUED);

    return res.status(200).json(response);
  } catch (err: any) {
    // If this is our custom error, use its properties
    if (err.status && err.error) {
      return res.status(err.status).json(err);
    }

    // Otherwise, log the unexpected error
    endpointLogger.error(
      {
        error: err,
        tags: [
          "action:getCredentialsV2",
          "error:unexpectedError",
          "stage:unknown",
        ],
      },
      "Unexpected error occurred"
    );

    return res.status(500).json({
      error: "An unexpected error occurred. Please try again later.",
    });
  }
}
