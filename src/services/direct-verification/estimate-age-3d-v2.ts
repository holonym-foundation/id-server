import axios from "axios";
import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { DVSession } from "../../init.js";
import {
  directVerificationSessionStatusEnum as dvStatuses,
} from "../../constants/misc.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { getFaceTecBaseURL } from "../../utils/facetec.js";
import { SSE_NAMESPACE } from "./constants.js"
import { customerFromAPIKey } from "./functions.js"

const endpointLogger =logger.child({
  msgPrefix: "[POST /direct-verification/estimate-age-3d-v2] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "facetec",
    feature: "holonym",
    subFeature: "estimate-age-3d-v2",
  },
})

export async function estimateAge3dV2(req: Request, res: Response) {
  try {
    // We don't check for the API key here. We know the session was created
    // by a valid customer, there's no reason to rate limit this endpoint 
    // by customer, and the customer API key isn't secret.
    // Make sure the API key corresponds to some customer
    // const _customer = await customerFromAPIKey(req)
    
    const sid = req.body.sid;

    let oid = null;
    try {
      oid = new ObjectId(sid);
    } catch (err) {
      return res.status(400).json({ error: "Invalid sid" })
    }

    const session = await DVSession.findOne({ _id: oid })

    if (!session) {
      return res.status(400).json({ error: "Session not found" })
    }

    if (session.status !== dvStatuses.ENROLLED) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${dvStatuses.ENROLLED}'`
      })
    }
    const userId = session.userId.toString()

    // --- Forward request to FaceTec server ---

    // age enum value of 5 indicates over 18 (see https://dev.facetec.com/api-guide#estimate-age-3d)
    const AGE_CHECK_TARGET = 5

    try {
      const checkAgeResponse = await axios.post(
        `${getFaceTecBaseURL(req)}/estimate-age-3d-v2`,
        {
          externalDatabaseRefID: userId,
          ageCheckTargetEnumInt: AGE_CHECK_TARGET,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-Device-Key": req.headers["x-device-key"],
            "X-User-Agent": req.headers["x-user-agent"] || "human-id-server",
            "X-Api-Key": process.env.FACETEC_SERVER_API_KEY,
          },
        }
      )

      if (!checkAgeResponse.data.ageV2GroupEnumInt) {
        endpointLogger.error(
          { respData: checkAgeResponse.data },
          "FaceTec response missing ageV2GroupEnumInt"
        );
        return res.status(400).json({
          error: "FaceTec server missing necessary data"
        })
      }

      if (checkAgeResponse.data.ageV2GroupEnumInt >= AGE_CHECK_TARGET) {
        endpointLogger.info({}, "User passed age verification");

        session.status = dvStatuses.PASSED_AGE_VERIFICATION
        await session.save()

        return res.status(200).json({
          success: true,
          ageV2GroupEnumInt: checkAgeResponse.data.ageV2GroupEnumInt,
        })
      } else {
        endpointLogger.error(
          { userId: session.userId.toString() },
          "User failed age verification"
        );
        session.status = dvStatuses.VERIFICATION_FAILED
        await session.save()

        req.app.locals.sseManager.sendToClient(SSE_NAMESPACE + sid, {
          status: "completed",
          message: "age check successful",
        });

        return res.status(400).json({
          error: "Verification failed. User's age is below target age.",
          triggerRetry: false,
        })
      }
    } catch (err: any) {
      if (err.request) {
        endpointLogger.error(
          { error: err.request.data },
          "(err.request) Error during estimate-age-3d-v2"
        );

        return res.status(502).json({
          error: true,
          errorMessage: "Did not receive a response from the server during estimate-age-3d-v2",
          triggerRetry: true,
        });
      } else if (err.response) {
        endpointLogger.error(
          { error: err.response.data },
          "(err.response) Error during estimate-age-3d-v2"
        );

        return res.status(err.response.status).json({
          error: true,
          errorMessage: "Server returned an error during estimate-age-3d-v2",
          data: err.response.data,
          triggerRetry: true,
        });
      } else {
        endpointLogger.error({ error: err }, "Error during estimate-age-3d-v2");
        return res.status(500).json({
          error: true,
          errorMessage: "An unknown error occurred",
          triggerRetry: true,
        });
      }
    }
  } catch (err) {
    endpointLogger.error(err, "Error encountered");
    return res.status(500).json({
      error: true,
      errorMessage: "An unknown error occurred",
      triggerRetry: true,
    });
  }
}
