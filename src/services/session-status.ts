import axios from "axios";
import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { HydratedDocument } from "mongoose";
import { Session, IDVSessions } from "../init.js";
import logger from "../utils/logger.js";
import { getVeriffSessionDecision } from "../utils/veriff.js";
import { getIdenfySessionStatus as getIdenfySession } from "../utils/idenfy.js";
import { getOnfidoReports } from "../utils/onfido.js";
import { IIdvSessions } from "../types.js";

const endpointLogger = logger.child({ msgPrefix: "[GET /session-status] " });
const endpointLoggerV2 = logger.child({ msgPrefix: "[GET /session-status/v2] " });

async function getVeriffSessionStatus(
  sessions: HydratedDocument<IIdvSessions> | null
) {
  if (!sessions?.veriff?.sessions || sessions.veriff.sessions.length === 0) {
    return;
  }

  // Get the decision for each session. If one is "Approved", return "Approved".
  // Otherwise, return the status of the latest session.

  const decisionsWithTimestamps = [];
  for (const session of sessions.veriff.sessions) {
    const decision = await getVeriffSessionDecision(session.sessionId as string);
    if (!decision) continue;
    decisionsWithTimestamps.push({
      decision,
      createdAt: session.createdAt ?? new Date(0),
    });
    if (decision?.verification?.status === "approved") {
      return { status: decision?.verification?.status, sessionId: session.sessionId };
    }
  }

  // Find the decision with the most recent createdAt timestamp
  const latestDecision =
    decisionsWithTimestamps.length > 0
      ? decisionsWithTimestamps.reduce((prev, current) =>
          prev.createdAt > current.createdAt ? prev : current
        ).decision
      : null;

  return {
    status: latestDecision?.verification?.status,
    sessionId: latestDecision?.verification?.id,
    // failureReason should be populated with a reason for verification failure
    // iff the verification failed. If verification is in progress, it should be null.
    failureReason: latestDecision?.verification?.reason,
  };
}

async function getIdenfySessionStatus(
  sessions: HydratedDocument<IIdvSessions> | null
) {
  if (!sessions?.idenfy?.sessions || sessions.idenfy.sessions.length === 0) {
    return;
  }

  // Get each session. If one is "APPROVED", return "APPROVED".
  // Otherwise, return the status of the latest session.

  const sessionsWithTimestamps = [];
  for (const sessionMetadata of sessions.idenfy.sessions) {
    const session = await getIdenfySession(sessionMetadata.scanRef as string);
    if (!session) continue;
    sessionsWithTimestamps.push({
      session,
      createdAt: sessionMetadata.createdAt ?? new Date(0),
    });
    if (session?.status === "APPROVED") {
      return { status: session?.status, scanRef: sessionMetadata.scanRef };
    }
  }

  // Find the decision with the most recent createdAt timestamp
  const latestSession =
    sessionsWithTimestamps.length > 0
      ? sessionsWithTimestamps.reduce((prev, current) =>
          prev.createdAt > current.createdAt ? prev : current
        ).session
      : null;

  let failureReason = undefined;
  if (
    (latestSession?.fraudTags ?? []).length > 0 ||
    (latestSession?.mismatchTags ?? []).length > 0 ||
    (latestSession?.manualDocument &&
      latestSession.manualDocument !== "DOC_VALIDATED") ||
    (latestSession?.manualFace && latestSession.manualFace !== "DOC_VALIDATED")
  ) {
    failureReason = {
      fraudTags: latestSession?.fraudTags,
      mismatchTags: latestSession?.mismatchTags,
      manualDocument: latestSession?.manualDocument,
      manualFace: latestSession?.manualFace,
    };
  }

  return {
    status: latestSession?.status,
    scanRef: latestSession?.scanRef,
    // failureReason should be populated with a reason for verification failure
    // iff the verification failed. If verification is in progress, it should be null.
    failureReason,
  };
}

