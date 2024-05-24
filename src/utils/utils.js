import { createHash, randomBytes } from "crypto";
import assert from "assert";
import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { poseidon } from "circomlibjs-old";
import sgMail from "@sendgrid/mail";

/**
 * @param {string} date Must be of form yyyy-mm-dd
 * @returns {number} Date as seconds since 1900
 */
export function getDateAsInt(date) {
  // Format input
  const [year, month, day] = date.split("-");
  assert.ok(year && month && day); // Make sure Y M D all given
  assert.ok(year >= 1900 && year <= 2099); // Make sure date is in a reasonable range, otherwise it's likely the input was malformatted and it's best to be safe by stopping -- we can always allow more edge cases if needed later
  const time = new Date(date).getTime() / 1000 + 2208988800; // 2208988800000 is 70 year offset; Unix timestamps below 1970 are negative and we want to allow from approximately 1900.
  assert.ok(!isNaN(time));
  return time;
}

export function logWithTimestamp(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function assertLengthIs(item, length, itemName) {
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
export async function createLeaf(
  issuer,
  secret,
  countryCode,
  nameCitySubdivisionZipStreetHash,
  completedAt,
  birthdate
) {
  assertLengthIs(issuer, 20, "issuer");
  assertLengthIs(secret, 16, "secret");
  try {
    return poseidon(
      [
        issuer,
        secret,
        countryCode,
        nameCitySubdivisionZipStreetHash,
        completedAt,
        birthdate,
      ].map((x) => ethers.BigNumber.from(x).toString())
    );
  } catch (err) {
    console.log(err);
  }
}

export async function sendEmail(to, subject, text, html) {
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

export function sha256(data) {
  // returns Buffer
  return createHash("sha256").update(data).digest();
}
