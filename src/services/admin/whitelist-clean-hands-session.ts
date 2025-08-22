import { Request, Response } from "express";
import { HydratedDocument } from "mongoose";
import { ObjectId } from "mongodb";
import { AMLChecksSession, CleanHandsSessionWhitelist } from "../../init.js";
import { sessionStatusEnum } from "../../constants/misc.js";
import { IAmlChecksSession, ICleanHandsSessionWhitelist } from "../../types.js";
import logger from "../../utils/logger.js";

const endpointLogger = logger.child({
  msgPrefix: "[POST /admin/whitelist-clean-hands-session] ",
});

async function whitelistCleanHandsSession(req: Request, res: Response) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const sid: string = req.body.sid;

    if (!sid) {
      return res
        .status(400)
        .json({ error: "'sid' must be included in request body" });
    }

    let session: HydratedDocument<IAmlChecksSession> | null = null;

    let objectId: ObjectId | null = null;
    try {
      objectId = new ObjectId(sid);
    } catch (err) {
      return res.status(400).json({ error: "Invalid _id" });
    }

    session = await AMLChecksSession.findOne({ _id: objectId }).exec();
    
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status !== sessionStatusEnum.VERIFICATION_FAILED) {
      return res.status(400).json({ error: "Cannot whitelist session. It is not in a failed state" });
    }

    const failureReason: string = session.verificationFailureReason as string;

    if (!failureReason.includes("Sanctions match found. Confidence scores")) {
      return res.status(400).json({ error: `Cannot whitelist session. verificationFailureReason is ${failureReason}, not "Sanctions match found"` });
    }

    // The failureReason string should look like something this:
    // "Sanctions match found. Confidence scores: (INT / Politically Exposed Persons: 0.91297483), (INT / Politically Exposed Persons: 0.91297483)"

    const confidenceScores = failureReason
      .split("Sanctions match found. Confidence scores: ")[1]
      .split(")")
      .map(item => item.trim().split(":")[1])
      .filter(score => score !== undefined)
      .map(score => parseFloat(score.trim()))
    
    const maxScore = Math.max(...confidenceScores);

    const MAX_ALLOWED_CONFIDENCE_SCORE: number = 0.95;
    if (maxScore > MAX_ALLOWED_CONFIDENCE_SCORE) {
      endpointLogger.error(
        {
          sessionId: session._id,
          maxConfidenceScoreInSession: maxScore,
          MAX_ALLOWED_CONFIDENCE_SCORE
        },
        'Cannot whitelist clean hands session.'
      );
      return res.status(400).json({ error: `Cannot whitelist session. Max confidence score is greater than ${MAX_ALLOWED_CONFIDENCE_SCORE}` });
    }

    endpointLogger.info(
      {
        sessionId: session._id,
        maxConfidenceScoreInSession: maxScore,
        MAX_ALLOWED_CONFIDENCE_SCORE
      },
      'Whitelisting clean hands session.'
    );

    const whitelistItem = new CleanHandsSessionWhitelist({
      sessionId: session._id,
      reason: `Admin override session failure. Session failed due to sanctions match. Max confidence score associated with the session: ${maxScore}`
    });

    await whitelistItem.save();

    session.status = sessionStatusEnum.IN_PROGRESS;
    // @ts-ignore
    session.verificationFailureReason = null;
    await session.save();

    return res.status(200).json({ message: `Successfully whitelisted clean hands session ${session._id}` });
  } catch (err) {
    endpointLogger.error({ error: err });
    console.log(err);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { whitelistCleanHandsSession };
