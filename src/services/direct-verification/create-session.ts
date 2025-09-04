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

    // User ID must be a valid ObjectId
    let oid = null;
    try {
      oid = new ObjectId(userId);
    } catch (err) {
      return res.status(400).json({ error: "Invalid user ID" })
    }

    const newSession = new DVSession({
      customerId: customer._id,
      userId: oid,
      status: dvStatuses.IN_PROGRESS
    })

    await newSession.save()

    return res.status(200).json({
      _id: newSession._id,
      userId: newSession.userId,
      status: newSession.status
    })
  } catch (err) {
    return res.status(500).json({ error: 'Unexpected error' })
  }
}
