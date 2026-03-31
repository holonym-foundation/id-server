import express from "express";
import {
  createCheckProd,
  createCheckSandbox,
  refreshTokenProd,
  refreshTokenSandbox,
  getStatusProd,
  getStatusSandbox,
  findBySignDigestProd,
  findBySignDigestSandbox,
} from "../services/onfido-sessions/endpoints.js";

const prodRouter = express.Router();

prodRouter.post("/:id/check", createCheckProd);
prodRouter.post("/:id/token", refreshTokenProd);
prodRouter.get("/:id/status", getStatusProd);
prodRouter.get("/", findBySignDigestProd);

const sandboxRouter = express.Router();

sandboxRouter.post("/:id/check", createCheckSandbox);
sandboxRouter.post("/:id/token", refreshTokenSandbox);
sandboxRouter.get("/:id/status", getStatusSandbox);
sandboxRouter.get("/", findBySignDigestSandbox);

export default prodRouter;
export { sandboxRouter };
