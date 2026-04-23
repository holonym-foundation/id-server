import express from "express";
import {
  postZkPassportOffChainAttestationProd,
  postZkPassportOffChainAttestationSandbox,
  getZkPassportOffChainAttestationProd,
  getZkPassportOffChainAttestationSandbox,
} from "../services/zk-passport/off-chain-attestation.js";

const prodRouter = express.Router();

prodRouter.post("/zk-passport", postZkPassportOffChainAttestationProd);
prodRouter.get("/zk-passport", getZkPassportOffChainAttestationProd);

const sandboxRouter = express.Router();

sandboxRouter.post("/zk-passport", postZkPassportOffChainAttestationSandbox);
sandboxRouter.get("/zk-passport", getZkPassportOffChainAttestationSandbox);

export default prodRouter;
export { sandboxRouter };
