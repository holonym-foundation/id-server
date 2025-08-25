import { ObjectId } from "mongodb";
import { HydratedDocument } from "mongoose";
import { AMLChecksSession } from "../init.js";
import { sessionStatusEnum } from "../constants/misc.js";
import { IAmlChecksSession } from "../types.js";

export async function getSessionById(_id: string) {
  let objectId = null;
  try {
    objectId = new ObjectId(_id);
  } catch (err) {
    return { error: "Invalid _id" };
  }

  const session = await AMLChecksSession.findOne({ _id: objectId }).exec();

  if (!session) {
    return { error: "Session not found" };
  }

  return { session, objectId }
}

export async function failSession(
  session: HydratedDocument<IAmlChecksSession>,
  failureReason: string
) {
  session.status = sessionStatusEnum.VERIFICATION_FAILED;
  if (failureReason) session.verificationFailureReason = failureReason;
  await session.save() 
}
