/**
 * A file for errors logged by the endpoints in this directory
 */

import e from "express";

export function upgradeV3Logger(logger) {

  logger.verificationPreviouslyFailed = (session) => {
    logger.error(
      {
        session_status: session.status,
        failure_reason: session.verificationFailureReason,
        tags: ["action:validateSession", "error:verificationFailed"],
      },
      "Session verification previously failed"
    );
  }

  logger.verificationFailed = (externalDatabaseRefID, reportsValidation) => {
    logger.error(
      {
        externalDatabaseRefID,
        detailed_reasons: reportsValidation.reasons,
        tags: ["action:validateVerification", "error:verificationFailed"],
      },
      "Verification failed"
    );
  }

  logger.unexpected = (err) => {
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

  return logger
}
