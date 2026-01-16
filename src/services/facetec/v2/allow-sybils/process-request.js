import axios from "axios";
import { ObjectId } from "mongodb";
import { BiometricsAllowSybilsSession } from "../../../../init.js";
import {
  biometricsSessionStatusEnum,
} from "../../../../constants/misc.js";
import {
  updateSessionStatus,
} from "../../functions-creds.js";
import { pinoOptions, logger } from "../../../../utils/logger.js";
import { getFaceTecBaseURL } from "../../../../utils/facetec.js";
import { v4 as uuidV4 } from "uuid";

const endpointLogger = logger.child({
  msgPrefix: "[POST /facetec/v2/allow-sybils/process-request] ",
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
    const faceTecParams = req.body.faceTecParams;

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

    const session = await BiometricsAllowSybilsSession.findOne({ _id: objectId }).exec();

    if (!session) {
      return res.status(400).json({ error: true, errorMessage: "Session not found" });
    }

    if (session.status !== biometricsSessionStatusEnum.IN_PROGRESS) {
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
        biometricsSessionStatusEnum.VERIFICATION_FAILED,
        failureReason
      );

      return res.status(400).json({
        error: failureReason,
      });
    }

    // generate one if not present - for older sessions
    if (!session.externalDatabaseRefID) {
      session.externalDatabaseRefID = uuidV4();
      await session.save();
    }

    // TODO: IP-based rate limiting

    const groupName = process.env.FACETEC_GROUP_NAME_FOR_SYBILS_ALLOWED_BIOMETRICS;

    // Validate required environment variables
    if (!groupName) {
      return res.status(500).json({ 
        error: `Missing environment variable: FACETEC_GROUP_NAME_FOR_SYBILS_ALLOWED_BIOMETRICS` 
      });
    }

    req.app.locals.sseManager.sendToClient(sid, {
      status: "in_progress",
      message: "liveness check: sending to server",
    });

    // Process Request
    const resp = await axios.post(
      `${getFaceTecBaseURL(req)}/process-request`,
      {
        ...faceTecParams,
        // We specifically do not pass an externalDatabaseRefID here because
        // we want FaceTec to only do a liveness check, not an enrollment
        // 18/11/2025: we now enroll and do duplicate check in a different groupName
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
    );

    // Technically, a request to /process-request is not necessarily a liveness
    // check. However, it seems that our biometrics flow makes only two calls
    // to process-request, so it is close enough for rate limiting purposes. 
    await BiometricsAllowSybilsSession.updateOne(
      { _id: objectId },
      { $inc: { num_facetec_liveness_checks: 1 } }
    );
    
    const data = resp.data;
    // console.log('/process-request response:', data);

    // The /process-request endpoint handles multiple request types. (The FaceTec docs and code
    // are unforunately not transparent about what it does exactly.) When it returns
    // "livenessProven", we assume that a liveness check was performed; and in this case,
    // we want to enroll the user.
    if (data?.result?.livenessProven) {
      // set session status to passed liveness check only after successful enrollment

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
        console.log("3d-db/enroll response:", resp.data);

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
    if (err.response) {
      let responseData = err.response?.data
      // No need to log requestBlob. It is uninformative, and it can be quite large
      // (which can result in larger datadog costs), so if it's present, we remove it.
      if (responseData?.requestBlob) {
        delete responseData.requestBlob
      }
      endpointLogger.error({
        responseData: err.response?.data,
        status: err.response?.status
      }, "POST /process-request: Error encountered");
    } else if (err.request) {
      endpointLogger.error({
        request: err.request
      }, "POST /process-request: Error encountered");
    } else {
      endpointLogger.error(err, "POST /process-request: Error encountered");
    }
    return res.status(500).json({
      error: true,
      errorMessage: "An unknown error occurred",
      triggerRetry: true,
    });
  }
}
