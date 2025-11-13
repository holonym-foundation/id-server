import { Request, Response } from "express";
import { HydratedDocument } from "mongoose";
import { IEncryptedNullifiers, ISandboxEncryptedNullifiers, SandboxVsLiveKYCRouteHandlerConfig } from "../types.js";
import { getRouteHandlerConfig } from "../init.js";
import logger from "../utils/logger.js";

const getEndpointLogger = logger.child({ msgPrefix: "[GET /nullifiers] " });

async function validatePutNullifierArgs(
  holoUserId: string | null | undefined,
  encryptedNullifier: { ciphertext: string, iv: string } | undefined
) {
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
function createGetNullifiersRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const holoUserId = req?.query?.holoUserId;

    if (!holoUserId) {
      getEndpointLogger.error("No holoUserId specified.");
      return res.status(400).json({ error: "No holoUserId specified" });
    }

    try {
      const nullifiers = await config.EncryptedNullifiersModel.findOne({
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
}

async function getNullifiersProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createGetNullifiersRouteHandler(config)(req, res);
}

async function getNullifiersSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createGetNullifiersRouteHandler(config)(req, res);
}

/**
 * ENDPOINT.
 * 
 * This endpoint does behave exactly like a standard PUT endpoint. we store the provided 
 * encrypted nullifier only if the user does not have an encrypted nullifier that was 
 * created in the last 11 months.
 */
function createPutGovIdNullifierRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
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

    let encryptedNullifiersDoc: HydratedDocument<IEncryptedNullifiers | ISandboxEncryptedNullifiers> | null;
    try {
      encryptedNullifiersDoc = await config.EncryptedNullifiersModel.findOne({
        holoUserId: holoUserId,
      }).exec();
    } catch (err) {
      logger.error({ error: err }, "An error occurred while retrieving encrypted nullifiers");
      return res.status(500).json({ error: "An error occurred while retrieving encrypted nullifiers." });
    }

    if (encryptedNullifiersDoc) {
      // Make sure user doesn't already have a nullifier that was created within the last 11 months
      if ((encryptedNullifiersDoc.govId?.createdAt ?? 0) > new Date(Date.now() - (335 * 24 * 60 * 60 * 1000))) {
        return res.status(200).json({ success: true, message: "User already has a valid nullifier" });
      }

      encryptedNullifiersDoc.govId = {
        encryptedNullifier,
        createdAt: new Date(),
      };
    } else {
      encryptedNullifiersDoc = new config.EncryptedNullifiersModel({
        holoUserId,
        govId: {
          encryptedNullifier,
          createdAt: new Date(),
        },
      });
    }

    if (!encryptedNullifiersDoc) {
      return res.status(500).json({ error: "Failed to create encrypted nullifiers document" });
    }

    try {
      await encryptedNullifiersDoc.save();
    } catch (err) {
      logger.error(
        { error: err },
        "An error occurred while saving user encrypted nullifier to database"
      );
      return res.status(500).json({ error: "An error occurred while trying to save object to database." });
    }

    return res.status(200).json({ success: true });
  }
}

async function putGovIdNullifierProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPutGovIdNullifierRouteHandler(config)(req, res);
}

async function putGovIdNullifierSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPutGovIdNullifierRouteHandler(config)(req, res);
}

/**
 * ENDPOINT
 */
function createPutPhoneNullifierRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
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
      encryptedNullifiersDoc = await config.EncryptedNullifiersModel.findOne({
        holoUserId: holoUserId,
      }).exec();
    } catch (err) {
      logger.error({ error: err }, "An error occurred while retrieving encrypted nullifiers");
      return res.status(500).json({ error: "An error occurred while retrieving encrypted nullifiers." });
    }

    if (encryptedNullifiersDoc) {
      // Make sure user doesn't already have a nullifier that was created within the last 11 months
      if ((encryptedNullifiersDoc.phone?.createdAt ?? 0) > new Date(Date.now() - (335 * 24 * 60 * 60 * 1000))) {
        return res.status(200).json({ success: true, message: "User already has a valid nullifier" });
      }

      encryptedNullifiersDoc.phone = {
        encryptedNullifier,
        createdAt: new Date(),
      };
    } else {
      encryptedNullifiersDoc = new config.EncryptedNullifiersModel({
        holoUserId,
        phone: {
          encryptedNullifier,
          createdAt: new Date(),
        },
      });
    }

    if (!encryptedNullifiersDoc) {
      return res.status(500).json({ error: "Failed to create encrypted nullifiers document" });
    }

    try {
      await encryptedNullifiersDoc.save();
    } catch (err) {
      logger.error(
        { error: err },
        "An error occurred while saving user encrypted nullifier to database"
      );
      return res.status(500).json({ error: "An error occurred while trying to save object to database." });
    }

    return res.status(200).json({ success: true });
  }
}

