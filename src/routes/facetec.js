import express from "express";
import { sseUpdates } from "../services/facetec/shared/sse-updates.js";
import { sessionToken } from "../services/facetec/shared/session-token.js";
import { enrollment3d } from "../services/facetec/enrollment-3d.js";
import { match3d2dIdScan } from "../services/facetec/match-3d-2d-idscan.js";
import { testOCRDateParsing } from "../services/facetec/shared/functions-date.js";
import { getCredentialsV3 } from "../services/facetec/credentials.js";
import { getCredentialsAllowSybils } from "../services/facetec/allow-sybils/credentials.js";
import { enrollment3dAllowSybils } from "../services/facetec/allow-sybils/enrollment-3d.js";
import { getProductionEncryptionKeyText } from "../services/facetec/shared/encryption-key.js";
import { processRequest } from "../services/facetec/v2/no-sybils/process-request.js";
import { getCredentials } from "../services/facetec/v2/no-sybils/credentials.js";

const router = express.Router();

router.get("/test-ocr-date-parsing", testOCRDateParsing);
router.get("/sse-updates/:sid", sseUpdates);
router.post("/session-token", sessionToken);

// enrollment-3d is for facetec face scan
router.post("/enrollment-3d", enrollment3d);

// match-3d-2d-idscan is for facetec id scan (id scan comes after face scan for KYC flow)
// DONE - it is handled server side, for both 1-sided ID and 2-sided ID
// TODO: FaceTec: /match-3d-2d-idscan is called 3 times--once for front of ID,
// once for back of ID, and once when user confirms their details. 
// We should remove the details confirmation step.
router.post("/match-3d-2d-idscan/:nullifier", match3d2dIdScan);

// this endpoint is not longer used directly
// its functions are used from /match-3d-2d-idscan when isReadyForUserConfirmation is true
// match-3d-2d-idscan-and-get-creds.js is renamed to functions-creds.js
// router.post("/match-3d-2d-idscan-and-get-creds/:nullifier", match3d2dIdScanAndGetCreds);

router.get("/credentials/v3/:_id/:nullifier/:sessionType", getCredentialsV3);

router.post("/allow-sybils/enrollment-3d", enrollment3dAllowSybils);
router.get("/allow-sybils/credentials/v3/:_id/:nullifier/:sessionType", getCredentialsAllowSybils);

router.get("/production-encryption-key-text", getProductionEncryptionKeyText);

router.post("/v2/no-sybils/process-request", processRequest);
router.get("/v2/no-sybils/credentials/:_id/:nullifier", getCredentials);


export default router;
