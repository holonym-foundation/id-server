import { BinaryLike, createHash, randomBytes } from "crypto";
import assert from "assert";
import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { ObjectId } from "mongodb";
import { poseidon } from "circomlibjs-old";
import sgMail from "@sendgrid/mail";

/**
 * @param {string} date Must be of form yyyy-mm-dd
 * @returns {number} Date as seconds since 1900
 */
export function getDateAsInt(date: string) {
  // Format input
  const [year, month, day] = date.split("-").map(s => Number(s));
  assert.ok(year && month && day, `Missing year, month, or day. Values: ${year}, ${month}, ${day}`); // Make sure Y M D all given
  assert.ok(year >= 1900 && year <= 2099, `Parsed year (${year}) doesn't satisfy: year >= 1900 && year <= 2099`); // Make sure date is in a reasonable range, otherwise it's likely the input was malformatted and it's best to be safe by stopping -- we can always allow more edge cases if needed later
  const time = new Date(date).getTime() / 1000 + 2208988800; // 2208988800000 is 70 year offset; Unix timestamps below 1970 are negative and we want to allow from approximately 1900.
  assert.ok(!isNaN(time), `Failed to convert date into a time. Date: ${date}`); // Make sure we parsed the date correctly
  return time;
}

function assertLengthIs(item: any, length: number, itemName: string) {
  const errMsg = `${itemName} must be ${length} bytes but is ${item.length} bytes`;
  assert.equal(item.length, length, errMsg);
}

/**
 * Takes Buffer, properly formats them (according to spec), and returns a hash.
 * See: https://opsci.gitbook.io/untitled/4alwUHFeMIUzhQ8BnUBD/extras/leaves
 * @param {Buffer} issuer Blockchain address of account that issued the credentials
 * @param {Buffer} secret 16 bytes
 * @param {Buffer} countryCode
 * @param {BigInt} nameCitySubdivisionZipStreetHash
 * @param {Buffer} completedAt
 * @param {Buffer} birthdate
 * @returns {Promise<string>} Poseidon hash (of input data) right-shifted 3 bits. Represented as
 * a base 10 number represented as a string.
 */
// export async function createLeaf(
//   issuer,
//   secret,
//   countryCode,
//   nameCitySubdivisionZipStreetHash,
//   completedAt,
//   birthdate
// ) {
//   assertLengthIs(issuer, 20, "issuer");
//   assertLengthIs(secret, 16, "secret");
//   try {
//     return poseidon(
//       [
//         issuer,
//         secret,
//         countryCode,
//         nameCitySubdivisionZipStreetHash,
//         completedAt,
//         birthdate,
//       ].map((x) => ethers.BigNumber.from(x).toString())
//     );
//   } catch (err) {
//     console.log(err);
//   }
// }

export async function sendEmail(to: string, subject: string, text: string, html: string) {
  // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  // const msg = {
  //   to, // "test@example.com"
  //   from: "idservices@holonym.id",
  //   subject,
  //   text,
  //   html,
  // };
  // try {
  //   await sgMail.send(msg);
  // } catch (error) {
  //   console.error(error);
  //   if (error.response) {
  //     console.error(error.response.body);
  //   }
  // }
}

export function sha256(data: BinaryLike) {
  // returns Buffer
  return createHash("sha256").update(data).digest();
}

export function govIdUUID(firstName: string, lastName: string, dob: string) {
  const uuidConstituents =
    (firstName || "") +
    (lastName || "") +
    // TODO: Maybe include address or zip code in the UUID. Not all
    // IDV providers provide this info under default settings though.
    (dob || "");
  return sha256(Buffer.from(uuidConstituents)).toString("hex");
}

export function validateUUIDv4(uuid: string) {  
  // Handle non-string inputs
  if (typeof uuid !== 'string') {
    return false;
  }
  
  return uuid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) !== null;
}

/**
 * When checking whether a user has already been verified, we want to ignore
 * records that are older than 11 months. The soonest an SBT can expire is
 * 11 months after the _credentials_ are issued. See the logic in the 
 * frontend for the security offset to see why we use 11 months instead of 12.
 */
export function objectIdElevenMonthsAgo() {
  const now = new Date();
  const elevenMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, now.getDate())
  return new ObjectId(Math.floor(elevenMonthsAgo.getTime() / 1000).toString(16) + "0000000000000000");
}

export function objectIdFiveDaysAgo() {
  const fiveDaysAgo = new Date(new Date().getTime() - (5 * 24 * 60 * 60 * 1000));
  return new ObjectId(Math.floor(fiveDaysAgo.getTime() / 1000).toString(16) + "0000000000000000");
}

export async function retry<T>(
  fn: () => Promise<T>,
  retries: number,
  delay: number
) {
  try {
    return await fn()
  } catch (err: any) {
    if (retries === 0) {
      throw err
    }

    console.log('retry encountered error "', err.message, '" retries left:', retries)

    // console.log(`Retrying... Attempts left: ${retries}`)
    await new Promise((resolve) => setTimeout(resolve, delay))

    return await retry(fn, retries - 1, delay)
  }
}
