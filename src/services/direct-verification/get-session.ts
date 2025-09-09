import { Request, Response } from "express"
import { ObjectId } from "mongodb";

import { DVSession } from "../../init.js";
import { CustomError } from "../../utils/errors.js";
import { customerFromAPIKey } from "./functions.js"

export async function getSession(req: Request, res: Response) {
  try {
    const customer = await customerFromAPIKey(req)

    // TODO: Should we have any rate limiting or validation here?
    
    const sessionid = req.params.sessionId

    let objectId = null;
    try {
      objectId = new ObjectId(sessionid);
    } catch (err) {
      return res.status(400).json({ error: "Invalid sessionId" })
    }

    const session = await DVSession.findOne({
      sessionId: objectId
    })

    if (!session) {
      return res.status(404).json({ error: "No session found for the provided sessionId" })
    }

    if (session.customerId.toString() !== customer._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to access this session" })
    }

    return res.status(200).json({
      _id: session._id,
      userId: session.userId,
      status: session.status,
      customerId: session.customerId
    })
  } catch (err: any) {
    if (err instanceof CustomError) {
      console.log(err.logMessage)
      return res.status(err.httpStatusCode).json({ error: err.userFacingMessage })
    }
    console.log(err)
    return res.status(500).json({ error: 'Unexpected error' })
  }
}
