import axios from "axios";
import { pinoOptions, logger } from "../../utils/logger.js";
import type { IdenfyVerificationData } from "./credentials/utils.js";
import {
  IDENFY_BASE_URL,
  getIdenfyCredentials,
  idenfyBasicAuthHeader,
} from "./http.js";

const dataLogger = logger.child({
  msgPrefix: "[services/idenfy/data] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "idenfy",
  },
});

/**
 * Fetch full verification data for a completed iDenfy session.
 *
 * @see https://documentation.idenfy.com/api/get-verification-data
 *
 * Response shape is partially defined by IdenfyVerificationData; the iDenfy
 * payload also includes media URLs and analyzer flags we don't consume.
 *
 * Throws on:
 *   - missing API credentials.
 *   - non-2xx HTTP response.
 *   - response payload missing `scanRef` or where the response `scanRef`
 *     differs from the request `scanRef` (defensive — prevents accepting
 *     payload for a different session).
 */
export async function fetchIdenfyVerificationData(args: {
  scanRef: string;
  sandbox?: boolean;
}): Promise<IdenfyVerificationData> {
  const { scanRef, sandbox = false } = args;
  const { apiKey, apiSecret } = getIdenfyCredentials(sandbox);

  if (!apiKey || !apiSecret) {
    throw new Error(
      sandbox
        ? "IDENFY_SANDBOX_API_KEY/IDENFY_SANDBOX_API_SECRET not configured"
        : "IDENFY_API_KEY/IDENFY_API_SECRET not configured"
    );
  }

  if (!scanRef) {
    throw new Error("scanRef is required");
  }

  let resp;
  try {
    resp = await axios.post<IdenfyVerificationData>(
      `${IDENFY_BASE_URL}/api/v2/data`,
      { scanRef },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: idenfyBasicAuthHeader(apiKey, apiSecret),
        },
        timeout: 10_000,
      }
    );
  } catch (err: any) {
    dataLogger.error(
      {
        scanRef,
        status: err?.response?.status,
        responseData: err?.response?.data,
        message: err?.message,
        sandbox,
      },
      "Failed to fetch iDenfy verification data"
    );
    throw err;
  }

  const data = resp.data;
  if (!data || typeof data !== "object") {
    throw new Error("iDenfy /api/v2/data returned non-object payload");
  }
  if (!data.scanRef) {
    throw new Error("iDenfy /api/v2/data response missing scanRef");
  }
  if (data.scanRef !== scanRef) {
    dataLogger.error(
      { requestedScanRef: scanRef, returnedScanRef: data.scanRef },
      "iDenfy /api/v2/data scanRef mismatch — possible session mix-up"
    );
    throw new Error("iDenfy /api/v2/data scanRef mismatch");
  }
  // /api/v2/data does NOT carry the overall verification decision — that
  // lives on /api/v2/status. Callers that need the decision must fetch it
  // separately via fetchIdenfyStatus.

  return data;
}
