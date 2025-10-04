import axios from "axios";
import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { poseidon } from "circomlibjs-old";
import { ObjectId } from "mongodb";
import { v4 as uuidV4 } from "uuid";
import {
  BiometricsAllowSybilsSession,
  UserVerifications,
  VerificationCollisionMetadata,
  BiometricsNullifierAndCreds,
} from "../../../../init.js";
import { issue as issuev2 } from "holonym-wasm-issuer-v2";
import {
  getDateAsInt,
  sha256,
  govIdUUID,
  validateUUIDv4,
  objectIdElevenMonthsAgo,
  objectIdFiveDaysAgo,
} from "../../../../utils/utils.js";
import { pinoOptions, logger } from "../../../../utils/logger.js";
import { biometricsAllowSybilsSessionStatusEnum } from "../../../../constants/misc.js";
import { upgradeV3Logger } from "../../error-logger.js";
import {
  updateSessionStatus,
} from "../../functions-creds.js";

const endpointLogger = upgradeV3Logger(
  logger.child({
    msgPrefix: "[POST /facetec/v2/allow-sybils/credentials] ",
    base: {
      ...pinoOptions.base,
      idvProvider: "facetec",
      feature: "holonym",
      subFeature: "biometrics",
    },
  })
);

async function saveUserToDb(uuidV2) {
  const userVerificationsDoc = new UserVerifications({
    biometrics: {
      uuidV2: uuidV2,
      issuedAt: new Date(),
    },
  });
  try {
    await userVerificationsDoc.save();
  } catch (err) {
    endpointLogger.error(
      err,
      "An error occurred while saving user verification to database"
    );
    return {
      error:
        "An error occurred while trying to save object to database. Please try again.",
    };
  }
  return { success: true };
}

/**
 * ENDPOINT
 *
 * Allows user to retrieve their signed verification info.
 */
async function getCredentials(req, res) {
  try {
    // TODO: Add SSE

    // Caller must specify a session ID and a nullifier. We first lookup the user's creds
    // using the nullifier. If no hit, then we lookup the credentials using the session ID.
    const _id = req.params._id;
    const issuanceNullifier = req.params.nullifier;

    try {
      const _number = BigInt(issuanceNullifier);
    } catch (err) {
      return res.status(400).json({
        error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`,
      });
    }

    let objectId = null;
    try {
      objectId = new ObjectId(_id);
    } catch (err) {
      return res.status(400).json({ error: "Invalid _id" });
    }

    const session = await BiometricsAllowSybilsSession.findOne({ _id: objectId }).exec();

    if (!session) {
      return res.status(400).json({ error: "Session not found" });
    }

    if (session.status === biometricsAllowSybilsSessionStatusEnum.VERIFICATION_FAILED) {
      endpointLogger.verificationPreviouslyFailed(session);
      return res.status(400).json({
        error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
      });
    }

    const ISSUER_PRIVKEY = process.env.NODE_ENV === "production"
      ? process.env.HOLONYM_ISSUER_FACETEC_SYBILS_ALLOWED_BIOMETRICS_PRIVKEY
      : process.env.HOLONYM_ISSUER_FACETEC_SYBILS_ALLOWED_BIOMETRICS_PRIVKEY_DEV;
    const groupName = process.env.FACETEC_GROUP_NAME_FOR_SYBILS_ALLOWED_BIOMETRICS;

    // Validate required environment variables
    if (!ISSUER_PRIVKEY) {
      return res.status(500).json({ 
        error: `Missing environment variable: HOLONYM_ISSUER_FACETEC_BIOMETRICS_PRIVKEY` 
      });
    }
    
    if (!groupName) {
      return res.status(500).json({ 
        error: `Missing environment variable: FACETEC_GROUP_NAME_FOR_BIOMETRICS` 
      });
    }

    if (
      ![
        biometricsAllowSybilsSessionStatusEnum.PASSED_LIVENESS_CHECK,
        biometricsAllowSybilsSessionStatusEnum.ISSUED
      ].includes(session.status)
    ) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${biometricsAllowSybilsSessionStatusEnum.IN_PROGRESS}'`,
      });
    }

    // TODO: facetec: revisit the logic for reverification
    // delete old facetec 3d-db entry to allow re-verification ???

    // --- ISSUANCE ---

    // The "credentials" that we issue here, don't really matter, so we just sign a uuid.
    const refBuffers = uuidV4()
      .split("-")
      .map((x) => Buffer.from(x));
    const refArgs = refBuffers.map((x) => ethers.BigNumber.from(x).toString());
    const referenceHash = ethers.BigNumber.from(poseidon(refArgs)).toString();

    const issueV2Response = JSON.parse(
      issuev2(
        ISSUER_PRIVKEY,
        issuanceNullifier,
        "2", // reference to 3d-db groupName for biometrics
        referenceHash
      )
    );

    endpointLogger.info(
      `Issue biometrics-allow-sybils credentials`
    );

    await updateSessionStatus(session, biometricsAllowSybilsSessionStatusEnum.ISSUED, null);

    return res.status(200).json(issueV2Response);
  } catch (err) {
    // Otherwise, log the unexpected error
    endpointLogger.unexpected(err);

    // If this is our custom error, use its properties
    if (err.status && err.error) {
      return res.status(err.status).json(err);
    }

    return res.status(500).json({
      error: "An unexpected error occurred.",
    });
  }
}

export { getCredentials };
