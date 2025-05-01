export const ethereumCMCID = 1027;
export const avalancheCMCID = 5805;
// export const fantomCMCID = 3513;
export const fantomCMCID = 32684; // Sonic
export const nearCMCID = 6535;

export const xlmCMCID = 512;

export const slugToID = {
  ethereum: ethereumCMCID,
  avalanche: avalancheCMCID,
  fantom: fantomCMCID,
  near: nearCMCID,
  stellar: xlmCMCID,
};

export const idToSlug = {
  [ethereumCMCID]: "ethereum",
  [avalancheCMCID]: "avalanche",
  [fantomCMCID]: "fantom",
  [nearCMCID]: "near",
  [xlmCMCID]: "stellar"
}
