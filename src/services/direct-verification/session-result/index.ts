import { Request, Response } from "express";

import { DVSession } from "../../../init.js";
import { CustomError } from "../../../utils/errors.js";
import { customerFromAPIKey } from "../functions.js";

export async function getSessionResult(req: Request, res: Response) {
  try {
    const customer = await customerFromAPIKey(req)

    const userId = req.query.userId

    if (typeof userId != 'string') {
      return res.status(400).json({ error: "userId query parameter is required and must be a string" })
    }

    const session = await DVSession.findOne({
      customerId: customer._id,
      userId
    })

    if (!session) {
      return res.status(404).json({ error: "No session found for the provided userId" })
    }

    return res.status(200).json({
      _id: session._id,
      customerId: session.customerId,
      userId: session.userId,
      status: session.status
    })
  } catch (err: any) {
    if (err instanceof CustomError) {
      console.log(err.logMessage)
      return res.status(err.httpStatusCode).json({ error: err.userFacingMessage })
    }
    console.log(err)
    return res.status(500).json({ error: "Internal server error" })
  }
}
