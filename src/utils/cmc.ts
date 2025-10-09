import axios from "axios";
import {
  ethereumCMCID,
  fantomCMCID,
  avalancheCMCID,
  slugToID,
  idToSlug,
  xlmCMCID,
  suiCMCID
} from "../constants/cmc.js";
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
 * Get price of the crypto designated by the given CMC ID.
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
 * First, check the cache. If nothing in cache, query CMC, and update cache.
 */
export async function getPriceFromCacheOrAPI(id: keyof typeof idToSlug) {
  const slug = idToSlug[id];
  const cachedPrice = await getPriceFromCache(slug);
  if (cachedPrice) {
    return cachedPrice;
  }
  const resp = await getLatestCryptoPrice(id)
  const price = resp?.data?.data?.[id]?.quote?.USD?.price;
  await setPriceInCache(slug, price);
  return price;
}

// TODO: getBatchPricesFromCacheOrAPI

export async function usdToETH(usdAmount: number) {
  // TEMPORARILY HARD CODING CONVERSION RATE TO GET AROUND CMC RATE LIMITS
  // const ethPrice = await getPriceFromCacheOrAPI(ethereumCMCID)
  const ethPrice = 4339.08
  const ethAmount = usdAmount / ethPrice;
  return ethAmount;
}

export async function usdToFTM(usdAmount: number) {
  const fantomPrice = await getPriceFromCacheOrAPI(fantomCMCID)
  const ftmAmount = usdAmount / fantomPrice;
  return ftmAmount;
}

export async function usdToAVAX(usdAmount: number) {
  // const avalanchePrice = await getPriceFromCacheOrAPI(avalancheCMCID)
  const avalanchePrice = 28
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
