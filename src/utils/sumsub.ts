import crypto from "crypto";
import axios, { type AxiosInstance } from "axios";
import logger from "./logger.js";
import { SUMSUB_BASE_URL } from "../constants/sumsub.js";

const sumsubLogger = logger.child({ msgPrefix: "[sumsub] " });

const clients = new Map<string, AxiosInstance>();

/**
 * Register a named Sumsub axios client with a request interceptor for HMAC signing.
 * Call once per environment (e.g. "live", "sandbox") at startup.
 * See: https://github.com/SumSubstance/AppTokenUsageExamples/tree/master/JS
 */
export function initSumsubClient(name: string, appToken: string, secretKey: string) {
  const client = axios.create({
    baseURL: SUMSUB_BASE_URL,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-App-Token': appToken,
    },
  });

  client.interceptors.request.use((config) => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secretKey);
    sig.update(ts + config.method!.toUpperCase() + config.url!);
    if (config.data) {
      sig.update(config.data);
    }
    config.headers['X-App-Access-Ts'] = ts;
    config.headers['X-App-Access-Sig'] = sig.digest('hex');
    return config;
  });

  clients.set(name, client);
}

function getClient(environment: string): AxiosInstance {
  const client = clients.get(environment);
  if (!client) throw new Error(`Sumsub client "${environment}" not initialized. Call initSumsubClient() first.`);
  return client;
}

/**
 * Create a Sumsub applicant.
 * See: https://docs.sumsub.com/reference/create-an-applicant
 */
export async function createSumsubApplicant(
  environment: string,
  externalUserId: string,
  levelName: string
) {
  const url = `/resources/applicants?levelName=${encodeURIComponent(levelName)}`;
  const body = JSON.stringify({ externalUserId });

  try {
    const resp = await getClient(environment).post(url, body);
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
  environment: string,
  externalUserId: string,
  levelName: string,
  ttlInSecs: number = 1200,
) {
  const url = `/resources/accessTokens?userId=${encodeURIComponent(externalUserId)}&levelName=${encodeURIComponent(levelName)}&ttlInSecs=${ttlInSecs}`;

  try {
    const resp = await getClient(environment).post(url);
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
  environment: string,
  applicantId: string,
) {
  const url = `/resources/applicants/${applicantId}/one`;

  try {
    const resp = await getClient(environment).get(url);
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
  environment: string,
  applicantId: string,
) {
  const url = `/resources/applicants/${applicantId}/info/idDoc`;

  try {
    const resp = await getClient(environment).get(url);
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
  environment: string,
  applicantId: string,
) {
  const url = `/resources/checks/latest?type=SIMILAR_SEARCH&applicantId=${applicantId}`;

  try {
    const resp = await getClient(environment).get(url);
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
