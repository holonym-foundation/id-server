import express from "express";
import {
  getPaymentSecretsProd,
  getPaymentSecretsSandbox,
  putPaymentSecretProd,
  putPaymentSecretSandbox,
} from "../services/payment-secrets.js";

const router = express.Router();

// GET /payment-secrets - Get all payment secrets for a user
router.get("/", getPaymentSecretsProd);

// PUT /payment-secrets - Store or update a payment secret
router.put("/", putPaymentSecretProd);

// --------------------- Sandbox routes ---------------------

const sandboxRouter = express.Router();

// GET /payment-secrets - Get all payment secrets for a user
sandboxRouter.get("/", getPaymentSecretsSandbox);

// PUT /payment-secrets - Store or update a payment secret
sandboxRouter.put("/", putPaymentSecretSandbox);

export default router;
export { sandboxRouter };

