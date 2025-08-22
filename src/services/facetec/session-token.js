import axios from "axios";
import { ObjectId } from "mongodb";
import { Session, BiometricsSession } from "../../init.js";
import {
  sessionStatusEnum,
} from "../../constants/misc.js";
import { getFaceTecBaseURL } from "../../utils/facetec.js";
import { pinoOptions, logger } from "../../utils/logger.js";

// const postSessionsLogger = logger.child({
//   msgPrefix: "[POST /sessions] ",
//   base: {
//     ...pinoOptions.base,
//   },
// });

/**
 * Create a FaceTec session token.
 */
export async function sessionToken(req, res) {
  try {
    const sid = req.body.sid;
    const sessionType = req.body.sessionType;

    if (!sid) {
      return res.status(400).json({ error: "sid is required" });
    }

    // --- Validate id-server session ---
    let objectId = null;
    try {
      objectId = new ObjectId(sid);
    } catch (err) {
      return res.status(400).json({ error: "Invalid sid" });
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
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status !== sessionStatusEnum.IN_PROGRESS) {
      return res.status(400).json({ error: `Session is not in progress. It is ${session.status}.` });
    }

    // --- Forward request to FaceTec server ---

    let data = null;
    try {
      req.app.locals.sseManager.sendToClient(sid, { 
        status: 'in_progress',
        message: 'starting verification session'
      });

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
    } catch (err) {
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
    
    // console.log('facetec POST /session-token response:', data);

    // --- Forward response from FaceTec server ---

    if (data) return res.status(200).json(data);
    else return res.status(500).json({ error: "An unknown error occurred" });
  } catch (err) {
    console.log("POST /session-token: Error encountered", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}
