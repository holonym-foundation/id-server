import { Request, Response } from "express";
import { HydratedDocument } from "mongoose";
import { ObjectId } from "mongodb";
import {
  Session,
  UserCredentialsV2
} from "../../init.js";
import { ISession, IUserCredentialsV2 } from "../../types.js";
import logger from "../../utils/logger.js";

const getEndpointLogger = logger.child({
  msgPrefix: "[GET /admin/user-has-backedup-credentials] ",
});

async function getUserHasBackedupCredentials(req: Request, res: Response) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const id: string = req.query.id as string;

    if (!id) {
      return res.status(400).json({ error: "No user ID provided." });
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

    const backedupCreds: HydratedDocument<IUserCredentialsV2> | null = await UserCredentialsV2.findOne({
      holoUserId: session.sigDigest
    }).exec();

    if (backedupCreds) {
      getEndpointLogger.info({ _id: id }, "Found backed up credentials");
      return res.status(200).json({
        hasPhoneCreds: !!backedupCreds?.encryptedPhoneCreds?.ciphertext,
        hasGovIdCreds: !!backedupCreds?.encryptedGovIdCreds?.ciphertext,
        hasCleanHandsCreds: !!backedupCreds?.encryptedCleanHandsCreds?.ciphertext,
      });
    } else {
      getEndpointLogger.info({ _id: id }, "No backed up credentials found");
      return res.status(404).json({ error: "No backed up credentials found." });
    }
  } catch (err) {
    console.log(err)
    getEndpointLogger.error(
      { error: err },
      ""
    );
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { getUserHasBackedupCredentials };
