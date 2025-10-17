import mongoose from "mongoose";
import dotenv from "dotenv";
import { IOrder } from "../types.js";
dotenv.config();

const { Schema } = mongoose;
if (process.env.ENVIRONMENT == "dev") mongoose.set("debug", true);

export const OrderSchema = new Schema<IOrder>({
  holoUserId: { type: String, required: true },
  externalOrderId: { type: String, required: true },
  category: { type: String, required: true },
  fulfilled: { type: Boolean, default: false,required: true },
  fulfillmentReceipt: {
    type: String,
    required: false
  },

  // For EVM payments
  txHash: { type: String, required: false },
  chainId: { type: Number, required: false },

  // For EVM payments
  refunded: { type: Boolean, default: false },
  refundTxHash: { type: String, required: false },

  // For Stellar payments
  stellar: {
    type: {
      txHash: String,
      refundTxHash: {
        type: String,
        required: false
      }
    },
    required: false
  },

  // For Sui payments
  sui: {
    type: {
      txHash: String,
      refundTxHash: {
        type: String,
        required: false
      }
    },
    required: false
  }

  // createdAt: { type: Date, default: Date.now },
  // updatedAt: { type: Date, default: Date.now },
});
OrderSchema.index({ externalOrderId: 1 })
OrderSchema.index({ txHash: 1 })
