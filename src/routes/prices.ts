import express from "express";
import { getPrice, getPriceV2 } from "../services/prices.js";

const router = express.Router();

router.get("/", getPrice);
router.get("/v2", getPriceV2);

export default router;
