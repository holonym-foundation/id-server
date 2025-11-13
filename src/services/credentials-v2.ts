import { Request, Response } from "express";
import { Model } from "mongoose";
import { UserCredentialsV2, getRouteHandlerConfig } from "../init.js";
import logger from "../utils/logger.js";
import {
  ISandboxUserCredentialsV2,
  IUserCredentialsV2,
  SandboxVsLiveKYCRouteHandlerConfig
} from "../types.js";

const getEndpointLogger = logger.child({ msgPrefix: "[GET /credentials/v2] " });

async function validatePutCredentialsArgs(
  holoUserId: string | null | undefined,
  encryptedCredentials: any
) {
  // Require that args are present
  if (!holoUserId || holoUserId == "null" || holoUserId == "undefined") {
    return { error: "No holoUserId specified" };
  }

  // Require that args are correct types
  if (typeof holoUserId != "string") {
    return { error: "holoUserId isn't a string" };
  }

  // Ensure that args are not too large
  if (holoUserId.length != 64) {
    return { error: "holoUserId is not 64 characters long" };
  }
  return { success: true };
}

async function storeOrUpdatePhoneCredentials(
  UserCredentialsV2Model: Model<IUserCredentialsV2 | ISandboxUserCredentialsV2>,
  holoUserId: string,
  encryptedCredentials: { ciphertext: string, iv: string }
) {
  let userCredentialsDoc;
  try {
    userCredentialsDoc = await UserCredentialsV2Model.findOne({
      holoUserId: holoUserId,
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while retrieving credentials");
    return { error: "An error occurred while retrieving credentials." };
  }
  if (userCredentialsDoc) {
    userCredentialsDoc.holoUserId = holoUserId;
    userCredentialsDoc.encryptedPhoneCreds = encryptedCredentials;
  } else {
    userCredentialsDoc = new UserCredentialsV2Model({
      holoUserId,
      encryptedPhoneCreds: encryptedCredentials,
    });
  }
  try {
    await userCredentialsDoc.save();
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while saving user credentials to database"
    );
    return { error: "An error occurred while trying to save object to database." };
  }
  return { success: true };
}

async function storeOrUpdateGovIdCredentials(
  UserCredentialsV2Model: Model<IUserCredentialsV2 | ISandboxUserCredentialsV2>,
  holoUserId: string,
  encryptedCredentials: { ciphertext: string, iv: string }
) {
  let userCredentialsDoc;
  try {
    userCredentialsDoc = await UserCredentialsV2Model.findOne({
      holoUserId: holoUserId,
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while retrieving credentials");
    return { error: "An error occurred while retrieving credentials." };
  }
  if (userCredentialsDoc) {
    userCredentialsDoc.holoUserId = holoUserId;
    userCredentialsDoc.encryptedGovIdCreds = encryptedCredentials;
  } else {
    userCredentialsDoc = new UserCredentialsV2Model({
      holoUserId,
      encryptedGovIdCreds: encryptedCredentials,
    });
  }
  try {
    await userCredentialsDoc.save();
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while saving user credentials to database"
    );
    return { error: "An error occurred while trying to save object to database." };
  }
  return { success: true };
}

async function storeOrUpdateCleanHandsCredentials(
  UserCredentialsV2Model: Model<IUserCredentialsV2 | ISandboxUserCredentialsV2>,
  holoUserId: string,
  encryptedCredentials: { ciphertext: string, iv: string }
) {
  let userCredentialsDoc;
  try {
    userCredentialsDoc = await UserCredentialsV2Model.findOne({
      holoUserId: holoUserId,
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while retrieving credentials");
    return { error: "An error occurred while retrieving credentials." };
  }
  if (userCredentialsDoc) {
    userCredentialsDoc.encryptedCleanHandsCreds = encryptedCredentials;
  } else {
    userCredentialsDoc = new UserCredentialsV2Model({
      holoUserId,
      encryptedCleanHandsCreds: encryptedCredentials,
    });
  }
  try {
    await userCredentialsDoc.save();
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while saving user credentials to database"
    );
    return { error: "An error occurred while trying to save object to database." };
  }
  return { success: true };
}

async function storeOrUpdateBiometricsCredentials(
  UserCredentialsV2Model: Model<IUserCredentialsV2 | ISandboxUserCredentialsV2>,
  holoUserId: string,
  encryptedCredentials: { ciphertext: string, iv: string }
) {
  let userCredentialsDoc;
  try {
    userCredentialsDoc = await UserCredentialsV2Model.findOne({
      holoUserId: holoUserId,
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while retrieving credentials");
    return { error: "An error occurred while retrieving credentials." };
  }
  if (userCredentialsDoc) {
    userCredentialsDoc.encryptedBiometricsCreds = encryptedCredentials;
  } else {
    userCredentialsDoc = new UserCredentialsV2Model({
      holoUserId,
      encryptedBiometricsCreds: encryptedCredentials,
    });
  }
  try {
    await userCredentialsDoc.save();
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while saving user credentials to database"
    );
    return { error: "An error occurred while trying to save object to database." };
  }
  return { success: true };
}

async function storeOrUpdateBiometricsAllowSybilsCredentials(
  UserCredentialsV2Model: Model<IUserCredentialsV2 | ISandboxUserCredentialsV2>,
  holoUserId: string,
  encryptedCredentials: { ciphertext: string, iv: string }
) {
  let userCredentialsDoc;
  try {
    userCredentialsDoc = await UserCredentialsV2Model.findOne({
      holoUserId: holoUserId,
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while retrieving credentials");
    return { error: "An error occurred while retrieving credentials." };
  }
  if (userCredentialsDoc) {
    userCredentialsDoc.encryptedBiometricsAllowSybilsCreds = encryptedCredentials;
  } else {
    userCredentialsDoc = new UserCredentialsV2Model({
      holoUserId,
      encryptedBiometricsAllowSybilsCreds: encryptedCredentials,
    });
  }
  try {
    await userCredentialsDoc.save();
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while saving user credentials to database"
    );
    return { error: "An error occurred while trying to save object to database." };
  }
  return { success: true };
}

/**
 * Get user's encrypted credentials and symmetric key from document store.
 */
function createGetCredentials(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const holoUserId = req?.query?.holoUserId;

    if (!holoUserId) {
      getEndpointLogger.error("No holoUserId specified.");
      return res.status(400).json({ error: "No holoUserId specified" });
    }
    if (typeof holoUserId != "string") {
      getEndpointLogger.error("holoUserId isn't a string.");
      return res.status(400).json({ error: "holoUserId isn't a string" });
    }

    try {
      const userCreds = await config.UserCredentialsV2Model.findOne({
        holoUserId: holoUserId,
      }).exec();
      return res.status(200).json(userCreds);
    } catch (err) {
      getEndpointLogger.error(
        { error: err, holoUserId },
        "An error occurred while retrieving credentials from database"
      );
      return res.status(400).json({
        error: "An error occurred while trying to get credentials object from database.",
      });
    }
  }
}

/**
 * ENDPOINT
 */
async function getCredentialsProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createGetCredentials(config)(req, res);
}

async function getCredentialsSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createGetCredentials(config)(req, res);
}

function createPutPhoneCredentials(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const holoUserId = req?.body?.holoUserId;
    const encryptedCredentials = req?.body?.encryptedCredentials;

    const validationResult = await validatePutCredentialsArgs(
      holoUserId,
      encryptedCredentials
    );
    if (validationResult.error) {
      logger.error({ error: validationResult.error }, "Invalid request body");
      return res.status(400).json({ error: validationResult.error });
    }

    const storeOrUpdateResult = await storeOrUpdatePhoneCredentials(
      config.UserCredentialsV2Model,
      holoUserId,
      encryptedCredentials
    );
    if (storeOrUpdateResult.error) {
      logger.error({ error: storeOrUpdateResult.error, holoUserId });
      return res.status(500).json({ error: storeOrUpdateResult.error });
    }

    return res.status(200).json({ success: true });
  }
}

/**
 * ENDPOINT
 */
async function putPhoneCredentialsProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPutPhoneCredentials(config)(req, res);
}

