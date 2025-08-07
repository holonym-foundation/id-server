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
