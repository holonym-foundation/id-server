import express from "express";
import { createApplicantProd, createApplicantSandbox } from "../services/onfido/applicant.js";
import {
  v1CreateCheckProd,
  v1CreateCheckSandbox,
  v2CreateCheckProd,
  v2CreateCheckSandbox
} from "../services/onfido/check.js";
import { getCredentials } from "../services/onfido/credentials/v1.js";
import { getCredentialsV2 } from "../services/onfido/credentials/v2.js";
import { getCredentialsV3Prod, getCredentialsV3Sandbox } from "../services/onfido/credentials/v3.js";
import { handleOnfidoWebhookLive, handleOnfidoWebhookSandbox } from "../services/onfido/webhooks.js";
import { debugOnfidoSession } from "../services/onfido/debug.js";

const prodRouter = express.Router();

// TODO: Remove the following 3 endpoints once pay-first frontend is live
prodRouter.post("/applicant", createApplicantProd);
prodRouter.post("/check", v1CreateCheckProd);
prodRouter.post("/v2/check", v2CreateCheckProd);

prodRouter.get("/credentials", getCredentials);
prodRouter.get("/credentials/v2/:nullifier", getCredentialsV2);
prodRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Prod);

prodRouter.post("/webhooks", handleOnfidoWebhookLive);

// for debugging onfido session by check_id
// prodRouter.get("/debug", debugOnfidoSession);

const sandboxRouter = express.Router();

sandboxRouter.post("/applicant", createApplicantSandbox);
sandboxRouter.post("/check", v1CreateCheckSandbox);
sandboxRouter.post("/v2/check", v2CreateCheckSandbox);
sandboxRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Sandbox);
sandboxRouter.post("/webhooks", handleOnfidoWebhookSandbox);

export default prodRouter;
export { sandboxRouter };
