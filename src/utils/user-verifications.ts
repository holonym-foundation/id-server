import { UserVerifications } from "../init.js";
import {
  objectIdElevenMonthsAgo,
  objectIdFiveDaysAgo
} from "./utils.js"

export async function findOneUserVerificationLast11Months(
  uuidOld: string,
  uuidNew: string
) {
  return UserVerifications.findOne({
    $or: [{ "govId.uuid": uuidOld }, { "govId.uuidV2": uuidNew }],
    // Filter out documents older than 11 months
    _id: { $gt: objectIdElevenMonthsAgo() },
  }).exec();
}

/**
 * Lookup a user verification that is older than 11 months and younger than 5 days.
 */
export async function findOneUserVerification11Months5Days(
  uuidOld: string,
  uuidNew: string
) {
  return UserVerifications.findOne({ 
    $or: [
      { "govId.uuid": uuidOld },
      { "govId.uuidV2": uuidNew } 
    ],
    // Filter out documents older than 11 months and younger than 5 days
    _id: {
      $gt: objectIdElevenMonthsAgo(),
      $lt: objectIdFiveDaysAgo()
    }
  }).exec();
}

/**
 * Lookup a clean hands user verification that is older than 11 months and younger than 5 days.
 */
export async function findOneCleanHandsUserVerification11Months5Days(uuid: string) {
  return UserVerifications.findOne({ 
    $or: [
      { "aml.uuid": uuid },
    ],
    // Filter out documents older than 11 months and younger than 5 days
    _id: {
      $gt: objectIdElevenMonthsAgo(),
      $lt: objectIdFiveDaysAgo()
    }
  }).exec();
}
