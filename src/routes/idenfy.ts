import express from "express";
import { getCredentials } from "../services/idenfy/credentials.js";
import { v1CreateSession, v2CreateSession } from "../services/idenfy/session.js";
import { webhook } from "../services/idenfy/webhooks.js";
import { verificationStatus } from "../services/idenfy/status.js";

const router = express.Router();

router.get("/credentials", getCredentials);

// TODO: Remove the following 2 endpoints once pay-first frontend is live
router.post("/session", v1CreateSession);
router.post("/v2/session", v2CreateSession);

router.get("/webhook", webhook);
router.get("/verification-status", verificationStatus);

export default router;
