import axios from "axios";
import { ObjectId } from "mongodb";
import { Session, BiometricsSession } from "../../../../init.js";
import {
  sessionStatusEnum,
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

    // TODO: SSE and IP-based rate limiting

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

    const data = resp.data;
    // console.log('/process-request response:', data);

    // The /process-request endpoint handles multiple request types. (The FaceTec docs and code
    // are unforunately not transparent about what it does exactly.) When it returns
    // "livenessProven", we assume that a liveness check was performed; and in this case,
    // we want to enroll the user.
    if (data?.result?.livenessProven) {
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
        
        await BiometricsSession.updateOne(
          { _id: objectId },
          { $inc: { num_facetec_liveness_checks: 1 } }
        );
      } catch (err) {
        console.error("Error during 3d-db/enroll:", err.response ? err.response.data : err.message);
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
