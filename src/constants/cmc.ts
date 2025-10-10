export const ethereumCMCID = 1027;
export const avalancheCMCID = 5805;
// export const fantomCMCID = 3513;
export const fantomCMCID = 32684; // Sonic
export const nearCMCID = 6535;

export const suiCMCID = 20947;

export const xlmCMCID = 512;

export const slugToID = {
  ethereum: ethereumCMCID,
  avalanche: avalancheCMCID,
  fantom: fantomCMCID,
  near: nearCMCID,
  stellar: xlmCMCID,
  sui: suiCMCID,
};

export const idToSlug = {
  [ethereumCMCID]: "ethereum" as const,
  [avalancheCMCID]: "avalanche" as const,
  [fantomCMCID]: "fantom" as const,
  [nearCMCID]: "near" as const,
  [xlmCMCID]: "stellar" as const,
  [suiCMCID]: "sui" as const
}

// Hardcoded USD prices of cryptocurrencies, in case the CMC API fails us
export const ETH_PRICE_FALLBACK = 4378.26
export const AVAX_PRICE_FALLBACK = 28
export const FTM_PRICE_FALLBACK = 0
export const NEAR_PRICE_FALLBACK = 2.86
export const XLM_PRICE_FALLBACK = 0.38
export const SUI_PRICE_FALLBACK = 3.39

export const idToPriceFallback = {
  [ethereumCMCID]: ETH_PRICE_FALLBACK,
  [avalancheCMCID]: AVAX_PRICE_FALLBACK,
  [fantomCMCID]: FTM_PRICE_FALLBACK,
  [nearCMCID]: NEAR_PRICE_FALLBACK,
  [xlmCMCID]: XLM_PRICE_FALLBACK,
  [suiCMCID]: SUI_PRICE_FALLBACK
}