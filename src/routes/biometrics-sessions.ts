import express from "express";
import {
  postSessionV2,
  getSessions,
} from "../services/biometrics-sessions/endpoints.js";
import {
  postSessionV2 as postSessionV2AllowSybils,
  getSessions as getSessionsAllowSybils,
} from "../services/biometrics-sessions/allow-sybils/endpoints.js";

const router = express.Router();

router.post("/v2", postSessionV2);
router.get("/", getSessions);

router.post("/allow-sybils/v2", postSessionV2AllowSybils);
router.get("/allow-sybils/", getSessionsAllowSybils);

export default router;