async function putPhoneCredentialsSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPutPhoneCredentials(config)(req, res);
}

function createPutGovIdCredentials(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const holoUserId = req?.body?.holoUserId;
    const encryptedCredentials = req?.body?.encryptedCredentials;

    const validationResult = await validatePutCredentialsArgs(
      holoUserId,
      encryptedCredentials
    );
    if (validationResult.error) {
      logger.error({ error: validationResult.error }, "Invalid request body");
      return res.status(400).json({ error: validationResult.error });
    }

    const storeOrUpdateResult = await storeOrUpdateGovIdCredentials(
      config.UserCredentialsV2Model,
      holoUserId,
      encryptedCredentials
    );
    if (storeOrUpdateResult.error) {
      logger.error({ error: storeOrUpdateResult.error, holoUserId });
      return res.status(500).json({ error: storeOrUpdateResult.error });
    }

    return res.status(200).json({ success: true });
  }
}

/**
 * ENDPOINT
 */
async function putGovIdCredentialsProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPutGovIdCredentials(config)(req, res);
}

async function putGovIdCredentialsSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPutGovIdCredentials(config)(req, res);
}

function createPutCleanHandsCredentials(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const holoUserId = req?.body?.holoUserId;
    const encryptedCredentials = req?.body?.encryptedCredentials;

    const validationResult = await validatePutCredentialsArgs(
      holoUserId,
      encryptedCredentials
    );
    if (validationResult.error) {
      logger.error({ error: validationResult.error }, "Invalid request body");
      return res.status(400).json({ error: validationResult.error });
    }

    const storeOrUpdateResult = await storeOrUpdateCleanHandsCredentials(
      config.UserCredentialsV2Model,
      holoUserId,
      encryptedCredentials
    );
    if (storeOrUpdateResult.error) {
      logger.error({ error: storeOrUpdateResult.error, holoUserId });
      return res.status(500).json({ error: storeOrUpdateResult.error });
    }

    return res.status(200).json({ success: true });
  }
}

