import { Request, Response } from "express";
import { HydratedDocument } from "mongoose";
import { ObjectId } from "mongodb";
import { Session } from "../../init.js";
import { sessionStatusEnum } from "../../constants/misc.js";
import { ISession } from "../../types.js";
import logger from "../../utils/logger.js";

const postEndpointLogger = logger.child({
  msgPrefix: "[POST /admin/fail-session] ",
});

/**
 * Admin endpoint for manually failing a session. This allows a user
 * to request a refund AFTER paying but BEFORE failing verification.
 */
async function failSession(req: Request, res: Response) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const id: string = req.body.id;

    if (!id) {
      return res.status(400).json({ error: "No session ID specified." });
    }

    let objectId: ObjectId | null = null;
    try {
      objectId = new ObjectId(id);
    } catch (err) {
      return res.status(400).json({ error: "Invalid _id" });
    }

    const session: HydratedDocument<ISession> | null = await Session.findOne({ _id: objectId }).exec();

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // if (session.status !== sessionStatusEnum.IN_PROGRESS) {
    if (
      session.status !== sessionStatusEnum.IN_PROGRESS &&
      session.status !== sessionStatusEnum.ISSUED
    ) {
      return res.status(400).json({
        error: `Session status is ${session.status}. Must be one of ${sessionStatusEnum.IN_PROGRESS} or ${sessionStatusEnum.ISSUED}`,
      });
    }

    session.status = sessionStatusEnum.VERIFICATION_FAILED;
    await session.save();

    return res.status(200).json({
      message: `Changed status of session ${id} to ${sessionStatusEnum.VERIFICATION_FAILED}`,
    });
  } catch (err) {
    postEndpointLogger.error({ error: err });
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { failSession };
