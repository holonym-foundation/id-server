import { valkeyClient } from "./valkey-glide.js";
import { CryptoPriceSlug } from "./cmc.js";
import { logger } from "./logger.js";

const CACHE_PREFIX = "crypto_price:";
const DEFAULT_TTL = 90; // 90 seconds in Redis

interface CachedPrice {
  price: number;
  lastUpdatedAt: string; // ISO string for JSON serialization
}

export async function getPriceFromRedisCache(slug: CryptoPriceSlug): Promise<number | null> {
  if (!valkeyClient) {
    console.warn("Valkey client not available, falling back to no cache");
    return null;
  }

  try {
    const key = `${CACHE_PREFIX}${slug}`;
    const cached = await valkeyClient.get(key);
    
    if (!cached) {
      return null;
    }

    const cachedPrice: CachedPrice = JSON.parse(cached.toString());
    const now = new Date();
    const lastUpdated = new Date(cachedPrice.lastUpdatedAt);
    
    // Check if cache is still valid (within TTL)
    const ageInSeconds = (now.getTime() - lastUpdated.getTime()) / 1000;
    if (ageInSeconds > DEFAULT_TTL) {
      // Cache expired, remove it
      await valkeyClient.del([key]);
      return null;
    }

    return cachedPrice.price;
  } catch (error) {
    // add to datadog, error
    logger.error({
      service: "cmc-api-cache",
      action: "cache-get-error",
      error,
      slug,
      tags: ["service:cmc-api-cache", "action:cache-get-error"]
    }, "Error getting price from Redis cache");
    console.error("Error getting price from Redis cache:", error);
    return null;
  }
}

export async function setPriceInRedisCache(slug: CryptoPriceSlug, price: number): Promise<void> {
  if (!valkeyClient) {
    console.warn("Valkey client not available, skipping cache");
    return;
  }

  try {
    const key = `${CACHE_PREFIX}${slug}`;
    const cachedPrice: CachedPrice = {
      price,
      lastUpdatedAt: new Date().toISOString()
    };

    // Store with TTL using setex command
    await valkeyClient.customCommand(["SETEX", key, DEFAULT_TTL.toString(), JSON.stringify(cachedPrice)]);
  } catch (error) {
    console.error("Error setting price in Redis cache:", error);
    // add to datadog, error
    logger.error({
      service: "cmc-api-cache",
      action: "cache-set-error",
      error,
      slug,
      price,
      tags: ["service:cmc-api-cache", "action:cache-set-error"]
    }, "Error setting price in Redis cache");
  }
}

