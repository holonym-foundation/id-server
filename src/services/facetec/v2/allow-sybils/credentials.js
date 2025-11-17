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
import { pinoOptions, logger } from "../../../../utils/logger.js";
import { biometricsAllowSybilsSessionStatusEnum } from "../../../../constants/misc.js";
import { getFaceTecBaseURL } from "../../../../utils/facetec.js";
import { upgradeV3Logger } from "../../error-logger.js";

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

    // log session, to debug for race condition
    logger.info({ session }, "Session found");

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
        error: `Missing environment variable: FACETEC_GROUP_NAME_FOR_SYBILS_ALLOWED_BIOMETRICS` 
      });
    }

    if (
      ![
        biometricsAllowSybilsSessionStatusEnum.PASSED_LIVENESS_CHECK,
        biometricsAllowSybilsSessionStatusEnum.ISSUED
      ].includes(session.status)
    ) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${biometricsAllowSybilsSessionStatusEnum.PASSED_LIVENESS_CHECK}'`,
      });
    }

    // TODO: facetec: revisit the logic for reverification
    // delete old facetec 3d-db entry to allow re-verification ???

    // --- ISSUANCE ---
    // search for duplicates first /3d-db/search
    try {
      const faceDbSearchResponse = await axios.post(
        `${getFaceTecBaseURL(req)}/3d-db/search`,
        {
          externalDatabaseRefID: session.externalDatabaseRefID,
          minMatchLevel: 15,
          groupName: groupName,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-Device-Key": req.headers["x-device-key"],
            "X-User-Agent": req.headers["x-user-agent"] || "human-id-server",
            "X-Api-Key": process.env.FACETEC_SERVER_API_KEY,
          },
        }
      );

      if (faceDbSearchResponse.data?.success && faceDbSearchResponse.data?.results) {
        if (faceDbSearchResponse.data.results.length === 0) {
          // search returns 0 result
          // so continue with enrollment flow
        } else if(faceDbSearchResponse.data.results.length === 1 && faceDbSearchResponse.data.results[0].identifier === session.externalDatabaseRefID) {
          // search returns 1 result which is the same, so it is not a duplicate
          // so continue with enrollment flow
        } else { 
          // TODO: Get the externalDatabaseRefID of each result. For each result find it in the UserVerifications collection. For each
          // document in the collection, check if it was inserted within the last 11 months. If there were any inserted within the last
          // 11 months, then DO NOT issue credentials (the user is a sybil); otherwise, issue credentials

          // duplicates found, return error
          endpointLogger.error(
            {
              resultsLength: faceDbSearchResponse.data.results.length,
              results: faceDbSearchResponse.data.results,
              externalDatabaseRefID: session.externalDatabaseRefID,
            },
            "Duplicate check: found duplicates"
          );
          session.status = biometricsAllowSybilsSessionStatusEnum.VERIFICATION_FAILED;
          session.verificationFailureReason = `Face scan failed as highly matching duplicates are found.`;
          await session.save();

          return res.status(400).json({
            error: true,
            errorMessage: "duplicate check: found duplicates",
            triggerRetry: false,
          });
        }
      } else if (faceDbSearchResponse.data?.errorMessage?.includes("/3d-db/enroll first")) {
        endpointLogger.info({ externalDatabaseRefID: session.externalDatabaseRefID }, "Fresh/empty groupName detected, continuing with enrollment flow");
        // Continue with the flow instead of returning an error
      } else {
        endpointLogger.error(
          {
            responseData: faceDbSearchResponse.data,
          },
          "Duplicate check: /3d-db/search encountered an error"
        );
        return res.status(400).json({
          error: true,
          errorMessage: "duplicate check: /3d-db/search encountered an error",
          triggerRetry: true,
        });
      }
    } catch (err) {
      endpointLogger.error(err, "Error during /3d-db/search");

      if (err.request) {
        return res.status(502).json({
          error: true,
          errorMessage: "Did not receive a response from the server during duplicate check",
          triggerRetry: true,
        });
      } else if (err.response) {
        return res.status(err.response.status).json({
          error: true,
          errorMessage: "Server returned an error during duplicate check",
          data: err.response.data,
          triggerRetry: true,
        });
      } else {
        return res.status(500).json({
          error: true,
          errorMessage: "An unknown error occurred during duplicate check",
          triggerRetry: true,
        });
      }
    }
    
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

    session.status = biometricsAllowSybilsSessionStatusEnum.ISSUED;
    await session.save();

    return res.status(200).json(issueV2Response);
  } catch (err) {
    // Otherwise, log the unexpected error
    endpointLogger.unexpected(err);

    // If this is our custom error, use its properties
    if (err && err.status && err.error) {
      return res.status(err.status).json(err);
    }

    return res.status(500).json({
      error: "An unexpected error occurred.",
    });
  }
}

export { getCredentials };