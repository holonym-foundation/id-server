import axios from "axios";
import {
  ethereumCMCID,
  fantomCMCID,
  avalancheCMCID,
  slugToID,
  idToSlug,
  xlmCMCID,
  suiCMCID,
  idToPriceFallback
} from "../constants/cmc.js";
import logger from "./logger.js"
import { 
  getPriceFromRedisCache, 
  setPriceInRedisCache,
  getMultiplePricesFromRedisCache,
  setMultiplePricesInRedisCache
} from "./crypto-prices-cache.js";

export type CryptoPriceSlug = keyof typeof slugToID;

export type CryptoPricesCache = {
  [K in keyof typeof slugToID]?: {
    price: number,
    lastUpdatedAt: Date
  }
}

// Redis-based cache for crypto prices
export async function getPriceFromCache(slug: CryptoPriceSlug): Promise<number | null> {
  return await getPriceFromRedisCache(slug);
}

export async function setPriceInCache(slug: CryptoPriceSlug, price: number): Promise<void> {
  await setPriceInRedisCache(slug, price);
}

// Batch operations for better performance
export async function getMultiplePricesFromCache(slugs: CryptoPriceSlug[]): Promise<Partial<Record<CryptoPriceSlug, number>>> {
  return await getMultiplePricesFromRedisCache(slugs);
}

export async function setMultiplePricesInCache(prices: Record<CryptoPriceSlug, number>): Promise<void> {
  await setMultiplePricesInRedisCache(prices);
}

/**
 * Wrapper around the CMC price API.
 */
export function getLatestCryptoPrice(id: number | string) {
  // @ts-ignore
  return axios.get(
    `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=${id}`,
    {
      headers: {
        "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY,
        Accept: "application/json",
      },
    }
  );
}

/**
 * Call the CMC API. If it fails for any reason, return a default, hardcoded price
 * for the given cryptocurrency.
 * @param ids - Array of CMC IDs for the cryptocurrencies.
 * @returns A record mapping each ID to its price.
 */
export async function tryGetLatestCryptoPriceWithFallback(
  ids: (number | string)[]
): Promise<Record<string, number>> {
  const idString = ids.join(',');

  let prices: Record<string, number> = {};

  try {
    const resp = await getLatestCryptoPrice(idString);
    const data = resp?.data?.data;

    for (const id of ids) {
      const price = data?.[id]?.quote?.USD?.price;
      if (price) {
        prices[String(id)] = price;
      }
    }
  } catch (err: any) {
    const errorMessage = err?.response?.data?.status?.error_message ?? err?.response?.data ?? err.message;
    const statusCode = err?.response?.status;
    
    logger.error(
      `Error querying CMC API - Status: ${statusCode || 'N/A'}, Message: ${errorMessage}`
    )
  }

  // Fill in missing prices with fallbacks
  for (const id of ids) {
    if (!prices[String(id)]) {
      const fallbackPrice = idToPriceFallback[id as keyof typeof idToPriceFallback];
      if (fallbackPrice) {
        prices[String(id)] = fallbackPrice;
      }
    }
  }

  // Check if any IDs are still missing prices
  for (const id of ids) {
    if (prices[String(id)] === undefined || prices[String(id)] === null) {
      throw new Error(`Could not get price for cryptocurrency with CMC ID ${id}. CMC API call failed, and no fallback price was found.`);
    }
  }

  return prices;
}

/**
 * First, check the cache. If nothing in cache, query CMC, and update cache.
 */
export async function getPriceFromCacheOrAPI(id: keyof typeof idToSlug) {
  const slug = idToSlug[id];
  const cachedPrice = await getPriceFromCache(slug);
  if (cachedPrice) {
    return cachedPrice;
  }
  const prices = await tryGetLatestCryptoPriceWithFallback([id])
  const price = prices[String(id)];
  await setPriceInCache(slug, price);
  return price;
}

// TODO: getBatchPricesFromCacheOrAPI

export async function usdToETH(usdAmount: number) {
  const ethPrice = await getPriceFromCacheOrAPI(ethereumCMCID)
  const ethAmount = usdAmount / ethPrice;
  return ethAmount;
}

export async function usdToFTM(usdAmount: number) {
  const fantomPrice = await getPriceFromCacheOrAPI(fantomCMCID)
  const ftmAmount = usdAmount / fantomPrice;
  return ftmAmount;
}

export async function usdToAVAX(usdAmount: number) {
  const avalanchePrice = await getPriceFromCacheOrAPI(avalancheCMCID)
  const ftmAmount = usdAmount / avalanchePrice;
  return ftmAmount;
}

export async function usdToXLM(usdAmount: number) {
  const xlmPrice = await getPriceFromCacheOrAPI(xlmCMCID)
  const xlmAmount = usdAmount / xlmPrice;
  return xlmAmount;
}

export async function usdToSui(usdAmount: number) {
  const suiPrice = await getPriceFromCacheOrAPI(suiCMCID)
  const suiAmount = usdAmount / suiPrice;
  return suiAmount;
}
