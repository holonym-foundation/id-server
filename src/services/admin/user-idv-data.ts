import { Request, Response } from "express";
import { HydratedDocument } from "mongoose";
import axios from "axios";
import { ObjectId } from "mongodb";
import { subDays } from "date-fns";
import {
  Session,
  NullifierAndCreds,
  CleanHandsNullifierAndCreds,
  getRouteHandlerConfig
} from "../../init.js";
import { sessionStatusEnum, facetecServerBaseURL } from "../../constants/misc.js";
import { ISession, INullifierAndCreds, ICleanHandsNullifierAndCreds } from "../../types.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { deleteVeriffSession } from "../../utils/veriff.js";
import { deleteOnfidoApplicant } from "../../utils/onfido.js";
import { deleteIdenfySession } from "../../utils/idenfy.js";

// const endpointLogger = logger.child({
//   msgPrefix: "[DELETE /admin/delete-user-data] ",
//   base: {
//     ...pinoOptions.base,
//   },
// });

const prodConfig = getRouteHandlerConfig("live");

function dateToObjectId(date: Date): ObjectId {
  // https://stackoverflow.com/a/8753670
  return new ObjectId(Math.floor(date.getTime() / 1000).toString(16) + "0000000000000000");
}

async function setDeletedFromIDVProvider(session: HydratedDocument<ISession>) {
  session.deletedFromIDVProvider = true;
  await session.save();
}

async function deleteDataFromIDVProvider(session: HydratedDocument<ISession>) {
  switch (session.idvProvider) {
    case "veriff":
      if (session.sessionId) {
        const result = await deleteVeriffSession(session.sessionId);
        if (result?.status === "success") {
          setDeletedFromIDVProvider(session);
        }
      }
      break;
    case "onfido":
      if (session.applicant_id) {
        const result = await deleteOnfidoApplicant(prodConfig.onfidoAPIKey, session.applicant_id);
        if (result?.status == 204) {
          setDeletedFromIDVProvider(session);
        }
      }
      break;
    case "idenfy":
      if (session.scanRef) {
        const result = await deleteIdenfySession(session.scanRef);
        if (result?.status == 200) {
          setDeletedFromIDVProvider(session);
        }
      }
      break;
    default:
      break;
  }
}

/**
 * Endpoint to be called by daemon to periodically delete old user data
 * from IDV provider databases.
 */
async function deleteUserData(req: Request, res: Response) {
  const apiKey = req.headers["x-api-key"];

  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "Invalid API key." });
  }

  try {
    // 1. Delete sessions that we know have failed or succeeded verification. \\
    // Get all sessions that:
    // - are older than 10 days AND
    // - have status of (VERIFICATION_FAILED or ISSUED) AND
    // - have not already been deleted from IDV provider databases
    const tenDaysAgo = subDays(new Date(), 10);
    const sessions: HydratedDocument<ISession>[] = await Session.find({
      $and: [
        {
          _id: {
            $lt: dateToObjectId(tenDaysAgo),
          },
        },
        {
          status: {
            $in: [
              sessionStatusEnum.VERIFICATION_FAILED,
              sessionStatusEnum.ISSUED, 
            ]
          }
        },
        { deletedFromIDVProvider: { $eq: false } },
      ],
    }).exec();

    // Delete sessions from IDV provider databases
    for (const session of sessions) {
      await deleteDataFromIDVProvider(session);
    }

    // 2. Delete sessions that might have been abandoned. \\
    // Get all sessions that:
    // - are older than 30 days AND
    // - have status of IN_PROGRESS or REFUNDED AND
    // - have not already been deleted from IDV provider databases
    const thirtyDaysAgo = subDays(new Date(), 30);
    const sessions2: HydratedDocument<ISession>[] = await Session.find({
      $and: [
        {
          _id: {
            $lt: dateToObjectId(thirtyDaysAgo),
          },
        },
        {
          status: { $in: [sessionStatusEnum.IN_PROGRESS, sessionStatusEnum.REFUNDED] },
        },
        { deletedFromIDVProvider: { $eq: false } },
      ],
    }).exec();

    // Delete sessions from IDV provider databases
    for (const session of sessions2) {
      await deleteDataFromIDVProvider(session);
    }

    // Delete records from our FaceTec Server
    // TODO: Uncomment once we finish facetec issuer
    // try {
    //   const resp = await axios.delete(`${facetecServerBaseURL}/old-enrollments`, {
    //     headers: {
    //       "X-Api-Key": process.env.FACETEC_SERVER_API_KEY,
    //     },
    //   });
    //   // For now, we log the result. Probably not necessary long-term.
    //   if (!resp.data?.deleted) {
    //     console.log("deleteUserData: No data deleted after calling DELETE /old-enrollments on FaceTec Server. Response from server:", resp.data);
    //   }
    // } catch (err) {
    //   console.log("deleteUserData: Error encountered while calling DELETE /old-enrollments on FaceTec Server (a)", err.message);
    //   if (err?.response?.data)
    //     console.log("deleteUserData: Error encountered (b)", err?.response?.data);
    //   else console.log("deleteUserData: Error encountered (b)", err);
    // }

    // 3. Delete NullifierAndCreds documents older than 30 days \\
    await NullifierAndCreds.deleteMany({
      _id: { $lt: dateToObjectId(thirtyDaysAgo) },
    }).exec();
    await CleanHandsNullifierAndCreds.deleteMany({
      _id: { $lt: dateToObjectId(thirtyDaysAgo) },
    }).exec();

    return res.status(200).json({ message: "Success" });
  } catch (err) {
    console.log("deleteUserData: Error encountered (a)", (err as Error).message);
    if ((err as any)?.response?.data)
      console.log("deleteUserData: Error encountered (b)", (err as any)?.response?.data);
    else console.log("deleteUserData: Error encountered (b)", err);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { deleteUserData };
