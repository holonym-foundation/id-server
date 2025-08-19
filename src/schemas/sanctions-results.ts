import mongoose from "mongoose";
import dotenv from "dotenv";
import { ISanctionsResult } from "@/types.js";
dotenv.config();

const { Schema } = mongoose;
if (process.env.ENVIRONMENT == "dev") mongoose.set("debug", true);

export const SanctionsResultSchema = new Schema<ISanctionsResult>({
  message: { type: String, required: true },
  // From sanctions io
  data_source: {
    type: {
      short_name: String,
      long_name: String
    },
    required: false
  },
  nationality: {
    type: [String],
    required: false
  },
  confidence_score: { type: String, required: false },
  si_identifier: { type: String, required: false },
});
