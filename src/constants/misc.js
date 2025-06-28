import * as StellarSdk from '@stellar/stellar-sdk'
import { ethers } from "ethers";

export const idServerPaymentAddress = "0xdca2e9ae8423d7b0f94d7f9fc09e698a45f3c851";

// Holonym multisig on Ethereum
export const companyENS = "holonym.eth";

// Holonym multisig on Optimism
export const companyAddressOP = "0x03627Ac5A08056B50084d8B9cf550EB74a13C78A";

export const companyAddressFTM = "0xbe20d0A27B79BA2E53c9DF150BadAa21D4783D42";

export const companyAddressBase = "0xbe20d0A27B79BA2E53c9DF150BadAa21D4783D42";

export const companyAddressAVAX = "0xbe20d0A27B79BA2E53c9DF150BadAa21D4783D42";

export const companyAddressAurora = "0xbe20d0A27B79BA2E53c9DF150BadAa21D4783D42";

export const holonymIssuers = [
  "0x8281316ac1d51c94f2de77575301cef615adea84", // gov-id
  "0xb625e69ab86db23c23682875ba10fbc8f8756d16", // phone
  "0xfc8a8de489efefb91b42bb8b1a6014b71211a513", // phone dev
];
export const relayerURL =
  process.env.NODE_ENV === "development"
    ? process.env.ON_LINUX === "true"
      ? "http://172.17.0.1:6969"
      : "http://host.docker.internal:6969"
    : // : "https://relayer.holonym.id";
      "https://relayer.holonym-internal.net";

export const facetecServerBaseURL = 
  process.env.NODE_ENV === "development"
    // ? "http://localhost:8080"
    // ? "https://api.facetec.com/api/v3.1/biometrics"
    ? "https://face-server.up.railway.app"
    : "https://facetec-server.holonym.io"

const supportedChainIds = [
  1, // Ethereum
  10, // Optimism
  250, // Fantom
  8453, // Base
  43114, // Avalanche
  1313161554, // Aurora
];
if (process.env.NODE_ENV === "development") {
  supportedChainIds.push(420); // Optimism goerli
}
export { supportedChainIds };

export const sessionStatusEnum = {
  NEEDS_PAYMENT: "NEEDS_PAYMENT",
  IN_PROGRESS: "IN_PROGRESS",
  ISSUED: "ISSUED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  REFUNDED: "REFUNDED",
};

// export const ethereumProvider = new ethers.providers.AlchemyProvider(
//   "homestead",
//   process.env.ALCHEMY_APIKEY
// );
// export const optimismProvider = new ethers.providers.AlchemyProvider(
//   "optimism",
//   process.env.ALCHEMY_APIKEY
// );
// export const optimismGoerliProvider = new ethers.providers.AlchemyProvider(
//   "optimism-goerli",
//   process.env.ALCHEMY_APIKEY
// );
export const ethereumProvider = new ethers.providers.JsonRpcProvider(
  process.env.ETHEREUM_RPC_URL
);
export const optimismProvider = new ethers.providers.JsonRpcProvider(
  process.env.OPTIMISM_RPC_URL
);
export const optimismGoerliProvider = new ethers.providers.JsonRpcProvider(
  process.env.OPTIMISM_GOERLI_RPC_URL
);
export const baseProvider = new ethers.providers.JsonRpcProvider(
  process.env.BASE_RPC_URL
);
export const fantomProvider = new ethers.providers.JsonRpcProvider(
  // "https://rpc.ftm.tools"
  "https://rpcapi.fantom.network/"
);
export const avalancheProvider = new ethers.providers.JsonRpcProvider(
  "https://api.avax.network/ext/bc/C/rpc"
);
export const auroraProvider = new ethers.providers.JsonRpcProvider(
  "https://mainnet.aurora.dev"
);

export const payPalApiUrlBase =
  process.env.NODE_ENV === "production"
    ? `https://api-m.paypal.com`
    : `https://api-m.sandbox.paypal.com`;

export const idvSessionUSDPrice = 5.0;

export const amlSessionUSDPrice = 1;

export const defaultActionId = 123456789;

export const kycIssuerAddress =
  "0x03fae82f38bf01d9799d57fdda64fad4ac44e4c2c2f16c5bf8e1873d0a3e1993";
export const phoneIssuerAddress =
  "0x40b8810cbaed9647b54d18cc98b720e1e8876be5d8e7089d3c079fc61c30a4";
// export const phoneIssuerAddress =
//   process.env.NODE_ENV === "production"
//     ? "0x40b8810cbaed9647b54d18cc98b720e1e8876be5d8e7089d3c079fc61c30a4"
//     : "0x2998cab3d07a64315f1e8399ecef60a19f478231663f8740703bd30a42a91ed4";
export const biometricsIssuerAddress = 
  "0x0d4f849df782fb9e68d525fbda10b73e59180e59cb2a21ce5d70ccc45dbfd922";

export const v3KYCSybilResistanceCircuitId =
  "0x729d660e1c02e4e419745e617d643f897a538673ccf1051e093bbfa58b0a120b";
export const v3PhoneSybilResistanceCircuitId =
  "0xbce052cf723dca06a21bd3cf838bc518931730fb3db7859fc9cc86f0d5483495";
export const v3EPassportSybilResistanceCircuitId =
  "0xf2ce248b529343e105f7b3c16459da619281c5f81cf716d28f7df9f87667364d";
export const v3BiometricsSybilResistanceCircuitId =
  "0x0b5121226395e3b6c76eb8ddfb0bf2f2075e7f2c6956567e84b38a223c3a3d15"; // even

// ---------------- Stellar stuff ----------------
export const horizonServer = new StellarSdk.Horizon.Server("https://horizon.stellar.org");

export const idServerStellarPaymentAddress = "GCJCFGPSKP2D6I4KU3PGA6NUKPUHKYT7XECMU5SGIATX6374WI4OX24B";
