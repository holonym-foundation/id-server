/**
 * A file for errors logged by the endpoints in this directory
 */
import pino from "pino";

interface UpgradedLogger extends pino.Logger {
  alreadyRegistered: (uuid: string) => void;
  sanctionsMatchFound: (sanctionsioResults: any) => void;
  nameTruncation: (logData: any) => void;
}

export function upgradeLogger(logger: pino.Logger): UpgradedLogger {  
  const upgradedLogger = logger as UpgradedLogger;

  upgradedLogger.alreadyRegistered = (uuid: string) => {
    upgradedLogger.error(
      {
        uuid,
        tags: [
          "action:registeredUserCheck",
          "error:userAlreadyRegistered",
          "stage:registration",
        ],
      },
      "User has already registered"
    );
  }

  upgradedLogger.sanctionsMatchFound = (sanctionsioResults) => {
    upgradedLogger.error(
      {
        sanctionsioResults
      },
      'Sanctions match found'
    )
  }

  upgradedLogger.nameTruncation = (logData) => {
    upgradedLogger.info(
      {
        logData
      },
      'Name truncation'
    )
  }

  return upgradedLogger
}
