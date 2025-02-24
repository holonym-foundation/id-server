import {
    handleRefund,
    getTransaction,
    handleRefund,
    validateTx
} from "./functions.js";

import { pinoOptions, logger } from "../../utils/logger.js";

const Order = import('../../schemas/orders.js');

const orderCategoryEnums = {
    MINT_ZERONYM_V3_SBT: "mint_zeronym_v3_sbt",
}

// POST /order.
// Creates an order and associates payment metadata with it. 
// To be called by client when user submits a tx. 
// Body should include a Order object. 
// body.category should be validated against a whitelist of payment categories. 
// body.externalOrderId should be hex and should match tx.data (more on the rational for this ID below). 
// order.fulfilled should be false when order is inserted into DB.
async function createOrder(req, res) {
    try {

        const { externalOrderId, category, txHash, chainId } = req.body;

        // Validate category against whitelist of payment categories
        if (!category || !Object.values(orderCategoryEnums).includes(category)) {
            return res.status(400).json({ error: "Invalid category" });
        }

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
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// GET /order/:externalOrderId/transaction/status. 
// To be called by verifier server. 
// Should query the DB for the tx metadata, 
// wait a little bit for the tx to be confirmed (if it's not already), 
// and return a success response if all goes well.
async function getOrderTransactionStatus(req, res) {
    try {
        const { externalOrderId } = req.params;

        // Query the DB for the tx metadata
        const order = await Order.findOne({ externalOrderId });

        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        // Check TX if it's confirmed
        // TX might take a while to be confirmed
        const tx = await retry(async () => {
            const result = await getTransaction(order.chainId, order.txHash)
            if (!result) throw new Error(`Could not find transaction with txHash ${order.txHash} on chain ${order.chainId}`)
            return result
        }, 5, 5000);

        // If it's still not found, return an error.
        if (!tx) {
            return res.status(404).json({
                error: `Could not find ${order.txHash} on chain ${order.chainId}.`,
            });
        }

        // Validate externalOrderId equals tx.data
        if (order.externalOrderId !== tx.data) {
            return res.status(400).json({ error: "Invalid externalOrderId, does not match tx.data" });
        }

        const txReceipt = await tx.wait();

        if (!txReceipt.blockHash || txReceipt.confirmations === 0) {
            return res.status(400).json({ error: "Transaction has not been confirmed yet." });
        }

        // If TX is confirmed, return the order
        return res.status(200).json({ order });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// POST /order/:externalOrderId/fulfilled. 
// API key gated endpoint. To be called by verifier server after minting the SBT. 
// Sets order.fulfilled to true.
async function setOrderFulfilled(req, res) {
    try {
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

        // Validate externalOrderId equals tx.data
        if (order.externalOrderId !== tx.data) {
            return res.status(400).json({ error: "Invalid externalOrderId, does not match tx.data" });
        }

        // Validate TX
        // TODO: verification amount should via variable/constant
        await validateTx(order, 5.0);

        // Set the order to fulfilled
        order.fulfilled = true;
        await order.save();

        return res.status(200).json({ message: "Order set to fulfilled" });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }

}

// POST /order/refund. 
// Body could be { txHash, chainId }. 
// Refunds an unfulfilled order.
async function refundOrder(req, res) {
    try {
        const { txHash, chainId } = req.body;

        // Query the DB for the order
        const order = await Order.findOne({ txHash, chainId });

        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        // Validate externalOrderId equals tx.data
        if (order.externalOrderId !== tx.data) {
            return res.status(400).json({ error: "Invalid externalOrderId, does not match tx.data" });
        }

        // Refund the order
        try {
            await handleRefund(order);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        return res.status(200).json({ message: "Order refunded" });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }

}

export {
    createOrder,
    getOrderTransactionStatus,
    setOrderFulfilled,
    refundOrder,
}
