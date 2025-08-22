import { ethers } from "ethers";
import { ObjectId } from "mongodb";
import {
  sessionStatusEnum,
  idServerPaymentAddress,
  ethereumProvider,
  optimismProvider,
  optimismGoerliProvider,
  fantomProvider,
  avalancheProvider,
  auroraProvider,
  baseProvider,
} from "../constants/misc.js";
import { usdToETH, usdToFTM, usdToAVAX } from "./cmc.js";
import { retry } from './utils.js';

function getTransaction(chainId: number, txHash: string) {
  if (chainId === 1) {
    return ethereumProvider.getTransaction(txHash);
  } else if (chainId === 10) {
    return optimismProvider.getTransaction(txHash);
  } else if (chainId === 250) {
    return fantomProvider.getTransaction(txHash);
  } else if (chainId === 8453) {
    return baseProvider.getTransaction(txHash);
  } else if (chainId === 43114) {
    return avalancheProvider.getTransaction(txHash);
  } else if (process.env.NODE_ENV === "development" && chainId === 420) {
    return optimismGoerliProvider.getTransaction(txHash);
  } else if (chainId === 1313161554) {
    return auroraProvider.getTransaction(txHash);
  }
}

/**
 * Check blockchain for tx.
 * - Ensure recipient of tx is id-server's address.
 * - Ensure amount is > desired amount (within 5%).
 * - Ensure tx is confirmed.
 * - Ensure tx is on a supported chain.
 */
async function validateTxForSessionCreation(session: { _id: ObjectId }, chainId: number, txHash: string, desiredAmount: number) {
  // Transactions on L2s mostly go through within a few seconds. Mainnet can take 15s or
  // possibly even longer.
  const tx = await retry(async () => {
    const result = await getTransaction(chainId, txHash)
    if (!result) throw new Error(`Could not find transaction with txHash ${txHash} on chain ${chainId}`)
    return result
  }, 5, 5000);
  
  // If it's still not found, return an error.
  if (!tx) {
    return {
      status: 400,
      error: `Session creation error: Could not find transaction with txHash ${txHash} on chain ${chainId}`,
    };
  }

  const txReceipt = await tx.wait();

  if (idServerPaymentAddress !== (tx.to as string).toLowerCase()) {
    return {
      status: 400,
      error: `Invalid transaction recipient. Recipient must be ${idServerPaymentAddress}`,
    };
  }

  // NOTE: This const must stay in sync with the frontend.
  // We allow a 5% margin of error.
  const expectedAmountInUSD = desiredAmount * 0.95;

  let expectedAmountInToken;
  if ([1, 10, 1313161554, 8453].includes(chainId)) {
    expectedAmountInToken = await usdToETH(expectedAmountInUSD);
  } else if (chainId === 250) {
    expectedAmountInToken = await usdToFTM(expectedAmountInUSD);
  } else if (chainId === 43114) {
    expectedAmountInToken = await usdToAVAX(expectedAmountInUSD);
  }
  // else if (process.env.NODE_ENV === "development" && chainId === 420) {
  //   expectedAmount = ethers.BigNumber.from("0");
  // }
  else if (process.env.NODE_ENV === "development" && chainId === 420) {
    expectedAmountInToken = await usdToETH(expectedAmountInUSD);
  } else {
    return {
      status: 400,
      error: `Unsupported chain ID: ${chainId}`,
    }
  }

  if (!txReceipt.blockHash || txReceipt.confirmations === 0) {
    return {
      status: 400,
      error: "Transaction has not been confirmed yet.",
    };
  }

  // Round to 18 decimal places to avoid this underflow error from ethers:
  // "fractional component exceeds decimals"
  const decimals = 18;
  const multiplier = 10 ** decimals;
  const rounded = Math.round(expectedAmountInToken * multiplier) / multiplier;

  const expectedAmount = ethers.utils.parseEther(rounded.toString());

  if (tx.value.lt(expectedAmount)) {
    return {
      status: 400,
      error: `Invalid transaction amount. Expected: ${expectedAmount.toString()}. Found: ${tx.value.toString()}. (chain ID: ${chainId})`,
    };
  }

  const sidDigest = ethers.utils.keccak256("0x" + session._id);
  if (tx.data !== sidDigest) {
    return {
      status: 400,
      error: "Invalid transaction data",
    };
  }

  return {};
}

/**
 * Refund 69.1% of the transaction denoted by session.txHash on chain session.chainId.
 * Sets session.refundTxHash and session.status after successful refund.
 */
async function refundMintFeeOnChain(
  session: {
    chainId: number,
    txHash: string,
    refundTxHash: string,
    status: string,
    save: () => Promise<void>
  },
  to: string
) {
  let provider;
  if (session.chainId === 1) {
    provider = ethereumProvider;
  } else if (session.chainId === 10) {
    provider = optimismProvider;
  } else if (session.chainId === 250) {
    provider = fantomProvider;
  } else if (session.chainId === 8453) {
    provider = baseProvider;
  } else if (session.chainId === 43114) {
    provider = avalancheProvider;
  } else if (session.chainId === 1313161554) {
    provider = auroraProvider;
  } else if (process.env.NODE_ENV === "development" && session.chainId === 420) {
    provider = optimismGoerliProvider;
  } else {
    throw new Error(`Session has an unsupported chain ID: ${session.chainId}`)
  }

  const tx = await provider.getTransaction(session.txHash);

  if (!tx) {
    return {
      status: 404,
      data: {
        error: "Could not find transaction with given txHash",
      },
    };
  }

  const wallet = new ethers.Wallet(process.env.PAYMENTS_PRIVATE_KEY as string, provider);

  const refundAmount = tx.value; //.mul(5).div(10);

  // Ensure wallet has enough funds to refund
  const balance = await wallet.getBalance();
  if (balance.lt(refundAmount)) {
    return {
      status: 500,
      data: {
        error: "Wallet does not have enough funds to refund. Please contact support.",
      },
    };
  }

  const txReq = await wallet.populateTransaction({
    to: to,
    value: refundAmount,
  });

  // Aug 9, 2025 note: We no longer support Fantom.
  // For some reason gas estimates from Fantom are way off. We manually increase
  // gas to avoid "transaction underpriced" error. Hopefully this is unnecessary
  // in the future. The following values happened to be sufficient at the time
  // of adding this block.
  // if (session.chainId === 250) {
  //   txReq.maxFeePerGas = txReq.maxFeePerGas.mul(2);
  //   txReq.maxPriorityFeePerGas = txReq.maxPriorityFeePerGas.mul(14);

  //   if (txReq.maxPriorityFeePerGas.gt(txReq.maxFeePerGas)) {
  //     txReq.maxPriorityFeePerGas = txReq.maxFeePerGas;
  //   }
  // }

  const txResponse = await wallet.sendTransaction(txReq);

  const receipt = await txResponse.wait();

  session.refundTxHash = receipt.transactionHash;
  session.status = sessionStatusEnum.REFUNDED;
  await session.save();

  return {
    status: 200,
    data: {
      txReceipt: receipt,
    },
  };
}

export { validateTxForSessionCreation, refundMintFeeOnChain, getTransaction };
