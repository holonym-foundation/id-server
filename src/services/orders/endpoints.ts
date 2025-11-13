import { Request, Response } from "express";
import {
  getProvider,
  getTransaction,
  validateTx,
  validateTxNoOrderId,
  validateTxConfirmation,
  handleRefund,
  sendRefundTx,
  getOrderByTxHash,
} from "./functions.js";
import { idvSessionUSDPrice } from "../../constants/misc.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { getSuiOrderTransactionStatus } from "./sui/endpoints.js"
import { getOrderTransactionStatus as getStellarOrderTransactionStatus } from "./stellar/endpoints.js"
import { validateTx as validateSuiTx, validateTxNoOrderId as validateSuiTxNoOrderId, sendRefundTx as sendSuiRefundTx, handleRefund as handleSuiRefund } from "./sui/functions.js"
import { validateTx as validateStellarTx, validateTxNoOrderId as validateStellarTxNoOrderId, sendRefundTx as sendStellarRefundTx, handleRefund as handleStellarRefund } from "./stellar/functions.js"
import { getRouteHandlerConfig } from "../../init.js";
import { orderCategoryEnums } from './constants.js';
import { IOrder, ISandboxOrder, SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";
import { createGetOrderByTxHashRouteHandler } from "./functions.js";

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
function createCreateOrderRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
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
        config.environment === "sandbox",
        chainId,
        txHash,
        externalOrderId,
        idvSessionUSDPrice
      );

      try {
        // Make sure this transaction isn't already associated with an order
        const existingOrder = await config.OrderModel.findOne({ "txHash": txHash });
        if (existingOrder) {
          return res.status(400).json({
            error: `An order already exists for this transaction (${txHash})`
          })
        }

        // Create the order
        const order = new config.OrderModel({
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
      } catch (error: any) {
        throw new Error(`Error creating order: ${error.message}`);
      }
    } catch (error: any) {
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
}

async function createOrderProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createCreateOrderRouteHandler(config)(req, res);
}

async function createOrderSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createCreateOrderRouteHandler(config)(req, res);
}

// GET /:externalOrderId/transaction/status.
// To be called by verifier server.
// Should query the DB for the tx metadata,
// wait a little bit for the tx to be confirmed (if it's not already),
// and return a success response if all goes well.
// Supports both EVM and Sui
function createGetOrderTransactionStatusRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const { externalOrderId } = req.params;

    try {
      // Query the DB for the tx metadata
      const order = await config.OrderModel.findOne({ externalOrderId });

      if (!order) {
        return res
          .status(404)
          .json({ error: "Order not found", externalOrderId });
      }

      // Handle EVM
      if (order.txHash) {
        // Validate TX (check tx.data, tx.to, tx.value, etc)
        const validTx = await validateTx(
          config.environment === "sandbox",
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
            txIsValid: true,
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
      } else if (order.sui?.txHash) {
        return await getSuiOrderTransactionStatus(req, res)
      } else if (order.stellar?.txHash) {
        return await getStellarOrderTransactionStatus(req, res)
      } else {
        return res.status(400).json({ error: 'Order has no associated transaction hash' })
      }
    } catch (error: any) {
      console.log("error", error);
      return res.status(500).json({ error: error.message, externalOrderId });
    }
  }
}

async function getOrderTransactionStatusProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createGetOrderTransactionStatusRouteHandler(config)(req, res);
}

async function getOrderTransactionStatusSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createGetOrderTransactionStatusRouteHandler(config)(req, res);
}

