import { randomBytes } from "crypto";
import { Request, Response } from "express";

import { DVCustomer, DVAPIKey } from "../../../init.js";

export async function createCustomer(req: Request, res: Response) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey || (apiKey !== process.env.DIRECT_VERIFICATION_API_KEY)) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const name = req.body.name

    const pattern = /^[A-Za-z]+$/

    if (!name || !pattern.test(name)) {
      return res.status(400).json({
        error: 'name is required and must consist of letters in the English alphabet'
      })
    }

    const existingDoc = await DVCustomer.findOne({ name })

    if (existingDoc) {
      return res.status(400).json({
        error: "A customer with this name already exists"
      })
    }

    // Create the customer and an API key for them

    const newCustomer = new DVCustomer({
      name,
    })

    const newApiKey = new DVAPIKey({
      customerId: newCustomer._id,
      key: randomBytes(24).toString('hex'),
    })

    await newCustomer.save()
    await newApiKey.save()

    return res.status(200).json({
      message: "success",
      customerId: newCustomer._id,
      apiKey: newApiKey._id,
    })
  } catch (err) {
    console.log(err)
    return res.status(500).json({ error: "Internal server error" })
  }
}

export async function getCustomers(req: Request, res: Response) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey || (apiKey !== process.env.DIRECT_VERIFICATION_API_KEY)) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const customers = await DVCustomer.find({})

    return res.status(200).json({
      message: "success",
      customers,
    })
  } catch (err) {
    console.log(err)
    return res.status(500).json({ error: "Internal server error" })
  }
}

