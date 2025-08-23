import { BiometricsNullifierAndCreds } from "../init.js";
import { objectIdFiveDaysAgo } from "./utils.js";

export async function findOneNullifierAndCredsLast5Days(issuanceNullifier: string) {
  return BiometricsNullifierAndCreds.findOne({
    issuanceNullifier,
    // Ignore records created more than 5 days ago
    _id: { $gt: objectIdFiveDaysAgo() }
  }).exec();
}
