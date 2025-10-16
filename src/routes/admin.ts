import express from "express";
import {
  getUserVerification,
  deleteUserVerification,
} from "../services/admin/user-verifications.js";
import { deleteUserData } from "../services/admin/user-idv-data.js";
import { transferFunds } from "../services/admin/transfer-funds.js";
import { setSessionIdvProvider } from "../services/admin/set-session-idv-provider.js";
import { userSessions } from "../services/admin/user-sessions.js";
import { failSession } from "../services/admin/fail-session.js";
import { refundUnusedTransaction } from "../services/admin/refund-unused-transaction.js";
import { userCleanHandsSessions } from "../services/admin/user-clean-hands-sessions.js";
import { failCleanHandsSession } from "../services/admin/fail-clean-hands-session.js";
import { refundFailedSession } from "../services/admin/refund-failed-session.js";
import { refundFailedCleanHandsSession } from "../services/admin/refund-failed-clean-hands-session.js";
import { issueVeraxAttestation } from "../services/admin/issue-verax-attestation.js";
import { getUserHasBackedupCredentials } from "../services/admin/user-has-backedup-credentials.js";
import { whitelistCleanHandsSession } from "../services/admin/whitelist-clean-hands-session.js";

const router = express.Router();

// Note that admin endpoints for the orders API are with the other orders routes

router.get("/user-verification", getUserVerification);
router.delete("/user-verification", deleteUserVerification);
router.delete("/user-idv-data", deleteUserData);
router.post("/transfer-funds", transferFunds);
router.post("/set-session-idv-provider", setSessionIdvProvider);
router.post("/user-sessions", userSessions);

// Old endpoints for when we charged for sessions, instead of charging for SBTs
// router.post("/fail-session", failSession);
// router.post("/refund-unused-transaction", refundUnusedTransaction);
// router.post("/refund-failed-session", refundFailedSession);

router.post("/issue-verax-attestation", issueVeraxAttestation);
router.get("/user-has-backedup-credentials", getUserHasBackedupCredentials);
// ---- Clean hands ----
router.post("/user-clean-hands-sessions", userCleanHandsSessions);
router.post("/fail-clean-hands-session", failCleanHandsSession);
// router.post("/refund-failed-clean-hands-session", refundFailedCleanHandsSession);
// router.post("/whitelist-clean-hands-session", whitelistCleanHandsSession);

export default router;
