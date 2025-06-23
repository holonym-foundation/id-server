import { EncryptedNullifiers } from "../init.js";
import logger from "../utils/logger.js";

const getEndpointLogger = logger.child({ msgPrefix: "[GET /nullifiers] " });

async function validatePutNullifierArgs(holoUserId, encryptedNullifier) {
  // Require that args are present
  if (!holoUserId || holoUserId == "null" || holoUserId == "undefined") {
    return { error: "No holoUserId specified" };
  }

  // Ensure that args are not too large
  if (holoUserId.length != 64) {
    return { error: "holoUserId is not 64 characters long" };
  }

  if (!encryptedNullifier || !encryptedNullifier?.ciphertext || !encryptedNullifier?.iv) {
    return { error: "No encryptedNullifier specified" };
  }

  if (encryptedNullifier.ciphertext.length > 1000 || encryptedNullifier.iv.length > 1000) {
    return { error: "encryptedNullifier is too large" };
  }

  return { success: true };
}

/**
 * Get user's encrypted nullifiers.
 */
async function getNullifiers(req, res) {
  const holoUserId = req?.query?.holoUserId;

  if (!holoUserId) {
    getEndpointLogger.error("No holoUserId specified.");
    return res.status(400).json({ error: "No holoUserId specified" });
  }

  try {
    const nullifiers = await EncryptedNullifiers.findOne({
      holoUserId: holoUserId,
    }).exec();
    return res.status(200).json(nullifiers);
  } catch (err) {
    getEndpointLogger.error(
      { error: err, holoUserId },
      "An error occurred while retrieving encrypted nullifiers from database"
    );
    return res.status(400).json({
      error: "An error occurred while trying to get encrypted nullifiers object from database.",
    });
  }
}

/**
 * ENDPOINT.
 * 
 * This endpoint does behave exactly like a standard PUT endpoint. we store the provided 
 * encrypted nullifier only if the user does not have an encrypted nullifier that was 
 * created in the last 11 months.
 */
