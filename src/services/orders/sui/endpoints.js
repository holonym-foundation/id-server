import {
  validateTx,
  // handleRefund, 
} from "./functions.js";
import { idvSessionUSDPrice } from "../../../constants/misc.js";
import { pinoOptions, logger } from "../../../utils/logger.js";

import { Order } from "../../../init.js";

// TODO: Move this to a constants file. It is duplicated in stellar and evm orders files
const orderCategoryEnums = {
  MINT_ZERONYM_V3_SBT: "mint_zeronym_v3_sbt",
};

const ordersLogger = logger.child({
  // msgPrefix: "[GET /orders] ",
  base: {
    ...pinoOptions.base,
    feature: "holonym",
    subFeature: "orders",
  },
});

async function createSuiOrder(req, res) {
  try {
    const { holoUserId, externalOrderId, category, txHash } = req.body;

    // Validate category against whitelist of payment categories
    if (!category || !Object.values(orderCategoryEnums).includes(category)) {
      return res.status(400).json({ error: "Invalid category" });
    }

    // check if txHash is passed
    if (!txHash) {
      return res.status(400).json({ error: "txHash is required" });
    }

    // Validate TX (check tx.memo, to, amount, etc)
    const validationResult = await validateTx(
      txHash,
      externalOrderId,
      idvSessionUSDPrice
    );

    if (!validationResult.isValid) {
      return res.status(400).json({
        error: "Transaction validation failed",
        details: validationResult.errors
      })
    }

    try {
      // Create the order
      const order = new Order({
        holoUserId,
        externalOrderId,
        category,
        fulfilled: false, // order.fulfilled should be false when order is inserted into DB
        sui: {
          txHash,
        }
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
          txHash: order.sui.txHash,
          refunded: order.refunded,
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

async function getSuiOrderTransactionStatus(req, res) {
  const { externalOrderId } = req.params;

  try {
    // Query the DB for the tx metadata
    const order = await Order.findOne({ externalOrderId });

    if (!order) {
      return res
        .status(404)
        .json({ error: "Order not found", externalOrderId });
    }

    // Validate TX (check memo, to, amount, etc)
    const validationResult = await validateTx(
      order.sui.txHash,
      order.externalOrderId,
      idvSessionUSDPrice
    );

    // If TX is confirmed, return both order and tx receipt
    return res
      .status(200)
      .json({
        txBlock: validationResult.txBlock,
        txIsValid: validationResult.isValid,
        order: {
          externalOrderId: order.externalOrderId,
          category: order.category,
          fulfilled: order.fulfilled,
          txHash: order.sui.txHash,
          refunded: order.refunded,
          refundTxHash: order.refundTxHash,
        }
      });
  } catch (error) {
    console.log("error", error);
    return res.status(500).json({ error: error.message, externalOrderId });
  }
}

// TODO: Add this once we fully support Sui SBTs
// async function setSuiOrderFulfilled(req, res) {
//   try {
//     // TODO: Reduce code duplication between this function and the setOrderFulfilled function for EVM and Stellar orders.

//     const { externalOrderId } = req.params;
//     const { fulfillmentReceipt } = req.query;

//     // Check for API key in header
//     const apiKey = req.headers["x-api-key"];

//     // to be sure that ORDERS_API_KEY is defined and that apiKey is passed
//     if (!process.env.ORDERS_API_KEY || !apiKey) {
//       return res.status(500).json({ error: "Unauthorized. No API key found." });
//     }

//     if (apiKey !== process.env.ORDERS_API_KEY) {
//       return res.status(401).json({ error: "Unauthorized" });
//     }

//     if (typeof fulfillmentReceipt != 'string') {
//       return res.status(400).json({
//         error: `Invalid fulfillment receipt. If present, it must be a string. Received '${fulfillmentReceipt}'`
//       })
//     }

//     // Right now, fulfillment receipt must be a JSON object with a base 58 string as the value.
//     const pattern = /\{\s*"\w+"\s*:\s*"((0x)?[1-9A-HJ-NP-Za-km-z]+)"\s*\}/;
//     if (!pattern.test(fulfillmentReceipt)) {
//       return res.status(400).json({
//         error: `Invalid fulfillment receipt. If present, it must be a JSON object with a base 58 string value. Received '${fulfillmentReceipt}'`
//       })
//     }

//     // Query the DB for the order
//     const order = await Order.findOne({ externalOrderId });

//     if (!order) {
//       return res.status(404).json({ error: "Order not found" });
//     }

//     // Validate TX (check memo, to, amount, etc)
//     const validationResult = await validateTx(
//       order.sui.txHash,
//       order.externalOrderId,
//       idvSessionUSDPrice
//     );

//     // Update the order to fulfilled
//     order.fulfilled = true;
//     if (fulfillmentReceipt) {
//       order.fulfillmentReceipt = fulfillmentReceipt
//     } else {
//       ordersLogger.info(
//         {
//           fulfillmentReceipt,
//           externalOrderId,
//         },
//         "Marking order fulfilled without fulfillmentReceipt"
//       )
//     }
//     await order.save();

//     return res.status(200).json({ message: "Order set to fulfilled" });
//   } catch (error) {
//     return res.status(500).json({ error: error.message });
//   }
// }

async function refundSuiOrder(req, res) {
  // todo...
}

export {
  createSuiOrder,
  getSuiOrderTransactionStatus,
  // setSuiOrderFulfilled,
}