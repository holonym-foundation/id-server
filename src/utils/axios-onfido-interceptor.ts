import axios from "axios";
import { logger } from "./logger.js";

function isOnfidoUrl(url: string): boolean {
  return url.includes('api.us.onfido.com');
}

// Request interceptor - log Onfido API requests
// @ts-ignore
axios.interceptors.request.use(
  (config: any) => {
    if (isOnfidoUrl(config.url || '')) {
      logger.info({
        service: "onfido-api",
        method: (config.method || 'GET').toUpperCase(),
        url: config.url,
        tags: ["service:onfido-api", "action:request"]
      }, `Onfido API request: ${config.method?.toUpperCase()} ${config.url}`);
    }
    return config;
  },
  (error: any) => {
    return Promise.reject(error);
  }
);

// Response interceptor - only log Onfido API errors
// @ts-ignore
axios.interceptors.response.use(
  (response: any) => {
    // Don't log successful responses, just return them
    return response;
  },
  (error: any) => {
    if (isOnfidoUrl(error.config?.url || '')) {
      const statusCode = error.response?.status;
      const isRateLimit = statusCode === 429 || statusCode === 403;
      
      if (isRateLimit) {
        logger.error({
          service: "onfido-api",
          method: (error.config?.method || 'GET').toUpperCase(),
          url: error.config?.url,
          statusCode,
          error: {
            message: error.message,
            responseData: error.response?.data,
            rateLimit: true
          },
          tags: ["service:onfido-api", "action:error", "error:rate-limit", `status:${statusCode}`]
        }, `Onfido API RATE LIMIT ERROR: ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${statusCode}`);
      } else {
        logger.error({
          service: "onfido-api",
          method: (error.config?.method || 'GET').toUpperCase(),
          url: error.config?.url,
          statusCode,
          error: {
            message: error.message,
            responseData: error.response?.data
          },
          tags: ["service:onfido-api", "action:error", "error:api-error", `status:${statusCode}`]
        }, `Onfido API error: ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${statusCode}`);
      }
    }
    return Promise.reject(error);
  }
);

export default axios;
