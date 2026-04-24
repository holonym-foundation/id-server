import express from "express";
import {
  postSession,
  postSessionSandbox,
  postSessionv2,
  postSessionv2Sandbox,
  postSessionv3,
  postSessionv3Sandbox,
  postSessionv4,
  postSessionv4Sandbox,
  createPayPalOrder,
  payForSession,
  payForSessionV2,
  payForSessionV3,
  payForSessionV4,
  payForSessionV4Sandbox,
  refund,
  refundV2,
  refundCleanHandsSession,
  refundCleanHandsSessionSandbox,
  issueCreds,
  issueCredsV2,
  issueCredsV3,
  issueCredsV4,
  issueCredsV4Sandbox,
  verifyAndIssueZkPassport,
  verifyAndIssueZkPassportSandbox,
  confirmStatement,
  confirmStatementSandbox,
  getSessions,
  getSessionsSandbox,
} from "../services/aml-sessions/endpoints.js";

const router = express.Router();

router.post("/", postSession);
router.post("/v2", postSessionv2);
router.post("/v3", postSessionv3);
router.post("/v4", postSessionv4);
router.get("/", getSessions);
router.post("/:_id/pay", payForSession);
router.post("/:_id/pay/v2", payForSessionV2);
router.post("/:_id/paypal-order", createPayPalOrder);
// router.post("/:_id/v2", createIdvSessionV2);
router.post("/:_id/v3", payForSessionV3);
router.post("/:_id/pay/v4", payForSessionV4);
// router.post("/:_id/refund", refund); // legacy v1; never enabled in prod
router.post("/:_id/refund/v2", refundV2);
router.post("/:_id/refund", refundCleanHandsSession);
router.get("/:_id/credentials/:nullifier", issueCreds);
router.get("/:_id/credentials/v2/:nullifier", issueCredsV2);
router.get("/:_id/credentials/v3/:nullifier", issueCredsV3);
router.get("/:_id/credentials/v4/:nullifier", issueCredsV4);
router.post("/:_id/verify-and-issue", verifyAndIssueZkPassport);
router.post("/:_id/statement/confirm", confirmStatement);

const sandboxRouter = express.Router();

sandboxRouter.post("/", postSessionSandbox);
sandboxRouter.post("/v2", postSessionv2Sandbox);
sandboxRouter.post("/v3", postSessionv3Sandbox);
sandboxRouter.post("/v4", postSessionv4Sandbox);
sandboxRouter.post("/:_id/pay/v4", payForSessionV4Sandbox);
sandboxRouter.get("/", getSessionsSandbox);
// sandboxRouter.post("/:_id/pay", payForSessionSandbox);
// sandboxRouter.post("/:_id/pay/v2", payForSessionV2Sandbox);
// sandboxRouter.post("/:_id/paypal-order", createPayPalOrderSandbox);
// sandboxRouter.post("/:_id/v3", payForSessionV3Sandbox);
// sandboxRouter.post("/:_id/refund/v2", refundV2Sandbox);
sandboxRouter.get("/:_id/credentials/v4/:nullifier", issueCredsV4Sandbox);
sandboxRouter.post("/:_id/verify-and-issue", verifyAndIssueZkPassportSandbox);
sandboxRouter.post("/:_id/statement/confirm", confirmStatementSandbox);
sandboxRouter.post("/:_id/refund", refundCleanHandsSessionSandbox);

export default router;
export { sandboxRouter };
