import express from "express";
import {
  postSessionV2,
  getSessions,
} from "../services/biometrics-sessions/endpoints.js";

const router = express.Router();

router.post("/v2", postSessionV2);
router.get("/", getSessions);

export default router;
