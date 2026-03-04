import { Model } from "mongoose";
import { IZkPassportNullifierAndCreds, ISandboxZkPassportNullifierAndCreds } from "../types.js";
import { objectIdFiveDaysAgo } from "./utils.js";

export async function findOneNullifierAndCredsLast5Days(
  ZkPassportNullifierAndCredsModel: Model<IZkPassportNullifierAndCreds | ISandboxZkPassportNullifierAndCreds>,
  issuanceNullifier: string
) {
  return ZkPassportNullifierAndCredsModel.findOne({
    issuanceNullifier,
    // Ignore records created more than 5 days ago
    _id: { $gt: objectIdFiveDaysAgo() }
  }).exec();
}
