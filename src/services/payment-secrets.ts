import { Request, Response } from "express";
import { Model, Types } from "mongoose";
import { getRouteHandlerConfig } from "../init.js";
import logger from "../utils/logger.js";
import {
  ISandboxPaymentSecret,
  IPaymentSecret,
  IPaymentCommitment,
  SandboxVsLiveKYCRouteHandlerConfig
} from "../types.js";
import { getRedemptionRecord, createCommitmentRecord } from "./payments/functions.js";

const getEndpointLogger = logger.child({ msgPrefix: "[GET /payment-secrets] " });
const putEndpointLogger = logger.child({ msgPrefix: "[PUT /payment-secrets] " });

async function validatePutPaymentSecretArgs(
  holoUserId: string | null | undefined,
  commitment: string | null | undefined,
  encryptedSecret: any
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

  if (!commitment || typeof commitment != "string") {
    return { error: "commitment is required and must be a string" };
  }

  if (!encryptedSecret || typeof encryptedSecret != "object") {
    return { error: "encryptedSecret is required and must be an object" };
  }

  if (!encryptedSecret.ciphertext || typeof encryptedSecret.ciphertext != "string") {
    return { error: "encryptedSecret.ciphertext is required and must be a string" };
  }

  if (!encryptedSecret.iv || typeof encryptedSecret.iv != "string") {
    return { error: "encryptedSecret.iv is required and must be a string" };
  }

  return { success: true };
}

async function storeOrUpdatePaymentSecret(
  PaymentSecretModel: Model<IPaymentSecret | ISandboxPaymentSecret>,
  PaymentCommitmentModel: Model<IPaymentCommitment>,
  holoUserId: string,
  commitment: string,
  encryptedSecret: { ciphertext: string, iv: string }
) {
  // Create or get PaymentCommitment record
  let commitmentId: Types.ObjectId;
  try {
    const commitmentRecord = await createCommitmentRecord(
      commitment,
      'user',
      PaymentCommitmentModel
    );
    if (!commitmentRecord._id) {
      return { error: "Failed to get or create PaymentCommitment." };
    }
    commitmentId = commitmentRecord._id;
  } catch (err) {
    logger.error({ error: err }, "An error occurred while creating/getting PaymentCommitment");
    return { error: "An error occurred while creating/getting PaymentCommitment." };
  }

  // Check if document exists to determine if this is a new insertion (for limit checking)
  let existingDoc;
  try {
    existingDoc = await PaymentSecretModel.findOne({
      commitmentId: commitmentId
    }).exec();
  } catch (err) {
    logger.error({ error: err }, "An error occurred while checking for existing payment secret");
    return { error: "An error occurred while checking for existing payment secret." };
  }

  // Only check limit when creating a new document, not when updating an existing one
  if (!existingDoc) {
    // Check if user has exceeded the limit of 10 payment secrets per year
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    try {
      const count = await PaymentSecretModel.countDocuments({
        holoUserId: holoUserId,
        createdAt: { $gte: oneYearAgo },
      }).exec();

      if (count >= 10) {
        return { error: "User has reached the limit of 10 payment secrets per year." };
      }
    } catch (err) {
      logger.error({ error: err }, "An error occurred while counting payment secrets");
      return { error: "An error occurred while checking payment secret limit." };
    }
  }

  // Build update object with commitmentId
  const updateData = {
    holoUserId,
    commitmentId,
    encryptedSecret,
  };

  // Use findOneAndUpdate with upsert for atomic update/create
  try {
    await PaymentSecretModel.findOneAndUpdate(
      {
        commitmentId: commitmentId
      },
      updateData,
      { upsert: true, new: true }
    ).exec();
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while saving payment secret to database"
    );
    return { error: "An error occurred while trying to save payment secret to database." };
  }
  return { success: true };
}

/**
 * Get user's payment secrets from document store.
 */
