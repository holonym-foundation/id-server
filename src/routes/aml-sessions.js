import express from "express";
import {
  postSession,
  postSessionv2,
  createPayPalOrder,
  payForSession,
  payForSessionV2,
  payForSessionV3,
  refund,
  refundV2,
  issueCreds,
  issueCredsV2,
  issueCredsV3,
  getSessions,
} from "../services/aml-sessions/endpoints.js";

const router = express.Router();

router.post("/", postSession);
router.post("/v2", postSessionv2);
router.get("/", getSessions);
router.post("/:_id/pay", payForSession);
router.post("/:_id/pay/v2", payForSessionV2);
router.post("/:_id/paypal-order", createPayPalOrder);
// router.post("/:_id/v2", createIdvSessionV2);
router.post("/:_id/v3", payForSessionV3);
// router.post("/:_id/refund", refund); // TODO: Uncomment
router.post("/:_id/refund/v2", refundV2);
router.get("/:_id/credentials/:nullifier", issueCreds);
router.get("/:_id/credentials/v2/:nullifier", issueCredsV2);
router.get("/:_id/credentials/v3/:nullifier", issueCredsV3);

export default router;
