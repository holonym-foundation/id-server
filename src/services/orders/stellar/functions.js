import { ethers } from "ethers";
import * as StellarSdk from "@stellar/stellar-sdk";
import { retry } from "../../../utils/utils.js";
import {
  idvSessionUSDPrice,
  idServerStellarPaymentAddress,
  horizonServer,
} from "../../../constants/misc.js";
import { usdToXLM } from "../../../utils/cmc.js";

async function getTransaction(txHash) {
  return horizonServer.transactions().transaction(txHash).call();
}

/**
 * Internal function to validate a Stellar transaction
 * @param {string} txHash
 * @param {number} desiredAmount - Expected transaction amount in USD
 * @param {Object} options - Validation options
 * @param {string} [options.externalOrderId] - External order ID to validate memo against
 * @returns {Promise<Object>} Transaction object
 */
async function _validateStellarTx(txHash, desiredAmount, options = {}) {
  const tx = await retry(
    async () => {
      const result = await getTransaction(txHash);
      if (!result)
        throw new Error(
          `Could not find transaction with txHash ${txHash} on Stellar`
        );
      return result;
    },
    10,
    5000
  );

  // If it's still not found, return an error.
  if (!tx) {
    throw new Error(
      `TX error: Could not find transaction with txHash ${txHash} on Stellar`
    );
  }

  if (!tx.successful) {
    throw new Error('Transaction is not marked successful')
  }

  const operations = await tx.operations()
  const record = operations?.records?.[0]

  if (!record) {
    throw new Error('Transaction has no operation records');
  }

  if (idServerStellarPaymentAddress !== record.to) {
    throw new Error(
      `Invalid transaction recipient. Recipient must be ${idServerStellarPaymentAddress}`
    );
  }

  // Validate memo if externalOrderId is provided
  if (options.externalOrderId) {
    if (!tx.memo) {
      throw new Error('Invalid transaction memo. No memo found.')
    }

    const memo = '0x' + Buffer.from(tx.memo, 'base64').toString('hex')
    if (!memo) {
      throw new Error('Invalid transaction memo. Could not parse memo.')
    }

    const externalOrderIdDigest = ethers.utils.keccak256(options.externalOrderId);
    if (memo !== externalOrderIdDigest) {
      throw new Error('Invalid transaction memo. Memo does not match external order ID.')
    }
  }

  // NOTE: This const must stay in sync with the frontend.
  // We allow a 5% margin of error.
  const expectedAmountInUSD = desiredAmount * 0.95;

  const expectedAmountInToken = await usdToXLM(expectedAmountInUSD);

  if (Number(record.amount) < expectedAmountInToken) {
    throw new Error(
      `Invalid transaction amount. Expected: ${expectedAmountInToken}. Found: ${record.amount}`
    );
  }

  return tx;
}

/**
 * Check blockchain for tx.
 * - Ensure recipient of tx is id-server's address.
 * - Ensure amount is > desired amount (within 5%).
 * - Ensure tx is confirmed.
 */
async function validateTx(txHash, externalOrderId, desiredAmount) {
  return _validateStellarTx(txHash, desiredAmount, { externalOrderId });
}

/**
 * Validates a Stellar transaction for payment amount (without checking memo/externalOrderId)
 * @param {string} txHash
 * @param {number} desiredAmount - Expected transaction amount in USD
 * @returns {Promise<Object>} Transaction object
 */
async function validateTxNoOrderId(txHash, desiredAmount) {
  return _validateStellarTx(txHash, desiredAmount);
}

/**
 * Refund the given order. DOES NOT VALIDATE the provided order or transaction.
 * @param {Object} _order - The order to refund (unused, kept for API consistency)
 * @param {Object} validTx - The validated transaction
 * @returns {Promise<Object>} Transaction receipt
 */
async function sendRefundTx(_order, validTx) {
  const operations = await validTx.operations()
  const amount = operations?.records?.[0]?.amount
  const userAddress = operations?.records?.[0]?.from

  const stellarKeypair = StellarSdk.Keypair.fromSecret(
    process.env.STELLAR_PAYMENTS_SECRET_KEY
  );
  const stellarAccount = await horizonServer.loadAccount(stellarKeypair.publicKey());
  const xlmBalance = stellarAccount.balances.filter(x => x.asset_type === 'native')[0].balance;
  if (xlmBalance < amount) {
    throw new Error("Wallet does not have enough funds to refund.");
  }

  const stellarTx = new StellarSdk.TransactionBuilder(
    stellarAccount,
    {
      networkPassphrase: StellarSdk.Networks.PUBLIC,
      fee: '100'
    }
  )
  .addOperation(StellarSdk.Operation.payment({
    destination: userAddress,
    amount: amount,
    asset: StellarSdk.Asset.native()
  }))
  .setTimeout(180)
  .build();
  stellarTx.sign(stellarKeypair);

  const tx = await horizonServer.submitTransaction(stellarTx);

  return {
    hash: tx.hash,
  };
}

/**
 * Validate the order and the transaction, and refund the order.
 */
async function handleRefund(order) {
  const validTx = await validateTx(
    order.stellar.txHash,
    order.externalOrderId,
    idvSessionUSDPrice
  );

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

  const receipt = await sendRefundTx(order, validTx);

  return {
    status: 200,
    data: {
      txHash: receipt.hash,
    },
  };
}

export {
  getTransaction,
  validateTx,
  validateTxNoOrderId,
  sendRefundTx,
  handleRefund,
};
