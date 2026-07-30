/**
 * Helpers for reading the identity fields disclosed by a verified ZK Passport
 * proof.
 *
 * Kept in its own module (no DB/SDK imports) so it stays cheap to unit test.
 */

/**
 * `dobRaw` is `Date | string`, not `string`.
 *
 * The SDK's QueryResult types birthdate's disclosed result as a `Date`, but the
 * value arrives here as an ISO string: the frontend JSON-serializes
 * `response.result` over the wire, and JSON has no Date type. It becomes a
 * `Date` again only because `zkPassport.verify()` internally calls
 * `formatQueryResultDates(queryResult)`, which mutates the passed object
 * **in place**.
 *
 * So this must be called AFTER verify(). Called before, `dobRaw` is still an
 * ISO string with a time component ("1901-06-06T00:00:00.000Z"), and
 * formatDateOfBirth() returns strings unchanged — that would silently write a
 * timestamped birthdate into credentials and into govIdUUID(), changing the
 * UUID and breaking cross-provider sybil matching. The union keeps both states
 * representable so no caller assumes a bare string, and it matches
 * formatDateOfBirth()'s own `Date | string` signature, its only consumer.
 */
export type DisclosedIdentity =
  | {
      hasRequiredFields: true;
      firstName: string;
      lastName: string;
      dobRaw: Date | string;
      nationality: string | undefined;
    }
  | {
      hasRequiredFields: false;
      firstName: string;
      lastName: string;
      dobRaw: Date | string | undefined;
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
 * Mononym holders (people with one legal name) have no given names at all. Per
 * ICAO 9303 the single name goes in the primary identifier (surname) position,
 * so the name zone is "SUKARNO<<<<<..." and firstname parses to "". Common for
 * Indonesian, Indian, Afghan, and Myanmar passports.
 *
 * So `hasRequiredFields` requires a name (either component) plus date of birth,
 * rather than both components. Requiring both rejected every mononym holder.
 * Empty names are already tolerated downstream by uuidOld(), govIdUUID(), and
 * extractCreds(), and by the KYC paths (see idenfy/credentials/utils.ts).
 *
 * The check is deliberately symmetric rather than "lastname must be present":
 * nothing downstream cares which component carries the name, and a name zone
 * with no "<<" at all parses to both-empty, which this still rejects.
 */
export function extractDisclosedIdentity(queryResult: any): DisclosedIdentity {
  const firstName: string = queryResult?.firstname?.disclose?.result ?? "";
  const lastName: string = queryResult?.lastname?.disclose?.result ?? "";
  const dobRaw: Date | string | undefined =
    queryResult?.birthdate?.disclose?.result;
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
