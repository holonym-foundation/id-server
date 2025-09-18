import axios from "axios";
import { ObjectId } from "mongodb";
import { BiometricsAllowSybilsSession } from "../../../init.js";
import {
  sessionStatusEnum,
} from "../../../constants/misc.js";
import {
  getDateAsInt,
  sha256,
  govIdUUID,
  objectIdElevenMonthsAgo,
} from "../../../utils/utils.js";
import {
  validateFaceTecResponse,
  saveCollisionMetadata,
  saveUserToDb,
  updateSessionStatus,
} from "./functions-creds.js";
import { ethers } from "ethers";
import { poseidon } from "circomlibjs-old";
import { issue as issuev2 } from "holonym-wasm-issuer-v2";
import { pinoOptions, logger } from "../../../utils/logger.js";
import { getFaceTecBaseURL } from "../../../utils/facetec.js";
import { upgradeV3Logger } from "./error-logger.js";

const endpointLoggerV3 = upgradeV3Logger(
  logger.child({
    msgPrefix: "[POST /facetec/allow-sybils/enrollment-3d] ",
    base: {
      ...pinoOptions.base,
      idvProvider: "facetec",
      feature: "holonym",
      subFeature: "enrollment",
    },
  })
);

export async function enrollment3dAllowSybils(req, res) {
  try {
    const sid = req.body.sid;
    const faceTecParams = req.body.faceTecParams;

    const groupName = process.env.FACETEC_GROUP_NAME_FOR_SYBILS_ALLOWED_BIOMETRICS;

    if (!sid) {
      return res
        .status(400)
        .json({ error: true, errorMessage: "sid is required" });
    }
    
    if (!faceTecParams) {
      return res
        .status(400)
        .json({ error: true, errorMessage: "faceTecParams is required" });
    }

    // --- Validate id-server session ---
    let objectId = null;
    try {
      objectId = new ObjectId(sid);
    } catch (err) {
      return res.status(400).json({ error: true, errorMessage: "Invalid sid" });
    }

    const session = await BiometricsAllowSybilsSession.findOne({ _id: objectId }).exec();

    if (!session) {
      return res
        .status(404)
        .json({ error: true, errorMessage: "Session not found" });
    }

    if (session.status !== sessionStatusEnum.IN_PROGRESS) {
      return res
        .status(400)
        .json({ error: true, errorMessage: `Session is not in progress. It is ${session.status}.` });
    }

    if (session.num_facetec_liveness_checks >= 5) {
      const failureReason =
        "User has reached the maximum number of allowed FaceTec liveness checks";
      // Fail session so user can collect refund
      await updateSessionStatus(
        session,
        sessionStatusEnum.VERIFICATION_FAILED,
        failureReason
      );

      return res.status(400).json({
        error: failureReason,
      });
    }

    // set externalDatabaseRefID to session.externalDatabaseRefID
    faceTecParams.externalDatabaseRefID = session.externalDatabaseRefID;

    // --- Forward request to FaceTec server ---

    let data = null;
    // TODO: For rate limiting, allow the user to enroll up to 5 times.
    // Once the user has reached this limit, do not allow them to create any more
    // facetec session tokens; also, obviously, do not let them enroll anymore.

    // Increment num_facetec_liveness_checks.
    // TODO: Make this atomic. Right now, this endpoint is subject to a
    // time-of-check-time-of-use attack. It's not a big deal since we only
    // care about a loose upper bound on the number of FaceTec checks per
    // user, but atomicity would be nice.
    await BiometricsAllowSybilsSession.updateOne(
      { _id: objectId },
      { $inc: { num_facetec_liveness_checks: 1 } }
    );

    try {
      faceTecParams.storeAsFaceVector = true;
      
      req.app.locals.sseManager.sendToClient(sid, {
        status: "in_progress",
        message: "liveness check: sending to server",
      });

      const enrollmentResponse = await axios.post(
        `${getFaceTecBaseURL(req)}/enrollment-3d`,
        faceTecParams,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Device-Key": req.headers["x-device-key"],
            "X-User-Agent": req.headers["x-user-agent"] || "human-id-server",
            "X-Api-Key": process.env.FACETEC_SERVER_API_KEY,
          },
        }
      );

      // check for enrollment success
      if (!enrollmentResponse.data.success) {
        // YES, session is still IN_PROGRESS
        // TODO: facetec: user should be able to retry enrollment
        let falseChecks = 0;
        
        if (enrollmentResponse.data.faceScanSecurityChecks) {
          falseChecks = Object.values(
            enrollmentResponse.data.faceScanSecurityChecks
          ).filter((value) => value === false).length;
        }

        if (falseChecks > 0) {
          return res.status(400).json({
            error: true,
            // errorMessage: `liveness check failed. ${falseChecks} out of ${
            //   enrollmentResponse.data.faceScanSecurityChecks 
            //     ? Object.keys(enrollmentResponse.data.faceScanSecurityChecks).length 
            //     : 0
            // } checks failed`,
            errorMessage: `Liveness check failed`,
            instructions: "Try again with better lighting and face clearly visible.\nStill having trouble? Use mobile instead.",
            triggerRetry: true,
          });
        } else if (enrollmentResponse.data.errorMessage.includes("enrollment already exists")) {
          // just do nothing, continue with the flow
        } else {
          return res.status(400).json({
            error: true,
            errorMessage: `liveness enrollment failed. ${enrollmentResponse.data.errorMessage}`,
            triggerRetry: true,
          });
        }
      }

      data = enrollmentResponse.data;
    } catch (err) {
      // For face scan and enrollment, one relevant error could come from faceScanSecurityChecks
      // user would be able to retry untill max attempts are reached
      // TODO: facetec: Look into facetec errors. For some, we
      // might want to fail the user's id-server session. For most,
      // we probably just want to forward the error to the user.

      if (err.request) {
        console.error(
          { error: err.request.data },
          "(err.request) Error during enrollment-3d"
        );

        return res.status(502).json({
          error: true,
          errorMessage: "Did not receive a response from the server during enrollment-3d",
          triggerRetry: true,
        });
      } else if (err.response) {
        console.error(
          { error: err.response.data },
          "(err.response) Error during enrollment-3d"
        );

        return res.status(err.response.status).json({
          error: true,
          errorMessage: "Server returned an error during enrollment-3d",
          data: err.response.data,
          triggerRetry: true,
        });
      } else {
        console.error("err");
        console.error({ error: err }, "Error during enrollment-3d");
        return res.status(500).json({
          error: true,
          errorMessage: "An unknown error occurred",
          triggerRetry: true,
        });
      }
    }

    // duplication check /3d-db/search
    // do duplication check here
    req.app.locals.sseManager.sendToClient(sid, {
      status: "in_progress",
      message: "duplicates check: sending to server",
    });

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
      console.error("Error during /3d-db/search:", err.message);

      if (err.request) {
        console.error("No response received from the server during duplicate check");
        return res.status(502).json({
          error: true,
          errorMessage: "Did not receive a response from the server during duplicate check",
          triggerRetry: true,
        });
      } else if (err.response) {
        console.error(
          { error: err.response.data },
          "(err.response) Error during duplicate check"
        );
        return res.status(err.response.status).json({
          error: true,
          errorMessage: "Server returned an error during duplicate check",
          data: err.response.data,
          triggerRetry: true,
        });
      } else {
        console.error("Unknown error:", err);
        return res.status(500).json({
          error: true,
          errorMessage: "An unknown error occurred during duplicate check",
          triggerRetry: true,
        });
      }
    }

    // credentials issuance and 3d-db enrollment logic happens via getCredentialsV3 endpoint
    // when /store page is accessed
    // here just return success and scanResultBlob
    req.app.locals.sseManager.sendToClient(sid, {
      status: "completed",
      message: "biometrics verification successful, proceed to mint SBT",
    });
  
    // return with issuedCreds and scanResultBlob
    return res.status(200).json({
      issuedCreds: true,
      scanResultBlob: data.scanResultBlob,
    });
  } catch (err) {
    endpointLoggerV3.error(err, "POST /enrollment-3d: Error encountered");
    return res.status(500).json({
      error: true,
      errorMessage: "An unknown error occurred",
      triggerRetry: true,
    });
  }
}
