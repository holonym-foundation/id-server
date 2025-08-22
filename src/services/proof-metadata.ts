import { Request, Response } from "express";
import { mongoose, UserCredentials, UserProofMetadata } from "../init.js";
import logger from "../utils/logger.js";

const postEndpointLogger = logger.child({ msgPrefix: "[POST /proof-metadata] " });
const getEndpointLogger = logger.child({ msgPrefix: "[GET /proof-metadata] " });

/**
 * Get user's encrypted proof metadata and symmetric key from document store.
 */
async function getProofMetadata(req: Request, res: Response) {
  const sigDigest = req?.query?.sigDigest;

  if (!sigDigest) {
    getEndpointLogger.error("No sigDigest specified.");
    return res.status(400).json({ error: "No sigDigest specified" });
  }
  if (typeof sigDigest != "string") {
    getEndpointLogger.error("sigDigest isn't a string.");
    return res.status(400).json({ error: "sigDigest isn't a string" });
  }

  try {
    const userProofMetadata = await UserProofMetadata.findOne({
      sigDigest: sigDigest,
    }).exec();
    return res.status(200).json(userProofMetadata);
  } catch (err) {
    getEndpointLogger.error(
      {
        error: err,
      },
      "An error occurred while retrieving user proof metadata."
    );
    return res.status(400).json({
      error:
        "An error occurred while trying to get proof metadata object from database.",
    });
  }
}

/**
 * Set user's encrypted proof metadata and symmetric key.
 */
async function postProofMetadata(req: Request, res: Response) {
  const sigDigest = req?.body?.sigDigest;
  const encryptedProofMetadata = req?.body?.encryptedProofMetadata;
  const encryptedSymmetricKey = req?.body?.encryptedSymmetricKey;
  const encryptedProofMetadataAES = req?.body?.encryptedProofMetadataAES;

  // Require that args are present
  if (!sigDigest) {
    return res.status(400).json({ error: "No sigDigest specified" });
  }

  // Require that args are correct types
  if (typeof sigDigest != "string") {
    return res.status(400).json({ error: "sigDigest isn't a string" });
  }

  // Ensure user exists
  let userCredentialsDoc;
  try {
    userCredentialsDoc = await UserCredentials.findOne({
      sigDigest: sigDigest,
    }).exec();
  } catch (err) {
    postEndpointLogger.error(
      { error: err },
      "An error occurred while retrieving user credentials."
    );
    return res.status(400).json({
      error: "An error occurred while retrieving user credentials.",
    });
  }
  if (!userCredentialsDoc) {
    return res.status(404).json({
      error: `User with sigDigest ${sigDigest} does not exist.`,
    });
  }

  // Store proof metadata
  let userProofMetadataDoc;
  try {
    userProofMetadataDoc = await UserProofMetadata.findOne({
      sigDigest: sigDigest,
    }).exec();
    userProofMetadataDoc;
  } catch (err) {
    postEndpointLogger.error(
      { error: err },
      "An error occurred while retrieving user proof metadata."
    );
    return res.status(400).json({
      error: "An error occurred while retrieving user proof metadata.",
    });
  }
  if (userProofMetadataDoc) {
    userProofMetadataDoc.encryptedProofMetadata = encryptedProofMetadata;
    userProofMetadataDoc.encryptedSymmetricKey = encryptedSymmetricKey;
    userProofMetadataDoc.encryptedProofMetadataAES = encryptedProofMetadataAES;
  } else {
    userProofMetadataDoc = new UserProofMetadata({
      sigDigest,
      encryptedProofMetadata,
      encryptedSymmetricKey,
      encryptedProofMetadataAES,
    });
  }
  try {
    await userProofMetadataDoc.save();
  } catch (err) {
    postEndpointLogger.error(
      { error: err },
      "An error occurred while saving user proof metadata to database"
    );
    return res.status(400).json({
      error: "An error occurred while trying to save object to database.",
    });
  }

  return res.status(200).json({ success: true });
}

export { getProofMetadata, postProofMetadata };