async function getOnfidoCheck(check_id: string) {
  try {
    // ignoring: "Property 'get' does not exist on type 'typeof import(...)"
    // @ts-ignore
    const resp = await axios.get(`https://api.us.onfido.com/v3.6/checks/${check_id}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${process.env.ONFIDO_API_TOKEN}`,
      },
    });
    return resp.data;
  } catch (err: any) {
    let errToLog = err;
    // Onfido deletes checks after 30 days. So, if we get a 410, delete the check
    // from IDVSessions.
    if (err.response?.status === 410) {
      errToLog = err.message; // reduces unnecessary verbosity
      await IDVSessions.findOneAndUpdate(
        { "onfido.checks.check_id": check_id },
        {
          $pull: {
            "onfido.checks": {
              check_id,
            },
          },
        }
      ).exec();
    }
    endpointLogger.error(
      { error: errToLog, check_id },
      "An error occurred while getting onfido check"
    );
  }
}

function getOnfidoVerificationFailureReasons(reports: Array<Record<string, any>>) {
  const failureReasons = [];
  for (const report of reports) {
    if (report.status !== "complete") {
      failureReasons.push(`Report status is '${report.status}'. Expected 'complete'.`);
    }
    for (const majorKey of Object.keys(report.breakdown ?? {})) {
      if (report.breakdown[majorKey]?.result !== "clear") {
        for (const minorkey of Object.keys(
          report.breakdown[majorKey]?.breakdown ?? {}
        )) {
          const minorResult = report.breakdown[majorKey].breakdown[minorkey].result;
          if (minorResult !== null && minorResult !== "clear") {
            failureReasons.push(
              `Result of ${minorkey} in ${majorKey} breakdown is '${minorResult}'. Expected 'clear'.`
            );
          }
        }
      }
    }
  }
  return failureReasons;
}

async function getOnfidoSessionStatus(
  sessions: HydratedDocument<IIdvSessions> | null
) {
  if (!sessions?.onfido?.checks || sessions.onfido.checks.length === 0) {
    return;
  }

  // Get each check. If one is "complete" (and result is "clear"), return "complete".
  // Otherwise, return the status of the latest check.

  const sessionsWithTimestamps = [];
  for (const sessionMetadata of sessions.onfido.checks) {
    const check = await getOnfidoCheck(sessionMetadata.check_id as string);
    if (!check) continue;
    sessionsWithTimestamps.push({
      check,
      createdAt: sessionMetadata.createdAt ?? new Date(0),
    });
    if (check?.status === "complete" && check?.result === "clear") {
      return {
        status: check?.status,
        result: check.result,
        check_id: sessionMetadata.check_id,
      };
    }
  }

  // Find the decision with the most recent createdAt timestamp
  const latestCheck =
    sessionsWithTimestamps.length > 0
      ? sessionsWithTimestamps.reduce((prev, current) =>
          prev.createdAt > current.createdAt ? prev : current
        ).check
      : null;

  let failureReason = undefined;

  if (latestCheck?.status === "complete" && latestCheck?.result === "consider") {
    const reports = (await getOnfidoReports(latestCheck?.report_ids)) ?? [];
    failureReason = getOnfidoVerificationFailureReasons(reports);
  }

  return {
    status: latestCheck?.status,
    result: latestCheck?.result,
    check_id: latestCheck?.check_id,
    // failureReason should be populated with a reason for verification failure
    // iff the verification failed. If verification is in progress, it should be null.
    failureReason,
  };
}

/**
 * ENDPOINT
 */