async function putPhoneNullifierProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPutPhoneNullifierRouteHandler(config)(req, res);
}

async function putPhoneNullifierSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPutPhoneNullifierRouteHandler(config)(req, res);
}

/**
 * ENDPOINT
 */
function createPutCleanHandsNullifierRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
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
      encryptedNullifiersDoc = await config.EncryptedNullifiersModel.findOne({
        holoUserId: holoUserId,
      }).exec();
    } catch (err) {
      logger.error({ error: err }, "An error occurred while retrieving encrypted nullifiers");
      return res.status(500).json({ error: "An error occurred while retrieving encrypted nullifiers." });
    }

    if (encryptedNullifiersDoc) {
      // Make sure user doesn't already have a nullifier that was created within the last 11 months
      if ((encryptedNullifiersDoc.cleanHands?.createdAt ?? 0) > new Date(Date.now() - (335 * 24 * 60 * 60 * 1000))) {
        return res.status(200).json({ success: true, message: "User already has a valid nullifier" });
      }

      encryptedNullifiersDoc.cleanHands = {
        encryptedNullifier,
        createdAt: new Date(),
      };
    } else {
      encryptedNullifiersDoc = new config.EncryptedNullifiersModel({
        holoUserId,
        cleanHands: {
          encryptedNullifier,
          createdAt: new Date(),
        },
      });
    }

    if (!encryptedNullifiersDoc) {
      return res.status(500).json({ error: "Failed to create encrypted nullifiers document" });
    }

    try {
      await encryptedNullifiersDoc.save();
    } catch (err) {
      logger.error(
        { error: err },
        "An error occurred while saving user encrypted nullifier to database"
      );
      return res.status(500).json({ error: "An error occurred while trying to save object to database." });
    }

    return res.status(200).json({ success: true });
  }
}

async function putCleanHandsNullifierProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPutCleanHandsNullifierRouteHandler(config)(req, res);
}

async function putCleanHandsNullifierSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPutCleanHandsNullifierRouteHandler(config)(req, res);
}

/**
 * ENDPOINT
 */
function createPutBiometricsNullifierRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
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
      encryptedNullifiersDoc = await config.EncryptedNullifiersModel.findOne({
        holoUserId: holoUserId,
      }).exec();
    } catch (err) {
      logger.error({ error: err }, "An error occurred while retrieving encrypted nullifiers");
      return res.status(500).json({ error: "An error occurred while retrieving encrypted nullifiers." });
    }

    if (encryptedNullifiersDoc) {
      // Make sure user doesn't already have a nullifier that was created within the last 11 months
      if ((encryptedNullifiersDoc.biometrics?.createdAt ?? 0) > new Date(Date.now() - (335 * 24 * 60 * 60 * 1000))) {
        return res.status(200).json({ success: true, message: "User already has a valid nullifier" });
      }

      encryptedNullifiersDoc.biometrics = {
        encryptedNullifier,
        createdAt: new Date(),
      };
    } else {
      encryptedNullifiersDoc = new config.EncryptedNullifiersModel({
        holoUserId,
        biometrics: {
          encryptedNullifier,
          createdAt: new Date(),
        },
      });
    }

    if (!encryptedNullifiersDoc) {
      return res.status(500).json({ error: "Failed to create encrypted nullifiers document" });
    }

    try {
      await encryptedNullifiersDoc.save();
    } catch (err) {
      logger.error(
        { error: err },
        "An error occurred while saving user encrypted nullifier to database"
      );
      return res.status(500).json({ error: "An error occurred while trying to save object to database." });
    }

    return res.status(200).json({ success: true });
  }
}

async function putBiometricsNullifierProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPutBiometricsNullifierRouteHandler(config)(req, res);
}

async function putBiometricsNullifierSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPutBiometricsNullifierRouteHandler(config)(req, res);
}

export { 
  getNullifiersProd,
  getNullifiersSandbox,
  putGovIdNullifierProd,
  putGovIdNullifierSandbox,
  putPhoneNullifierProd,
  putPhoneNullifierSandbox,
  putCleanHandsNullifierProd,
  putCleanHandsNullifierSandbox,
  putBiometricsNullifierProd,
  putBiometricsNullifierSandbox,
};
