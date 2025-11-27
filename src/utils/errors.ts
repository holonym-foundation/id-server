import axios from 'axios';

export function toAlreadyRegisteredStr(userId: string) {
  return `User has already registered. User ID: ${userId}`
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
