import { ethers } from "ethers";
import { Order } from "../../init.js";
import { idvSessionUSDPrice } from "../../constants/misc.js";
import { retry } from "../../utils/utils.js";
import {
  idServerPaymentAddress,
  ethereumProvider,
  optimismProvider,
  optimismGoerliProvider,
  fantomProvider,
  avalancheProvider,
  auroraProvider,
  baseProvider,
} from "../../constants/misc.js";
import { usdToETH, usdToFTM, usdToAVAX } from "../../utils/cmc.js";

function getProvider(chainId) {
  let provider;
  if (chainId === 1) {
    provider = ethereumProvider;
  } else if (chainId === 10) {
    provider = optimismProvider;
  } else if (chainId === 250) {
    provider = fantomProvider;
  } else if (chainId === 8453) {
    provider = baseProvider;
  } else if (chainId === 43114) {
    provider = avalancheProvider;
  } else if (chainId === 1313161554) {
    provider = auroraProvider;
  } else if (process.env.NODE_ENV === "development" && chainId === 420) {
    provider = optimismGoerliProvider;
  }

  return provider;
}

function getTransaction(chainId, txHash) {
  // console.log("getTransaction", chainId, txHash);

  let provider = getProvider(chainId);

  return provider.getTransaction(txHash);
}

/**
 * Check blockchain for tx.
 * started off with validateTxForSessionCreation from utils/transactions.js
 * - Ensure recipient of tx is id-server's address.
 * - Ensure amount is > desired amount (within 5%).
 * - Ensure tx is confirmed.
 * - Ensure tx is on a supported chain.
 * - Ensure tx.data == keccak(externalOrderId)
 */
async function validateTx(chainId, txHash, externalOrderId, desiredAmount) {
  const tx = await getTxWithRetries(txHash, chainId)

  await validateTxIsToIDServer(tx)

  await validateTxDataAgainstOrderId(tx, externalOrderId)

  await validateTxAmount(tx, chainId, desiredAmount)

  return tx;
}

async function validateTxNoOrderId(chainId, txHash, desiredAmount) {
  const tx = await getTxWithRetries(txHash, chainId)

  await validateTxIsToIDServer(tx)

  await validateTxAmount(tx, chainId, desiredAmount)

  return tx;
}

async function getTxWithRetries(txHash, chainId) {
  // Transactions on L2s mostly go through within a few seconds.
  // Mainnet can take 15s or possibly even longer.
  const tx = await retry(
    async () => {
      const result = await getTransaction(chainId, txHash);
      if (!result)
        throw new Error(
          `Could not find transaction with txHash ${txHash} on chain ${chainId}`
        );
      return result;
    },
    10,
    5000
  );

  // If it's still not found, return an error.
  if (!tx) {
    throw new Error(
      `TX error: Could not find transaction with txHash ${txHash} on chain ${chainId}`
    );
  }

  return tx
}

async function validateTxIsToIDServer(tx) {
  if (idServerPaymentAddress !== tx.to.toLowerCase()) {
    throw new Error(
      `Invalid transaction recipient. Recipient must be ${idServerPaymentAddress}`
    );
  }
}

async function validateTxDataAgainstOrderId(tx, externalOrderId) {
  const externalOrderIdDigest = ethers.utils.keccak256(externalOrderId);
  if (tx.data !== externalOrderIdDigest) {
    throw new Error("Invalid transaction data: invalid digest");
  }
}

async function validateTxAmount(tx, chainId, desiredAmount) {
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
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  // Round to 18 decimal places to avoid this underflow error from ethers:
  // "fractional component exceeds decimals"
  const decimals = 18;
  const multiplier = 10 ** decimals;
  const rounded = Math.round(expectedAmountInToken * multiplier) / multiplier;

  const expectedAmount = ethers.utils.parseEther(rounded.toString());

  if (tx.value.lt(expectedAmount)) {
    throw new Error(
      `Invalid transaction amount. Expected: ${expectedAmount.toString()}. Found: ${tx.value.toString()}. (chain ID: ${chainId})`
    );
  }
}

