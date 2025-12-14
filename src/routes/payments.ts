import express from "express";
import {
  createPaymentParamsProd,
  createPaymentParamsSandbox,
  reserveRedemptionProd,
  reserveRedemptionSandbox,
  completeRedemptionProd,
  completeRedemptionSandbox,
  cancelRedemptionProd,
  cancelRedemptionSandbox,
  requestRefundProd,
  requestRefundSandbox,
  paymentStatusProd,
  paymentStatusSandbox,
} from "../services/payments/endpoints.js";

const prodRouter = express.Router();

prodRouter.post("/payment-params", createPaymentParamsProd);

// POST /payments/redemption/reserve - Redemption Phase 1: Reserve redemption
prodRouter.post("/redemption/reserve", reserveRedemptionProd);

// POST /payments/redemption/complete - Redemption Phase 2: Complete redemption
prodRouter.post("/redemption/complete", completeRedemptionProd);

// POST /payments/redemption/cancel - Cancel a reserved redemption
prodRouter.post("/redemption/cancel", cancelRedemptionProd);

prodRouter.post("/refund/request", requestRefundProd);

// GET /payments/status - Check payment status
prodRouter.get("/status", paymentStatusProd);

// --------------------- Sandbox routes ---------------------

const sandboxRouter = express.Router();

sandboxRouter.post("/payment-params", createPaymentParamsSandbox);

// POST /payments/redemption/reserve - Redemption Phase 1: Reserve redemption
sandboxRouter.post("/redemption/reserve", reserveRedemptionSandbox);

// POST /payments/redemption/complete - Redemption Phase 2: Complete redemption
sandboxRouter.post("/redemption/complete", completeRedemptionSandbox);

// POST /payments/redemption/cancel - Cancel a reserved redemption
sandboxRouter.post("/redemption/cancel", cancelRedemptionSandbox);

sandboxRouter.post("/refund/request", requestRefundSandbox);

// GET /payments/status - Check payment status
sandboxRouter.get("/status", paymentStatusSandbox);

export default prodRouter;
export { sandboxRouter };

