import crypto from "crypto";
import axios from "axios";
import logger from "./logger.js";
import { SUMSUB_BASE_URL } from "../constants/sumsub.js";

const sumsubLogger = logger.child({ msgPrefix: "[sumsub] " });

/**
 * Create HMAC-SHA256 signature for Sumsub API authentication.
 * Signs: ts + method + urlPath + body
 * See: https://docs.sumsub.com/reference/authentication
 */
export function createSumsubSignature(
  method: string,
  urlPath: string,
  ts: number,
  body: string,
  secretKey: string
): string {
  const hmac = crypto.createHmac("sha256", secretKey);
  hmac.update(ts.toString() + method.toUpperCase() + urlPath + body);
  return hmac.digest("hex");
}

/**
 * Build authenticated headers for a Sumsub API request.
 */
export function getSumsubHeaders(
  method: string,
  urlPath: string,
  body: string = "",
  appToken: string,
  secretKey: string
): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createSumsubSignature(method, urlPath, ts, body, secretKey);
  return {
    "Content-Type": "application/json",
    "X-App-Token": appToken,
    "X-App-Access-Sig": sig,
    "X-App-Access-Ts": ts.toString(),
  };
}

/**
 * Create a Sumsub applicant.
 * See: https://docs.sumsub.com/reference/create-an-applicant
 */
export async function createSumsubApplicant(
  appToken: string,
  secretKey: string,
  externalUserId: string,
  levelName: string,
  baseUrl: string = SUMSUB_BASE_URL
) {
  const urlPath = `/resources/applicants?levelName=${encodeURIComponent(levelName)}`;
  const body = JSON.stringify({ externalUserId });
  const headers = getSumsubHeaders("POST", urlPath, body, appToken, secretKey);

  try {
    const resp = await axios.post(`${baseUrl}${urlPath}`, body, { headers });
    return resp.data;
  } catch (err: any) {
    sumsubLogger.error(
      { errMsg: err.message, errResponseData: err.response?.data, externalUserId },
      "Error creating Sumsub applicant"
    );
    throw err;
  }
}

/**
 * Generate an access token for the Sumsub Web SDK.
 * See: https://docs.sumsub.com/reference/generate-access-token
 */
export async function getSumsubAccessToken(
  appToken: string,
  secretKey: string,
  externalUserId: string,
  levelName: string,
  ttlInSecs: number = 1200,
  baseUrl: string = SUMSUB_BASE_URL
) {
  const urlPath = `/resources/accessTokens?userId=${encodeURIComponent(externalUserId)}&levelName=${encodeURIComponent(levelName)}&ttlInSecs=${ttlInSecs}`;
  const body = "";
  const headers = getSumsubHeaders("POST", urlPath, body, appToken, secretKey);

  try {
    const resp = await axios.post(`${baseUrl}${urlPath}`, body, { headers });
    return resp.data as { token: string; userId: string };
  } catch (err: any) {
    sumsubLogger.error(
      { errMsg: err.message, errResponseData: err.response?.data, externalUserId },
      "Error generating Sumsub access token"
    );
    throw err;
  }
}

/**
 * Get full applicant data (info, review, idDocs, etc.).
 * See: https://docs.sumsub.com/reference/get-applicant-data
 */
export async function getSumsubApplicantData(
  appToken: string,
  secretKey: string,
  applicantId: string,
  baseUrl: string = SUMSUB_BASE_URL
) {
  const urlPath = `/resources/applicants/${applicantId}/one`;
  const headers = getSumsubHeaders("GET", urlPath, "", appToken, secretKey);

  try {
    const resp = await axios.get(`${baseUrl}${urlPath}`, { headers });
    return resp.data;
  } catch (err: any) {
    sumsubLogger.error(
      { errMsg: err.message, errResponseData: err.response?.data, applicantId },
      "Error getting Sumsub applicant data"
    );
  }
}

/**
 * Get ID document data for an applicant.
 * See: https://docs.sumsub.com/reference/get-id-verification-results
 */
export async function getSumsubIdDocs(
  appToken: string,
  secretKey: string,
  applicantId: string,
  baseUrl: string = SUMSUB_BASE_URL
) {
  const urlPath = `/resources/applicants/${applicantId}/info/idDoc`;
  const headers = getSumsubHeaders("GET", urlPath, "", appToken, secretKey);

  try {
    const resp = await axios.get(`${baseUrl}${urlPath}`, { headers });
    return resp.data;
  } catch (err: any) {
    sumsubLogger.error(
      { errMsg: err.message, errResponseData: err.response?.data, applicantId },
      "Error getting Sumsub ID docs"
    );
  }
}

/**
 * Verify a Sumsub webhook signature.
 * Sumsub sends the digest in the `x-payload-digest` header and the algorithm
 * in `x-payload-digest-alg` (default: HMAC_SHA256_HEX).
 * See: https://docs.sumsub.com/docs/webhook-manager
 */
export function verifySumsubWebhookSignature(
  rawBody: Buffer | string,
  signature: string,
  webhookSecret: string,
  algorithm: string = "HMAC_SHA256_HEX"
): boolean {
  let hmacAlgorithm: string;
  if (algorithm === "HMAC_SHA1_HEX") {
    hmacAlgorithm = "sha1";
  } else if (algorithm === "HMAC_SHA512_HEX") {
    hmacAlgorithm = "sha512";
  } else {
    // Default: HMAC_SHA256_HEX
    hmacAlgorithm = "sha256";
  }

  const hmac = crypto.createHmac(hmacAlgorithm, webhookSecret);
  hmac.update(rawBody);
  const computed = hmac.digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(signature, "hex")
  );
}

/**
 * Get duplicate applicant check results (SIMILAR_SEARCH).
 * Returns whether Sumsub detected duplicate applicants based on face, name,
 * document number, etc.
 * See: https://docs.sumsub.com/reference/get-duplicate-applicants-check-result
 */
export async function getSumsubDuplicateCheck(
  appToken: string,
  secretKey: string,
  applicantId: string,
  baseUrl: string = SUMSUB_BASE_URL
) {
  const urlPath = `/resources/checks/latest?type=SIMILAR_SEARCH&applicantId=${applicantId}`;
  const headers = getSumsubHeaders("GET", urlPath, "", appToken, secretKey);

  try {
    const resp = await axios.get(`${baseUrl}${urlPath}`, { headers });
    return resp.data as {
      answer: "GREEN" | "RED";
      checkType: string;
      createdAt: string;
      id: string;
      similarSearchInfo?: {
        answer: string;
        duplicateApplicantHits?: Array<{
          applicantId: string;
          matchedFields: string[];
          types: string[];
        }>;
      };
    };
  } catch (err: any) {
    sumsubLogger.error(
      { errMsg: err.message, errResponseData: err.response?.data, applicantId },
      "Error getting Sumsub duplicate check results"
    );
  }
}

// NOTE: Sumsub does not support applicant deletion like Onfido does.
// Sumsub offers "deactivate" (PATCH /resources/applicants/{id}/presence/deactivated)
// and "reset" endpoints, but neither guarantees immediate PII removal.
// Per Sumsub's privacy notice, data deletion requests are fulfilled within 30 days.
// See: https://docs.sumsub.com/reference/deactivate-applicant-profile
