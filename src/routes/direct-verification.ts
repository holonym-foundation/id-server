import express from "express";
import { sseUpdates } from "../services/direct-verification/sse-updates.js";
import { sessionToken } from "../services/direct-verification/session-token.js";
import { enrollment3d } from "../services/direct-verification/enrollment-3d.js";
import { estimateAge3dV2 } from "../services/direct-verification/estimate-age-3d-v2.js";
import { createSession } from "../services/direct-verification/create-session.js";
// import { getProductionEncryptionKeyText } from "../services/facetec/encryption-key.js";
import { createCustomer, getCustomers } from "../services/direct-verification/customer/index.js";
import { createOrder } from "../services/direct-verification/order/index.js"
import { getSessionResult } from "../services/direct-verification/session-result/index.js";

const router = express.Router();

router.post("/sessions", createSession);
router.get("/session-result", getSessionResult);
router.get("/sse-updates/:sid", sseUpdates);
router.post("/session-token", sessionToken);
router.post("/enrollment-3d", enrollment3d);
router.post("/estimate-age-3d-v2", estimateAge3dV2);

// Use the /production-encryption-key-text endpoint under the /facetec route
// router.get("/production-encryption-key-text", getProductionEncryptionKeyText);

router.post("/customers", createCustomer);
router.get("/customers", getCustomers);
router.post("/orders", createOrder);

export default router;