export async function getMultiplePricesFromRedisCache(slugs: CryptoPriceSlug[]): Promise<Partial<Record<CryptoPriceSlug, number>>> {
  if (!valkeyClient) {
    logger.warn({
      service: "cmc-api-cache",
      action: "client-unavailable",
      requestedSlugs: slugs,
      tags: ["service:cmc-api-cache", "action:client-unavailable"]
    }, "Valkey client not available, falling back to no cache");
    return {};
  }
  
  if (slugs.length === 0) {
    return {};
  }

  try {
    const keys = slugs.map(slug => `${CACHE_PREFIX}${slug}`);
    
    // Use individual GET commands instead of MGET to avoid CrossSlot error
    const getPromises = keys.map(key => valkeyClient!.get(key));
    const cachedValues = await Promise.all(getPromises);
    
    // logger.info({
    //   service: "cmc-api-cache",
    //   action: "cache-lookup-result",
    //   requestedSlugs: slugs,
    //   cacheKeys: keys,
    //   retrievedValues: cachedValues,
    //   tags: ["service:cmc-api-cache", "action:cache-lookup-result"]
    // }, "CMC API cache lookup result");
    
    const result: Partial<Record<CryptoPriceSlug, number>> = {};
    
    for (let i = 0; i < slugs.length; i++) {
      const cached = cachedValues[i];
      if (cached) {
        try {
          const cachedPrice: CachedPrice = JSON.parse(cached.toString());
          const now = new Date();
          const lastUpdated = new Date(cachedPrice.lastUpdatedAt);
          
          // Check if cache is still valid
          const ageInSeconds = (now.getTime() - lastUpdated.getTime()) / 1000;
          if (ageInSeconds <= DEFAULT_TTL) {
            result[slugs[i]] = cachedPrice.price;
          }
        } catch (parseError) {
          console.error(`Error parsing cached price for ${slugs[i]}:`, parseError);
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error("Error getting multiple prices from Redis cache:", error);
    // log to datadog, error
    logger.error({
      service: "cmc-api-cache",
      action: "cache-get-error",
      error,
      requestedSlugs: slugs,
      tags: ["service:cmc-api-cache", "action:cache-get-error"]
    }, "CMC API cache get error");
    return {};
  }
}

export async function setMultiplePricesInRedisCache(prices: Record<CryptoPriceSlug, number>): Promise<void> {
  if (!valkeyClient) {
    logger.warn({
      service: "cmc-api-cache",
      action: "client-unavailable",
      pricesToCache: Object.keys(prices),
      tags: ["service:cmc-api-cache", "action:client-unavailable"]
    }, "CMC API Valkey client not available, skipping cache");
    return;
  }
  
  if (Object.keys(prices).length === 0) {
    return;
  }

  try {
    // Use individual setex operations
    const promises = Object.entries(prices).map(async ([slug, price]) => {
      const key = `${CACHE_PREFIX}${slug}`;
      const cachedPrice: CachedPrice = {
        price,
        lastUpdatedAt: new Date().toISOString()
      };
      
      return valkeyClient!.customCommand(["SETEX", key, DEFAULT_TTL.toString(), JSON.stringify(cachedPrice)]);
    });
    
    await Promise.all(promises);
    
    // Log successful cache setting
    // logger.info({
    //   service: "cmc-api-cache",
    //   action: "cache-set",
    //   pricesToCache: Object.keys(prices),
    //   priceCount: Object.keys(prices).length,
    //   ttl: DEFAULT_TTL,
    //   tags: ["service:cmc-api-cache", "action:cache-set"]
    // }, `CMC API cached ${Object.keys(prices).length} prices in Redis with ${DEFAULT_TTL}s TTL`);
    
  } catch (error) {
    console.error("Error setting multiple prices in Redis cache:", error);
    // log to datadog, error
    logger.error({
      service: "cmc-api-cache",
      action: "cache-set-error",
      error,
      pricesToCache: Object.keys(prices),
      tags: ["service:cmc-api-cache", "action:cache-set-error"]
    }, "CMC API error setting multiple prices in Redis cache");
  }
}

export async function clearCryptoCache(): Promise<void> {
  if (!valkeyClient) {
    return;
  }

  try {
    // Use KEYS command to find all crypto price keys
    const pattern = `${CACHE_PREFIX}*`;
    const keys = await valkeyClient.customCommand(["KEYS", pattern]);
    
    if (keys && Array.isArray(keys) && keys.length > 0) {
      // Filter out null values and convert to string array
      const validKeys = keys.filter(key => key !== null).map(key => key.toString());
      if (validKeys.length > 0) {
        await valkeyClient.del(validKeys);
      }
    }
  } catch (error) {
    console.error("Error clearing crypto cache:", error);
  }
}

export async function getCacheStats(): Promise<{ totalKeys: number; memoryUsage: string }> {
  if (!valkeyClient) {
    return { totalKeys: 0, memoryUsage: "0B" };
  }

  try {
    // Count keys with pattern
    const pattern = `${CACHE_PREFIX}*`;
    const keys = await valkeyClient.customCommand(["KEYS", pattern]);
    const keyCount = Array.isArray(keys) ? keys.length : 0;
    
    // Get memory info
    const info = await valkeyClient.customCommand(["INFO", "memory"]);
    const infoStr = info ? (Array.isArray(info) ? info.join('') : info.toString()) : '';
    
    // Parse memory usage from Redis INFO
    const memoryMatch = infoStr.match(/used_memory_human:([^\r\n]+)/);
    const memoryUsage = memoryMatch ? memoryMatch[1].trim() : "unknown";
    
    return {
      totalKeys: keyCount,
      memoryUsage
    };
  } catch (error) {
    console.error("Error getting cache stats:", error);
    return { totalKeys: 0, memoryUsage: "error" };
  }
}
