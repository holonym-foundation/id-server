import { Request, Response } from "express";
import { UserCredentialsV2 } from "../init.js";
import logger from "../utils/logger.js";

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
  holoUserId: string,
  encryptedCredentials: { ciphertext: string, iv: string }
) {
  let userCredentialsDoc;
  try {
    userCredentialsDoc = await UserCredentialsV2.findOne({
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
    userCredentialsDoc = new UserCredentialsV2({
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
  holoUserId: string,
  encryptedCredentials: { ciphertext: string, iv: string }
) {
  let userCredentialsDoc;
  try {
    userCredentialsDoc = await UserCredentialsV2.findOne({
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
    userCredentialsDoc = new UserCredentialsV2({
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
  holoUserId: string,
  encryptedCredentials: { ciphertext: string, iv: string }
) {
  let userCredentialsDoc;
  try {
    userCredentialsDoc = await UserCredentialsV2.findOne({
      holoUserId: holoUserId,
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while retrieving credentials");
    return { error: "An error occurred while retrieving credentials." };
  }
  if (userCredentialsDoc) {
    userCredentialsDoc.encryptedCleanHandsCreds = encryptedCredentials;
  } else {
    userCredentialsDoc = new UserCredentialsV2({
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
  holoUserId: string,
  encryptedCredentials: { ciphertext: string, iv: string }
) {
  let userCredentialsDoc;
  try {
    userCredentialsDoc = await UserCredentialsV2.findOne({
      holoUserId: holoUserId,
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while retrieving credentials");
    return { error: "An error occurred while retrieving credentials." };
  }
  if (userCredentialsDoc) {
    userCredentialsDoc.encryptedBiometricsCreds = encryptedCredentials;
  } else {
    userCredentialsDoc = new UserCredentialsV2({
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

/**
 * Get user's encrypted credentials and symmetric key from document store.
 */
async function getCredentials(req: Request, res: Response) {
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
    const userCreds = await UserCredentialsV2.findOne({
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

/**
 * ENDPOINT
 */
async function putPhoneCredentials(req: Request, res: Response) {
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
    holoUserId,
    encryptedCredentials
  );
  if (storeOrUpdateResult.error) {
    logger.error({ error: storeOrUpdateResult.error, holoUserId });
    return res.status(500).json({ error: storeOrUpdateResult.error });
  }

  return res.status(200).json({ success: true });
}

/**
 * ENDPOINT
 */
async function putGovIdCredentials(req: Request, res: Response) {
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
    holoUserId,
    encryptedCredentials
  );
  if (storeOrUpdateResult.error) {
    logger.error({ error: storeOrUpdateResult.error, holoUserId });
    return res.status(500).json({ error: storeOrUpdateResult.error });
  }

  return res.status(200).json({ success: true });
}

/**
 * ENDPOINT
 */
async function putCleanHandsCredentials(req: Request, res: Response) {
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
    holoUserId,
    encryptedCredentials
  );
  if (storeOrUpdateResult.error) {
    logger.error({ error: storeOrUpdateResult.error, holoUserId });
    return res.status(500).json({ error: storeOrUpdateResult.error });
  }

  return res.status(200).json({ success: true });
}

/**
 * ENDPOINT
 */
async function putBiometricsCredentials(req: Request, res: Response) {
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
    holoUserId,
    encryptedCredentials
  );
  if (storeOrUpdateResult.error) {
    logger.error({ error: storeOrUpdateResult.error, holoUserId });
    return res.status(500).json({ error: storeOrUpdateResult.error });
  }

  return res.status(200).json({ success: true });
}

export { 
  getCredentials, 
  putPhoneCredentials, 
  putGovIdCredentials, 
  putCleanHandsCredentials,
  putBiometricsCredentials
};
