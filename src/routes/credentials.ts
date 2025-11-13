import express from "express";
import { getCredentials, postCredentials } from "../services/credentials.js";
import {
  getCredentialsProd as getCredentialsV2Prod,
  getCredentialsSandbox as getCredentialsV2Sandbox,
  putPhoneCredentialsProd,
  putPhoneCredentialsSandbox,
  putGovIdCredentialsProd,
  putGovIdCredentialsSandbox,
  putCleanHandsCredentialsProd,
  putCleanHandsCredentialsSandbox,
  putBiometricsCredentialsProd,
  putBiometricsCredentialsSandbox,
  putBiometricsAllowSybilsCredentialsProd,
  putBiometricsAllowSybilsCredentialsSandbox,
} from "../services/credentials-v2.js";

const router = express.Router();

// Routes for accessing & modifying database containing user's encrypted credentials
router.get("/", getCredentials);
router.post("/", postCredentials);
router.get("/v2", getCredentialsV2Prod);
router.put("/v2/phone", putPhoneCredentialsProd);
router.put("/v2/gov-id", putGovIdCredentialsProd);
router.put("/v2/clean-hands", putCleanHandsCredentialsProd);
router.put("/v2/biometrics", putBiometricsCredentialsProd);
router.put("/v2/biometrics-allow-sybils", putBiometricsAllowSybilsCredentialsProd);

const sandboxRouter = express.Router();
sandboxRouter.get("/v2", getCredentialsV2Sandbox);
sandboxRouter.put("/v2/phone", putPhoneCredentialsSandbox);
sandboxRouter.put("/v2/gov-id", putGovIdCredentialsSandbox);
sandboxRouter.put("/v2/clean-hands", putCleanHandsCredentialsSandbox);
sandboxRouter.put("/v2/biometrics", putBiometricsCredentialsSandbox);
sandboxRouter.put("/v2/biometrics-allow-sybils", putBiometricsAllowSybilsCredentialsSandbox);

export default router;
export { sandboxRouter };
