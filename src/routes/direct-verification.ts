import express from "express";
import { sseUpdates } from "../services/direct-verification/sse-updates.js";
import { sessionToken } from "../services/direct-verification/session-token.js";
import { enrollment3d } from "../services/direct-verification/enrollment-3d.js";
import { estimateAge3dV2 } from "../services/direct-verification/estimate-age-3d-v2.js";
import { createSession } from "../services/direct-verification/create-session.js";
// import { getProductionEncryptionKeyText } from "../services/facetec/encryption-key.js";

const router = express.Router();

router.post("/session", createSession);
router.get("/sse-updates/:sid", sseUpdates);
router.post("/session-token", sessionToken);
router.post("/enrollment-3d", enrollment3d);
router.post("/estimate-age-3d-v2", estimateAge3dV2);

// Use the /production-encryption-key-text endpoint under the /facetec route
// router.get("/production-encryption-key-text", getProductionEncryptionKeyText);

export default router;