// GET /:externalOrderId/fulfilled.
// API key gated endpoint. To be called by verifier server after minting the SBT.
// Sets order.fulfilled to true.
function createSetOrderFulfilledRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
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

      const loggerCtx = {
        fulfillmentReceipt,
        externalOrderId,
      }

    // if (!fulfillmentReceipt) {
    //   ordersLogger.info(
    //     loggerCtx,
    //     "Received request to set order fulfilled without fulfillmentReceipt"
    //   )
    //   return res.status(400).json({
    //     error: "fulfillmentReceipt query param is required"
    //   })
    // }

    // if (typeof fulfillmentReceipt != 'string') {
    //   return res.status(400).json({
    //     error: `Invalid fulfillment receipt. If present, it must be a string. Received '${fulfillmentReceipt}'`
    //   })
    // }

    // // Right now, fulfillment receipt must be a JSON object with a hex string as the value.
    // const pattern = /\{\s*"\w+"\s*:\s*"((0x)?[0-9a-fA-F]+)"\s*\}/;
    // if (!pattern.test(fulfillmentReceipt)) {
    //   ordersLogger.info(
    //     loggerCtx,
    //     "Received request to set order fulfilled with invalid fulfillmentReceipt"
    //   )
    //   return res.status(400).json({
    //     error: `Invalid fulfillment receipt. If present, it must be a JSON object with a hex string value. Received '${fulfillmentReceipt}'`
    //   })
    // }
  
      // Query the DB for the order
      const order = await config.OrderModel.findOne({ externalOrderId });

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      if (order.txHash) {
        // Validate TX (check tx.data, tx.to, tx.value, etc)
        const validTx = await validateTx(
          config.environment === "sandbox",
          order.chainId,
          order.txHash,
          order.externalOrderId,
          idvSessionUSDPrice
        );
      } else if (order.sui?.txHash) {
        const validationResult = await validateSuiTx(
          order.sui.txHash,
          order.externalOrderId,
          idvSessionUSDPrice
        );
      } else if (order.stellar?.txHash) {
        const validTx = await validateStellarTx(
          order.stellar.txHash,
          order.externalOrderId,
          idvSessionUSDPrice
        );
      } else {
        return res.status(400).json({ error: "Unexpected: no transaction hash associated with order" })
      }

      // Update the order to fulfilled
      order.fulfilled = true;
      if (fulfillmentReceipt) {
        order.fulfillmentReceipt = fulfillmentReceipt as string
      } else {
        ordersLogger.info(
          loggerCtx,
          "Marking order fulfilled without fulfillmentReceipt"
        )
      }
      await order.save();

      return res.status(200).json({ message: "Order set to fulfilled" });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}

async function setOrderFulfilledProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createSetOrderFulfilledRouteHandler(config)(req, res);
}

async function setOrderFulfilledSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createSetOrderFulfilledRouteHandler(config)(req, res);
}

