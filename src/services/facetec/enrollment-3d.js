import axios from "axios";
import { ObjectId } from "mongodb";
import { Session, BiometricsSession } from "../../init.js";
import {
  sessionStatusEnum,
  facetecServerBaseURL,
} from "../../constants/misc.js";
import {
  getDateAsInt,
  sha256,
  govIdUUID,
  objectIdElevenMonthsAgo,
} from "../../utils/utils.js";
import {
  validateFaceTecResponse,
  saveCollisionMetadata,
  saveUserToDb,
  updateSessionStatus,
} from "./functions-creds.js";
import { ethers } from "ethers";
import { poseidon } from "circomlibjs-old";
import { issue as issuev2 } from "holonym-wasm-issuer-v2";
import { pinoOptions, logger } from "../../utils/logger.js";

// const postSessionsLogger = logger.child({
//   msgPrefix: "[POST /sessions] ",
//   base: {
//     ...pinoOptions.base,
//   },
// });

export async function enrollment3d(req, res) {
  try {
    const sid = req.body.sid;
    const faceTecParams = req.body.faceTecParams;
    const issuanceNullifier = req.params.nullifier;

    // sessionType = "kyc" | "biometrics"
    const sessionType = req.query.sessionType;

    let groupName = "";
    if (sessionType === "biometrics") {
      groupName = process.env.FACETEC_GROUP_NAME_FOR_BIOMETRICS;
    } else if (sessionType === "kyc") {
      groupName = process.env.FACETEC_GROUP_NAME_FOR_KYC;
    }

    if (!sid) {
      return res
        .status(400)
        .json({ error: true, errorMessage: "sid is required" });
    }
    if (!sessionType) {
      return res
        .status(400)
        .json({ error: true, errorMessage: "sessionType is required" });
    }
    if (!issuanceNullifier) {
      return res
        .status(400)
        .json({ error: true, errorMessage: "issuanceNullifier is required" });
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

    let session;
    if(sessionType === "biometrics") {
      session = await BiometricsSession.findOne({ _id: objectId }).exec();
    } else if(sessionType === "kyc") {
      session = await Session.findOne({ _id: objectId }).exec();
    } else {
      session = await Session.findOne({ _id: objectId }).exec();
    }

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
    if(sessionType === "biometrics") {
      await BiometricsSession.updateOne(
        { _id: objectId },
        { $inc: { num_facetec_liveness_checks: 1 } }
      );
    } else {
      await Session.updateOne(
        { _id: objectId },
        { $inc: { num_facetec_liveness_checks: 1 } }
      );
    }

    // console.log('device key', req.headers["x-device-key"])
    // console.log('x-user-agent', req.headers["x-user-agent"])
    // console.log('enrollment-3d faceTecParams', faceTecParams)
    try {
      if (sessionType === "biometrics") faceTecParams.storeAsFaceVector = true;
      
      req.app.locals.sseManager.sendToClient(sid, {
        status: "in_progress",
        message: "liveness check: sending to server",
      });

      const enrollmentResponse = await axios.post(
        `${facetecServerBaseURL}/enrollment-3d`,
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

      console.log("enrollmentResponse.data", enrollmentResponse.data);

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

    // console.log("facetec POST /enrollment-3d response:", data);

    // duplication check /3d-db/search
    // do duplication check here
    req.app.locals.sseManager.sendToClient(sid, {
      status: "in_progress",
      message: "duplicates check: sending to server",
    });

    console.log("/3d-db/search", {
      externalDatabaseRefID: session.externalDatabaseRefID,
      minMatchLevel: 15,
      groupName: groupName,
    });

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
      console.log("faceDbSearchResponse.data", faceDbSearchResponse.data);

      if (faceDbSearchResponse.data?.errorMessage?.includes("/3d-db/enroll first")) {
        console.log("Fresh/empty groupName detected, continuing with enrollment flow");
        // Continue with the flow instead of returning an error
      } else {
        if (faceDbSearchResponse.data?.results?.length > 0) {
          if(faceDbSearchResponse.data.results.length === 1 && faceDbSearchResponse.data.results[0].identifier === session.externalDatabaseRefID) {
            // Continue
            // search returns 1 result which is the same, so it is not a duplicate
          } else {
            // duplicates found, return error
            console.log(
              "duplicate check: found duplicates",
              faceDbSearchResponse.data.results.length,
              faceDbSearchResponse.data.results
            );

            // send event to user client
            req.app.locals.sseManager.sendToClient(sid, {
              status: "error",
              message: "found duplicates! verification has failed.",
            });

            await updateSessionStatus(
              session,
              sessionStatusEnum.VERIFICATION_FAILED,
              `Face scan failed as highly matching duplicates are found.`
            );

            return res.status(400).json({
              error: true,
              errorMessage: "duplicate check: found duplicates",
              instructions: "Verification has failed as highly matching duplicates are found.",
              triggerRetry: false,
            });
          }
        }
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

    // credentials issuance and 3d-dbenrollment logic happens via getCredentialsV3 endpoint
    // when /store page is accessed
    // here just return success and scanResultBlob
    if (sessionType === "biometrics") {
      req.app.locals.sseManager.sendToClient(sid, {
        status: "completed",
        message: "biometrics verification successful, proceed to mint SBT",
      });
    
      // return with issuedCreds and scanResultBlob
      return res.status(200).json({
        issuedCreds: true,
        scanResultBlob: data.scanResultBlob,
      });
    }

    // --- Forward response from FaceTec server ---

    if (data) return res.status(200).json(data);
    else
      return res.status(500).json({
        error: true,
        errorMessage: "An unknown error occurred",
        triggerRetry: true,
      });
  } catch (err) {
    console.log("POST /enrollment-3d: Error encountered", err.message);
    return res.status(500).json({
      error: true,
      errorMessage: "An unknown error occurred",
      triggerRetry: true,
    });
  }
}
