import express from "express";
import {
  verifyAndIssueProd,
  verifyAndIssueSandbox,
} from "../services/zk-passport/verify-and-issue.js";
import {
  postZkPassportSessionV2Prod,
  postZkPassportSessionV2Sandbox,
  getZkPassportSessionProd,
  getZkPassportSessionSandbox,
  refundZkPassportSessionProd,
  refundZkPassportSessionSandbox,
} from "../services/zk-passport/sessions.js";

const prodRouter = express.Router();

prodRouter.post("/sessions/v2", postZkPassportSessionV2Prod);
prodRouter.get("/sessions/:sid", getZkPassportSessionProd);
prodRouter.post("/sessions/:sid/refund", refundZkPassportSessionProd);
prodRouter.post("/verify-and-issue", verifyAndIssueProd);

const sandboxRouter = express.Router();

sandboxRouter.post("/sessions/v2", postZkPassportSessionV2Sandbox);
sandboxRouter.get("/sessions/:sid", getZkPassportSessionSandbox);
sandboxRouter.post("/sessions/:sid/refund", refundZkPassportSessionSandbox);
sandboxRouter.post("/verify-and-issue", verifyAndIssueSandbox);

export default prodRouter;
export { sandboxRouter };
