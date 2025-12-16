import { ethers } from 'ethers';
import {
  ethereumProvider,
  optimismProvider,
  optimismGoerliProvider,
  fantomProvider,
  avalancheProvider,
  auroraProvider,
  baseProvider,
  optimismSepoliaProvider,
  idvSessionUSDPrice,
  humanIDPaymentsABI,
} from "../constants/misc.js";

export function getProvider(chainId: number): ethers.providers.JsonRpcProvider {
  let provider;
  if (chainId == 1) {
    provider = ethereumProvider;
  } else if (chainId == 10) {
    provider = optimismProvider;
  } else if (chainId == 250) {
    provider = fantomProvider;
  } else if (chainId == 8453) {
    provider = baseProvider;
  } else if (chainId == 43114) {
    provider = avalancheProvider;
  } else if (chainId == 1313161554) {
    provider = auroraProvider;
  } else if (chainId == 420) {
    provider = optimismGoerliProvider;
  } else if (chainId == 11155420) {
    provider = optimismSepoliaProvider;
  } else {
    throw new Error(`Invalid chainId (${chainId}). Could not get provider`)
  }

  return provider;
}