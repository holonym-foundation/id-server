import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const { Schema } = mongoose;
if (process.env.ENVIRONMENT == "dev") mongoose.set("debug", true);

const orderSchema = new Schema({
    userId: { type: String, required: true },
    externalOrderId: { type: String, required: true },
    category: { type: String, required: true },
    fulfilled: { type: Boolean, default: false,required: true },
    
    txHash: { type: String, required: true },
    chainId: { type: Number, required: true },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

export { orderSchema };