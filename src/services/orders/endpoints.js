import {
  getProvider,
  getTransaction,
  validateTx,
  validateTxConfirmation,
  handleRefund,
  getOrderByTxHash,
} from "./functions.js";
import { idvSessionUSDPrice } from "../../constants/misc.js";
import { pinoOptions, logger } from "../../utils/logger.js";

import { Order } from "../../init.js";
import { orderCategoryEnums } from './constants.js';

const ordersLogger = logger.child({
  // msgPrefix: "[GET /orders] ",
  base: {
    ...pinoOptions.base,
    feature: "holonym",
    subFeature: "orders",
  },
});

// POST /.
// Creates an order and associates payment metadata with it.
// To be called by client when user submits a tx.
// Body should include a Order object.
// body.category should be validated against a whitelist of payment categories.
// body.externalOrderId should be hex and should match tx.data (more on the rational for this ID below).
// order.fulfilled should be false when order is inserted into DB.
async function createOrder(req, res) {
  try {
    const { holoUserId, externalOrderId, category, txHash, chainId } = req.body;

    // Validate category against whitelist of payment categories
    if (!category || !Object.values(orderCategoryEnums).includes(category)) {
      return res.status(400).json({ error: "Invalid category" });
    }

    // check if txHash and chainId are passed
    if (!txHash || !chainId) {
      return res.status(400).json({ error: "txHash and chainId are required" });
    }

    // Validate TX (check tx.data, tx.to, tx.value, etc)
    const validTx = await validateTx(
      chainId,
      txHash,
      externalOrderId,
      idvSessionUSDPrice
    );

    try {
      // Create the order
      const order = new Order({
        holoUserId,
        externalOrderId,
        category,
        txHash,
        chainId,
        fulfilled: false, // order.fulfilled should be false when order is inserted into DB
      });

      await order.save();

      ordersLogger.info(
        {
          order
        },
        "Created order"
      );

      return res.status(200).json({
        order: {
          externalOrderId: order.externalOrderId,
          category: order.category,
          fulfilled: order.fulfilled,
          txHash: order.txHash,
          chainId: order.chainId,
          refunded: order.refunded,
          refundTxHash: order.refundTxHash,
        }
      });
    } catch (error) {
      throw new Error(`Error creating order: ${error.message}`);
    }
  } catch (error) {
    console.log("error", error);
    ordersLogger.error(
      {
        error
      },
      "Error creating order: " + error.message
    );
    return res.status(500).json({ error: error.message });
  }
}

// GET /:externalOrderId/transaction/status.
// To be called by verifier server.
// Should query the DB for the tx metadata,
// wait a little bit for the tx to be confirmed (if it's not already),
// and return a success response if all goes well.
async function getOrderTransactionStatus(req, res) {
  const { externalOrderId } = req.params;

  try {
    // Query the DB for the tx metadata
    const order = await Order.findOne({ externalOrderId });

    if (!order) {
      return res
        .status(404)
        .json({ error: "Order not found", externalOrderId });
    }

    // Validate TX (check tx.data, tx.to, tx.value, etc)
    const validTx = await validateTx(
      order.chainId,
      order.txHash,
      order.externalOrderId,
      idvSessionUSDPrice
    );
    const validTxConfirmation = await validateTxConfirmation(validTx);

    // If TX is confirmed, return both order and tx receipt
    return res
      .status(200)
      .json({
        txReceipt: validTxConfirmation,
        order: {
          externalOrderId: order.externalOrderId,
          category: order.category,
          fulfilled: order.fulfilled,
          txHash: order.txHash,
          chainId: order.chainId,
          refunded: order.refunded,
          refundTxHash: order.refundTxHash,
        }
      });
  } catch (error) {
    console.log("error", error);
    return res.status(500).json({ error: error.message, externalOrderId });
  }
}

// GET /:externalOrderId/fulfilled.
// API key gated endpoint. To be called by verifier server after minting the SBT.
// Sets order.fulfilled to true.
async function setOrderFulfilled(req, res) {
  try {
    const { externalOrderId } = req.params;
    const { fulfillmentReceipt } = req.query;

    // Check for API key in header
    const apiKey = req.headers["x-api-key"];

    // to be sure that ORDERS_API_KEY is defined and that apiKey is passed
    if (!process.env.ORDERS_API_KEY || !apiKey) {
      return res.status(500).json({ error: "Unauthorized. No API key found." });
    }

    if (apiKey !== process.env.ORDERS_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Fulfillment receipt, if present, must be a string. 
    if (fulfillmentReceipt) {
      if (typeof fulfillmentReceipt != 'string') {
        return res.status(400).json({
          error: `Invalid fulfillment receipt. If present, it must be a string. Received '${fulfillmentReceipt}'`
        })
      }

      // Right now, fulfillment receipt must be a JSON object with a hex string as the value.
      const pattern = /\{\s*"\w+"\s*:\s*"((0x)?[0-9a-fA-F]+)"\s*\}/;
      if (!pattern.test(fulfillmentReceipt)) {
        return res.status(400).json({
          error: `Invalid fulfillment receipt. If present, it must be a JSON object with a hex string value. Received '${fulfillmentReceipt}'`
        })
      }
    }

    // Query the DB for the order
    const order = await Order.findOne({ externalOrderId });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Validate TX (check tx.data, tx.to, tx.value, etc)
    const validTx = await validateTx(
      order.chainId,
      order.txHash,
      order.externalOrderId,
      idvSessionUSDPrice
    );

    // Update the order to fulfilled
    order.fulfilled = true;
    if (fulfillmentReceipt) {
      order.fulfillmentReceipt = fulfillmentReceipt
    } else {
      ordersLogger.info(
        {
          fulfillmentReceipt,
          externalOrderId,
        },
        "Marking order fulfilled without fulfillmentReceipt"
      )
    }
    await order.save();

    return res.status(200).json({ message: "Order set to fulfilled" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// GET /:externalOrderId/refund.
// Refunds an unfulfilled order.
// Gated by admin API key. Why? Because if an order is unfulfilled, a user could trigger
// SBT minting and a refund at the same time, to effectively not pay for the SBT.
async function refundOrder(req, res) {
  try {
    const { txHash, chainId } = req.body;

    if (!txHash || !chainId) {
      return res
        .status(400)
        .json({ error: "txHash and chainId are required for refund" });
    }

    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    // Query the DB for the order
    const order = await Order.findOne({ txHash, chainId });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Refund the order
    try {
      // Validate TX (check tx.data, tx.to, tx.value, etc)
      const validTx = await validateTx(
        order.chainId,
        order.txHash,
        order.externalOrderId,
        idvSessionUSDPrice
      );

      const response = await handleRefund(order);

      if (response.status === 200) {
        // Update the order refundTxHash and refunded
        order.refundTxHash = response.data.txReceipt.transactionHash;
        order.refunded = true;
        await order.save();
      }

      return res.status(response.status).json(response.data);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function getOrder(req, res) {
  const apiKey = req.headers["x-api-key"];

  if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
    return res.status(401).json({ error: "Invalid API key." });
  }

  if (req.query.txHash) {
    return getOrderByTxHash(req, res)
  }

  return res.status(501).json({ error: 'Not implemented' })
}

export {
  createOrder,
  getOrderTransactionStatus,
  setOrderFulfilled,
  refundOrder,
  getOrder,
};
