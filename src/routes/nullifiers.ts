import express from "express";
import {
  getNullifiersProd,
  getNullifiersSandbox,
  putGovIdNullifierProd,
  putGovIdNullifierSandbox,
  putPhoneNullifierProd,
  putPhoneNullifierSandbox,
  putCleanHandsNullifierProd,
  putCleanHandsNullifierSandbox,
  putBiometricsNullifierProd,
  putBiometricsNullifierSandbox,
  putZkPassportNullifierProd,
  putZkPassportNullifierSandbox,
} from "../services/nullifiers.js";

const prodRouter = express.Router();

// Routes for accessing & modifying database containing user's encrypted nullifiers
prodRouter.get("/", getNullifiersProd);
prodRouter.put("/gov-id", putGovIdNullifierProd);
prodRouter.put("/phone", putPhoneNullifierProd);
prodRouter.put("/clean-hands", putCleanHandsNullifierProd);
prodRouter.put("/biometrics", putBiometricsNullifierProd);
prodRouter.put("/zk-passport", putZkPassportNullifierProd);

const sandboxRouter = express.Router();
sandboxRouter.get("/", getNullifiersSandbox);
sandboxRouter.put("/gov-id", putGovIdNullifierSandbox);
sandboxRouter.put("/phone", putPhoneNullifierSandbox);
sandboxRouter.put("/clean-hands", putCleanHandsNullifierSandbox);
sandboxRouter.put("/biometrics", putBiometricsNullifierSandbox);
sandboxRouter.put("/zk-passport", putZkPassportNullifierSandbox);

export default prodRouter;
export { sandboxRouter };
