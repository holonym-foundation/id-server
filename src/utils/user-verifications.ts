import { HydratedDocument } from "mongoose";
import { UserVerifications } from "../init.js";
import { IUserVerifications } from "../types.js";
import { objectIdFromDate } from "./utils.js";

type DateRange = { before?: Date; after?: Date };

type UserVerificationNamespace = "govId" | "aml" | "biometrics";

type FindUserVerificationOpts = {
  issuedAt?: DateRange;
  expiresAt?: DateRange;
};

const NAMESPACE_UUID_FIELD: Record<UserVerificationNamespace, string> = {
  govId: "govId.uuidV2",
  aml: "aml.uuid",
  biometrics: "biometrics.uuidV2",
};

/**
 * Find the most recent UserVerifications document whose uuid in the given
 * namespace matches, optionally constrained by an issuedAt window (enforced
 * via the document's _id ObjectId creation timestamp) and/or an expiresAt
 * window (enforced via the namespace's stored expiresAt field).
 * 
 * The expiresAt filter is treated as optional. Documents before April 23, 2026
 * do not have it. We do not exclude those documents from the search results.
 */
export async function findUserVerification(
  uuid: string,
  namespace: UserVerificationNamespace,
  opts: FindUserVerificationOpts = {}
): Promise<HydratedDocument<IUserVerifications> | null> {
  const uuidField = NAMESPACE_UUID_FIELD[namespace];

  const query: Record<string, any> = { [uuidField]: uuid };

  if (opts.issuedAt?.after || opts.issuedAt?.before) {
    const idFilter: Record<string, any> = {};
    if (opts.issuedAt.after) idFilter.$gt = objectIdFromDate(opts.issuedAt.after);
    if (opts.issuedAt.before) idFilter.$lt = objectIdFromDate(opts.issuedAt.before);
    query._id = idFilter;
  }

  // The expiresAt field was added April 23, 2026. Documents created before
  // then do not have it, so we include them via $exists: false rather than
  // excluding them from the search.
  if (opts.expiresAt?.after || opts.expiresAt?.before) {
    const expiresFilter: Record<string, any> = {};
    if (opts.expiresAt.after) expiresFilter.$gt = opts.expiresAt.after;
    if (opts.expiresAt.before) expiresFilter.$lt = opts.expiresAt.before;
    query.$or = [
      // TODO: After March 23, 2027, remove the $exists check
      { [`${namespace}.expiresAt`]: { $exists: false } },
      { [`${namespace}.expiresAt`]: expiresFilter },
    ];
  }

  return UserVerifications.findOne(query).sort({ _id: "desc" }).exec();
}
