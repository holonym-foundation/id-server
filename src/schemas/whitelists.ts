import mongoose from "mongoose";
import dotenv from "dotenv";
import {
  IHumanIDPaymentGateWhitelist,
  ICleanHandsSessionWhitelist,
  ISessionRetryWhitelist
} from "../types.js";
dotenv.config();

const { Schema } = mongoose;
if (process.env.ENVIRONMENT == "dev") mongoose.set("debug", true);

export const HumanIDPaymentGateWhitelistSchema = new Schema<
  IHumanIDPaymentGateWhitelist
>({
  address: { type: String, required: true },
  // e.g., 'Sui' or '0xa'
  chain: { type: String, required: true },
  // The reason this address is on the Human ID payment gate whitelist
  reason: { type: String, required: true }
});

export const CleanHandsSessionWhitelistSchema = new Schema<
  ICleanHandsSessionWhitelist
>({
  sessionId: { type: String, required: true },
  reason: { type: String, required: true }
});

export const SessionRetryWhitelistSchema = new Schema<
  ISessionRetryWhitelist
>({
  address: { type: String, required: true },
  tier: { type: Number, required: true, enum: [0, 1, 2] }
});
