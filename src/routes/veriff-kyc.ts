import express from "express";
import {
  getCredentials,
  getCredentialsV2,
  getCredentialsV3,
} from "../services/veriff-kyc/credentials.js";
import { v1CreateSession, v2CreateSession } from "../services/veriff-kyc/session.js";
import { decisionWebhook } from "../services/veriff-kyc/webhooks.js";

const router = express.Router();

router.get("/credentials", getCredentials);
router.get("/credentials/v2/:nullifier", getCredentialsV2);
router.get("/credentials/v3/:_id/:nullifier", getCredentialsV3);

// router.post("/session", v1CreateSession);
// router.post("/v2/session", v2CreateSession);

router.get("/decision-webhook", decisionWebhook);

export default router;
