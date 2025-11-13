import express from "express";
import {
  getSessionStatusProd,
  getSessionStatusSandbox,
  getSessionStatusV2Prod,
  getSessionStatusV2Sandbox
} from "../services/session-status.js";

const prodRouter = express.Router();

prodRouter.get("/", getSessionStatusProd);
prodRouter.get("/v2", getSessionStatusV2Prod);

const sandboxRouter = express.Router();
sandboxRouter.get("/", getSessionStatusSandbox);
sandboxRouter.get("/v2", getSessionStatusV2Sandbox);

export default prodRouter;
export { sandboxRouter };