// POST /refund.
// Refunds an unfulfilled order OR if there is no order for the given txHash+chainId
// combination, it validates the tx, creates an order, and refunds it.
// Gated by admin API key. Why? Because if an order is unfulfilled, a user could trigger
// SBT minting and a refund at the same time, to effectively not pay for the SBT.
function createRefundOrderRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const { txHash, chainId, platform } = req.body;

      let chainPlatform = platform ?? 'evm'

      if (!['evm', 'sui', 'stellar'].includes(chainPlatform)) {
        return res.status(400).json({ error: `Invalid platform '${platform}'` })
      }

      if (chainPlatform === 'evm' && (!txHash || !chainId)) {
        return res
          .status(400)
          .json({ error: "txHash and chainId are required for EVM refund" });
      }

      if (chainPlatform === 'evm' && Number.isNaN(Number(chainId))) {
        return res.status(400).json({ error: "chainId must be a number" })
      }

      if (!txHash) {
        return res
          .status(400)
          .json({ error: 'txHash is required' });
      }

      const apiKey = req.headers["x-api-key"];

      if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
        return res.status(401).json({ error: "Invalid API key." });
      }

      // Query the DB for the order
      let order = null
      if (chainPlatform === 'evm') {
        order = await config.OrderModel.findOne({ txHash, chainId });
      } else if (chainPlatform === 'sui') {
        order = await config.OrderModel.findOne({ 'sui.txHash': txHash });
      } else if (chainPlatform === 'stellar') {
        order = await config.OrderModel.findOne({ 'stellar.txHash': txHash });
      }

      // If there's no order associated with this txHash, maybe the user sent
      // a valid transaction but it wasn't successfully associated with an order
      // (due to a malfunction of our server). In this case, we want to (a) create
      // an order for the valid transaction, then (b) refund it.
      if (!order) {
        let validTx;
        let newOrderData: IOrder | ISandboxOrder = {
          holoUserId: 'n/a',
          externalOrderId: 'n/a',
          category: orderCategoryEnums.MINT_ZERONYM_V3_SBT,
          // Mark the order as fulfilled so that this tx cannot be refunded again
          fulfilled: true,
          // Wait to set order.refunded until refund is successful
          refunded: false,
        };

        if (chainPlatform === 'evm') {
          validTx = await validateTxNoOrderId(
            chainId,
            txHash,
            idvSessionUSDPrice
          );
          newOrderData.txHash = txHash;
          newOrderData.chainId = chainId;
        } else if (chainPlatform === 'sui') {
          validTx = await validateSuiTxNoOrderId(
            txHash,
            idvSessionUSDPrice
          );
          newOrderData.sui = { txHash };
        } else if (chainPlatform === 'stellar') {
          validTx = await validateStellarTxNoOrderId(
            txHash,
            idvSessionUSDPrice
          );
          newOrderData.stellar = { txHash };
        } else {
          throw new Error(`Unexpected chain platform: ${chainPlatform}`);
        }

        const order = new config.OrderModel(newOrderData);
        await order.save();

        let txReceipt;
        try {
          if (chainPlatform === 'evm') {
            txReceipt = await sendRefundTx(order, validTx);
            order.refunded = true;
            order.refundTxHash = txReceipt.transactionHash;
          } else if (chainPlatform === 'sui') {
            txReceipt = await sendSuiRefundTx(order, validTx);
            order.refunded = true;
            if (!order.sui) order.sui = {};
            // @ts-ignore
            order.sui.refundTxHash = txReceipt.hash;
          } else if (chainPlatform === 'stellar') {
            txReceipt = await sendStellarRefundTx(order, validTx);
            order.refunded = true;
            if (!order.stellar) order.stellar = {};
            // @ts-ignore
            order.stellar.refundTxHash = txReceipt.hash;
          }

          await order.save();

          ordersLogger.info(
            {
              order
            },
            "Order refunded"
          );
        } catch (err: any) {
          ordersLogger.error({ err }, "Failed to refund order")

          return res.status(500).json({
            error: 'An unkown error occurred while trying to refund the order',
            internalError: err.message
          })
        }
        return res.status(200).json({
          txReceipt
        });
      }

      // Refund the order
      try {
        let response;

        if (chainPlatform === 'evm') {
          response = await handleRefund(order);
        } else if (chainPlatform === 'sui') {
          response = await handleSuiRefund(order);
        } else if (chainPlatform === 'stellar') {
          response = await handleStellarRefund(order);
        } else {
          throw new Error(`Unsupported chain platform '${chainPlatform}'`);
        }

        // @ts-ignore
        if (response.status === 200) {
          // Update the order refundTxHash and refunded
          order.refunded = true;
          if (chainPlatform === 'evm') {
            // @ts-ignore
            order.refundTxHash = response.data.txHash || response.data.txReceipt?.transactionHash;
          } else if (chainPlatform === 'sui') {
            if (!order.sui) order.sui = {};
            // @ts-ignore
            order.sui.refundTxHash = response.data.txHash;
          } else if (chainPlatform === 'stellar') {
            if (!order.stellar) order.stellar = {};
            // @ts-ignore
            order.stellar.refundTxHash = response.data.txHash;
          }
          await order.save();

          ordersLogger.info(
            {
              order
            },
            "Order refunded"
          );
        } else {
          ordersLogger.error({ response }, "Failed to refund order")
        }

        // @ts-ignore
        return res.status(response.status).json(response.data);
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
}

async function refundOrderProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createRefundOrderRouteHandler(config)(req, res);
}

// async function refundOrderSandbox(req: Request, res: Response) {
//   const config = getRouteHandlerConfig("sandbox");
//   return createRefundOrderRouteHandler(config)(req, res);
// }

function createGetOrderRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const apiKey = req.headers["x-api-key"];

    if (!process.env.ADMIN_API_KEY_LOW_PRIVILEGE || !apiKey) {
      return res.status(401).json({ error: "Unauthorized. No API key found." });
    }

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    if (req.query.txHash) {
      const getOrderByTxHashHandler = createGetOrderByTxHashRouteHandler(config.OrderModel);
      return getOrderByTxHashHandler(req, res);
    }

    return res.status(501).json({ error: 'Not implemented' });
  }
}

async function getOrderProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createGetOrderRouteHandler(config)(req, res);
}

async function getOrderSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createGetOrderRouteHandler(config)(req, res);
}

export {
  createOrderProd,
  createOrderSandbox,
  getOrderTransactionStatusProd,
  getOrderTransactionStatusSandbox,
  setOrderFulfilledProd,
  setOrderFulfilledSandbox,
  refundOrderProd,
  // refundOrderSandbox,
  getOrderProd,
  getOrderSandbox,
};
