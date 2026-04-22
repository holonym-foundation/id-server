import express from "express";
import {
  verifyAndIssueProd,
  verifyAndIssueSandbox,
} from "../services/zk-passport/verify-and-issue.js";
import {
  postZkPassportSessionProd,
  postZkPassportSessionSandbox,
  getZkPassportSessionProd,
  getZkPassportSessionSandbox,
  listZkPassportSessionsProd,
  listZkPassportSessionsSandbox,
  refundZkPassportSessionProd,
  refundZkPassportSessionSandbox,
} from "../services/zk-passport/sessions.js";

const prodRouter = express.Router();

prodRouter.post("/sessions", postZkPassportSessionProd);
prodRouter.get("/sessions", listZkPassportSessionsProd);
prodRouter.get("/sessions/:sid", getZkPassportSessionProd);
prodRouter.post("/sessions/:sid/refund", refundZkPassportSessionProd);
prodRouter.post("/verify-and-issue", verifyAndIssueProd);

const sandboxRouter = express.Router();

sandboxRouter.post("/sessions", postZkPassportSessionSandbox);
sandboxRouter.get("/sessions", listZkPassportSessionsSandbox);
sandboxRouter.get("/sessions/:sid", getZkPassportSessionSandbox);
sandboxRouter.post("/sessions/:sid/refund", refundZkPassportSessionSandbox);
sandboxRouter.post("/verify-and-issue", verifyAndIssueSandbox);

export default prodRouter;
export { sandboxRouter };
