import express from "express";
import {
  storePeanutData,
  getUserHasClaimedNFT,
  getUserHasClaimedNFTByEmail,
} from "../services/silk/galxe-campaign.js";
import {
  storePeanutData as storePeanutMetadataForCampaign,
  getUserHasClaimedNFTByEmail as getUserHasClaimedNFTByEmailForCampaign,
} from "../services/silk/peanut-metadata.js";
const router = express.Router();

router.post("/galxe-campaigns/0/user-peanut-data", storePeanutData);
router.get("/galxe-campaigns/0/user-has-claimed-nft/:address", getUserHasClaimedNFT);
router.get(
  "/galxe-campaigns/0/user-has-claimed-nft/by-email/:email",
  getUserHasClaimedNFTByEmail
);
router.post("/campaigns/peanut-data", storePeanutMetadataForCampaign);
router.get(
  "/campaigns/:campaignId/user-has-claimed-nft/by-email/:email",
  getUserHasClaimedNFTByEmailForCampaign
);

export default router;
