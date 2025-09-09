import axios from "axios";
import { Request, Response } from "express"
import { ObjectId } from "mongodb";
import { DVSession, DVCustomer } from "../../init.js";
import { CustomError } from "../../utils/errors.js";
import {
  directVerificationSessionStatusEnum as dvStatuses
} from "../../constants/misc.js"
import { pinoOptions, logger } from "../../utils/logger.js";
import { getFaceTecBaseURL } from "../../utils/facetec.js";
import { SSE_NAMESPACE } from "./constants.js";
import { customerFromAPIKey, validateCustomerCreditUsage } from "./functions.js";

const endpointLogger = logger.child({
  msgPrefix: "[POST /direct-verification/enrollment-3d] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "facetec",
    feature: "holonym",
    subFeature: "enrollment",
  },
})

export async function enrollment3d(req: Request, res: Response) {
  try {
    const sid = req.body.sid;
    const faceTecParams = req.body.faceTecParams;

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

    // --- Forward request to FaceTec server ---

    let data = null
    try {
      faceTecParams.storeAsFaceVector = true;
      
      req.app.locals.sseManager.sendToClient(SSE_NAMESPACE + sid, {
        status: "in_progress",
        message: "liveness check: sending to server",
      });

      // Ignoring "Property 'post' does not exist on type 'typeof import(...)'"
      // @ts-ignore
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
    } catch (err: any) {
      // For face scan and enrollment, one relevant error could come from faceScanSecurityChecks
      // user would be able to retry untill max attempts are reached

      if (err.request) {
        endpointLogger.error(
          { error: err.request.data },
          "(err.request) Error during enrollment-3d"
        );

        return res.status(502).json({
          error: true,
          errorMessage: "Did not receive a response from the server during enrollment-3d",
          triggerRetry: true,
        });
      } else if (err.response) {
        endpointLogger.error(
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
        endpointLogger.error("err");
        endpointLogger.error({ error: err }, "Error during enrollment-3d");
        return res.status(500).json({
          error: true,
          errorMessage: "An unknown error occurred",
          triggerRetry: true,
        });
      }
    }

    req.app.locals.sseManager.sendToClient(SSE_NAMESPACE + sid, {
      status: "completed",
      message: "enrollment successful, proceed to next step",
    });

    // --- Forward response from FaceTec server ---

    if (data) {
      session.status = dvStatuses.ENROLLED
      await session.save()
      return res.status(200).json(data);
    } else {
      return res.status(500).json({
        error: true,
        errorMessage: "An unknown error occurred",
        triggerRetry: true,
      });
    }
  } catch (err: any) {
    if (err instanceof CustomError) {
      console.log(err.logMessage)
      return res.status(err.httpStatusCode).json({ error: err.userFacingMessage })
    }
    endpointLogger.error(err, "Error encountered");
    return res.status(500).json({
      error: true,
      errorMessage: "An unknown error occurred",
      triggerRetry: true,
    });
  }
}
