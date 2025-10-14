import { Request, Response } from "express";
import { IDVSessions } from "../../init.js";

/**
 * Debug endpoint to look up session details by check_id or report_id
 * Usage: GET /onfido/webhooks/debug?check_id=xxx OR ?report_id=xxx
 */
export async function debugOnfidoSession(req: Request, res: Response) {
  try {
    const { check_id, report_id } = req.query;

    if (!check_id && !report_id) {
      return res.status(400).json({
        error: "Missing required parameter",
        message: "Provide either check_id or report_id query parameter",
        example: "/onfido/webhooks/debug?check_id=abc123 or ?report_id=def456"
      });
    }

    let session = null;
    let searchType = "";

    if (check_id) {
      // Search by check_id
      session = await IDVSessions.findOne({
        "onfido.checks.check_id": check_id,
      }).exec();
      searchType = "check_id";
    } else if (report_id) {
      // Search by report_id
      session = await IDVSessions.findOne({
        "onfido.checks.report_ids": report_id,
      }).exec();
      searchType = "report_id";
    }

    if (!session) {
      return res.status(404).json({
        error: "Session not found",
        searchType,
        searchValue: check_id || report_id,
        message: "No session found with the provided identifier"
      });
    }

    // Find the specific check that matches our search
    let matchingCheck = null;
    if (check_id) {
      matchingCheck = session.onfido?.checks?.find(
        (c: any) => c.check_id === check_id
      );
    } else if (report_id) {
      matchingCheck = session.onfido?.checks?.find(
        (c: any) => c.report_ids?.includes(report_id)
      );
    }

    // Calculate report completion status
    const reportCompletionStatus = matchingCheck ? {
      total_reports: matchingCheck.report_ids?.length || 0,
      completed_reports: matchingCheck.completed_reports?.length || 0,
      pending_reports: (matchingCheck.report_ids?.length || 0) - (matchingCheck.completed_reports?.length || 0),
      completed_report_ids: matchingCheck.completed_reports || [],
      pending_report_ids: matchingCheck.report_ids?.filter(
        (id: string) => !matchingCheck.completed_reports?.includes(id)
      ) || []
    } : null;

    const debugInfo = {
      session: {
        _id: session._id,
      },
      search: {
        type: searchType,
        value: check_id || report_id
      },
      onfido: {
        total_checks: session.onfido?.checks?.length || 0,
        matching_check: matchingCheck ? {
          check_id: matchingCheck.check_id,
          status: matchingCheck.status,
          result: matchingCheck.result,
          report_ids: matchingCheck.report_ids,
          completed_reports: matchingCheck.completed_reports,
          webhookReceivedAt: matchingCheck.webhookReceivedAt,
          lastPolledAt: matchingCheck.lastPolledAt,
          createdAt: matchingCheck.createdAt
        } : null,
        all_checks: session.onfido?.checks?.map((c: any) => ({
          check_id: c.check_id,
          status: c.status,
          result: c.result,
          report_count: c.report_ids?.length || 0,
          completed_count: c.completed_reports?.length || 0,
          createdAt: c.createdAt
        })) || []
      },
      report_completion: reportCompletionStatus
    };

    res.status(200).json(debugInfo);

  } catch (err) {
    
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to retrieve session debug information"
    });
  }
}
