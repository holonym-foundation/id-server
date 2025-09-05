import { Request, Response } from "express"
import { ObjectId } from "mongodb";

import { DVSession } from "../../init.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { SSE_NAMESPACE } from "./constants.js";
import {
  directVerificationSessionStatusEnum as dvStatuses
} from "../../constants/misc.js"
import { customerFromAPIKey, validateCustomerCreditUsage } from "./functions.js"

export async function createSession(req: Request, res: Response) {
  try {
    // TODO: Improve handling of errors thrown by customerFromAPIKey.
    const customer = await customerFromAPIKey(req)

    // TODO: Improve handling of errors thrown by validateCustomerCreditUsage
    await validateCustomerCreditUsage(customer)

    // TODO: Should we have any rate limiting or validation here?
    
    const userId = req.body.userId

    // User ID must be a string with letters, numbers, and dashes
    if (!/^[a-zA-Z0-9-]+$/.test(userId)) {
      throw new Error("Invalid user ID. Must be a string with letters, numbers, and dashes")
    }

    const newSession = new DVSession({
      customerId: customer._id,
      userId,
      status: dvStatuses.IN_PROGRESS
    })

    await newSession.save()

    return res.status(200).json({
      _id: newSession._id,
      userId: newSession.userId,
      status: newSession.status
    })
  } catch (err) {
    console.log(err)
    return res.status(500).json({ error: 'Unexpected error' })
  }
}
