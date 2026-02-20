import express from "express";
import { getCredentialsV3Prod, getCredentialsV3Sandbox } from "../services/sumsub/credentials/v3.js";
import { handleSumsubWebhookLive } from "../services/sumsub/webhooks.js";

const prodRouter = express.Router();

prodRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Prod);
prodRouter.post("/webhooks", handleSumsubWebhookLive);

const sandboxRouter = express.Router();

sandboxRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Sandbox);
// TODO: Add sandbox webhooks endpoint. Use source keys to distinguish between
// sandbox and production: https://docs.sumsub.com/docs/source-keys

export default prodRouter;
export { sandboxRouter };
