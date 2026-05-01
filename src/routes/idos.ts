import express from "express";
import { issueKycTokenProd, issueKycTokenSandbox } from "../services/idos/kyc-token.js";

const prodRouter = express.Router();
prodRouter.post("/kyc-token", issueKycTokenProd);
// Slice 3 (parent plan U4) adds:
//   prodRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Prod);

const sandboxRouter = express.Router();
sandboxRouter.post("/kyc-token", issueKycTokenSandbox);
// Slice 3 (parent plan U4) adds:
//   sandboxRouter.get("/credentials/v3/:_id/:nullifier", getCredentialsV3Sandbox);

export default prodRouter;
export { sandboxRouter };
