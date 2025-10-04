import axios from "axios";
import { Request, Response } from "express"
import { ObjectId } from "mongodb";
import { DVSession, DVCustomer } from "../../../init.js";
import {
  directVerificationSessionStatusEnum as dvStatuses
} from "../../../constants/misc.js";
import { pinoOptions, logger } from "../../../utils/logger.js";
import { getFaceTecBaseURL } from "../../../utils/facetec.js";
// import { upgradeV3Logger } from "./error-logger.js";
import { validateCustomerCreditUsage } from "../functions.js";

const endpointLogger = logger.child({
  msgPrefix: "[POST /direct-verification/age-check/process-request] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "facetec",
    feature: "holonym",
    subFeature: "enrollment",
  },
})

export async function processRequest(req: Request, res: Response) {
  try {
    const sid = req.body.sid;
    const faceTecParams = req.body.faceTecParams

    // TODO: SSE
    // TODO: session-based and IP-based rate limiting

    if (!sid || typeof sid !== "string") {
      return res.status(400).json({ error: "sid is required and must be a string" })
    }

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

    if (session.status !== dvStatuses.IN_PROGRESS) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${dvStatuses.IN_PROGRESS}'`
      })
    }
    const userId = session.userId.toString()

    const customerId = session.customerId;
    const customer = await DVCustomer.findOne({ _id: customerId })
    
    if (!customer) {
      return res.status(400).json({ error: "Customer not found" })
    }

    await validateCustomerCreditUsage(customer)

    // NOTE: We might change this, depending on whether we offer other kinds of verification
    // const groupName = 'direct-verification-age'

    if (!faceTecParams) {
      return res
        .status(400)
        .json({ error: "faceTecParams is required" });
    }

    faceTecParams.externalDatabaseRefID = userId

    // Process Request
    // Ignoring "Property 'post' does not exist on type 'typeof import(...)'"
    // @ts-ignore
    const resp = await axios.post(
      `${getFaceTecBaseURL(req)}/process-request`,
      {
        ...faceTecParams,
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
    // we want to also check the detected age.
    if (data?.result?.livenessProven) {
      if (typeof data.result.ageV2GroupEnumInt != 'number') {
        endpointLogger.error(
          { respData: data },
          "FaceTec response missing ageV2GroupEnumInt"
        );
        return res.status(400).json({
          error: "FaceTec liveness response missing necessary data: ageV2GroupEnumInt"
        })
      }

      // age enum value of 5 indicates over 18 (see https://dev.facetec.com/api-guide#estimate-age-3d)
      const AGE_CHECK_TARGET = 5

      if (data.result.ageV2GroupEnumInt < AGE_CHECK_TARGET) {
        endpointLogger.error(
          { userId: session.userId.toString() },
          "User failed age verification"
        );
        session.status = dvStatuses.VERIFICATION_FAILED
        await session.save()

        // req.app.locals.sseManager.sendToClient(SSE_NAMESPACE + sid, {
        //   status: "completed",
        //   message: "age check successful",
        // });

        return res.status(400).json({
          error: "Verification failed. User's age is below target age.",
          triggerRetry: false,
        })
      }

      endpointLogger.info({}, "User passed age verification");
      
      session.status = dvStatuses.PASSED_AGE_VERIFICATION
      await session.save()

      return res.status(200).json({
        success: true,
        ageV2GroupEnumInt: data.result.ageV2GroupEnumInt,
      })
    }

    return res.status(200).json(data);
  } catch (err) {
    endpointLogger.error(err, "Unknown error");
    return res.status(500).json({
      error: true,
      errorMessage: "An unknown error occurred",
      triggerRetry: true,
    });
  }
}
