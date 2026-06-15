import { Types } from "mongoose";
import { TimeUnit } from "@valkey/valkey-glide";
import { pinoOptions, logger } from "../../utils/logger.js";
import {
  IIdenfySession,
  ISandboxIdenfySession,
  IdenfySessionView,
  SandboxVsLiveKYCRouteHandlerConfig,
} from "../../types.js";
import { createIdenfyToken } from "../idenfy/token.js";
import { fetchIdenfyStatus } from "../idenfy/status.js";
import { valkeyClient } from "../../utils/valkey-glide.js";

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

// Max number of fresh iDenfy sessions we will mint for a single IdenfySession row
// after EXPIRED. iDenfy bills per session ("each session consumes a verification
// credit"), so this bounds cost/abuse. Beyond the cap we stop re-creating and
// surface EXPIRED (the existing dead-end UI + manual support path).
const IDENFY_RECREATE_CAP = 10;

// TTL for the Valkey lock that serializes the iDenfy token API call across
// concurrent pollers. Long enough to cover the /api/v2/token request (10s
// timeout) + the row update, short enough to auto-release if a process dies
// mid-mint.
const IDENFY_RECREATE_LOCK_TTL_SECONDS = 30;

function idenfyRecreateLockKey(
  idenfySessionId: string | Types.ObjectId,
  environment: "sandbox" | "live"
): string {
  const prefix = environment === "sandbox" ? "sandbox:" : "";
  return `${prefix}idenfy:recreate-lock:${idenfySessionId}`;
}

/**
 * Atomically attempt to acquire the per-row iDenfy re-creation lock. Returns
 * true if acquired, false if another caller already holds it. Mirrors the
 * SET-NX pattern used by tryAcquireRedemptionPending. Acquired ONLY around the
 * iDenfy token API call — never for plain status reads.
 */
export async function tryAcquireIdenfyRecreateLock(
  idenfySessionId: string | Types.ObjectId,
  environment: "sandbox" | "live"
): Promise<boolean> {
  if (!valkeyClient) {
    throw new Error("Valkey client not initialized");
  }
  const key = idenfyRecreateLockKey(idenfySessionId, environment);
  const result = await valkeyClient.set(key, "1", {
    conditionalSet: "onlyIfDoesNotExist",
    expiry: { type: TimeUnit.Seconds, count: IDENFY_RECREATE_LOCK_TTL_SECONDS },
  });
  return result !== null;
}

/**
 * Release the per-row iDenfy re-creation lock.
 */
export async function releaseIdenfyRecreateLock(
  idenfySessionId: string | Types.ObjectId,
  environment: "sandbox" | "live"
): Promise<void> {
  if (!valkeyClient) {
    throw new Error("Valkey client not initialized");
  }
  const key = idenfyRecreateLockKey(idenfySessionId, environment);
  await valkeyClient.del([key]);
}

// iDenfy reports these as a final, non-recoverable decision on /api/v2/status
// (and webhook). They are cached and returned as-is. EXPIRED is deliberately
// NOT in this set: it is recoverable (the token's session window lapsed before
// the user finished), so it routes into recreateExpiredIdenfySession instead.
// Anything else (ACTIVE, REVIEWING, null) is in-progress — keep polling.
const IDENFY_TERMINAL_STATUSES = new Set([
  "APPROVED",
  "DENIED",
  "SUSPECTED",
]);

/**
 * Mint a fresh iDenfy session for a row whose previous session EXPIRED, reusing
 * the same parent flow session (clientId = createdBySessionId) so the user does
 * NOT pay again. The fresh authToken/scanRef overwrite the row in place and the
 * status resets to in_progress; recreationCount is incremented.
 *
 * Anti-flash contract — this NEVER returns EXPIRED while re-creation is viable,
 * because the frontend's `expired` flag is sticky and one EXPIRED response would
 * dead-end the page:
 *   - recreationCount >= cap        -> return EXPIRED (genuine give-up)
 *   - lock acquired + mint ok       -> return fresh row (in_progress, new token)
 *   - lock acquired + iDenfy error  -> return EXPIRED (actionable fallback)
 *   - lock NOT acquired (peer mint) -> re-read; return fresh if refreshed, else
 *                                      return a pending status with the stale
 *                                      token withheld so the frontend keeps
 *                                      polling (never EXPIRED).
 *
 * The Valkey lock is held ONLY around the iDenfy token API call so concurrent
 * pollers (the host verify page and the external popup poll independently) mint
 * at most one fresh session per expiry under normal timing.
 */
