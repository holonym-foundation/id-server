import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import * as StellarSdk from '@stellar/stellar-sdk'
import { ethers } from "ethers";

export const idServerPaymentAddress = "0xdca2e9ae8423d7b0f94d7f9fc09e698a45f3c851";

// Holonym multisig on Ethereum
export const companyENS = "holonym.eth";

// Holonym multisig on Optimism
export const companyAddressOP = "0x03627Ac5A08056B50084d8B9cf550EB74a13C78A";

export const companyAddressFTM = "0x790f8e64449944fc81949a43b3450fd8c842dbed";

export const companyAddressBase = "0x790f8e64449944fc81949a43b3450fd8c842dbed";

export const companyAddressAVAX = "0x790f8e64449944fc81949a43b3450fd8c842dbed";

export const companyAddressAurora = "0x790f8e64449944fc81949a43b3450fd8c842dbed";

export const holonymIssuers = [
  "0x8281316ac1d51c94f2de77575301cef615adea84", // gov-id
  "0xb625e69ab86db23c23682875ba10fbc8f8756d16", // phone
  "0xfc8a8de489efefb91b42bb8b1a6014b71211a513", // phone dev
];

// We use this FaceTec server for silksecure.net. This server will be shut down eventually
export const facetecServerBaseURL = 
  process.env.NODE_ENV === "development"
    ? "http://localhost:8080"
    // ? "https://api.facetec.com/api/v3.1/biometrics"
    // ? "https://face-server.up.railway.app"
    : "https://facetec-server.holonym.io"

// We use this FaceTec server for id.human.tech
export const facetecServer2BaseURL = 
  process.env.NODE_ENV === "development"
    ? "http://localhost:8080"
    // ? "https://api.facetec.com/api/v3.1/biometrics"
    // ? "https://face-server.up.railway.app"
    : "https://facetec-server-2.holonym.io"

const supportedChainIds = [
  1, // Ethereum
  10, // Optimism
  250, // Fantom
  8453, // Base
  43114, // Avalanche
  1313161554, // Aurora
  // For sandbox
  11155420, // Optimism Goerli
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

export type SessionStatus =
  (typeof sessionStatusEnum)[keyof typeof sessionStatusEnum]

export const biometricsSessionStatusEnum = {
  ...sessionStatusEnum,
  // PASSED_LIVENESS_CHECK is after IN_PROGRESS, before ISSUED
  PASSED_LIVENESS_CHECK: "PASSED_LIVENESS_CHECK",
};

export const cleanHandsSessionStatusEnum = {
  ...sessionStatusEnum,
  NEEDS_USER_DECLARATION: "NEEDS_USER_DECLARATION",
};

export const directVerificationSessionStatusEnum = {
  IN_PROGRESS: "IN_PROGRESS" as const,
  ENROLLED: "ENROLLED" as const,
  PASSED_AGE_VERIFICATION: "PASSED_AGE_VERIFICATION" as const,
  VERIFICATION_FAILED: "VERIFICATION_FAILED" as const
};

export const ethereumProvider = new ethers.providers.JsonRpcProvider(
  process.env.ETHEREUM_RPC_URL
);
export const optimismProvider = new ethers.providers.JsonRpcProvider(
  process.env.OPTIMISM_RPC_URL
);
export const optimismGoerliProvider = new ethers.providers.JsonRpcProvider(
  process.env.OPTIMISM_GOERLI_RPC_URL
);
export const optimismSepoliaProvider = new ethers.providers.JsonRpcProvider(
  process.env.OPTIMISM_SEPOLIA_RPC_URL
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

export const krakenXLMAddress = "GA5XIGA5C7QTPTWXQHY6MCJRMTRZDOSHR6EFIBNDQTCQHG262N4GGKTM";
export const krakenXLMMemo = StellarSdk.Memo.text("1742822151996056872");

// ---------------- Sui stuff ----------------
export const idServerSuiPaymentAddress = "0x96a5cbb66c3150eb5e61ebab9cef55b17083ee2ab903295dc90292a477acabbc";
export const companySuiAddress = "0x58d01e1281b29ad0888ca6c482efd16e9633d128a2d38230f655c8da229b0ef0";

export const suiClient = new SuiClient({
  // url: getFullnodeUrl("mainnet")
  url: process.env.SUI_RPC_URL as string
});

// ---------------- Human ID Payments Contract Addresses ----------------
export const humanIDPaymentsContractAddresses: Record<number, string | null> = {
  1: "0xa2ca14c7d625895e6939961B87CE378836ca840F", // Ethereum
  10: "0xbE6C430BD2d5851A1E97d468E5432BcF7d689D94", // Optimism
  250: null, // Fantom
  8453: "0x916863E0239B4e0a70705659130Ef27649aDB801", // Base
  43114: "0xFa0FFfDc21476245cd8a667DAec4E049eb5337Db", // Avalanche
  1313161554: null, // Aurora
  // For sandbox
  11155420: "0xF98798e9dAC28928F1E5EE6109d5eb2797152E92", // Optimism Sepolia
};

/**
 * HumanIDPayments contract ABI
 * Includes all functions from HumanIDPayments and inherited AccessControl
 */
export const humanIDPaymentsABI = [
  // HumanIDPayments public/external functions
  "function pay(bytes32 commitment, bytes32 service, uint256 timestamp, bytes memory signature) external payable",
  "function batchPay(bytes32[] calldata commitments, bytes32[] calldata services, uint256[] calldata amounts, uint256[] calldata timestamps, bytes[] calldata signatures) external payable",
  "function refund(bytes32 commitment, uint256 timestamp, bytes memory signature) external",
  "function getBalance() external view returns (uint256)",
  "function deposit() external payable",
  "function receive() external payable",
  "function forceRefund(bytes32 commitment) external",
  "function withdraw(uint256 amount) external",
  "function withdrawTo(uint256 amount, address payable to) external",
  "function withdrawAll() external",
  "function setOracleAddress(address newOracle) external",
  // HumanIDPayments public state variables
  "function payments(bytes32) public view returns (bytes32 commitment, bytes32 service, uint256 timestamp, address sender, uint256 amount, bool refunded)",
  "function oracleAddress() public view returns (address)",
  "function ADMIN_ROLE() public view returns (bytes32)",
  // AccessControl functions
  "function hasRole(bytes32 role, address account) public view returns (bool)",
  "function getRoleAdmin(bytes32 role) public view returns (bytes32)",
  "function grantRole(bytes32 role, address account) public",
  "function revokeRole(bytes32 role, address account) public",
  "function renounceRole(bytes32 role, address account) public",
  "function supportsInterface(bytes4 interfaceId) public view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() public view returns (bytes32)",
];

/**
 * Service identifier for SBT minting
 */
export const PAYMENT_SERVICE_SBT_MINT = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('mint_zeronym_v3_sbt'))
