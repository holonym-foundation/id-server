import { Request, Response } from "express";
import { Session } from "../../init.js";
import { getOnfidoCheckAsync } from "./get-check-async.js";

/**
 * Debug endpoint to look up session details by check_id
 * Usage: GET /onfido/debug?check_id=xxx
 */
export async function debugOnfidoSession(req: Request, res: Response) {
  try {
    const { check_id } = req.query;

    if (!check_id) {
      return res.status(400).json({
        error: "Missing required parameter",
        message: "Provide either check_id query parameter",
        example: "/onfido/webhooks/debug?check_id=abc123"
      });
    }

    const onfidoAPIKey = process.env.ONFIDO_API_TOKEN!;

    // also debug getOnfidoCheckAsync
    const check = await getOnfidoCheckAsync(onfidoAPIKey, check_id as string);
    console.log("check", check);

    let session = null;

    // Search by check_id in Session collection
    session = await Session.findOne({
      check_id: check_id,
    }).exec();

    if (!session) {
      return res.status(404).json({
        error: "Session not found",
        searchValue: check_id,
        message: "No session found with the provided identifier"
      });
    }

    // Extract creation time from ObjectId
    const createdAt = new Date(parseInt(session._id.toString().substring(0, 8), 16) * 1000);

    const debugInfo = {
      session: {
        _id: session._id,
        check_id: session.check_id,
        check_status: session.check_status,
        check_result: session.check_result,
        check_report_ids: session.check_report_ids,
        check_last_updated_at: session.check_last_updated_at,
        createdAt: createdAt.toISOString(),
        onfido_sdk_token: session.onfido_sdk_token ? "present" : "missing"
      }
    };

    res.status(200).json(debugInfo);

  } catch (err) {
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to retrieve session debug information"
    });
  }
}
