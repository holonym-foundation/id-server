import axios from "axios";
import { logger } from "./logger.js";

function isOnfidoUrl(url: string): boolean {
  return url.includes('api.us.onfido.com');
}

// Request interceptor - just log Onfido API requests
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

export default axios;
