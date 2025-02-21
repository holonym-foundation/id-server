import {
    handleRefund,
} from "./functions.js";
import { getTransaction } from "../../utils/transactions.js";

import { pinoOptions, logger } from "../../utils/logger.js";

const Order = import('../../schemas/orders.js');

const orderCategoryEnums = {
    CATEGORY1: "category_1",
    CATEGORY2: "category_2",
    CATEGORY3: "category_3",
}

// POST /order.
// Creates an order and associates payment metadata with it. 
// To be called by client when user submits a tx. 
// Body should include a Order object. 
// body.category should be validated against a whitelist of payment categories. 
// body.externalOrderId should be hex and should match tx.data (more on the rational for this ID below). 
// order.fulfilled should be false when order is inserted into DB.
async function createOrder(req, res) {
    const { externalOrderId, category, txHash, chainId } = req.body;

    // Validate category against whitelist of payment categories
    if (!category || !Object.values(orderCategoryEnums).includes(category)) {
        return res.status(400).json({ error: "Invalid category" });
    }

    // get TX
    const tx = await getTransaction(chainId, txHash);

    if (!tx) {
        return res.status(404).json({
            error: `Could not find ${txHash} on chain ${chainId}.`,
        });
    }

    // Validate externalOrderId equals tx.data
    if (externalOrderId !== tx.data) {
        return res.status(400).json({ error: "Invalid externalOrderId, does not match tx.data" });
    }

    try {
        // Create the order
        const order = new Order({
            externalOrderId,
            category,
            txHash,
            chainId,
            fulfilled: false // order.fulfilled should be false when order is inserted into DB
        });

        await order.save();

        return res.status(200).json({ order });
    } catch (error) {
        throw new Error(`Error creating order: ${error.message}`);
    }
}

// GET /order/:externalOrderId/transaction/status. 
// To be called by verifier server. 
// Should query the DB for the tx metadata, wait a little bit for the tx to be confirmed (if it's not already), 
// and return a success response if all goes well.
async function getOrderTransactionStatus(req, res) {
    const { externalOrderId } = req.params;

    // Query the DB for the tx metadata
    const order = await Order.findOne({ externalOrderId });

    if (!order) {
        return res.status(404).json({ error: "Order not found" });
    }

    // Check TX if it's confirmed
    const tx = await getTransaction(order.txHash, order.chainId);

    if (!tx) {
        return res.status(404).json({
            error: `Could not find ${order.txHash} on chain ${order.chainId}.`,
        });
    }

    // If TX is not confirmed yet, wait a little bit and check again
    if (!tx.blockHash || tx.confirmations === 0) {
        // todo: add a timeout
        // refer to validateTxForSessionCreation
    }

    // If TX is confirmed, return the order
    return res.status(200).json({ order });
}

// POST /order/:externalOrderId/fulfilled. 
// API key gated endpoint. To be called by verifier server after minting the SBT. 
// Sets order.fulfilled to true.
async function setOrderFulfilled(req, res) {
    const { externalOrderId } = req.params;

    // Check for API key in header
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.ORDERS_API_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    // Query the DB for the order
    const order = await Order.findOne({ externalOrderId });

    if (!order) {
        return res.status(404).json({ error: "Order not found" });
    }

    // Set the order to fulfilled
    order.fulfilled = true;
    await order.save();

    return res.status(200).json({ message: "Order set to fulfilled" });

}

// POST /order/refund. 
// Body could be { txHash, chainId }. 
// Refunds an unfulfilled order.
async function refundOrder(req, res) {
    const { txHash, chainId } = req.body;

    // Query the DB for the order
    const order = await Order.findOne({ txHash, chainId });

    if (!order) {
        return res.status(404).json({ error: "Order not found" });
    }

    // Refund the order
    try {
        await handleRefund(order);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ message: "Order refunded" });

}

export {
    createOrder,
    getOrderTransactionStatus,
    setOrderFulfilled,
    refundOrder,
}
