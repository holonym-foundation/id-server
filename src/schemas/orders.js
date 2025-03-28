import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const { Schema } = mongoose;
if (process.env.ENVIRONMENT == "dev") mongoose.set("debug", true);

export const OrderSchema = new Schema({
    holoUserId: { type: String, required: true },
    externalOrderId: { type: String, required: true },
    category: { type: String, required: true },
    fulfilled: { type: Boolean, default: false,required: true },
    
    txHash: { type: String, required: true },
    chainId: { type: Number, required: true },

    refunded: { type: Boolean, default: false },
    refundTxHash: { type: String },

    // createdAt: { type: Date, default: Date.now },
    // updatedAt: { type: Date, default: Date.now },
});
