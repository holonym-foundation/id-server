import { Model } from "mongoose";
import { INullifierAndCreds, ISandboxNullifierAndCreds } from "../types.js";
import { objectIdFiveDaysAgo } from "./utils.js";

export async function findOneNullifierAndCredsLast5Days(NullifierAndCredsModel: Model<INullifierAndCreds | ISandboxNullifierAndCreds>, issuanceNullifier: string) {
  return NullifierAndCredsModel.findOne({
    issuanceNullifier,
    // Ignore records created more than 5 days ago
    _id: { $gt: objectIdFiveDaysAgo() }
  }).exec();
}
