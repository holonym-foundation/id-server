import axios from "axios";
import { ObjectId } from "mongodb";
import { Session, BiometricsSession } from "../../../../init.js";
import {
  sessionStatusEnum,
  biometricsSessionStatusEnum
} from "../../../../constants/misc.js";
// import {
//   getDateAsInt,
//   sha256,
//   govIdUUID,
//   objectIdElevenMonthsAgo,
// } from "../../utils/utils.js";
// import {
//   validateFaceTecResponse,
//   saveCollisionMetadata,
//   saveUserToDb,
//   updateSessionStatus,
// } from "./functions-creds.js";
import {
  updateSessionStatus,
} from "../../functions-creds.js";
// import { ethers } from "ethers";
// import { poseidon } from "circomlibjs-old";
// import { issue as issuev2 } from "holonym-wasm-issuer-v2";
import { pinoOptions, logger } from "../../../../utils/logger.js";
import { getFaceTecBaseURL } from "../../../../utils/facetec.js";
// import { upgradeV3Logger } from "./error-logger.js";

const endpointLogger = logger.child({
  msgPrefix: "[POST /facetec/v2/no-sybils/process-request] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "facetec",
    feature: "holonym",
    subFeature: "enrollment",
  },
})

export async function processRequest(req, res) {
  try {
    console.log('/v2/no-sybils/process-request entered');
    const sid = req.body.sid;
    const faceTecParams = req.body.faceTecParams

    if (!sid) {
      return res
        .status(400)
        .json({ error: true, errorMessage: "sid is required" });
    }

    let objectId = null;
    try {
      objectId = new ObjectId(sid);
    } catch (err) {
      return res.status(400).json({ error: true, errorMessage: "Invalid sid" });
    }

    const session = await BiometricsSession.findOne({ _id: objectId }).exec();

    console.log('/v2/no-sybils/process-request session:', session);

    if (!session) {
      return res.status(400).json({ error: true, errorMessage: "Session not found" });
    }

    if (session.status !== sessionStatusEnum.IN_PROGRESS) {
      return res
        .status(400)
        .json({ error: true, errorMessage: `Session is not in progress. It is ${session.status}.` });
    }

    if (session.num_facetec_liveness_checks >= 15) {
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

    // TODO: IP-based rate limiting

    const groupName = process.env.FACETEC_GROUP_NAME_FOR_BIOMETRICS;

    // Process Request
    const resp = await axios.post(
      `${getFaceTecBaseURL(req)}/process-request`,
      {
        ...faceTecParams,
        externalDatabaseRefID: session.externalDatabaseRefID,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Device-Key": req.headers["x-device-key"],
          // "X-User-Agent": req.headers["x-user-agent"] || "human-id-server",
          "X-Api-Key": process.env.FACETEC_SERVER_API_KEY,
        },
      }
    )

    // Technically, a request to /process-request is not necessarily a liveness
    // check. However, it seems that our biometrics flow makes only two calls
    // to process-request, so it is close enough for rate limiting purposes. 
    await BiometricsSession.updateOne(
      { _id: objectId },
      { $inc: { num_facetec_liveness_checks: 1 } }
    );

    const data = resp.data;
    // console.log('/process-request response:', data);
    console.log('/v2/no-sybils/process-request response from /process-request:', JSON.stringify(data));

    // The /process-request endpoint handles multiple request types. (The FaceTec docs and code
    // are unforunately not transparent about what it does exactly.) When it returns
    // "livenessProven", we assume that a liveness check was performed; and in this case,
    // we want to enroll the user.
    if (data?.result?.livenessProven) {
      console.log('/v2/no-sybils/process-request sending /3d-db/enroll request');
      req.app.locals.sseManager.sendToClient(sid, {
        status: "in_progress",
        message: "liveness check: sending to server",
      });

      // 3d-db/enroll
      try {
        const resp = await axios.post(
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
        // console.log("3d-db/enroll response:", resp.data);
        console.log('/v2/no-sybils/process-request response from /3d-db/enroll:', JSON.stringify(resp.data));

        if (!resp.data.success || !resp.data.wasProcessed) {
          endpointLogger.info(
            {
              externalDatabaseRefID: session.externalDatabaseRefID,
              responseData: resp.data,
            },
            `/3d-db/enroll failed`
          );
          
          // one of the reason might be that verification enrollment does not exit
          // just return and exit the flow, do not proceed with issuance
          return res
            .status(400)
            .json({ error: "duplicate check: /3d-db enrollment failed" });
        } else {
          console.log('/v2/no-sybils/process-request request to /3d-db/enroll was successful');
          session.status = biometricsSessionStatusEnum.PASSED_LIVENESS_CHECK;
          await session.save();
          req.app.locals.sseManager.sendToClient(sid, {
            status: "completed",
            message: "biometrics verification successful, proceed to next step",
          });
        }
      } catch (err) {
        endpointLogger.error(err, "Error during /3d-db/enroll");
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
    }

    return res.status(200).json(data);
  } catch (err) {
    endpointLogger.error(err, "POST /process-request: Error encountered");
    return res.status(500).json({
      error: true,
      errorMessage: "An unknown error occurred",
      triggerRetry: true,
    });
  }
}
