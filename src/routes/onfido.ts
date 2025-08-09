import express from "express";
import { createApplicant } from "../services/onfido/applicant.js";
import { v1CreateCheck, v2CreateCheck } from "../services/onfido/check.js";
import { getCredentials, getCredentialsV2, getCredentialsV3 } from "../services/onfido/credentials.js";

const router = express.Router();

// TODO: Remove the following 3 endpoints once pay-first frontend is live
router.post("/applicant", createApplicant);
router.post("/check", v1CreateCheck);
router.post("/v2/check", v2CreateCheck);

router.get("/credentials", getCredentials);
router.get("/credentials/v2/:nullifier", getCredentialsV2);
router.get("/credentials/v3/:_id/:nullifier", getCredentialsV3);

export default router;