async function validateTxConfirmation(tx) {
  const txReceipt = await tx.wait();

  if (!txReceipt.blockHash || txReceipt.confirmations === 0) {
    throw new Error("Transaction has not been confirmed yet.");
  }

  return txReceipt;
}

/**
 * Refund 69.1% of the transaction denoted by order.txHash on chain order.chainId.
 * started off with refundMintFeeOnChain from utils/transactions.js
 * Sets order.refundTxHash and order.status after successful refund.
 */
async function handleRefund(order) {
  const tx = await getTransaction(order.chainId, order.txHash);

  if (!tx) {
    return {
      status: 404,
      data: {
        error: "Could not find transaction with given txHash.",
      },
    };
  }

  const validTx = await validateTx(
    order.chainId,
    order.txHash,
    order.externalOrderId,
    idvSessionUSDPrice
  );
  const validTxConfirmation = await validateTxConfirmation(validTx);

  // check if tx is already fulfilled
  if (order.fulfilled) {
    return {
      status: 400,
      data: {
        error: "The order has already been fulfilled, cannot refund.",
      },
    };
  }

  // check if tx is already refunded
  if (order.refunded) {
    return {
      status: 400,
      data: {
        error: "The order has already been refunded, cannot refund again.",
      },
    };
  }

  const receipt = await sendRefundTx(order, tx);

  return {
    status: 200,
    data: {
      txReceipt: receipt,
    },
  };
}

/**
 * Refund the given order. DOES NOT VALIDATE the provided order or transaction. 
 */
async function sendRefundTx(order, tx) {
  const provider = getProvider(order.chainId);
  const wallet = new ethers.Wallet(process.env.PAYMENTS_PRIVATE_KEY, provider);

  // Refund 50% of the transaction amount. This approximates the mint cost.
  // const refundAmount = tx.value.mul(5).div(10);
  // In Feb 2025, we changed the refund amount be the full tx amount.
  const refundAmount = tx.value

  // Ensure wallet has enough funds to refund
  const balance = await wallet.getBalance();
  if (balance.lt(refundAmount)) {
    return {
      status: 500,
      data: {
        error:
          "Wallet does not have enough funds to refund. Please contact support.",
      },
    };
  }

  const txReq = await wallet.populateTransaction({
    to: tx.from,
    value: refundAmount,
  });

  // We have disabled Fantom payments in Human ID
  // For some reason gas estimates from Fantom are way off. We manually increase
  // gas to avoid "transaction underpriced" error. Hopefully this is unnecessary
  // in the future. The following values happened to be sufficient at the time
  // of adding this block.
  // if (order.chainId === 250) {
  //   txReq.maxFeePerGas = txReq.maxFeePerGas.mul(2);
  //   txReq.maxPriorityFeePerGas = txReq.maxPriorityFeePerGas.mul(14);

  //   if (txReq.maxPriorityFeePerGas.gt(txReq.maxFeePerGas)) {
  //     txReq.maxPriorityFeePerGas = txReq.maxFeePerGas;
  //   }
  // }

  const txResponse = await wallet.sendTransaction(txReq);

  return txResponse.wait();
}

async function getOrderByTxHash(req, res) {
  const { txHash, chainId } = req.query;

  if (!txHash || !chainId) {
    return res
      .status(400)
      .json({ error: "txHash and chainId are required" });
  }

  const order = await Order.findOne({ txHash, chainId });

  if (!order) {
    return res.status(404).json({
      error: `No order has the associated txHash (${txHash}) and chainId (${chainId})`
    })
  }

  return res.status(200).json({
    order: {
      externalOrderId: order.externalOrderId,
      category: order.category,
      fulfilled: order.fulfilled, 
      fulfillmentReceipt: order.fulfillmentReceipt,
      // For EVM payments
      txHash: order.txHash,
      chainId: order.chainId,
      // For EVM payments
      refunded: order.refunded,
      refundTxHash: order.refundTxHash,
      // For Stellar payments
      stellar: order.stellar
    }
  })
}

export {
  getTransaction,
  getProvider,
  validateTx,
  validateTxNoOrderId,
  validateTxConfirmation,
  handleRefund,
  sendRefundTx,
  getOrderByTxHash,
};
