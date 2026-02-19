import express from "express";
import {
  postSession,
  postSessionV2Prod,
  postSessionV2Sandbox,
  createPayPalOrder,
  createIdvSession,
  createIdvSessionV2,
  createIdvSessionV3,
  setIdvProvider,
  refreshOnfidoTokenProd,
  refreshOnfidoTokenSandbox,
  createOnfidoCheckEndpointProd,
  createOnfidoCheckEndpointSandbox,
  refreshSumsubTokenProd,
  refreshSumsubTokenSandbox,
  refund,
  refundV2,
  getSessionsProd,
  getSessionsSandbox,
} from "../services/sessions/endpoints.js";

const prodRouter = express.Router();

prodRouter.post("/", postSession);
prodRouter.post("/v2", postSessionV2Prod);
prodRouter.post("/:_id/paypal-order", createPayPalOrder);
// prodRouter.post("/:_id/idv-session", createIdvSession);
prodRouter.post("/:_id/idv-session/v2", createIdvSessionV2);
prodRouter.post("/:_id/idv-session/v3", createIdvSessionV3);
prodRouter.get("/:_id/set-idv-provider/:idvProvider", setIdvProvider);
// These refund endpoints are old, for when we charged for sessions rather than for SBTs.
// prodRouter.post("/:_id/idv-session/refund", refund);
// prodRouter.post("/:_id/idv-session/refund/v2", refundV2);
prodRouter.post("/:_id/idv-session/onfido/token", refreshOnfidoTokenProd);
prodRouter.post("/:_id/idv-session/onfido/check", createOnfidoCheckEndpointProd);
prodRouter.post("/:_id/idv-session/sumsub/token", refreshSumsubTokenProd);
prodRouter.get("/", getSessionsProd);

const sandboxRouter = express.Router();

sandboxRouter.post("/v2", postSessionV2Sandbox);
sandboxRouter.post("/:_id/idv-session/onfido/token", refreshOnfidoTokenSandbox);
sandboxRouter.post("/:_id/idv-session/onfido/check", createOnfidoCheckEndpointSandbox);
sandboxRouter.post("/:_id/idv-session/sumsub/token", refreshSumsubTokenSandbox);
sandboxRouter.get("/", getSessionsSandbox);

export default prodRouter;
export { sandboxRouter };