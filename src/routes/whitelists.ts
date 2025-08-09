import express from "express";
import { 
  getHumanIDPaymentgateWhitelistItem
} from "../services/whitelists/endpoints.js";

const router = express.Router();

router.get("/human-id-payment-gate", getHumanIDPaymentgateWhitelistItem);

export default router;
