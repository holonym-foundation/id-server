import express from "express";
import { getCountry, getIpAndCountry } from "../services/ip-info.js";

const router = express.Router();

router.get("/country", getCountry);
router.get("/ip-and-country", getIpAndCountry);

export default router;
