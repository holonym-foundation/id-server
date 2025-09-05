import mongoose from "mongoose";
import dotenv from "dotenv";
import {
  DirectVerification
} from "../types.js";
import {
  directVerificationSessionStatusEnum as dvStatuses
} from "../constants/misc.js"
dotenv.config();

const { Schema } = mongoose;
if (process.env.ENVIRONMENT == "dev") mongoose.set("debug", true);

export const CustomerSchema = new Schema<DirectVerification.ICustomer>({
  name: { type: String, required: true, unique: true },
});

export const APIKeySchema = new Schema<DirectVerification.IAPIKey>({
  customerId: { type: Schema.Types.ObjectId, required: true },
  key: { type: String, required: true, unique: true, index: true }
});

export const OrderSchema = new Schema<DirectVerification.IOrder>({
  customerId: { type: Schema.Types.ObjectId, required: true },
  credits: { type: Number, required: true }
});

export const SessionSchema = new Schema<DirectVerification.ISession>({
  customerId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  status: { 
    type: String, 
    enum: Object.values(dvStatuses),
    required: true 
  }
});
