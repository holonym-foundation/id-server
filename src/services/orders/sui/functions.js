import { ethers } from "ethers";
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction as SuiTransaction } from '@mysten/sui/transactions';

import { usdToSui } from "../../../utils/cmc.js";
import { suiToMist, mistToSui } from "../../../utils/sui.js";
import { suiClient, idServerSuiPaymentAddress } from "../../../constants/misc.js"

const PACKAGE_ID = "0xf03bf161b3f338f1bdff745d642be98c5b5b0246539ff37a87bce54b389fc979";
const MEMO_EVENT_TYPE = `${PACKAGE_ID}::payment_memo::PaymentMemo`;

/**
 * @typedef {Object} ValidationDetails
 * @property {number|null} actualAmount - The actual amount transferred in MIST
 * @property {string|null} actualMemo - The memo from the transaction event
 * @property {string|null} actualRecipient - The recipient address
 * @property {string|null} sender - The sender address
 * @property {string|null} timestamp - The transaction timestamp
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} isValid - Whether the transaction is valid
 * @property {string} txDigest - The transaction digest
 * @property {Object} txBlock - The transaction block
 * @property {string[]} errors - Array of validation errors
 * @property {ValidationDetails} details - Transaction details
 */

/**
 * Internal function to validate a Sui transaction
 * @param {string} txDigest
 * @param {number} desiredAmount - Expected transaction amount in USD
 * @param {Object} options - Validation options
 * @param {string} [options.externalOrderId] - External order ID to validate memo against
 * @returns {Promise<ValidationResult>} Validation result
 */
async function _validateSuiTx(txDigest, desiredAmount, options = {}) {
  try {
    // Fetch the transaction block with all details
    const txBlock = await suiClient.getTransactionBlock({
      digest: txDigest,
      options: {
        showInput: true,
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
        showBalanceChanges: true,
      }
    });

    const validation = {
      isValid: false,
      txDigest,
      txBlock,
      errors: [],
      details: {
        actualAmount: null,
        actualMemo: null,
        actualRecipient: null,
        sender: null,
        timestamp: null,
      }
    };

    // Check if transaction was successful
    if (txBlock.effects?.status?.status !== 'success') {
      validation.errors.push('Transaction failed or is still pending');
      return validation;
    }

    // Extract sender
    validation.details.sender = txBlock.transaction?.data?.sender;

    // 1. Validate the memo from events (if externalOrderId is provided)
    if (options.externalOrderId) {
      const memoEvent = findMemoEvent(txBlock.events);
      if (!memoEvent) {
        validation.errors.push('No payment memo event found');
      } else {
        validation.details.actualMemo = memoEvent.parsedJson.memo;
        validation.details.timestamp = memoEvent.parsedJson.timestamp;
        console.log('memoEvent', JSON.stringify(memoEvent, null, 2))

        const externalOrderIdDigest = ethers.utils.keccak256(options.externalOrderId);
        console.log('externalOrderIdDigest', externalOrderIdDigest)
        console.log('externalOrderId', options.externalOrderId)
        if (memoEvent.parsedJson.memo !== externalOrderIdDigest) {
          validation.errors.push(`Memo mismatch. Expected: "${externalOrderIdDigest}", Got: "${memoEvent.parsedJson.memo}"`);
        }
      }
    }

    // 2. Validate the payment amount and recipient from balance changes
    const paymentDetails = extractPaymentDetails(txBlock.balanceChanges, validation.details.sender);
    if (!paymentDetails) {
      validation.errors.push('No valid payment transfer found');
    } else {
      validation.details.actualAmount = Math.abs(paymentDetails.amount);
      validation.details.actualRecipient = paymentDetails.recipient;

      // Validate amount
      const expectedAmountInUSD = desiredAmount * 0.95;
      const expectedAmountInSui = await usdToSui(expectedAmountInUSD);
      const expectedAmountInMist = suiToMist(expectedAmountInSui)
      if (Math.abs(paymentDetails.amount) <= expectedAmountInMist) {
        validation.errors.push(`Amount mismatch. Expected: ${expectedAmountInMist} MIST, Got: ${Math.abs(paymentDetails.amount)} MIST`);
      }

      // Validate recipient
      if (paymentDetails.recipient !== idServerSuiPaymentAddress) {
        validation.errors.push(`Recipient mismatch. Expected: "${idServerSuiPaymentAddress}", Got: "${paymentDetails.recipient}"`);
      }
    }

    // Set validation result
    validation.isValid = validation.errors.length === 0;

    return validation;

  } catch (error) {
    return {
      isValid: false,
      txDigest,
      txBlock: null,
      errors: [`Failed to fetch or parse transaction: ${error.message}`],
      details: {}
    };
  }
}

