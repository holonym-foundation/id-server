import { Request, Response } from "express";
import { HydratedDocument } from "mongoose";
import {
  UserVerifications,
  DailyVerificationCount,
  DailyVerificationDeletions,
} from "../../init.js";
import { IUserVerifications, IDailyVerificationDeletions } from "../../types.js";
import logger from "../../utils/logger.js";

const getEndpointLogger = logger.child({
  msgPrefix: "[GET /admin/user-verifications] ",
});
const deleteEndpointLogger = logger.child({
  msgPrefix: "[DELETE /admin/user-verifications] ",
});

async function getUserVerification(req: Request, res: Response) {
  try {
    const apiKey = req.headers["x-api-key"];

    // if (apiKey !== process.env.ADMIN_API_KEY) {
    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }


    const id: string = req.query.id as string;
    const uuid: string = req.query.uuid as string;
    const uuidV2: string = req.query.uuidV2 as string;
    const idvProviderSessionId: string = req.query.idvProviderSessionId as string;

    if (!id && !uuid && !uuidV2 && !idvProviderSessionId) {
      return res.status(400).json({ error: "No user ID provided." });
    }

    // Whatever parameters were included in the request to this endpoint, include them.
    // Leave out any null/undefined values.
    const orInQuery: any[] = []
    if (id) {
      orInQuery.push({ _id: id });
    }
    if (uuid) {
      orInQuery.push({ "govId.uuid": uuid });
    }
    if (uuidV2) {
      orInQuery.push({ "govId.uuidV2": uuidV2 });
    }
    if (idvProviderSessionId) {
      orInQuery.push({ "govId.sessionId": idvProviderSessionId });
    }

    // const user = await UserVerifications.findOne({ _id: id }).exec();
    const users: HydratedDocument<IUserVerifications>[] = await UserVerifications.find({
      $or: orInQuery,
    }).exec();
    if (users) {
      getEndpointLogger.info({ _id: id, uuid }, "Found users");
      return res.status(200).json(users);
    } else {
      getEndpointLogger.info({ _id: id, uuid }, "No user found");
      return res.status(404).json({ error: "No user found." });
    }
  } catch (err) {
    getEndpointLogger.error(
      { error: err },
      "An error occurred while retrieving user verification"
    );
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

async function deleteUserVerification(req: Request, res: Response) {
  try {
    const apiKey = req.headers["x-api-key"];

    // if (apiKey !== process.env.ADMIN_API_KEY) {
    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const id: string = req.query.id as string;
    const uuid: string = req.query.uuid as string;
    const uuidV2: string = req.query.uuidV2 as string;
    const idvProviderSessionId: string = req.query.idvProviderSessionId as string;

    if (!id && !uuid && !uuidV2 && !idvProviderSessionId) {
      return res.status(400).json({ error: "No user ID provided." });
    }

    // Limit the number of deletions per day to 2% of the number of verifications per day
    // const verificationCountDoc = await DailyVerificationCount.findOne({
    //   date: new Date().toISOString().slice(0, 10),
    // }).exec();
    // // NOTE: If we add other verification providers, we need to update the following line
    // const sessionCountToday =
    //   (verificationCountDoc?.veriff?.sessionCount ?? 0) +
    //   (verificationCountDoc?.idenfy?.sessionCount ?? 0) +
    //   (verificationCountDoc?.onfido?.applicantCount ?? 0);
    const deletionCountDoc: HydratedDocument<IDailyVerificationDeletions> | null = await DailyVerificationDeletions.findOne({
      date: new Date().toISOString().slice(0, 10),
    }).exec();
    const deletionCountToday: number = deletionCountDoc?.deletionCount ?? 0;
    // if (deletionCountToday >= sessionCountToday * 0.02) {
    if (deletionCountToday >= 6) {
      deleteEndpointLogger.info("Deletion limit reached for today. Exiting.");
      return res
        .status(429)
        .json({ error: "Deletion limit reached for today. Try again tomorrow." });
    }

    // Whatever parameters were included in the request to this endpoint, include them.
    // Leave out any null/undefined values.
    const orInQuery: any[] = []
    if (id) {
      orInQuery.push({ _id: id });
    }
    if (uuid) {
      orInQuery.push({ "govId.uuid": uuid });
    }
    if (uuidV2) {
      orInQuery.push({ "govId.uuidV2": uuidV2 });
    }
    if (idvProviderSessionId) {
      orInQuery.push({ "govId.sessionId": idvProviderSessionId });
    }

    // const result = await UserVerifications.deleteOne({ _id: id }).exec();
    const result = await UserVerifications.deleteOne({
      $or: orInQuery,
    }).exec();
    if (result.acknowledged && result.deletedCount >= 1) {
      deleteEndpointLogger.info(
        { _id: id, uuid, uuidV2, idvProviderSessionId },
        "Deleted user"
      );

      // Increment the deletion count for today
      await DailyVerificationDeletions.updateOne(
        { date: new Date().toISOString().slice(0, 10) },
        { $inc: { deletionCount: 1 } },
        { upsert: true }
      ).exec();

      return res.status(200).json({ message: "User deleted" });
    } else {
      deleteEndpointLogger.info({ _id: id, uuid }, "No user found");
      return res.status(404).json({ error: "No user found." });
    }
  } catch (err) {
    deleteEndpointLogger.error({ error: err }, "An error occurred");
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { getUserVerification, deleteUserVerification };
