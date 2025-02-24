import express from "express";
import { 
    createOrder, 
    getOrderTransactionStatus, 
    setOrderFulfilled, 
    refundOrder,
} from "../services/orders/endpoints.js";
const router = express.Router();

// ---- Order ----
// Endpoints
// POST /order. Creates an order and associates payment metadata with it. To be called by client when user submits a tx. Body should include a Order object. body.category should be validated against a whitelist of payment categories. body.externalOrderId should be hex and should match tx.data (more on the rational for this ID below). order.fulfilled should be false when order is inserted into DB.
// GET /order/:externalOrderId/transaction/status. To be called by verifier server. Should query the DB for the tx metadata, wait a little bit for the tx to be confirmed (if it's not already), and return a success response if all goes well.
// POST /order/:externalOrderId/fulfilled. API key gated endpoint. To be called by verifier server after minting the SBT. Sets order.fulfilled to true.
// POST /order/refund. Body could be { txHash, chainId }. Refunds an unfulfilled order.
router.post("/order", createOrder);
router.get("/order/:externalOrderId/transaction/status", getOrderTransactionStatus);
router.post("/order/:externalOrderId/fulfilled", setOrderFulfilled); // gated by ORDERS_API_KEY
router.post("/order/refund", refundOrder);

export default router;