import express from "express";
import {
  getCredentialsV3Prod,
  getCredentialsV3Sandbox,
} from "../services/idenfy/credentials/v3.js";
import {
  handleIdenfyWebhookLive,
  handleIdenfyWebhookSandbox,
} from "../services/idenfy/webhooks.js";

/**
 * iDenfy IDV provider routes.
 *
 * Note on removed endpoints (deprecated in this rewrite — see PR #30):
 *
 *   - GET  /idenfy/credentials              (legacy — used UserVerifications/IDVSessions)
 *   - POST /idenfy/session                  (legacy — used deprecated session model)
 *   - POST /idenfy/v2/session               (legacy — pre-Sumsub-template attempt)
 *   - GET  /idenfy/webhook                  (was GET; webhook is now POST per iDenfy docs)
 *   - GET  /idenfy/verification-status      (legacy — replaced by /session-status/v2)
 *
 * The current flow is keyed on `session.idenfyScanRef` + per-session
 * `session.idenfyAuthToken` + `session.idenfyVerificationStatus`. Old code
 * paths were never wired to the current Sumsub-style payment/verification
 * lifecycle, so removing them is non-breaking for live callers.
 */

const prodRouter = express.Router();

prodRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Prod);
prodRouter.post("/webhook", handleIdenfyWebhookLive);

const sandboxRouter = express.Router();

sandboxRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Sandbox);
sandboxRouter.post("/webhook", handleIdenfyWebhookSandbox);

export default prodRouter;
export { sandboxRouter };
