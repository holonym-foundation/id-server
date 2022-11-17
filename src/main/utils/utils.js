import assert from "assert";
import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { poseidon } from "circomlibjs-old";

/**
 * Sign data with the server's private key
 */
export async function sign(data) {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const signature = await wallet.signMessage(data);
  return signature;
}

/**
 * @param {string} date Must be of form yyyy-mm-dd
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
 * @param {string} subdivision hex string representation
 * @param {Buffer} completedAt
 * @param {Buffer} birthdate
 * @returns {Promise<string>} Poseidon hash (of input data) right-shifted 3 bits. Represented as
 * a base 10 number represented as a string.
 */
export async function createLeaf(
  issuer,
  secret,
  countryCode,
  subdivision,
  completedAt,
  birthdate
) {
  assertLengthIs(issuer, 20, "issuer");
  assertLengthIs(secret, 16, "secret");
  // assertLengthIs(countryCode, 2, "countryCode");
  // assertLengthIs(subdivision, 2, "subdivision");
  // assertLengthIs(completedAt, 3, "completedAt");
  // assertLengthIs(birthdate, 3, "birthdate");
  try {
    return poseidon(
      [issuer, secret, countryCode, subdivision, completedAt, birthdate].map((x) =>
        ethers.BigNumber.from(x).toString()
      )
    );
  } catch (err) {
    console.log(err);
  }
}
