import express from "express";
import { issueKycTokenProd, issueKycTokenSandbox } from "../services/idos/kyc-token.js";
import {
  getCredentialsV3Prod,
  getCredentialsV3Sandbox,
} from "../services/idos/credentials/v3.js";

const prodRouter = express.Router();
prodRouter.post("/kyc-token", issueKycTokenProd);
prodRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Prod);

const sandboxRouter = express.Router();
sandboxRouter.post("/kyc-token", issueKycTokenSandbox);
sandboxRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Sandbox);

export default prodRouter;
export { sandboxRouter };
