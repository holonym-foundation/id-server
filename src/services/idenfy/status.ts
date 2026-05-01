import axios from "axios";
import { pinoOptions, logger } from "../../utils/logger.js";
import {
  IDENFY_BASE_URL,
  getIdenfyCredentials,
  idenfyBasicAuthHeader,
} from "./http.js";

const statusLogger = logger.child({
  msgPrefix: "[services/idenfy/status] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "idenfy",
  },
});

/**
 * iDenfy /api/v2/status response shape (subset we consume).
 *
 * @see https://documentation.idenfy.com/kyc/data-retrieval
 *
 * `status` is the top-level overall decision. Possible values:
 *   APPROVED | DENIED | SUSPECTED | REVIEWING | ACTIVE | EXPIRED
 */
export type IdenfyStatusResponse = {
  scanRef: string;
  clientId?: string;
  status: string;
  autoDocument?: string;
  autoFace?: string;
  manualDocument?: string;
  manualFace?: string;
  fraudTags?: string[];
  mismatchTags?: string[];
  [key: string]: unknown;
};

/**
 * Fetch the overall verification status for an iDenfy session by scanRef.
 *
 * Distinct from /api/v2/data (which returns extracted document fields but
 * NOT the overall decision). Used as a webhook fallback when iDenfy can't
 * call back to us (e.g. localhost dev).
 *
 * iDenfy recommends webhooks for delivery; do not poll on a tight loop.
 */
export async function fetchIdenfyStatus(args: {
  scanRef: string;
  sandbox?: boolean;
}): Promise<IdenfyStatusResponse> {
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
    resp = await axios.post<IdenfyStatusResponse>(
      `${IDENFY_BASE_URL}/api/v2/status`,
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
    statusLogger.error(
      {
        scanRef,
        status: err?.response?.status,
        responseData: err?.response?.data,
        message: err?.message,
        sandbox,
      },
      "Failed to fetch iDenfy status"
    );
    throw err;
  }

  const data = resp.data;
  if (!data || typeof data !== "object") {
    throw new Error("iDenfy /api/v2/status returned non-object payload");
  }
  if (!data.scanRef) {
    throw new Error("iDenfy /api/v2/status response missing scanRef");
  }
  if (data.scanRef !== scanRef) {
    statusLogger.error(
      { requestedScanRef: scanRef, returnedScanRef: data.scanRef },
      "iDenfy /api/v2/status scanRef mismatch — possible session mix-up"
    );
    throw new Error("iDenfy /api/v2/status scanRef mismatch");
  }
  if (!data.status) {
    throw new Error("iDenfy /api/v2/status response missing status");
  }

  return data;
}
