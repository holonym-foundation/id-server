import axios from "axios";
import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { poseidon } from "circomlibjs-old";
import { ObjectId } from "mongodb";
import {
  Session,
  BiometricsSession,
  UserVerifications,
  VerificationCollisionMetadata,
  BiometricsNullifierAndCreds,
} from "../../init.js";
import { issue as issuev2 } from "holonym-wasm-issuer-v2";
import {
  getDateAsInt,
  sha256,
  govIdUUID,
  validateUUIDv4,
  objectIdElevenMonthsAgo,
  objectIdFiveDaysAgo,
} from "../../utils/utils.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { sessionStatusEnum, facetecServerBaseURL } from "../../constants/misc.js";
import {
  findOneUserVerificationLast11Months,
  findOneUserVerification11Months5Days,
} from "../../utils/user-verifications.js";
import { findOneNullifierAndCredsLast5Days } from "../../utils/biometrics-nullifier-and-creds.js";
import { upgradeV3Logger } from "./error-logger.js";
import {
  updateSessionStatus,
} from "./functions-creds.js";

const endpointLoggerV3 = upgradeV3Logger(
  logger.child({
    msgPrefix: "[GET /facetec/v3/credentials] ",
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
    endpointLoggerV3.error(
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
 *
 * Compared to the v1 and v2 endpoints, this one allows the user to get their
 * credentials up to 5 days after initial issuance, if they provide the
 * same nullifier.
 */
async function getCredentialsV3(req, res) {
  try {
    // Caller must specify a session ID and a nullifier. We first lookup the user's creds
    // using the nullifier. If no hit, then we lookup the credentials using the session ID.
    const _id = req.params._id;
    const issuanceNullifier = req.params.nullifier;
    const sessionType = req.params.sessionType;

    // Validate sessionType
    if (!sessionType || (sessionType !== "biometrics" && sessionType !== "kyc")) {
      return res.status(400).json({ 
        error: "sessionType parameter is required and must be either 'biometrics' or 'kyc'" 
      });
    }

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

    let session = null;
    if (sessionType === "biometrics") {
      session = await BiometricsSession.findOne({ _id: objectId }).exec();
    } else {
      session = await Session.findOne({ _id: objectId }).exec();
    }

    if (!session) {
      return res.status(400).json({ error: "Session not found" });
    }

    if (session.status === sessionStatusEnum.VERIFICATION_FAILED) {
      endpointLoggerV3.verificationPreviouslyFailed(session.externalDatabaseRefID, session);
      return res.status(400).json({
        error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
      });
    }

    let ISSUER_PRIVKEY, groupName;
    if (sessionType === "biometrics") {
      ISSUER_PRIVKEY = process.env.NODE_ENV === "production" ? process.env.HOLONYM_ISSUER_FACETEC_BIOMETRICS_PRIVKEY : process.env.HOLONYM_ISSUER_FACETEC_BIOMETRICS_PRIVKEY_DEV;
      groupName = process.env.FACETEC_GROUP_NAME_FOR_BIOMETRICS;
    } else {
      ISSUER_PRIVKEY = process.env.NODE_ENV === "production" ? process.env.HOLONYM_ISSUER_FACETEC_KYC_PRIVKEY : process.env.HOLONYM_ISSUER_FACETEC_KYC_PRIVKEY_DEV;
      groupName = process.env.FACETEC_GROUP_NAME_FOR_KYC;
    }

    // Validate required environment variables
    if (!ISSUER_PRIVKEY) {
      return res.status(500).json({ 
        error: `Missing environment variable: HOLONYM_ISSUER_FACETEC_${sessionType.toUpperCase()}_PRIVKEY` 
      });
    }
    
    if (!groupName) {
      return res.status(500).json({ 
        error: `Missing environment variable: FACETEC_GROUP_NAME_FOR_${sessionType.toUpperCase()}` 
      });
    }

    // logic for facetec
    // it is slightly different as we are relying on face duplication check for uniqueness
    
    // TODO: facetec: revisit the logic for reverification
    // delete old facetec 3d-db entry to allow re-verification ???

    const nullifierAndCreds = await findOneNullifierAndCredsLast5Days(
      issuanceNullifier
    );
    const externalDatabaseRefIDFromNullifier =
      nullifierAndCreds?.idvSessionIds?.facetec?.externalDatabaseRefID;

    // retrieval of credentials
    if (externalDatabaseRefIDFromNullifier) {
      // issue credentials
      const refBuffers = externalDatabaseRefIDFromNullifier
        .split("-")
        .map((x) => Buffer.from(x));
      const refArgs = refBuffers.map((x) => ethers.BigNumber.from(x).toString());
      const referenceHash = ethers.BigNumber.from(poseidon(refArgs)).toString();
  
      const issueV2Response = JSON.parse(
        issuev2(
          ISSUER_PRIVKEY,
          issuanceNullifier,
          "1", // reference to 3d-db groupName for biometrics
          referenceHash
        )
      );

      endpointLoggerV3.info(
        { 
          externalDatabaseRefID: session.externalDatabaseRefID
        },
        `Issue ${sessionType} credentials with issuanceNullifier`
      );
      
      await updateSessionStatus(session, sessionStatusEnum.ISSUED, null);

      return res.status(200).json(issueV2Response);
    }

    // If the session isn't in progress, we do not issue credentials. If the session is ISSUED,
    // then the lookup via nullifier should have worked above.
    if (session.status !== sessionStatusEnum.IN_PROGRESS) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
      });
    }

    // ISSUANCE for the first time then save nullifierAndCreds mapping

    // redundant check for session.externalDatabaseRefID is valid uuid V4
    if (!validateUUIDv4(session.externalDatabaseRefID)) {
      return res.status(400).json({
        error: "Invalid externalDatabaseRefID. It must be a valid UUID V4",
      });
    }
 
    // as facetec is used for deduplication
    // there is no need for saveCollisionMetadata logic

    // search for duplicates first /3d-db/search
    try {
      const faceDbSearchResponse = await axios.post(
        `${facetecServerBaseURL}/3d-db/search`,
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
        if(faceDbSearchResponse.data.results.length === 0) {
          // search returns 0 result
          // so continue with enrollment flow
        } else if(faceDbSearchResponse.data.results.length === 1 && faceDbSearchResponse.data.results[0].identifier === session.externalDatabaseRefID) {
          // search returns 1 result which is the same, so it is not a duplicate
          // so continue with enrollment flow
        } else { 
          // duplicates found, return error
          endpointLoggerV3.error(
            {
              resultsLength: faceDbSearchResponse.data.results.length,
              results: faceDbSearchResponse.data.results,
              externalDatabaseRefID: session.externalDatabaseRefID,
            },
            "Duplicate check: found duplicates"
          );
          await updateSessionStatus(
            session,
            sessionStatusEnum.VERIFICATION_FAILED,
            `Face scan failed as highly matching duplicates are found.`
          );

          return res.status(400).json({
            error: true,
            errorMessage: "duplicate check: found duplicates",
            triggerRetry: false,
          });
        }
      } else if (faceDbSearchResponse.data?.errorMessage?.includes("/3d-db/enroll first")) {
        endpointLoggerV3.info({ externalDatabaseRefID: session.externalDatabaseRefID }, "Fresh/empty groupName detected, continuing with enrollment flow");
        // Continue with the flow instead of returning an error
      } else {
        endpointLoggerV3.error(
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
      endpointLoggerV3.error(err, "Error during /3d-db/search");

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

    // do /3d-db/enroll (verify page only did /3d-db/search)
    try {
      const faceDbEnrollResponse = await axios.post(
        `${facetecServerBaseURL}/3d-db/enroll`,
        {
          externalDatabaseRefID: session.externalDatabaseRefID,
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

      // this should be a rare case if the user has done proper verification enrollment
      if (faceDbEnrollResponse.data.success && faceDbEnrollResponse.data.wasProcessed) {
        // enrollment successful
        // so continue with issuance
        const refBuffers = session.externalDatabaseRefID
          .split("-")
          .map((x) => Buffer.from(x));
        const refArgs = refBuffers.map((x) => ethers.BigNumber.from(x).toString());
        const referenceHash = ethers.BigNumber.from(poseidon(refArgs)).toString();

        const issueV2Response = JSON.parse(
          issuev2(
            ISSUER_PRIVKEY,
            issuanceNullifier,
            "1", // reference to 3d-db groupName for biometrics
            referenceHash
          )
        );

        endpointLoggerV3.info(
          { 
            externalDatabaseRefID: session.externalDatabaseRefID
          },
          `Issue ${sessionType} credentials`
        );
        
        // Store UUID for Sybil resistance
        const uuidNew = govIdUUID(session.externalDatabaseRefID, "", "");
        const dbResponse = await saveUserToDb(uuidNew);
        if (dbResponse.error) return res.status(400).json(dbResponse);

        // save nullifierAndCreds mapping for subsequent retrieval of credentials
        const newNullifierAndCreds = new BiometricsNullifierAndCreds({
          holoUserId: session.sigDigest,
          issuanceNullifier,
          uuidV2: uuidNew,
          idvSessionIds: {
            facetec: {
              externalDatabaseRefID: session.externalDatabaseRefID,
            },
          },
        });
        await newNullifierAndCreds.save();

        await updateSessionStatus(session, sessionStatusEnum.ISSUED, null);

        return res.status(200).json(issueV2Response);
      } else {
        endpointLoggerV3.info(
          {
            externalDatabaseRefID: session.externalDatabaseRefID,
            responseData: faceDbEnrollResponse.data,
          },
          `/3d-db/enroll failed`
        );
        
        // one of the reason might be that verification enrollment does not exit
        // just return and exit the flow, do not proceed with issuance
        return res
          .status(400)
          .json({ error: "duplicate check: /3d-db enrollment failed" });
      }
    } catch (err) {
      endpointLoggerV3.error(err, "Error during /3d-db/enroll");
      if (err.request) {
        return res.status(502).json({
          error: true,
          errorMessage: "Did not receive a response from the server during /3d-db/enroll",
          triggerRetry: true,
        });
      } else if (err.response) {
        return res.status(err.response.status).json({
          error: true,
          errorMessage: "The server returned an error during /3d-db/enroll",
          data: err.response.data,
          triggerRetry: true,
        }); 
      } else {
        return res.status(500).json({
          error: true,
          errorMessage: "An unknown error occurred during /3d-db/enroll",
          triggerRetry: true,
        });
      }
    }
  } catch (err) {
    // Otherwise, log the unexpected error
    endpointLoggerV3.unexpected(err);

    // If this is our custom error, use its properties
    if (err.status && err.error) {
      return res.status(err.status).json(err);
    }

    return res.status(500).json({
      error: "An unexpected error occurred.",
    });
  }
}

export { getCredentialsV3 };
