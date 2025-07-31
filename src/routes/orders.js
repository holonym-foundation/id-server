import express from "express";
import { 
  createOrder, 
  getOrderTransactionStatus, 
  setOrderFulfilled, 
  refundOrder,
  getOrder
} from "../services/orders/endpoints.js";
import {
  createOrder as createStellarOrder,
  getOrderTransactionStatus as getStellarOrderTransactionStatus,
  setOrderFulfilled as setStellarOrderFulfilled,
  refundOrder as refundStellarOrder
} from "../services/orders/stellar/endpoints.js"
import {
  createSuiOrder,
  getSuiOrderTransactionStatus,
  setSuiOrderFulfilled,
  // refundOrder as refundSuiOrder
} from "../services/orders/sui/endpoints.js"

const router = express.Router();

// ---- Order ----
// Endpoints
// POST /. Creates an order and associates payment metadata with it. To be called by client when user submits a tx. Body should include a Order object. body.category should be validated against a whitelist of payment categories. body.externalOrderId should be hex and should match tx.data (more on the rational for this ID below). order.fulfilled should be false when order is inserted into DB.
// GET /:externalOrderId/transaction/status. To be called by verifier server. Should query the DB for the tx metadata, wait a little bit for the tx to be confirmed (if it's not already), and return a success response if all goes well.
// GET /:externalOrderId/fulfilled. API key gated endpoint. To be called by verifier server after minting the SBT. Sets order.fulfilled to true.
// GET /:externalOrderId/refund.  Refunds an unfulfilled order.

// --- EVM ---
router.post("/", createOrder);
router.get("/:externalOrderId/transaction/status", getOrderTransactionStatus);
router.get("/:externalOrderId/fulfilled", setOrderFulfilled); // gated by ORDERS_API_KEY
router.get("/", getOrder);
router.post("/admin/refund", refundOrder);

// --- Stellar ---
router.post("/stellar", createStellarOrder);
router.get("/stellar/:externalOrderId/transaction/status", getStellarOrderTransactionStatus);
router.get("/stellar/:externalOrderId/fulfilled", setStellarOrderFulfilled); // gated by ORDERS_API_KEY
router.post("/stellar/admin/refund", refundStellarOrder);

// --- Sui ---
router.post("/sui", createSuiOrder);
router.get("/sui/:externalOrderId/transaction/status", getSuiOrderTransactionStatus);
router.get("/sui/:externalOrderId/fulfilled", setSuiOrderFulfilled); // gated by ORDERS_API_KEY
// router.post("/sui/admin/refund", refundStellarOrder);

export default router;