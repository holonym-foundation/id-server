import { Request, Response } from "express";
import { issue } from "holonym-wasm-issuer";
import { pinoOptions, logger } from "../../../utils/logger.js";
import {
  newDummyUserCreds,
} from "../../../utils/constants.js";
import { sessionStatusEnum } from "../../../constants/misc.js";
import {
  getOnfidoCheck,
  getOnfidoReports,
  deleteOnfidoApplicant,
} from "../../../utils/onfido.js";
import {
  findOneUserVerificationLast11Months
} from "../../../utils/user-verifications.js";
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
import { getRouteHandlerConfig } from "../../../init.js";
import { makeUnknownErrorLoggable } from "../../../utils/errors.js";

const endpointLogger = logger.child({
  msgPrefix: "[GET /onfido/credentials] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "onfido",
    feature: "holonym",
    subFeature: "gov-id",
  },
});

const prodConfig = getRouteHandlerConfig("live")

/**
 * ENDPOINT
 *
 * Allows user to retrieve their signed verification info
 */
export async function getCredentials(req: Request, res: Response) {
  try {
    // if (process.env.ENVIRONMENT == "dev") {
    //   const creds = newDummyUserCreds;

    //   const response = issue(
    //     process.env.HOLONYM_ISSUER_PRIVKEY as string,
    //     creds.rawCreds.countryCode.toString(),
    //     creds.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
    //   );
    //   response.metadata = newDummyUserCreds;

    //   return res.status(200).json(response);
    // }

    const check_id = req.query.check_id as string | undefined;
    if (!check_id) {
      return res.status(400).json({ error: "No check_id specified" });
    }

    const metaSession = await getSession(check_id);
    if (metaSession.status !== sessionStatusEnum.IN_PROGRESS) {
      if (metaSession.status === sessionStatusEnum.VERIFICATION_FAILED) {
        return res.status(400).json({
          error: `Verification failed. Reason(s): ${metaSession.verificationFailureReason}`,
        });
      }
      return res.status(400).json({
        error: `Session status is '${metaSession.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
      });
    }

    const check = await getOnfidoCheck(prodConfig.onfidoAPIKey, check_id);
    const validationResultCheck = validateCheck(check);
    if (validationResultCheck.error) {
      endpointLogger.error(
        validationResultCheck.log.data,
        validationResultCheck.log.msg
      );
      return res.status(400).json({ error: validationResultCheck.error });
    }

    const reports = await getOnfidoReports(prodConfig.onfidoAPIKey, check.report_ids);
    if (!reports || reports.length == 0) {
      endpointLogger.error("No reports found");
      return res.status(400).json({ error: "No reports found" });
    }
    const validationResult = validateReports(reports, metaSession);
    if (validationResult.error) {
      endpointLogger.error(validationResult.log.data, validationResult.log.msg);
      const failureReason = validationResult.reasons
        ? validationResult.reasons.join(";")
        : validationResult.error;
      await updateSessionStatus(
        prodConfig.SessionModel,
        check_id,
        sessionStatusEnum.VERIFICATION_FAILED,
        failureReason
      );
      return res.status(400).json({
        error: validationResult.error,
        reasons: validationResult.reasons,
      });
    }

    const documentReport = reports.find((report) => report.name == "document");
    // Get UUID
    const uuidOld = uuidOldFromOnfidoReport(documentReport);
    const uuidNew = uuidNewFromOnfidoReport(documentReport);

    // We started using a new UUID generation method on May 24, 2024, but we still
    // want to check the database for the old UUIDs too.

    // Assert user hasn't registered yet
    const user = await findOneUserVerificationLast11Months(uuidOld, uuidNew);
    if (user) {
      await saveCollisionMetadata(uuidOld, uuidNew, check_id, documentReport);

      endpointLogger.error({ uuidV2: uuidNew }, "User has already registered");
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

    const response = JSON.parse(issue(
      process.env.HOLONYM_ISSUER_PRIVKEY as string,
      creds.rawCreds.countryCode.toString(),
      creds.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
    ));
    response.metadata = creds;

    await deleteOnfidoApplicant(prodConfig.onfidoAPIKey, check.applicant_id);

    endpointLogger.info({ uuidV2: uuidNew, check_id }, "Issuing credentials");

    await updateSessionStatus(prodConfig.SessionModel, check_id, sessionStatusEnum.ISSUED);

    return res.status(200).json(response);
  } catch (err) {
    console.error('getCredentials: Error:', makeUnknownErrorLoggable(err));
    return res.status(500).send();
  }
}
