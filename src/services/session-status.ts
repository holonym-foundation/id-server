import axios from "axios";
import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { HydratedDocument, Model } from "mongoose";
import { getRouteHandlerConfig } from "../init.js";
import logger from "../utils/logger.js";
import { getVeriffSessionDecision } from "../utils/veriff.js";
// Legacy v1 path: getIdenfySession used to fetch iDenfy state from the
// per-user IDVSessions array. After the iDenfy decoupling refactor (see
// docs/plans/2026-05-01-001-refactor-decouple-idenfy-from-gov-id-flow-plan.md),
// iDenfy state lives on IIdenfySession only. The v1 /session-status endpoint
// is kept for backward compat but its idenfy branch is now a stub.
import { getOnfidoReports } from "../utils/onfido.js";
import { getSumsubApplicantData } from "../utils/sumsub.js";
import { resolveHoloUserId } from "../utils/holo-user-id.js";
import { IIdvSessions, ISandboxSession, ISession, SandboxVsLiveKYCRouteHandlerConfig } from "../types.js";
import { getOnfidoCheckAsync } from "./onfido/get-check-async.js";
import { getOnfidoCheckAsync as getOnfidoCheckAsyncFromService, getOnfidoSessionById } from "./onfido-sessions/functions.js";
import {
  getIdenfySessionById,
  getIdenfyStatusForSession,
} from "./idenfy-sessions/functions.js";

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
  _sessions: HydratedDocument<IIdvSessions> | null
) {
  // Legacy v1 stub. Modern callers must use /session-status/v2 with a session
  // sid; that path reads from the standalone IIdenfySession collection.
  return undefined;
}

