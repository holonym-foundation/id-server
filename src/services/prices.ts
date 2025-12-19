import { Request, Response } from "express";

import { pinoOptions, logger } from "../utils/logger.js";
import {
  getPriceFromCache,
  setPriceInCache,
  getMultiplePricesFromCache,
  setMultiplePricesInCache,
  tryGetLatestCryptoPriceWithFallback,
  CryptoPriceSlug
} from "../utils/cmc.js";
import { slugToID } from "../constants/cmc.js";

const endpointLogger = logger.child({
  msgPrefix: "[GET /prices] ",
  base: {
    ...pinoOptions.base,
  },
});

async function getPrice(req: Request, res: Response) {
  try {
    const slug = req.query.slug;
    if (!slug) {
      return res.status(400).json({ error: "No slug provided." });
    }

    const id = slugToID[slug as keyof typeof slugToID];

    const prices = await tryGetLatestCryptoPriceWithFallback([id]);
    const price = prices[String(id)];

    return res.status(200).json({
      price,
    });
  } catch (err: any) {
    if (err.response) {
      endpointLogger.error(
        { error: err.response.data, theUserIp: req.ip, userReq: req },
        "Error getting price from CMC (getPrice v1)"
      );
    } else if (err.request) {
      endpointLogger.error(
        { error: err.request.data, theUserIp: req.ip, userReq: req },
        "Error getting price from CMC (getPrice v1)"
      );
    } else {
      endpointLogger.error({ error: err.message }, "Error getting price from CMC (getPrice V1)");
    }
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

async function getPriceV2(req: Request, res: Response) {
  // const ip = headers().get("x-forwarded-for") || req.connection.remoteAddress;
  try {
    const slug = req.query.slug;
    if (!slug) {
      return res.status(400).json({ error: "No slug provided." });
    }

    const slugs = (slug as string).split(",");
    
    // Remove duplicates from requested slugs
    const uniqueSlugs = [...new Set(slugs)];

    // Check cache first - batch operation for better performance
    const cachedPrices = await getMultiplePricesFromCache(uniqueSlugs as CryptoPriceSlug[]);
    
    // Log cache hits
    // const cachedSlugs = Object.keys(cachedPrices);
    // if (cachedSlugs.length > 0) {
    //   endpointLogger.info({
    //     service: "cmc-api",
    //     action: "cache-hit",
    //     cachedSlugs,
    //     totalRequested: slugs.length,
    //     cacheHitRate: (cachedSlugs.length / uniqueSlugs.length * 100).toFixed(1) + "%",
    //     tags: ["service:cmc-api", "action:cache-hit"]
    //   }, `CMC API from cache: ${cachedSlugs.join(", ")}`);
    // }

    // Get ids of cryptos whose prices weren't retrieved from cache
    const ids = [];
    for (let i = 0; i < uniqueSlugs.length; i++) {
      const slug = uniqueSlugs[i] as CryptoPriceSlug;
      if (!cachedPrices[slug]) {
        ids.push(slugToID[slug]);
      }
    }

    if (ids.length === 0) {
      return res.status(200).json(cachedPrices);
    }

    // Log API request
    // const requestedSlugs = uniqueSlugs.filter(s => !cachedSlugs.includes(s));
    // endpointLogger.info({
    //   service: "cmc-api",
    //   action: "api-request",
    //   requestedSlugs,
    //   cmcIds: ids,
    //   tags: ["service:cmc-api", "action:api-request"]
    // }, `CMC API request for: ${requestedSlugs.join(", ")}`);

    const pricesById = await tryGetLatestCryptoPriceWithFallback(ids);

    const newPrices: Partial<Record<CryptoPriceSlug, number>> = {};

    for (let i = 0; i < uniqueSlugs.length; i++) {
      const slug = uniqueSlugs[i] as CryptoPriceSlug;

      // Ignore slugs whose prices were retrieved from cache
      if (cachedPrices[slug]) continue;

      const id = slugToID[slug];
      newPrices[slug] = pricesById[String(id)];
    }

    // Batch update cache for better performance
    if (Object.keys(newPrices).length > 0) {
      await setMultiplePricesInCache(newPrices as Record<CryptoPriceSlug, number>);
    }

    // Log successful API response
    // endpointLogger.info({
    //   service: "cmc-api",
    //   action: "api-success",
    //   fetchedSlugs: Object.keys(newPrices),
    //   cachedSlugs: Object.keys(cachedPrices),
    //   tags: ["service:cmc-api", "action:api-success"]
    //   }, `CMC API success request: ${Object.keys(newPrices).join(", ")}`);

    return res.status(200).json({ ...newPrices, ...cachedPrices });
  } catch (err: any) {
    const isRateLimit = err.response?.status === 429 || err.response?.status === 403;
    
    if (isRateLimit) {
      endpointLogger.error({
        service: "cmc-api",
        action: "api-error",
        errorType: "rate-limit",
        statusCode: err.response?.status,
        error: {
          message: err.message,
          responseData: err.response?.data,
          rateLimit: true
        },
        theUserIp: req.ip,
        tags: ["service:cmc-api", "action:api-error", "error:rate-limit"]
      }, `CMC API RATE LIMIT ERROR from IP: ${req.ip}`);
    } else if (err.response) {
      endpointLogger.error({
        service: "cmc-api",
        action: "api-error",
        errorType: "api-error",
        statusCode: err.response?.status,
        error: {
          message: err.message,
          responseData: err.response?.data
        },
        theUserIp: req.ip,
        tags: ["service:cmc-api", "action:api-error", "error:api-error"]
      }, `CMC API error from IP: ${req.ip}`);
    } else if (err.request) {
      endpointLogger.error({
        service: "cmc-api",
        action: "api-error",
        errorType: "network-error",
        error: {
          message: err.message,
          requestData: err.request?.data
        },
        theUserIp: req.ip,
        tags: ["service:cmc-api", "action:api-error", "error:network-error"]
      }, `CMC API network error from IP: ${req.ip}`);
    } else {
      endpointLogger.error({
        service: "cmc-api",
        action: "api-error",
        errorType: "unknown-error",
        error: {
          message: err.message
        },
        theUserIp: req.ip,
        tags: ["service:cmc-api", "action:api-error", "error:unknown-error"]
      }, `CMC API unknown error from IP: ${req.ip}`);
    }
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { getPrice, getPriceV2 };
