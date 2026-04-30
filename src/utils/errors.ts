import axios from 'axios';

export function toAlreadyRegisteredStr(userId: string) {
  return `User has already registered. User ID: ${userId}`
}

/**
 * Canonical sybil-failure prefixes across credential types. Each prefix is the
 * writer of a uniqueness/sybil rejection in its respective flow:
 *
 *   - 'User has already registered' — gov-id / KYC / clean-hands / zk-passport.
 *     Canonical writer: `toAlreadyRegisteredStr` above. Used by Onfido v1/v2/v3,
 *     Sumsub, Veriff, Idenfy, AML cross-provider, and zk-passport.
 *   - 'Number has been registered already' — phone. Writer:
 *     `failPhoneSession(..., 'Number has been registered already')` in
 *     `services/phone/check-number.ts`.
 *   - 'Face scan failed as highly matching duplicates are found' — biometrics.
 *     Writer: FaceTec duplicate-match path in
 *     `services/facetec/{credentials,v2/no-sybils/credentials,enrollment-3d}.js`.
 *
 * Keep this list in sync with new sybil writers. The frontend mirrors this in
 * `frontend/src/hooks/holonym/misc.ts:isAlreadyRegisteredFailure`.
 */
const SYBIL_FAILURE_PREFIXES = [
  'User has already registered',
  'Number has been registered already',
  'Face scan failed as highly matching duplicates are found'
] as const

/**
 * True iff the given verification-failure reason indicates a sybil/uniqueness
 * rejection across any credential type.
 */
export function isAlreadyRegisteredFailure(reason: string | null | undefined): boolean {
  if (!reason) return false
  return SYBIL_FAILURE_PREFIXES.some((p) => reason.startsWith(p))
}

export class CustomError extends Error {
  userFacingMessage: string;
  logMessage: string;
  httpStatusCode: number;

  constructor({
    userFacingMessage,
    logMessage,
    httpStatusCode
  }: {
    userFacingMessage: string,
    logMessage: string,
    httpStatusCode: number
  }) {
    super(userFacingMessage);
    this.userFacingMessage = userFacingMessage;
    this.logMessage = logMessage;
    this.httpStatusCode = httpStatusCode;
  }
}

/**
 * Converts an unknown error to a concise, loggable message/object.
 * For axios errors, extracts request/response info including URL.
 * For other errors, returns the error object as-is.
 */
export function makeUnknownErrorLoggable(error: unknown): {
  message: string;
  error: unknown;
  axiosError?: {
    url?: string;
    method?: string;
    status?: number;
    statusText?: string;
    responseData?: unknown;
    requestData?: unknown;
    message: string;
  };
} {
  if (axios.isAxiosError(error)) {
    const axiosError = error as any;
    const url = axiosError.config?.url || axiosError.request?.url || 'unknown URL';
    const method = axiosError.config?.method?.toUpperCase() || axiosError.request?.method?.toUpperCase() || 'UNKNOWN';
    const status = axiosError.response?.status;
    const statusText = axiosError.response?.statusText;
    const responseData = axiosError.response?.data;
    const requestData = axiosError.config?.data || axiosError.request?.data;

    // Build a concise message
    let message = `Axios error: ${method} ${url}`;
    if (status) {
      message += ` - ${status} ${statusText || ''}`.trim();
    } else if (axiosError.request && !axiosError.response) {
      message += ' - No response received (network error)';
    } else {
      message += ` - ${axiosError.message}`;
    }

    return {
      message,
      error: {
        message: axiosError.message,
        code: axiosError.code,
        stack: axiosError.stack
      },
      axiosError: {
        url,
        method,
        status,
        statusText,
        responseData,
        requestData,
        message: axiosError.message
      }
    };
  }

  // For non-axios errors, return the error as-is
  return {
    message: error instanceof Error ? error.message : String(error),
    error
  };
}
