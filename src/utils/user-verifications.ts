import { UserVerifications } from "../init.js";
import { objectIdFromDate } from "./utils.js";

type DateRange = { before?: Date; after?: Date };

type UserVerificationNamespace = "govId" | "aml" | "biometrics";

type FindUserVerificationOpts = {
  issuedAt?: DateRange;
  // IMPORTANT: The expiresAt field was added April 23, 2026. It should not
  // be used in queries until March 23, 2027.
  // expiresAt?: DateRange;
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
 */
export async function findUserVerification(
  uuid: string,
  namespace: UserVerificationNamespace,
  opts: FindUserVerificationOpts = {}
) {
  const uuidField = NAMESPACE_UUID_FIELD[namespace];

  const query: Record<string, any> = { [uuidField]: uuid };

  if (opts.issuedAt?.after || opts.issuedAt?.before) {
    const idFilter: Record<string, any> = {};
    if (opts.issuedAt.after) idFilter.$gt = objectIdFromDate(opts.issuedAt.after);
    if (opts.issuedAt.before) idFilter.$lt = objectIdFromDate(opts.issuedAt.before);
    query._id = idFilter;
  }

  // TODO: Uncomment this after March 23, 2027
  // if (opts.expiresAt?.after || opts.expiresAt?.before) {
  //   const expiresFilter: Record<string, any> = {};
  //   if (opts.expiresAt.after) expiresFilter.$gt = opts.expiresAt.after;
  //   if (opts.expiresAt.before) expiresFilter.$lt = opts.expiresAt.before;
  //   query[`${namespace}.expiresAt`] = expiresFilter;
  // }

  return UserVerifications.findOne(query).sort({ _id: "desc" }).exec();
}