async function getSessionStatus(req: Request, res: Response) {
  try {
    const sigDigest = req.query.sigDigest;
    const provider = req.query.provider; // not required

    if (!sigDigest) {
      return res.status(400).json({ error: "Missing sigDigest" });
    }

    const sessions = await IDVSessions.findOne({ sigDigest }).exec();

    // If provider is specified, only return the status for that provider. This
    // helps avoid unnecessary API calls.
    if (provider) {
      if (provider === "veriff") {
        return res
          .status(200)
          .json({ veriff: await getVeriffSessionStatus(sessions) });
      } else if (provider === "idenfy") {
        return res
          .status(200)
          .json({ idenfy: await getIdenfySessionStatus(sessions) });
      } else if (provider === "onfido") {
        return res
          .status(200)
          .json({ onfido: await getOnfidoSessionStatus(sessions) });
      }
    }

    const sessionStatuses = {
      veriff: await getVeriffSessionStatus(sessions),
      idenfy: await getIdenfySessionStatus(sessions),
      onfido: await getOnfidoSessionStatus(sessions),
    };

    // console.log("sessionStatuses", sessionStatuses);

    return res.status(200).json(sessionStatuses);
  } catch (err) {
    endpointLogger.error(
      { error: err },
      "An unknown error occurred while retrieving session status"
    );
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT
 */
async function getSessionStatusV2(req: Request, res: Response) {
  try {
    const sid = req.query.sid;

    if (!sid) {
      return res.status(400).json({ error: "Missing sid" });
    }

    let objectId = null;
    try {
      objectId = new ObjectId(sid as string);
    } catch (err) {
      return res.status(400).json({ error: "Invalid sid" });
    }

    const session = await Session.findOne({ _id: objectId }).exec();

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // not required
    // this is to provide direct status query
    // when more than 1 idv sessions are done in 1 session
    const provider = req.query.provider;
    if(provider) session.idvProvider = provider as string;

    if (session.idvProvider === "veriff") {
      if (!session.sessionId) {
        return res.status(200).json({
          veriff: {
            sid: session._id,
            status: null,
            sessionId: null,
          },
        });
      }

      const decision = await getVeriffSessionDecision(session.sessionId);
      if (!decision) {
        return res.status(404).json({ error: "IDV Session not found" });
      }

      return res.status(200).json({
        veriff: {
          sid: session._id,
          status: decision?.verification?.status,
          sessionId: session.sessionId,
          // failureReason should be populated with a reason for verification failure
          // iff the verification failed. If verification is in progress, it should be null.
          failureReason: decision?.verification?.reason,
        },
      });
    } else if (session.idvProvider === "idenfy") {
      if (!session.scanRef) {
        return res.status(200).json({
          idenfy: {
            sid: session._id,
            status: null,
            scanRef: null,
          },
        });
      }

      const idenfySession = await getIdenfySession(session.scanRef);
      if (!idenfySession) {
        return res.status(404).json({ error: "IDV Session not found" });
      }

      let failureReason = undefined;
      if (
        (idenfySession?.fraudTags ?? []).length > 0 ||
        (idenfySession?.mismatchTags ?? []).length > 0 ||
        (idenfySession?.manualDocument &&
          idenfySession.manualDocument !== "DOC_VALIDATED") ||
        (idenfySession?.manualFace && idenfySession.manualFace !== "DOC_VALIDATED")
      ) {
        failureReason = {
          fraudTags: idenfySession?.fraudTags,
          mismatchTags: idenfySession?.mismatchTags,
          manualDocument: idenfySession?.manualDocument,
          manualFace: idenfySession?.manualFace,
        };
      }

      return res.status(200).json({
        idenfy: {
          sid: session._id,
          status: idenfySession?.status,
          scanRef: session.scanRef,
          // failureReason should be populated with a reason for verification failure
          // iff the verification failed. If verification is in progress, it should be null.
          failureReason,
        },
      });
    } else if (session.idvProvider === "onfido") {
      if (!session.check_id) {
        return res.status(200).json({
          onfido: {
            check_id: session.check_id,
          },
        });
      }

      const check = await getOnfidoCheck(session.check_id);
      if (!check) {
        return res.status(404).json({ error: "IDV Session not found" });
      }

      let failureReason = undefined;

      if (check?.status === "complete" && check?.result === "consider") {
        const reports = (await getOnfidoReports(check?.report_ids)) ?? [];
        failureReason = getOnfidoVerificationFailureReasons(reports);
      }

      return res.status(200).json({
        onfido: {
          sid: session._id,
          status: check?.status,
          result: check?.result,
          check_id: session.check_id,
          failureReason,
        },
      });
    } else if (session.idvProvider === "facetec") {
      return res.status(200).json({
        facetec: { // to-do: not actually needed, but check again
          sid: session._id,
          status: null,
        },
      });
    } else {
      return res.status(500).json({ error: "Unknown idvProvider" });
    }
  } catch (err) {
    endpointLoggerV2.error(
      { error: err },
      "An unknown error occurred while retrieving session status"
    );
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { getSessionStatus, getSessionStatusV2 };
