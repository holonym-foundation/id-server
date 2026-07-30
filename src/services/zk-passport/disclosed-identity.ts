/**
 * Helpers for reading the identity fields disclosed by a verified ZK Passport
 * proof.
 *
 * Kept in its own module (no DB/SDK imports) so it stays cheap to unit test.
 */

export type DisclosedIdentity =
  | {
      hasRequiredFields: true;
      firstName: string;
      lastName: string;
      dobRaw: string;
      nationality: string | undefined;
    }
  | {
      hasRequiredFields: false;
      firstName: string;
      lastName: string;
      dobRaw: string | undefined;
      nationality: string | undefined;
    };

/**
 * Pull the disclosed identity fields out of a verified ZK Passport queryResult.
 *
 * The SDK does not read firstname and lastname as separate MRZ fields — it
 * discloses the single MRZ name zone and splits it on "<<". Either component
 * can therefore come back as an empty string even though the proof verified
 * and the name was disclosed:
 *
 *   - Mononym holders (people with one legal name) have no given names at all.
 *     Per ICAO 9303 the single name goes in the primary identifier (surname)
 *     position, so the name zone is "SUKARNO<<<<<..." and firstname parses to
 *     "". Common for Indonesian, Indian, Afghan, and Myanmar passports.
 *   - A name zone with no "<<" separator parses entirely into firstname,
 *     leaving lastname "".
 *
 * So `hasRequiredFields` requires a name (either component) plus date of birth,
 * rather than both components. Requiring both rejected every mononym holder.
 * Empty names are already tolerated downstream by uuidOld(), govIdUUID(), and
 * extractCreds(), and by the KYC paths (see idenfy/credentials/utils.ts).
 */
export function extractDisclosedIdentity(queryResult: any): DisclosedIdentity {
  const firstName: string = queryResult?.firstname?.disclose?.result ?? "";
  const lastName: string = queryResult?.lastname?.disclose?.result ?? "";
  const dobRaw: string | undefined = queryResult?.birthdate?.disclose?.result;
  const nationality: string | undefined =
    queryResult?.nationality?.disclose?.result;

  if ((firstName || lastName) && dobRaw) {
    return { hasRequiredFields: true, firstName, lastName, dobRaw, nationality };
  }

  return { hasRequiredFields: false, firstName, lastName, dobRaw, nationality };
}

/**
 * Join the disclosed name components for external screening. Skips empty
 * components so a mononym holder is not screened as " Sukarno".
 */
export function formatDisclosedName(firstName: string, lastName: string) {
  return [firstName, lastName].filter(Boolean).join(" ");
}
