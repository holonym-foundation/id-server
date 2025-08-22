import { Request, Response } from "express";
import { HydratedDocument } from "mongoose";
import { ObjectId } from "mongodb";
import { AMLChecksSession } from "../../init.js";
import { IAmlChecksSession } from "../../types.js";
import logger from "../../utils/logger.js";

const getEndpointLogger = logger.child({
  msgPrefix: "[GET /admin/user-clean-hands-sessions] ",
});

/**
 * Simple endpoint that returns all of a user's clean hands sessions, given a 
 * single session ID or txHash.
 */
async function userCleanHandsSessions(req: Request, res: Response) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const id: string = req.body.id;
    const txHash: string = req.body.txHash;

    if (!id && !txHash) {
      return res
        .status(400)
        .json({ error: "'id' or 'txHash' must be included in request body" });
    }

    let session: HydratedDocument<IAmlChecksSession> | null = null;

    if (id) {
      let objectId: ObjectId | null = null;
      try {
        objectId = new ObjectId(id);
      } catch (err) {
        return res.status(400).json({ error: "Invalid _id" });
      }

      session = await AMLChecksSession.findOne({ _id: objectId }).exec();
    } else {
      session = await AMLChecksSession.findOne({ txHash }).exec();
    }

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const sigDigest = session.sigDigest;

    const sessions: HydratedDocument<IAmlChecksSession>[] = await AMLChecksSession.find({ sigDigest }).exec();

    // Only include session status, txHash, chainId, and refundTxHash.
    const filteredSessions = sessions.map((s) => ({
      status: s.status,
      txHash: s.txHash,
      chainId: s.chainId,
      refundTxHash: s.refundTxHash,
      silkDiffWallet: s.silkDiffWallet,
      verificationFailureReason: s.verificationFailureReason,
      sid: s._id.toString(),
    }));

    return res.status(200).json({ sessions: filteredSessions });
  } catch (err) {
    getEndpointLogger.error({ error: err });
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { userCleanHandsSessions };
