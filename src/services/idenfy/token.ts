import axios from "axios";
import { pinoOptions, logger } from "../../utils/logger.js";
import {
  IDENFY_BASE_URL,
  getIdenfyCredentials,
  idenfyBasicAuthHeader,
} from "./http.js";

/**
 * UUID of the KYC branding theme applied to every iDenfy session so the hosted
 * verification UI matches Human ID branding rather than iDenfy's stock look.
 * Created in the iDenfy dashboard (Settings → KYC → Branding); the same ID must
 * exist in both the live and sandbox iDenfy accounts. Sent as `theme` on
 * /api/v2/token — iDenfy falls back to its built-in "Default" theme if omitted.
 *
 * @see https://documentation.idenfy.com/KYC/GeneratingIdentificationToken/
 */
const IDENFY_KYC_THEME_UUID = "dd51a655-ecaa-47f4-8096-747cadad183f";

/**
 * iDenfy /api/v2/token request body.
 *
 * `clientId` is a partner-supplied identifier. iDenfy treats reused clientIds
 * as the same logical user — colliding clientIds across distinct sessions
 * create a fresh iDenfy session each call. We therefore key it on
 * `session._id` (a fresh ObjectId per Human ID session row), which gives us
 * idempotency on retry within the same session and uniqueness across sessions.
 *
 * @see https://documentation.idenfy.com/api/start-of-the-identification
 */
type CreateIdenfyTokenRequest = {
  clientId: string;
  /** UUID of the KYC branding theme to apply. @see IDENFY_KYC_THEME_UUID */
  theme?: string;
  // iDenfy's token endpoint accepts many other optional fields (firstName,
  // lastName, locale, country, expiryTime, tokenType, documents[],
  // generateDigitString, etc.). Add as needed — none are required.
};

export type IdenfyTokenResponse = {
  authToken: string;
  scanRef: string;
  expiryTime?: number;
  redirectUrl?: string;
  // iDenfy returns additional fields we don't currently consume.
  [key: string]: unknown;
};

const tokenLogger = logger.child({
  msgPrefix: "[services/idenfy/token] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "idenfy",
  },
});

/**
 * Create a new iDenfy applicant token.
 *
 * Throws on non-2xx (caller is responsible for converting to a route error).
 */
export async function createIdenfyToken(args: {
  clientId: string;
  sandbox?: boolean;
}): Promise<IdenfyTokenResponse> {
  const { clientId, sandbox = false } = args;
  const { apiKey, apiSecret } = getIdenfyCredentials(sandbox);

  if (!apiKey || !apiSecret) {
    throw new Error(
      sandbox
        ? "IDENFY_SANDBOX_API_KEY/IDENFY_SANDBOX_API_SECRET not configured"
        : "IDENFY_API_KEY/IDENFY_API_SECRET not configured"
    );
  }

  const reqBody: CreateIdenfyTokenRequest = {
    clientId,
    theme: IDENFY_KYC_THEME_UUID,
  };

  try {
    const resp = await axios.post<IdenfyTokenResponse>(
      `${IDENFY_BASE_URL}/api/v2/token`,
      reqBody,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: idenfyBasicAuthHeader(apiKey, apiSecret),
        },
        timeout: 10_000,
      }
    );

    if (!resp.data?.authToken || !resp.data?.scanRef) {
      tokenLogger.error(
        { responseShape: Object.keys(resp.data ?? {}) },
        "iDenfy /api/v2/token returned unexpected payload (missing authToken or scanRef)"
      );
      throw new Error("iDenfy /api/v2/token returned unexpected payload");
    }

    return resp.data;
  } catch (err: any) {
    // NEVER log api key/secret. axios error shape is { message, response: { status, data } }
    tokenLogger.error(
      {
        status: err?.response?.status,
        // err.response.data may include a human-readable error from iDenfy.
        responseData: err?.response?.data,
        message: err?.message,
        sandbox,
      },
      "Failed to create iDenfy token"
    );
    throw err;
  }
}
