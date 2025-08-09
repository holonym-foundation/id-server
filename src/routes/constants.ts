import express from "express";
import {
  getActionIdFromCampaignId,
  getWorkflowIdFromCampaignId,
} from "../services/constants.js";

const router = express.Router();

router.get("/:campaignId/actionId", getActionIdFromCampaignId);
router.get("/:campaignId/workflowId", getWorkflowIdFromCampaignId);

export default router;