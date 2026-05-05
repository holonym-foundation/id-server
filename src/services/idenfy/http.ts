/**
 * Shared HTTP-client helpers for the iDenfy API. Used by token.ts (POST
 * /api/v2/token) and data.ts (POST /api/v2/data).
 *
 * Sandbox vs production is selected per call via the `sandbox` flag — both
 * paths use the same hostname (`ivs.idenfy.com`) but different API keys.
 */

export const IDENFY_BASE_URL = "https://ivs.idenfy.com";

export function getIdenfyCredentials(sandbox: boolean): {
  apiKey: string;
  apiSecret: string;
} {
  if (sandbox) {
    return {
      apiKey: process.env.IDENFY_SANDBOX_API_KEY ?? "",
      apiSecret: process.env.IDENFY_SANDBOX_API_SECRET ?? "",
    };
  }
  return {
    apiKey: process.env.IDENFY_API_KEY ?? "",
    apiSecret: process.env.IDENFY_API_SECRET ?? "",
  };
}

export function idenfyBasicAuthHeader(apiKey: string, apiSecret: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
}
