import express from "express";
import {
  createPaymentParamsProd,
  createPaymentParamsSandbox,
  reserveRedemptionProd,
  reserveRedemptionSandbox,
  completeRedemptionProd,
  completeRedemptionSandbox,
  requestRefundProd,
  requestRefundSandbox,
} from "../services/payments/endpoints.js";

const prodRouter = express.Router();

prodRouter.post("/payment-params", createPaymentParamsProd);

// POST /payments/redemption/reserve - Redemption Phase 1: Reserve redemption
prodRouter.post("/redemption/reserve", reserveRedemptionProd);

// POST /payments/redemption/complete - Redemption Phase 2: Complete redemption
prodRouter.post("/redemption/complete", completeRedemptionProd);

prodRouter.post("/refund/request", requestRefundProd);

// --------------------- Sandbox routes ---------------------

const sandboxRouter = express.Router();

sandboxRouter.post("/payment-params", createPaymentParamsSandbox);

// POST /payments/redemption/reserve - Redemption Phase 1: Reserve redemption
sandboxRouter.post("/redemption/reserve", reserveRedemptionSandbox);

// POST /payments/redemption/complete - Redemption Phase 2: Complete redemption
sandboxRouter.post("/redemption/complete", completeRedemptionSandbox);

sandboxRouter.post("/refund/request", requestRefundSandbox);

export default prodRouter;
export { sandboxRouter };