/**
 * ENDPOINT
 */
async function putCleanHandsCredentialsProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPutCleanHandsCredentials(config)(req, res);
}

async function putCleanHandsCredentialsSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPutCleanHandsCredentials(config)(req, res);
}

function createPutBiometricsCredentials(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const holoUserId = req?.body?.holoUserId;
    const encryptedCredentials = req?.body?.encryptedCredentials;

    const validationResult = await validatePutCredentialsArgs(
      holoUserId,
      encryptedCredentials
    );
    if (validationResult.error) {
      logger.error({ error: validationResult.error }, "Invalid request body");
      return res.status(400).json({ error: validationResult.error });
    }

    const storeOrUpdateResult = await storeOrUpdateBiometricsCredentials(
      config.UserCredentialsV2Model,
      holoUserId,
      encryptedCredentials
    );
    if (storeOrUpdateResult.error) {
      logger.error({ error: storeOrUpdateResult.error, holoUserId });
      return res.status(500).json({ error: storeOrUpdateResult.error });
    }

    return res.status(200).json({ success: true });
  }
}

/**
 * ENDPOINT
 */
async function putBiometricsCredentialsProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPutBiometricsCredentials(config)(req, res);
}

async function putBiometricsCredentialsSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPutBiometricsCredentials(config)(req, res);
}

function createPutBiometricsAllowSybilsCredentials(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const holoUserId = req?.body?.holoUserId;
    const encryptedCredentials = req?.body?.encryptedCredentials;

    const validationResult = await validatePutCredentialsArgs(
      holoUserId,
      encryptedCredentials
    );
    if (validationResult.error) {
      logger.error({ error: validationResult.error }, "Invalid request body");
      return res.status(400).json({ error: validationResult.error });
    }

    const storeOrUpdateResult = await storeOrUpdateBiometricsAllowSybilsCredentials(
      config.UserCredentialsV2Model,
      holoUserId,
      encryptedCredentials
    );
    if (storeOrUpdateResult.error) {
      logger.error({ error: storeOrUpdateResult.error, holoUserId });
      return res.status(500).json({ error: storeOrUpdateResult.error });
    }

    return res.status(200).json({ success: true });
  }
}

/**
 * ENDPOINT
 */
async function putBiometricsAllowSybilsCredentialsProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPutBiometricsAllowSybilsCredentials(config)(req, res);
}

async function putBiometricsAllowSybilsCredentialsSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPutBiometricsAllowSybilsCredentials(config)(req, res);
}

export { 
  getCredentialsProd, 
  getCredentialsSandbox, 
  putPhoneCredentialsProd, 
  putPhoneCredentialsSandbox, 
  putGovIdCredentialsProd, 
  putGovIdCredentialsSandbox, 
  putCleanHandsCredentialsProd, 
  putCleanHandsCredentialsSandbox, 
  putBiometricsCredentialsProd, 
  putBiometricsCredentialsSandbox, 
  putBiometricsAllowSybilsCredentialsProd, 
  putBiometricsAllowSybilsCredentialsSandbox
};
