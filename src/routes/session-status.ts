import express from "express";
import { getSessionStatus, getSessionStatusV2 } from "../services/session-status.js";

const router = express.Router();

router.get("/", getSessionStatus);
router.get("/v2", getSessionStatusV2);

export default router;
