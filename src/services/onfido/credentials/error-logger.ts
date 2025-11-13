/**
 * A file for errors logged by the endpoints in this directory
 */
import pino from "pino";

import { ISession } from "../../../types.js";

export type ValidationResult = {
  log: {
    msg: string;
    data: Record<string, any>;
  };
  error: string;
}

type UpgradedLogger = pino.Logger & {
  failedToGetCheck: (check_id: string) => void;
  failedToGetReports: (check_id: string, report_ids: string[]) => void;
  noReportsFound: (check_id: string, report_ids: string[]) => void;
  noDocumentReport: (reports: any) => void;
  alreadyRegistered: (uuidNew: string) => void;
  verificationPreviouslyFailed: (check_id: string, session: ISession) => void;
  checkValidationFailed: (validationResult: ValidationResult) => void;
  verificationFailed: (check_id: string, reportsValidation: any) => void;
  unexpected: (err: any) => void;
}

export function upgradeV3Logger(logger: pino.Logger): UpgradedLogger {
  const upgradedLogger = logger as UpgradedLogger;

  upgradedLogger.failedToGetCheck = (check_id) => {
    logger.error(
      { check_id },
      "Failed to get onfido check."
    );
  }

  upgradedLogger.failedToGetReports = (check_id, report_ids) => {
    logger.error(
      {
        check_id,
        report_ids: report_ids ?? "unknown",
        tags: ["action:getReports", "error:noReportsFound"],
      },
      "Failed to get onfido reports"
    );
  }

  upgradedLogger.noReportsFound = (check_id, report_ids) => {
    logger.error(
      {
        check_id,
        report_ids: report_ids ?? "unknown",
        tags: ["action:getReports", "error:noReportsFound"],
      },
      "No reports found"
    );
  }

  upgradedLogger.noDocumentReport = (reports) => {
    logger.error(
      { reports },
      "No documentReport"
    );
  }

  upgradedLogger.alreadyRegistered = (uuidNew) => {
    logger.error(
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
  }

  upgradedLogger.verificationPreviouslyFailed = (check_id, session) => {
    logger.error(
      {
        check_id,
        session_status: session.status,
        failure_reason: session.verificationFailureReason,
        tags: ["action:validateSession", "error:verificationFailed"],
      },
      "Session verification previously failed"
    );
  }

  upgradedLogger.checkValidationFailed = (validationResult) => {
    logger.error(
      validationResult.log.data,
      validationResult.log.msg,
      {
        tags: ["action:validateSession", "error:verificationFailed"],
      }
    ); 
  }

  upgradedLogger.verificationFailed = (check_id, reportsValidation) => {
    logger.error(
      {
        check_id,
        detailed_reasons: reportsValidation.reasons,
        tags: ["action:validateVerification", "error:verificationFailed"],
      },
      "Verification failed"
    );
  }

  upgradedLogger.unexpected = (err) => {
    logger.error(
      {
        error: err.message ?? err.toString(),
        tags: [
          "action:getCredentialsV3",
          "error:unexpectedError",
          "stage:unknown",
        ],
      },
      "Unexpected error occurred"
    );
  }

  return upgradedLogger
}
