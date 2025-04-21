/**
 * A file for errors logged by the endpoints in this directory
 */

export function upgradeLogger(logger) {  
  logger.alreadyRegistered = (uuid) => {
    logger.error(
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

  return logger
}