async function putGovIdNullifier(req, res) {
  const holoUserId = req?.body?.holoUserId;
  const encryptedNullifier = req?.body?.encryptedNullifier;

  const validationResult = await validatePutNullifierArgs(
    holoUserId,
    encryptedNullifier
  );
  if (validationResult.error) {
    logger.error({ error: validationResult.error }, "Invalid request body");
    return res.status(400).json({ error: validationResult.error });
  }

  let encryptedNullifiersDoc;
  try {
    encryptedNullifiersDoc = await EncryptedNullifiers.findOne({
      holoUserId: holoUserId,
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while retrieving encrypted nullifiers");
    return { error: "An error occurred while retrieving encrypted nullifiers." };
  }

  if (encryptedNullifiersDoc) {
    // Make sure user doesn't already have a nullifier that was created within the last 11 months
    if (encryptedNullifiersDoc.govId?.createdAt > new Date(Date.now() - (335 * 24 * 60 * 60 * 1000))) {
      return res.status(200).json({ success: true, message: "User already has a valid nullifier" });
    }

    encryptedNullifiersDoc.govId = {
      encryptedNullifier,
      createdAt: new Date(),
    };
  } else {
    encryptedNullifiersDoc = new EncryptedNullifiers({
      holoUserId,
      govId: {
        encryptedNullifier,
        createdAt: new Date(),
      },
    });
  }

  try {
    await encryptedNullifiersDoc.save();
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while saving user encrypted nullifier to database"
    );
    return { error: "An error occurred while trying to save object to database." };
  }

  return res.status(200).json({ success: true });
}

/**
 * ENDPOINT
 */
async function putPhoneNullifier(req, res) {
  const holoUserId = req?.body?.holoUserId;
  const encryptedNullifier = req?.body?.encryptedNullifier;

  const validationResult = await validatePutNullifierArgs(
    holoUserId,
    encryptedNullifier
  );
  if (validationResult.error) {
    logger.error({ error: validationResult.error }, "Invalid request body");
    return res.status(400).json({ error: validationResult.error });
  }

  let encryptedNullifiersDoc;
  try {
    encryptedNullifiersDoc = await EncryptedNullifiers.findOne({
      holoUserId: holoUserId,
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while retrieving encrypted nullifiers");
    return { error: "An error occurred while retrieving encrypted nullifiers." };
  }

  if (encryptedNullifiersDoc) {
    // Make sure user doesn't already have a nullifier that was created within the last 11 months
    if (encryptedNullifiersDoc.phone?.createdAt > new Date(Date.now() - (335 * 24 * 60 * 60 * 1000))) {
      return res.status(200).json({ success: true, message: "User already has a valid nullifier" });
    }

    encryptedNullifiersDoc.phone = {
      encryptedNullifier,
      createdAt: new Date(),
    };
  } else {
    encryptedNullifiersDoc = new EncryptedNullifiers({
      holoUserId,
      phone: {
        encryptedNullifier,
        createdAt: new Date(),
      },
    });
  }

  try {
    await encryptedNullifiersDoc.save();
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while saving user encrypted nullifier to database"
    );
    return { error: "An error occurred while trying to save object to database." };
  }

  return res.status(200).json({ success: true });
}

/**
 * ENDPOINT
 */
async function putCleanHandsNullifier(req, res) {
  const holoUserId = req?.body?.holoUserId;
  const encryptedNullifier = req?.body?.encryptedNullifier;

  const validationResult = await validatePutNullifierArgs(
    holoUserId,
    encryptedNullifier
  );
  if (validationResult.error) {
    logger.error({ error: validationResult.error }, "Invalid request body");
    return res.status(400).json({ error: validationResult.error });
  }

  let encryptedNullifiersDoc;
  try {
    encryptedNullifiersDoc = await EncryptedNullifiers.findOne({
      holoUserId: holoUserId,
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while retrieving encrypted nullifiers");
    return { error: "An error occurred while retrieving encrypted nullifiers." };
  }

  if (encryptedNullifiersDoc) {
    // Make sure user doesn't already have a nullifier that was created within the last 11 months
    if (encryptedNullifiersDoc.cleanHands?.createdAt > new Date(Date.now() - (335 * 24 * 60 * 60 * 1000))) {
      return res.status(200).json({ success: true, message: "User already has a valid nullifier" });
    }

    encryptedNullifiersDoc.cleanHands = {
      encryptedNullifier,
      createdAt: new Date(),
    };
  } else {
    encryptedNullifiersDoc = new EncryptedNullifiers({
      holoUserId,
      cleanHands: {
        encryptedNullifier,
        createdAt: new Date(),
      },
    });
  }

  try {
    await encryptedNullifiersDoc.save();
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while saving user encrypted nullifier to database"
    );
    return { error: "An error occurred while trying to save object to database." };
  }

  return res.status(200).json({ success: true });
}

/**
 * ENDPOINT
 */
async function putBiometricsNullifier(req, res) {
  const holoUserId = req?.body?.holoUserId;
  const encryptedNullifier = req?.body?.encryptedNullifier;

  const validationResult = await validatePutNullifierArgs(
    holoUserId,
    encryptedNullifier
  );
  if (validationResult.error) {
    logger.error({ error: validationResult.error }, "Invalid request body");
    return res.status(400).json({ error: validationResult.error });
  }

  let encryptedNullifiersDoc;
  try {
    encryptedNullifiersDoc = await EncryptedNullifiers.findOne({
      holoUserId: holoUserId,
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while retrieving encrypted nullifiers");
    return { error: "An error occurred while retrieving encrypted nullifiers." };
  }

  if (encryptedNullifiersDoc) {
    // Make sure user doesn't already have a nullifier that was created within the last 11 months
    if (encryptedNullifiersDoc.biometrics?.createdAt > new Date(Date.now() - (335 * 24 * 60 * 60 * 1000))) {
      return res.status(200).json({ success: true, message: "User already has a valid nullifier" });
    }

    encryptedNullifiersDoc.biometrics = {
      encryptedNullifier,
      createdAt: new Date(),
    };
  } else {
    encryptedNullifiersDoc = new EncryptedNullifiers({
      holoUserId,
      biometrics: {
        encryptedNullifier,
        createdAt: new Date(),
      },
    });
  }

  try {
    await encryptedNullifiersDoc.save();
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while saving user encrypted nullifier to database"
    );
    return { error: "An error occurred while trying to save object to database." };
  }

  return res.status(200).json({ success: true });
}

export { 
  getNullifiers, 
  putGovIdNullifier, 
  putPhoneNullifier,
  putCleanHandsNullifier,
  putBiometricsNullifier
};
