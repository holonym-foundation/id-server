import { Model } from "mongoose";
import { ICleanHandsNullifierAndCreds, ISandboxCleanHandsNullifierAndCreds } from "../types.js";
import { objectIdFiveDaysAgo } from "./utils.js";

export async function findOneNullifierAndCredsLast5Days(
  CleanHandsNullifierAndCredsModel: Model<ICleanHandsNullifierAndCreds | ISandboxCleanHandsNullifierAndCreds>,
  issuanceNullifier: string
) {
  return CleanHandsNullifierAndCredsModel.findOne({
    issuanceNullifier,
    // Ignore records created more than 5 days ago
    _id: { $gt: objectIdFiveDaysAgo() }
  }).exec();
}