// @deprecated - Use getOnfidoCheckAsync instead
// async function getOnfidoCheck(check_id: string) {
//   try {
//     const resp = await axios.get(`https://api.us.onfido.com/v3.6/checks/${check_id}`, {
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Token token=${process.env.ONFIDO_API_TOKEN}`,
//       },
//     });
//     return resp.data;
//   } catch (err: any) {
//     let errToLog = err;
//     // Onfido deletes checks after 30 days. So, if we get a 410, delete the check
//     // from IDVSessions.
//     if (err.response?.status === 410) {
//       errToLog = err.message; // reduces unnecessary verbosity
//       await IDVSessions.findOneAndUpdate(
//         { "onfido.checks.check_id": check_id },
//         {
//           $pull: {
//             "onfido.checks": {
//               check_id,
//             },
//           },
//         }
//       ).exec();
//     }
//     endpointLogger.error(
//       { error: errToLog, check_id },
//       "An error occurred while getting onfido check"
//     );
//   }
// }

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
  SessionModel: Model<ISession | ISandboxSession>,
  onfidoAPIKey: string,
  sessions: HydratedDocument<IIdvSessions> | null
) {
  if (!sessions?.onfido?.checks || sessions.onfido.checks.length === 0) {
    return;
  }

  // Get each check. If one is "complete" (and result is "clear"), return "complete".
  // Otherwise, return the status of the latest check.

  const sessionsWithTimestamps = [];
  for (const sessionMetadata of sessions.onfido.checks) {
    const check = await getOnfidoCheckAsync(SessionModel, onfidoAPIKey, sessionMetadata.check_id as string);
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
    const reports = (await getOnfidoReports(onfidoAPIKey, latestCheck?.report_ids)) ?? [];
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
function createGetSessionStatus(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const sigDigest = resolveHoloUserId(req, req.query.sigDigest);
      const provider = req.query.provider; // not required

      if (!sigDigest) {
        return res.status(400).json({ error: "Missing sigDigest" });
      }

      const sessions = await config.IDVSessionsModel.findOne({ sigDigest }).exec();

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
            .json({ onfido: await getOnfidoSessionStatus(config.SessionModel, config.onfidoAPIKey, sessions) });
        }
      }

      const sessionStatuses = {
        veriff: await getVeriffSessionStatus(sessions),
        idenfy: await getIdenfySessionStatus(sessions),
        onfido: await getOnfidoSessionStatus(config.SessionModel, config.onfidoAPIKey, sessions),
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
}

async function getSessionStatusProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createGetSessionStatus(config)(req, res);
}

async function getSessionStatusSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createGetSessionStatus(config)(req, res);
}

/**
 * ENDPOINT
 */
function createGetSessionStatusV2(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async function getSessionStatusV2(req: Request, res: Response) {
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

      // Gov-id flows live in SessionModel. Clean Hands (AML) sessions live in a
      // separate collection but share the iDenfy status-resolution path (the
      // shared /idenfy/verify page polls this endpoint with the AML session _id
      // for the iDenfy Clean Hands branch). Fall back to the AML collection when
      // the gov-id lookup misses so `provider=idenfy` resolves either kind.
      const ambiguousSession: any =
        (await config.SessionModel.findOne({ _id: objectId }).exec()) ??
        (await config.AMLChecksSessionModel.findOne({ _id: objectId }).exec());

      if (!ambiguousSession) {
        return res.status(404).json({ error: "Session not found" });
      }

      // not required
      // this is to provide direct status query
      // when more than 1 idv sessions are done in 1 session
      const provider = req.query.provider;
      if (provider) ambiguousSession.idvProvider = provider as string;

      if (ambiguousSession.idvProvider === "veriff") {
        const session = ambiguousSession as HydratedDocument<ISession>; // veriff is only in prod
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
      } else if (ambiguousSession.idvProvider === "idenfy") {
        // Read everything from the standalone IIdenfySession via
        // ambiguousSession.idenfySessionId. getIdenfyStatusForSession lazily
        // polls iDenfy's /api/v2/status when the webhook hasn't fired yet.
        if (!ambiguousSession.idenfySessionId) {
          return res.status(200).json({
            idenfy: {
              sid: ambiguousSession._id,
              status: null,
              scanRef: null,
              authToken: null,
            },
          });
        }

        const idenfyDoc = await getIdenfySessionById(
          config,
          ambiguousSession.idenfySessionId
        );
        if (!idenfyDoc) {
          return res.status(404).json({ error: "iDenfy session not found" });
        }

        const resolved = await getIdenfyStatusForSession(
          config,
          idenfyDoc.toObject()
        );

        return res.status(200).json({
          idenfy: {
            sid: ambiguousSession._id,
            status: resolved?.idenfyVerificationStatus ?? null,
            scanRef: resolved?.idenfyScanRef ?? null,
            authToken: resolved?.idenfyAuthToken ?? null,
            failureReason: resolved?.verificationFailureReason ?? undefined,
          },
        });
      } else if (ambiguousSession.idvProvider === "onfido") {
        // If session has onfidoSessionId, use the new standalone service
        if (ambiguousSession.onfidoSessionId) {
          const onfidoSession = await getOnfidoSessionById(config, ambiguousSession.onfidoSessionId);
          if (onfidoSession) {
            const onfidoSessionObj = onfidoSession.toObject();
            if (!onfidoSessionObj.check_id) {
              return res.status(200).json({
                onfido: {
                  sid: ambiguousSession._id,
                  check_id: null,
                },
              });
            }

            const check = await getOnfidoCheckAsyncFromService(config, onfidoSessionObj);
            let failureReason = undefined;
            if (check?.status === "complete" && check?.result === "consider") {
              const reports = (await getOnfidoReports(config.onfidoAPIKey, check?.report_ids)) ?? [];
              failureReason = getOnfidoVerificationFailureReasons(reports);
            }

            return res.status(200).json({
              onfido: {
                sid: ambiguousSession._id,
                status: check?.status,
                result: check?.result,
                check_id: check?.id,
                failureReason,
              },
            });
          }
        }

        // Fallback to existing behavior (reads check data from ISession)
        if (!ambiguousSession.check_id) {
          return res.status(200).json({
            onfido: {
              check_id: ambiguousSession.check_id,
            },
          });
        }

        const check = await getOnfidoCheckAsync(config.SessionModel, config.onfidoAPIKey, ambiguousSession.check_id);
        if (!check) {
          return res.status(404).json({ error: "IDV Session not found" });
        }

        let failureReason = undefined;

        if (check?.status === "complete" && check?.result === "consider") {
          const reports = (await getOnfidoReports(config.onfidoAPIKey, check?.report_ids)) ?? [];
          failureReason = getOnfidoVerificationFailureReasons(reports);
        }

        return res.status(200).json({
          onfido: {
            sid: ambiguousSession._id,
            status: check?.status,
            result: check?.result,
            check_id: ambiguousSession.check_id,
            failureReason,
          },
        });
      } else if (ambiguousSession.idvProvider === "facetec") {
        return res.status(200).json({
          facetec: { // to-do: not actually needed, but check again
            sid: ambiguousSession._id,
            status: null,
          },
        });
      } else if (ambiguousSession.idvProvider === "sumsub") {
        // Fallback: We request the applicant data from the SumSub API until the review
        // is complete
        if (
          ambiguousSession.sumsub_applicant_id &&
          (ambiguousSession.sumsub_review_status !== "completed")
        ) {
          endpointLoggerV2.warn(
            { sid, applicantId: ambiguousSession.sumsub_applicant_id },
            "Sumsub session missing review status — falling back to API poll"
          );

          const applicantData = await getSumsubApplicantData(
            config.environment,
            ambiguousSession.sumsub_applicant_id,
          );

          const reviewAnswer = applicantData?.review?.reviewResult?.reviewAnswer;
          const reviewStatus = applicantData?.review?.reviewStatus;
          if (
            reviewAnswer &&
            // SumSub will sometimes set "reviewAnswer" to "RED" during precheck and then later update it to "GREEN",
            // even though the user passes the check a second or two later.
            // We only want to store the review status when the review is complete.
            reviewStatus === "completed"
          ) {
            ambiguousSession.sumsub_review_status = reviewStatus;
            ambiguousSession.sumsub_review_answer = reviewAnswer;
            ambiguousSession.sumsub_last_updated_at = new Date();

            if (reviewAnswer === "RED") {
              const rejectLabels = applicantData?.review?.reviewResult?.rejectLabels || [];
              const moderationComment = applicantData?.review?.reviewResult?.moderationComment || "";
              ambiguousSession.verificationFailureReason =
                moderationComment || rejectLabels.join(", ") || "Verification rejected";
            }

            await ambiguousSession.save();
          }
        }

        return res.status(200).json({
          sumsub: {
            sid: ambiguousSession._id,
            status: ambiguousSession.sumsub_review_status || null,
            reviewAnswer: ambiguousSession.sumsub_review_answer || null,
            applicantId: ambiguousSession.sumsub_applicant_id || null,
            failureReason: ambiguousSession.verificationFailureReason || undefined,
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
}

async function getSessionStatusV2Prod(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createGetSessionStatusV2(config)(req, res);
}

async function getSessionStatusV2Sandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createGetSessionStatusV2(config)(req, res);
}

export {
  getSessionStatusProd,
  getSessionStatusSandbox,
  getSessionStatusV2Prod,
  getSessionStatusV2Sandbox,
};
