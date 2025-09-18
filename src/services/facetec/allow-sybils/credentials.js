import axios from "axios";
import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { poseidon } from "circomlibjs-old";
import { ObjectId } from "mongodb";
import {
  BiometricsAllowSybilsSession,
} from "../../../init.js";
import { issue as issuev2 } from "holonym-wasm-issuer-v2";
import {
  validateUUIDv4,
} from "../../../utils/utils.js";
import { pinoOptions, logger } from "../../../utils/logger.js";
import { sessionStatusEnum } from "../../../constants/misc.js";
import { getFaceTecBaseURL } from "../../../utils/facetec.js";
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

/**
 * ENDPOINT
 * 
 * The same as getCredentialsV3, except it signs credentials using a different
 * private key and does not prevent sybils.
 */
async function getCredentialsAllowSybils(req, res) {
  try {
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

    if (session.status === sessionStatusEnum.VERIFICATION_FAILED) {
      endpointLoggerV3.verificationPreviouslyFailed(session.externalDatabaseRefID, session);
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
        error: `Missing environment variable: private key for issuance` 
      });
    }
    
    if (!groupName) {
      return res.status(500).json({ 
        error: `Missing environment variable: group name` 
      });
    }

    // If the session isn't in progress or issued, we do not issue credentials
    if (![sessionStatusEnum.IN_PROGRESS, sessionStatusEnum.ISSUED].includes(session.status)) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
      });
    }

    // redundant check for session.externalDatabaseRefID is valid uuid V4
    if (!validateUUIDv4(session.externalDatabaseRefID)) {
      return res.status(400).json({
        error: "Invalid externalDatabaseRefID. It must be a valid UUID V4",
      });
    }
 
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

      if (faceDbSearchResponse.data.success && faceDbSearchResponse.data.wasProcessed) {
        // do nothing
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
        `${getFaceTecBaseURL(req)}/3d-db/enroll`,
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
      if (
        (faceDbEnrollResponse.data.success && faceDbEnrollResponse.data.wasProcessed) ||
        faceDbEnrollResponse.data.errorMessage.includes("enrollment already exists")
      ) {
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
            "2", // reference to 3d-db groupName for non-sybil resistant biometrics
            referenceHash
          )
        );

        endpointLoggerV3.info(
          { 
            externalDatabaseRefID: session.externalDatabaseRefID
          },
          `Issue credentials`
        );

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

export { getCredentialsAllowSybils };
