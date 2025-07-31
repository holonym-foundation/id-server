import axios from "axios";
import {
  ethereumCMCID,
  fantomCMCID,
  avalancheCMCID,
  idToSlug,
  xlmCMCID,
  suiCMCID
} from "../constants/cmc.js";

// TODO: Use redis instead. This is a temporary solution to avoid hitting
// CMC's rate limit. key-value pair is { slug: { price: number, lastUpdatedAt: Date } }
const cryptoPricesCache = {};

export function getPriceFromCache(slug) {
  const now = new Date();
  const cachedPrice = cryptoPricesCache[slug];
  // If price was last updated less than 30 seconds ago, use cached price
  if (cachedPrice && now - cachedPrice.lastUpdatedAt < 30 * 1000) {
    return cachedPrice.price;
  }
}

export function setPriceInCache(slug, price) {
  cryptoPricesCache[slug] = { price, lastUpdatedAt: new Date() };
}

/**
 * Get price of the crypto designated by the given CMC ID.
 */
export function getLatestCryptoPrice(id) {
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
export async function getPriceFromCacheOrAPI(id) {
  const slug = idToSlug[id];
  const cachedPrice = getPriceFromCache(slug);
  if (cachedPrice) {
    return cachedPrice;
  }
  const resp = await getLatestCryptoPrice(id)
  const price = resp?.data?.data?.[id]?.quote?.USD?.price;
  setPriceInCache(slug, price);
  return price;
}

// TODO: getBatchPricesFromCacheOrAPI

export async function usdToETH(usdAmount) {
  const ethPrice = await getPriceFromCacheOrAPI(ethereumCMCID)
  const ethAmount = usdAmount / ethPrice;
  return ethAmount;
}

export async function usdToFTM(usdAmount) {
  const fantomPrice = await getPriceFromCacheOrAPI(fantomCMCID)
  const ftmAmount = usdAmount / fantomPrice;
  return ftmAmount;
}

export async function usdToAVAX(usdAmount) {
  const avalanchePrice = await getPriceFromCacheOrAPI(avalancheCMCID)
  const ftmAmount = usdAmount / avalanchePrice;
  return ftmAmount;
}

export async function usdToXLM(usdAmount) {
  const xlmPrice = await getPriceFromCacheOrAPI(xlmCMCID)
  const xlmAmount = usdAmount / xlmPrice;
  return xlmAmount;
}

export async function usdToSui(usdAmount) {
  const suiPrice = await getPriceFromCacheOrAPI(suiCMCID)
  const suiAmount = usdAmount / suiPrice;
  return suiAmount;
}