/**
 * Validates a Sui transaction for payment amount and memo
 * @param {string} txDigest
 * @param {string} externalOrderId
 * @param {number} desiredAmount - Expected transaction amount in USD
 * @returns {Promise<ValidationResult>} Validation result
 */
async function validateTx(txDigest, externalOrderId, desiredAmount) {
  return _validateSuiTx(txDigest, desiredAmount, { externalOrderId });
}

/**
 * Validates a Sui transaction for payment amount (without checking memo/externalOrderId)
 * @param {string} txDigest
 * @param {number} desiredAmount - Expected transaction amount in USD
 * @returns {Promise<ValidationResult>} Validation result
 */
async function validateTxNoOrderId(txDigest, desiredAmount) {
  return _validateSuiTx(txDigest, desiredAmount);
}

/**
 * @param {Array} events - Transaction events array
 * @returns {Object|null} The memo event or null if not found
 */
function findMemoEvent(events) {
  if (!events || !Array.isArray(events)) return null;

  return events.find(event => event.type === MEMO_EVENT_TYPE);
}

/**
 * Extracts payment details from balance changes
 * @param {Array} balanceChanges - Balance changes from the transaction
 * @param {string} sender - Transaction sender address
 * @returns {Object|null} Payment details or null if not found
 */
function extractPaymentDetails(balanceChanges, sender) {
  if (!balanceChanges || !Array.isArray(balanceChanges)) return null;

  // Find the balance change where sender loses SUI and someone else gains it
  const senderChange = balanceChanges.find(change => 
    change.owner?.AddressOwner === sender && 
    change.coinType === '0x2::sui::SUI' &&
    parseInt(change.amount) < 0 // Sender loses money
  );

  const recipientChange = balanceChanges.find(change => 
    change.owner?.AddressOwner !== sender && 
    change.coinType === '0x2::sui::SUI' &&
    parseInt(change.amount) > 0 // Recipient gains money
  );

  if (senderChange && recipientChange) {
    return {
      amount: Math.abs(parseInt(senderChange.amount)), // Make positive
      recipient: recipientChange.owner.AddressOwner,
      sender: sender
    };
  }

  return null;
}

/**
 * Validate the order and the transaction, and refund the order.
 * @param {Object} order - The order to refund
 * @returns {Promise<Object>} Response object with status and data
 */
async function handleRefund(order) {
  const validationResult = await validateTx(
    order.sui.txHash,
    order.externalOrderId,
    5 // idvSessionUSDPrice - we'll import this if needed
  );

  if (!validationResult.isValid) {
    return {
      status: 400,
      data: {
        error: `Transaction validation failed: ${validationResult.errors.join(', ')}`,
      },
    };
  }

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

  const receipt = await sendRefundTx(order, validationResult);

  return {
    status: 200,
    data: {
      txHash: receipt.hash,
    },
  };
}

/**
 * Refund the given order. DOES NOT VALIDATE the provided order or transaction.
 * @param {Object} _order - The order to refund (unused, kept for API consistency)
 * @param {Object} validationResult - The validation result from validateTx or validateTxNoOrderId
 * @returns {Promise<Object>} Transaction receipt with hash property
 */
async function sendRefundTx(_order, validationResult) {
  if (!validationResult.isValid) {
    throw new Error(`Cannot refund: Transaction validation failed: ${validationResult.errors.join(', ')}`);
  }

  const amountInMist = validationResult.details.actualAmount;
  const userAddress = validationResult.details.sender;

  if (!amountInMist || !userAddress) {
    throw new Error('Cannot refund: Missing amount or sender address from validation result');
  }

  // Initialize wallet from private key
  const privateKeyBytes = new Uint8Array(
    Buffer.from(process.env.SUI_PRIVATE_KEY.replace('0x', ''), 'hex')
  );
  const suiWallet = Ed25519Keypair.fromSecretKey(privateKeyBytes);

  // Check wallet balance
  const suiBalanceResult = await suiClient.getBalance({
    owner: suiWallet.toSuiAddress()
  });
  const walletBalanceInMist = Number(suiBalanceResult?.totalBalance);

  if (walletBalanceInMist < amountInMist) {
    throw new Error("Wallet does not have enough funds to refund.");
  }

  // Create and send refund transaction
  const tx = new SuiTransaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountInMist)]);
  tx.transferObjects([coin], tx.pure.address(userAddress));

  const result = await suiClient.signAndExecuteTransaction({
    signer: suiWallet,
    transaction: tx,
    options: {
      showEvents: true,
      showEffects: true,
    }
  });

  return {
    hash: result.digest,
  };
}

// Export functions for use in other modules
export {
  validateTx,
  validateTxNoOrderId,
  handleRefund,
  sendRefundTx,
  findMemoEvent,
  extractPaymentDetails,
  mistToSui
};
