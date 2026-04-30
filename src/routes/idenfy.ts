import express from "express";
import {
  getCredentialsV3Prod,
  getCredentialsV3Sandbox,
} from "../services/idenfy/credentials/v3.js";
import {
  handleIdenfyWebhookLive,
  handleIdenfyWebhookSandbox,
} from "../services/idenfy/webhooks.js";

const prodRouter = express.Router();

prodRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Prod);
prodRouter.post("/webhook", handleIdenfyWebhookLive);

const sandboxRouter = express.Router();

sandboxRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Sandbox);
sandboxRouter.post("/webhook", handleIdenfyWebhookSandbox);

export default prodRouter;
export { sandboxRouter };