async function recreateExpiredIdenfySession(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  idenfySession: IIdenfySession | ISandboxIdenfySession
): Promise<IdenfySessionView> {
  const env = config.environment;
  const id = idenfySession._id!;
  const currentCount = idenfySession.recreationCount ?? 0;

  // Pending shape returned when we must withhold the stale token (lock-miss or
  // a row that moved under us). Frontend treats null status as "preparing".
  const pending = (
    base: IIdenfySession | ISandboxIdenfySession
  ): IdenfySessionView =>
    ({
      ...base,
      idenfyVerificationStatus: null,
      verificationFailureReason: null,
      idenfyAuthToken: null,
      idenfyScanRef: null,
    }) as IdenfySessionView;

  // Cap reached — stop minting, surface EXPIRED (existing dead-end UI).
  if (currentCount >= IDENFY_RECREATE_CAP) {
    idenfySessionLogger.info(
      { idenfySessionId: id, recreationCount: currentCount },
      "iDenfy recreate cap reached — returning EXPIRED"
    );
    return {
      ...idenfySession,
      idenfyVerificationStatus: "EXPIRED",
    } as IdenfySessionView;
  }

  const acquired = await tryAcquireIdenfyRecreateLock(id, env);

  if (!acquired) {
    // A peer poller is re-creating. Re-read the row: return it if already
    // refreshed; otherwise return a pending status with the stale (expired)
    // token withheld so the frontend shows "Preparing verification…" instead
    // of flashing the sticky expired screen.
    const refreshed = await getIdenfySessionById(config, id);
    const refreshedObj = (refreshed ? refreshed.toObject() : idenfySession) as
      | IIdenfySession
      | ISandboxIdenfySession;

    if (
      refreshedObj.idenfyVerificationStatus !== "EXPIRED" &&
      refreshedObj.status === "in_progress"
    ) {
      return refreshedObj;
    }

    return pending(refreshedObj);
  }

  try {
    const tokenData = await createIdenfyToken({
      clientId: idenfySession.createdBySessionId.toString(),
      sandbox: env === "sandbox",
    });

    const update: Partial<IdenfySessionView> = {
      idenfyAuthToken: tokenData.authToken,
      idenfyScanRef: tokenData.scanRef,
      status: "in_progress",
      idenfyVerificationStatus: null,
      verificationFailureReason: null,
    };

    // Conditional on the OLD scanRef so a concurrent webhook write for the
    // expired session can't be clobbered ambiguously — we only update the row
    // we actually read.
    const updateRes = await config.IdenfySessionModel.updateOne(
      { _id: id, idenfyScanRef: idenfySession.idenfyScanRef },
      { $set: update, $inc: { recreationCount: 1 } }
    );

    // The row moved under us between read and write — e.g. the lock TTL expired
    // mid-mint and a second poller already persisted a fresh session. Our
    // just-minted token was never recorded (its webhook would 404), so do NOT
    // return it as success. Return whatever actually landed in the DB instead.
    if (updateRes.matchedCount === 0) {
      idenfySessionLogger.warn(
        { idenfySessionId: id, oldScanRef: idenfySession.idenfyScanRef },
        "iDenfy re-mint matched no row (concurrent re-mint?) — returning persisted state, not the orphaned token"
      );
      const persisted = await getIdenfySessionById(config, id);
      return persisted
        ? (persisted.toObject() as IdenfySessionView)
        : pending(idenfySession);
    }

    idenfySessionLogger.info(
      {
        idenfySessionId: id,
        newScanRef: tokenData.scanRef,
        recreationCount: currentCount + 1,
      },
      "Recreated expired iDenfy session"
    );

    return {
      ...idenfySession,
      ...update,
      recreationCount: currentCount + 1,
    } as IdenfySessionView;
  } catch (err: any) {
    idenfySessionLogger.error(
      { idenfySessionId: id, error: err?.message },
      "iDenfy session re-creation failed — returning EXPIRED"
    );
    return {
      ...idenfySession,
      idenfyVerificationStatus: "EXPIRED",
    } as IdenfySessionView;
  } finally {
    await releaseIdenfyRecreateLock(id, env);
  }
}

/**
 * Resolve the verification status for an iDenfy session.
 *
 * Polls iDenfy's `/api/v2/status` whenever the persisted status is empty OR
 * non-terminal (ACTIVE / REVIEWING). Truly-terminal values
 * (APPROVED/DENIED/SUSPECTED) — set by the webhook or a previous poll — are
 * returned from cache without hitting the API.
 *
 * EXPIRED is recoverable, not terminal: whether it arrives cached (webhook) or
 * from a fresh /api/v2/status poll, it routes into recreateExpiredIdenfySession
 * which mints a fresh iDenfy session for the same (already-paid) parent session.
 */
export async function getIdenfyStatusForSession(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  idenfySession: IIdenfySession | ISandboxIdenfySession | null | undefined
): Promise<IdenfySessionView | null> {
  if (!idenfySession) return null;

  const cachedStatus = idenfySession.idenfyVerificationStatus;

  // Cached truly-terminal status (APPROVED/DENIED/SUSPECTED) — return as-is.
  if (cachedStatus && IDENFY_TERMINAL_STATUSES.has(cachedStatus)) {
    return idenfySession;
  }

  // Cached EXPIRED (e.g. set by the webhook) — recover rather than dead-end.
  if (cachedStatus === "EXPIRED") {
    return recreateExpiredIdenfySession(config, idenfySession);
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
      // Freshly fetched EXPIRED (no webhook fired). Persist the EXPIRED sentinel
      // — verification-status only, NOT status:"failed" — BEFORE recovery so
      // concurrent pollers and the cap short-circuit see authoritative state.
      // Without it, a lock-losing peer would re-read an in_progress row and hand
      // back the stale expired token, and a capped row would re-hit
      // /api/v2/status on every poll.
      if (data.status === "EXPIRED") {
        await config.IdenfySessionModel.updateOne(
          { _id: idenfySession._id },
          { $set: { idenfyVerificationStatus: "EXPIRED" } }
        );
        return recreateExpiredIdenfySession(config, {
          ...idenfySession,
          idenfyVerificationStatus: "EXPIRED",
        } as IIdenfySession | ISandboxIdenfySession);
      }

      const update: Record<string, unknown> = {
        idenfyVerificationStatus: data.status,
      };
      if (data.status === "APPROVED") update.status = "complete";
      else if (data.status === "DENIED" || data.status === "SUSPECTED") {
        update.status = "failed";
      }

      await config.IdenfySessionModel.updateOne(
        { _id: idenfySession._id },
        { $set: update }
      );

      return {
        ...idenfySession,
        ...update,
      } as IdenfySessionView;
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
