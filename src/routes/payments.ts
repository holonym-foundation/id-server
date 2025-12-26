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
import {
  nonceProd,
  siweAuthProd,
  generateSecretsProd,
  getSecretsProd,
  nonceSandbox,
  siweAuthSandbox,
  generateSecretsSandbox,
  getSecretsSandbox,
} from '../services/payments/human-id-credits/endpoints.js';
import { validateSessionMiddleware } from '../services/payments/human-id-credits/middleware.js';

const prodRouter = express.Router();

prodRouter.get("/payment-params", createPaymentParamsProd);

// POST /payments/redemption/reserve - Redemption Phase 1: Reserve redemption
prodRouter.post("/redemption/reserve", reserveRedemptionProd);

// POST /payments/redemption/complete - Redemption Phase 2: Complete redemption
prodRouter.post("/redemption/complete", completeRedemptionProd);

// POST /payments/redemption/cancel - Cancel a reserved redemption
prodRouter.post("/redemption/cancel", cancelRedemptionProd);

prodRouter.post("/refund/request", requestRefundProd);

// GET /payments/status - Check payment status
prodRouter.get("/status", paymentStatusProd);

// --------------------- Human ID Credits routes ---------------------

// GET /payments/human-id-credits/auth/nonce - Get nonce for SIWE authentication
prodRouter.get("/human-id-credits/auth/nonce", nonceProd);

// POST /payments/human-id-credits/auth/siwe - Authenticate with SIWE
prodRouter.post("/human-id-credits/auth/siwe", siweAuthProd);

// POST /payments/human-id-credits/secrets/batch - Generate batch of payment secrets
prodRouter.post(
  "/human-id-credits/secrets/batch",
  validateSessionMiddleware,
  generateSecretsProd
);

// GET /payments/human-id-credits/secrets - Get list of generated payment secrets
prodRouter.get(
  "/human-id-credits/secrets",
  validateSessionMiddleware,
  getSecretsProd
);

// --------------------- Sandbox routes ---------------------

const sandboxRouter = express.Router();

sandboxRouter.get("/payment-params", createPaymentParamsSandbox);

// POST /payments/redemption/reserve - Redemption Phase 1: Reserve redemption
sandboxRouter.post("/redemption/reserve", reserveRedemptionSandbox);

// POST /payments/redemption/complete - Redemption Phase 2: Complete redemption
sandboxRouter.post("/redemption/complete", completeRedemptionSandbox);

// POST /payments/redemption/cancel - Cancel a reserved redemption
sandboxRouter.post("/redemption/cancel", cancelRedemptionSandbox);

sandboxRouter.post("/refund/request", requestRefundSandbox);

// GET /payments/status - Check payment status
sandboxRouter.get("/status", paymentStatusSandbox);

// --------------------- Human ID Credits routes ---------------------

// GET /payments/human-id-credits/auth/nonce - Get nonce for SIWE authentication
sandboxRouter.get("/human-id-credits/auth/nonce", nonceSandbox);

// POST /payments/human-id-credits/auth/siwe - Authenticate with SIWE
sandboxRouter.post("/human-id-credits/auth/siwe", siweAuthSandbox);

// POST /payments/human-id-credits/secrets/batch - Generate batch of payment secrets
sandboxRouter.post(
  "/human-id-credits/secrets/batch",
  validateSessionMiddleware,
  generateSecretsSandbox
);

// GET /payments/human-id-credits/secrets - Get list of generated payment secrets
sandboxRouter.get(
  "/human-id-credits/secrets",
  validateSessionMiddleware,
  getSecretsSandbox
);

export default prodRouter;
export { sandboxRouter };

