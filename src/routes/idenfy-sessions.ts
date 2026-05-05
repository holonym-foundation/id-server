import express from "express";
import {
  getStatusProd,
  getStatusSandbox,
  findBySignDigestProd,
  findBySignDigestSandbox,
} from "../services/idenfy-sessions/endpoints.js";

const prodRouter = express.Router();

prodRouter.get("/:id/status", getStatusProd);
prodRouter.get("/", findBySignDigestProd);

const sandboxRouter = express.Router();

sandboxRouter.get("/:id/status", getStatusSandbox);
sandboxRouter.get("/", findBySignDigestSandbox);

export default prodRouter;
export { sandboxRouter };
