import express from "express";
import {
  verifyAndIssueProd,
  verifyAndIssueSandbox,
} from "../services/zk-passport/verify-and-issue.js";

const prodRouter = express.Router();

prodRouter.post("/verify-and-issue", verifyAndIssueProd);

const sandboxRouter = express.Router();

sandboxRouter.post("/verify-and-issue", verifyAndIssueSandbox);

export default prodRouter;
export { sandboxRouter };
