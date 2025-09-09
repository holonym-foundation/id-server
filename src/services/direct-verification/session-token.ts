import axios from "axios";
import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { DVSession } from "../../init.js";
import { CustomError } from "../../utils/errors.js";
import {
  directVerificationSessionStatusEnum as dvStatuses,
} from "../../constants/misc.js";
import { getFaceTecBaseURL } from "../../utils/facetec.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { SSE_NAMESPACE } from "./constants.js";
import { customerFromAPIKey, validateCustomerCreditUsage } from "./functions.js";

const endpointLogger = logger.child({
  // msgPrefix: "[POST /session-token] ",
  base: {
    ...pinoOptions.base,
  },
});

/**
 * Create a FaceTec session token.
 * 
 * Mostly duplicated from src/services/facetec/session-token.js
 */
export async function sessionToken(req: Request, res: Response) {
  try {
    const sid = req.body.sid;

    const customer = await customerFromAPIKey(req)

    await validateCustomerCreditUsage(customer)

    if (!sid) {
      return res.status(400).json({ error: "sid is required" });
    }

    let objectId = null;
    try {
      objectId = new ObjectId(sid);
    } catch (err) {
      return res.status(400).json({ error: "Invalid sid" });
    }

    const session = await DVSession.findOne({ _id: objectId }).exec();

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status !== dvStatuses.IN_PROGRESS) {
      return res.status(400).json({ error: `Session is not in progress. It is ${session.status}.` });
    }

    // --- Forward request to FaceTec server ---

    let data = null;
    try {
      req.app.locals.sseManager.sendToClient(SSE_NAMESPACE + sid, { 
        status: 'in_progress',
        message: 'starting verification session'
      });

      // Ignoring "Property 'get' does not exist on type 'typeof import(...)"
      // @ts-ignore
      const resp = await axios.get(
        `${getFaceTecBaseURL(req)}/session-token`,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Device-Key": req.headers["x-device-key"],
            "X-User-Agent": req.headers["x-user-agent"] || "human-id-server",
            "X-Api-Key": process.env.FACETEC_SERVER_API_KEY,
          },
        }
      )
      data = resp.data;
    } catch (err: any) {
      if (err.request) {
        console.error(
          { error: err.request.data },
          "(err.request) Error during facetec session-token"
        );

        return res.status(502).json({
          error: "Did not receive a response from the FaceTec server"
        })
      } else if (err.response) {
        console.error(
          { error: err.response.data },
          "(err.response) Error during facetec session-token"
        );

        return res.status(err.response.status).json({
          error: "FaceTec server returned an error",
          data: err.response.data
        })
      } else {
        console.error('err')
        console.error({ error: err }, "Error during FaceTec session-token");
        return res.status(500).json({ error: "An unknown error occurred" });
      }
    }

    // --- Forward response from FaceTec server ---

    if (data) {
      endpointLogger.info({}, "Created FaceTec session token for direct verification service")
      return res.status(200).json(data);
    } else {
      return res.status(500).json({ error: "An unknown error occurred" });
    }
  } catch (err: any) {
    if (err instanceof CustomError) {
      console.log(err.logMessage)
      return res.status(err.httpStatusCode).json({ error: err.userFacingMessage })
    }
    console.log("POST /session-token: Error encountered", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}
