import express from "express";
import { getProofMetadata, postProofMetadata } from "../services/proof-metadata.js";

const router = express.Router();

router.get("/", getProofMetadata);
router.post("/", postProofMetadata);

export default router;
