import { Request, Response } from "express";
import { ObjectId } from "mongodb";

import { DVCustomer, DVOrder } from "../../../init.js";

export async function createOrder(req: Request, res: Response) {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || (apiKey !== process.env.DIRECT_VERIFICATION_API_KEY)) {
    return res.status(401).json({ error: "Invalid API key." });
  }

  const customerId = req.body.customerId
  const numCredits = req.body.credits
  // const paymentDetails = req.body.paymentDetails

  let oid = null;
  try {
    oid = new ObjectId(customerId);
  } catch (err) {
    return res.status(400).json({ error: "Invalid sid" })
  }

  const customer = await DVCustomer.findOne({ _id: oid })

  if (!customer) {
    return res.status(400).json({ error: "Customer not found" })
  }

  if (!numCredits) {
    return res.status(400).json({ error: "Credits must be a number greater than 0" })
  }

  const newOrder = new DVOrder({
    customerId: customer._id,
    credits: Number(numCredits),
    // paymentDetails
  })

  await newOrder.save()

  return res.status(200).json({
    message: "success",
    orderId: newOrder._id,
  })
}
