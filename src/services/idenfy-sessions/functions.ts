import { Types } from "mongoose";
import { pinoOptions, logger } from "../../utils/logger.js";
import {
  IIdenfySession,
  ISandboxIdenfySession,
  SandboxVsLiveKYCRouteHandlerConfig,
} from "../../types.js";
import { createIdenfyToken } from "../idenfy/token.js";
import { fetchIdenfyStatus } from "../idenfy/status.js";

const idenfySessionLogger = logger.child({
  msgPrefix: "[iDenfy Sessions] ",
  base: {
    ...pinoOptions.base,
    service: "idenfy-sessions",
  },
});

/**
 * Create a new iDenfy session: calls iDenfy's `/api/v2/token` and persists the
 * returned authToken + scanRef as a standalone IIdenfySession row.
 *
 * Internal-only — NOT exposed as an HTTP route. Only flow session creation
 * endpoints (sessions/v3, future aml-sessions/v3) call this.
 */
export async function createIdenfySession(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  sigDigest: string,
  flowType: "gov-id" | "clean-hands",
  flowSessionId: Types.ObjectId
): Promise<IIdenfySession | ISandboxIdenfySession> {
  const tokenData = await createIdenfyToken({
    clientId: flowSessionId.toString(),
    sandbox: config.environment === "sandbox",
  });

  const idenfySession = new config.IdenfySessionModel({
    sigDigest,
    idenfyAuthToken: tokenData.authToken,
    idenfyScanRef: tokenData.scanRef,
    status: "in_progress",
    createdByFlow: flowType,
    createdBySessionId: flowSessionId,
    createdAt: new Date(),
  });
  await idenfySession.save();

  idenfySessionLogger.info(
    {
      idenfySessionId: idenfySession._id,
      flowType,
      idenfyScanRef: tokenData.scanRef,
    },
    "Created iDenfy session"
  );

  return idenfySession.toObject();
}

/**
 * Find a reusable iDenfy session: same sigDigest, status complete,
 * idenfyVerificationStatus APPROVED, created within the last 5 days.
 */
export async function findReusableIdenfySession(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  sigDigest: string
): Promise<(IIdenfySession | ISandboxIdenfySession) | null> {
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  const session = await config.IdenfySessionModel.findOne({
    sigDigest,
    status: "complete",
    idenfyVerificationStatus: "APPROVED",
    createdAt: { $gte: fiveDaysAgo },
  })
    .sort({ createdAt: -1 })
    .exec();

  return session ? session.toObject() : null;
}

/**
 * Simple lookup by ID.
 */
export async function getIdenfySessionById(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  id: string | Types.ObjectId
) {
  return config.IdenfySessionModel.findById(id).exec();
}

/**
 * Resolve the verification status for an iDenfy session.
 *
 * If `idenfyVerificationStatus` is already populated (webhook fired), returns
 * the existing fields. Otherwise polls iDenfy's `/api/v2/status` with the
 * persisted scanRef, mirrors the result onto the row, and returns the updated
 * fields. Used as a webhook fallback for environments where iDenfy can't call
 * back to us (e.g. localhost dev).
 */
export async function getIdenfyStatusForSession(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  idenfySession: IIdenfySession | ISandboxIdenfySession | null | undefined
) {
  if (!idenfySession) return null;

  if (idenfySession.idenfyVerificationStatus) {
    return idenfySession;
  }

  if (!idenfySession.idenfyScanRef) {
    return idenfySession;
  }

  try {
    const data = await fetchIdenfyStatus({
      scanRef: idenfySession.idenfyScanRef,
      sandbox: config.environment === "sandbox",
    });
    if (data.status) {
      const update: Record<string, unknown> = {
        idenfyVerificationStatus: data.status,
      };
      if (data.status === "APPROVED") update.status = "complete";
      else if (
        data.status === "DENIED" ||
        data.status === "SUSPECTED" ||
        data.status === "EXPIRED"
      ) {
        update.status = "failed";
      }

      await config.IdenfySessionModel.updateOne(
        { _id: idenfySession._id },
        { $set: update }
      );

      return {
        ...idenfySession,
        ...update,
      } as IIdenfySession | ISandboxIdenfySession;
    }
  } catch (err: any) {
    idenfySessionLogger.warn(
      {
        idenfySessionId: idenfySession._id,
        scanRef: idenfySession.idenfyScanRef,
        error: err?.message,
      },
      "iDenfy /api/v2/status fallback poll failed — returning unpopulated status"
    );
  }

  return idenfySession;
}
