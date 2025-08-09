import express from "express";
import {
  getNullifiers,
  putGovIdNullifier,
  putPhoneNullifier,
  putCleanHandsNullifier,
  putBiometricsNullifier,
} from "../services/nullifiers.js";

const router = express.Router();

// Routes for accessing & modifying database containing user's encrypted nullifiers
router.get("/", getNullifiers);
router.put("/gov-id", putGovIdNullifier);
router.put("/phone", putPhoneNullifier);
router.put("/clean-hands", putCleanHandsNullifier)
router.put("/biometrics", putBiometricsNullifier)

export default router;