function createGetPaymentSecrets(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const holoUserId = req?.query?.holoUserId;
    const checkRedemptionParam = req?.query?.checkRedemption;
    const checkRedemption = checkRedemptionParam === "true" || String(checkRedemptionParam) === "true";

    if (!holoUserId) {
      getEndpointLogger.error("No holoUserId specified.");
      return res.status(400).json({ error: "No holoUserId specified" });
    }
    if (typeof holoUserId != "string") {
      getEndpointLogger.error("holoUserId isn't a string.");
      return res.status(400).json({ error: "holoUserId isn't a string" });
    }

    try {
      // Get the collection name for the PaymentCommitment model
      const commitmentCollectionName = config.PaymentCommitmentModel.collection.name;

      // Build aggregation pipeline
      const pipeline: any[] = [
        // Match payment secrets by holoUserId
        {
          $match: {
            holoUserId: holoUserId,
          },
        },
        // Lookup the commitment from PaymentCommitment collection
        {
          $lookup: {
            from: commitmentCollectionName,
            localField: "commitmentId",
            foreignField: "_id",
            as: "commitmentDoc",
          },
        },
        // Unwind the commitment document (should be one-to-one)
        {
          $unwind: {
            path: "$commitmentDoc",
            preserveNullAndEmptyArrays: true, // Keep documents even if commitment not found
          },
        },
        // Project fields including the commitment string
        {
          $project: {
            _id: 1,
            holoUserId: 1,
            commitmentId: 1,
            encryptedSecret: 1,
            createdAt: 1,
            commitment: "$commitmentDoc.commitment", // Include commitment string
          },
        },
      ];

      // Execute aggregation
      const paymentSecrets = await config.PaymentSecretModel.aggregate(pipeline).exec();

      // If checkRedemption is requested, add redemption info to each payment secret
      if (checkRedemption) {
        const paymentSecretsWithRedemption = await Promise.all(
          paymentSecrets.map(async (secret) => {
            if (!secret.commitment) {
              throw new Error("No commitment found for given commitmentId.");
            }
            
            const redemption = await getRedemptionRecord(
              secret.commitment,
              config.PaymentRedemptionModel,
              config.PaymentCommitmentModel
            );
            if (redemption) {
              secret.redemption = redemption;
            }
            return secret;
          })
        );
        return res.status(200).json(paymentSecretsWithRedemption);
      }

      return res.status(200).json(paymentSecrets);
    } catch (err) {
      getEndpointLogger.error(
        { error: err, holoUserId },
        "An error occurred while retrieving payment secrets from database"
      );
      return res.status(400).json({
        error: "An error occurred while trying to get payment secrets from database.",
      });
    }
  };
}

/**
 * ENDPOINT
 */
async function getPaymentSecretsProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createGetPaymentSecrets(config)(req, res);
}

async function getPaymentSecretsSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createGetPaymentSecrets(config)(req, res);
}

function createPutPaymentSecret(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const holoUserId = req?.body?.holoUserId;
    const commitment = req?.body?.commitment;
    const encryptedSecret = req?.body?.encryptedSecret;

    const validationResult = await validatePutPaymentSecretArgs(
      holoUserId,
      commitment,
      encryptedSecret
    );
    if (validationResult.error) {
      putEndpointLogger.error({ error: validationResult.error }, "Invalid request body");
      return res.status(400).json({ error: validationResult.error });
    }

    const storeOrUpdateResult = await storeOrUpdatePaymentSecret(
      config.PaymentSecretModel,
      config.PaymentCommitmentModel,
      holoUserId,
      commitment,
      encryptedSecret
    );
    if (storeOrUpdateResult.error) {
      putEndpointLogger.error({ error: storeOrUpdateResult.error, holoUserId, commitment });
      return res.status(500).json({ error: storeOrUpdateResult.error });
    }

    return res.status(200).json({ success: true });
  };
}

/**
 * ENDPOINT
 */
async function putPaymentSecretProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPutPaymentSecret(config)(req, res);
}

async function putPaymentSecretSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPutPaymentSecret(config)(req, res);
}

export { 
  getPaymentSecretsProd, 
  getPaymentSecretsSandbox, 
  putPaymentSecretProd, 
  putPaymentSecretSandbox
};

