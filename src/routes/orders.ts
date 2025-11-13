import express from "express";
import { 
  createOrderProd,
  createOrderSandbox, 
  getOrderTransactionStatusProd,
  getOrderTransactionStatusSandbox, 
  setOrderFulfilledProd,
  setOrderFulfilledSandbox, 
  refundOrderProd,
  // refundOrderSandbox,
  getOrderProd,
  getOrderSandbox
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
  // setSuiOrderFulfilled,
  // refundOrder as refundSuiOrder
} from "../services/orders/sui/endpoints.js"

const prodRouter = express.Router();

// ---- Order ----
// Endpoints
// POST /. Creates an order and associates payment metadata with it. To be called by client when user submits a tx. Body should include a Order object. body.category should be validated against a whitelist of payment categories. body.externalOrderId should be hex and should match tx.data (more on the rational for this ID below). order.fulfilled should be false when order is inserted into DB.
// GET /:externalOrderId/transaction/status. To be called by verifier server. Should query the DB for the tx metadata, wait a little bit for the tx to be confirmed (if it's not already), and return a success response if all goes well.
// GET /:externalOrderId/fulfilled. API key gated endpoint. To be called by verifier server after minting the SBT. Sets order.fulfilled to true.
// GET /:externalOrderId/refund.  Refunds an unfulfilled order.

// --- Chain-agnostic ---
prodRouter.get("/:externalOrderId/transaction/status", getOrderTransactionStatusProd);

// --- EVM ---
prodRouter.post("/", createOrderProd);
prodRouter.get("/:externalOrderId/fulfilled", setOrderFulfilledProd); // gated by ORDERS_API_KEY
prodRouter.get("/", getOrderProd);
prodRouter.post("/admin/refund", refundOrderProd);

// --- Stellar ---
prodRouter.post("/stellar", createStellarOrder);
// TODO: Deprecate this stellar order status endpoint. The frontend just needs the chain-agnostic order status endpoint
prodRouter.get("/stellar/:externalOrderId/transaction/status", getStellarOrderTransactionStatus);
prodRouter.get("/stellar/:externalOrderId/fulfilled", setStellarOrderFulfilled); // gated by ORDERS_API_KEY
prodRouter.post("/stellar/admin/refund", refundStellarOrder);

// --- Sui ---
prodRouter.post("/sui", createSuiOrder);
// TODO: Deprecate this sui order status endpoint. The frontend just needs the chain-agnostic order status endpoint
prodRouter.get("/sui/:externalOrderId/transaction/status", getSuiOrderTransactionStatus);
// prodRouter.get("/sui/:externalOrderId/fulfilled", setSuiOrderFulfilled); // gated by ORDERS_API_KEY
// prodRouter.post("/sui/admin/refund", refundStellarOrder);

// --------------------- Sandbox routes ---------------------

const sandboxRouter = express.Router();

// --- Chain-agnostic ---
sandboxRouter.get("/:externalOrderId/transaction/status", getOrderTransactionStatusSandbox);

// --- EVM ---
sandboxRouter.post("/", createOrderSandbox);
sandboxRouter.get("/:externalOrderId/fulfilled", setOrderFulfilledSandbox); // gated by ORDERS_API_KEY
sandboxRouter.get("/", getOrderSandbox);
// sandboxRouter.post("/admin/refund", refundOrderSandbox);

export default prodRouter;
export { sandboxRouter };
