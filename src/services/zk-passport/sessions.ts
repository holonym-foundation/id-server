import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import {
  reserveRedemption,
  completeRedemption,
  cancelRedemption,
  forceRefundPayment,
  PaymentError,
} from "../payments/functions.js";
import {
  PAYMENT_SERVICE_ZK_PASSPORT_VERIFICATION,
  sessionStatusEnum,
} from "../../constants/misc.js";
import { rateLimitByTier } from "../../utils/rate-limiting.js";
import { getRateLimitTier } from "../../utils/whitelist.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { makeUnknownErrorLoggable } from "../../utils/errors.js";
import { getRouteHandlerConfig } from "../../init.js";
import type { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";

const zkPassportSessionsLogger = logger.child({
  base: {
    ...pinoOptions.base,
    feature: "holonym",
    subFeature: "zk-passport-sessions",
  },
});

const MAX_ZK_PASSPORT_SESSIONS_PER_USER = 10;

/**
 * POST /zk-passport/sessions/v2
 *
 * Creates a zkPassport verification session bound to a paid commitment.
 * The session only exists post-payment: `reserveRedemption` validates the
 * onchain payment + acquires the redemption-pending lock, then we insert
 * the session and `completeRedemption`. The session status machine (rather
 * than a reservationToken with 5-minute TTL) becomes the one-verify-per-
 * payment gate downstream. This mirrors the POST /sessions/v3 pattern used
 * by Onfido gov-ID sessions.
 *
 * Body: { holoUserId, paymentSecret, paymentChainId }
 * Returns: { session } with _id as the sid.
 */
function createPostZkPassportSessionV2Handler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    let reservationToken: string | null = null;

    try {
      const holoUserId = req.body?.holoUserId;
      const address = req.body?.address || null;
      const paymentSecret = req.body?.paymentSecret;
      const paymentChainId = req.body?.paymentChainId;

      if (!holoUserId || typeof holoUserId !== "string") {
        return res.status(400).json({ error: "holoUserId is required" });
      }
      if (!paymentSecret || typeof paymentSecret !== "string") {
        return res.status(400).json({ error: "paymentSecret is required" });
      }
      const chainIdNum =
        typeof paymentChainId === "number" ? paymentChainId : Number(paymentChainId);
      if (!paymentChainId || isNaN(chainIdNum)) {
        return res
          .status(400)
          .json({ error: "paymentChainId is required and must be a number" });
      }

      // Rate limit: per-IP, with whitelist tiering, same pattern as Onfido v3
      const ip = (req.headers["x-forwarded-for"] ?? req.socket.remoteAddress) as string;
      const tier = await getRateLimitTier(address);
      const { limitExceeded, maxForTier } = await rateLimitByTier(
        tier,
        ip,
        "zk-passport-sessions",
      );
      if (limitExceeded) {
        zkPassportSessionsLogger.warn(
          { ip, tier },
          "Rate limit exceeded for zk-passport-sessions",
        );
        return res.status(429).json({
          error: `This device has reached the maximum number of allowed zkPassport sessions (${maxForTier}). Please try again in 30 days.`,
        });
      }

      // Per-user session cap
      const existingSessions = await config.ZkPassportSessionModel.find({
        sigDigest: holoUserId,
        status: {
          $in: [
            sessionStatusEnum.IN_PROGRESS,
            sessionStatusEnum.VERIFICATION_FAILED,
            sessionStatusEnum.ISSUED,
          ],
        },
      }).exec();
      if (existingSessions.length >= MAX_ZK_PASSPORT_SESSIONS_PER_USER) {
        return res.status(400).json({
          error: `User has reached the maximum number of sessions (${MAX_ZK_PASSPORT_SESSIONS_PER_USER})`,
        });
      }

      // Reserve the payment (onchain validation + redemption-pending NX lock)
      const reservation = await reserveRedemption({
        secret: paymentSecret,
        chainId: chainIdNum,
        service: PAYMENT_SERVICE_ZK_PASSPORT_VERIFICATION,
        config,
      });
      reservationToken = reservation.reservationToken;

      const session = new config.ZkPassportSessionModel({
        sigDigest: holoUserId,
        status: sessionStatusEnum.IN_PROGRESS,
        paymentCommitment: reservation.commitment,
        chainId: chainIdNum,
        numAttempts: 0,
      });
      await session.save();

      // Complete redemption after the session doc exists so the commitment
      // cannot be re-used for another session.
      await completeRedemption({
        reservationToken: reservationToken!,
        service: PAYMENT_SERVICE_ZK_PASSPORT_VERIFICATION,
        fulfillmentReceipt: `zk-passport-session:${session._id}`,
        config,
      });
      reservationToken = null;

      zkPassportSessionsLogger.info(
        { sid: session._id, chainId: chainIdNum, environment: config.environment },
        "Created zkPassport session",
      );

      return res.status(201).json({ session });
    } catch (err: any) {
      if (reservationToken) {
        try {
          await cancelRedemption({ reservationToken, config });
        } catch (cancelErr: any) {
          zkPassportSessionsLogger.error(
            { error: cancelErr?.message, reservationToken },
            "Failed to cancel payment reservation after session create failure",
          );
        }
      }
      if (err instanceof PaymentError) {
        return res.status(err.statusCode).json({ error: err.message });
      }

      // Duplicate commitment → session already exists for this payment
      if (err?.code === 11000) {
        return res.status(409).json({
          error: "A session already exists for this payment commitment",
        });
      }

      zkPassportSessionsLogger.error(
        { error: makeUnknownErrorLoggable(err) },
        "POST /zk-passport/sessions/v2 error",
      );
      return res.status(500).json({ error: "An unknown error occurred" });
    }
  };
}

export async function postZkPassportSessionV2Prod(req: Request, res: Response) {
  return createPostZkPassportSessionV2Handler(getRouteHandlerConfig("live"))(req, res);
}

export async function postZkPassportSessionV2Sandbox(req: Request, res: Response) {
  return createPostZkPassportSessionV2Handler(getRouteHandlerConfig("sandbox"))(req, res);
}

/**
 * GET /zk-passport/sessions/:sid
 *
 * Returns session status. Used by the frontend to gate access to verify/
 * store/success pages and to render refund affordances.
 *
 * Authorization: if the `holoUserId` query param is provided it must match
 * session.sigDigest. The :sid ObjectId is generated server-side and should
 * only be known by the session owner, so we accept unauthenticated reads
 * (mirrors existing session-status patterns in this codebase).
 */
function createGetZkPassportSessionHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const sid = req.params.sid;
      if (!sid) return res.status(400).json({ error: "sid is required" });

      let objectId: ObjectId;
      try {
        objectId = new ObjectId(sid);
      } catch {
        return res.status(400).json({ error: "Invalid session id" });
      }

      const session = await config.ZkPassportSessionModel.findOne({ _id: objectId }).exec();
      if (!session) return res.status(404).json({ error: "Session not found" });

      const holoUserId = req.query?.holoUserId;
      if (
        typeof holoUserId === "string" &&
        holoUserId &&
        session.sigDigest !== holoUserId
      ) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      return res.status(200).json({
        _id: session._id,
        status: session.status,
        numAttempts: session.numAttempts ?? 0,
        failureReason: session.failureReason,
        chainId: session.chainId,
      });
    } catch (err: any) {
      zkPassportSessionsLogger.error(
        { error: makeUnknownErrorLoggable(err) },
        "GET /zk-passport/sessions/:sid error",
      );
      return res.status(500).json({ error: "An unknown error occurred" });
    }
  };
}

export async function getZkPassportSessionProd(req: Request, res: Response) {
  return createGetZkPassportSessionHandler(getRouteHandlerConfig("live"))(req, res);
}

export async function getZkPassportSessionSandbox(req: Request, res: Response) {
  return createGetZkPassportSessionHandler(getRouteHandlerConfig("sandbox"))(req, res);
}

const refundLogger = logger.child({
  msgPrefix: "[POST /zk-passport/sessions/:sid/refund] ",
  base: { ...pinoOptions.base, feature: "holonym", subFeature: "zk-passport-refund" },
});

/**
 * POST /zk-passport/sessions/:sid/refund
 *
 * User-initiated refund. Only allowed when session.status === VERIFICATION_FAILED.
 * The :sid is known only to the session owner; we additionally require
 * holoUserId in the body to match session.sigDigest.
 */
function createRefundZkPassportSessionHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const sid = req.params.sid;
      const holoUserId = req.body?.holoUserId;
      if (!sid) return res.status(400).json({ error: "sid is required" });
      if (!holoUserId || typeof holoUserId !== "string") {
        return res.status(401).json({ error: "Unauthorized" });
      }

      let objectId: ObjectId;
      try {
        objectId = new ObjectId(sid);
      } catch {
        return res.status(400).json({ error: "Invalid session id" });
      }

      const session = await config.ZkPassportSessionModel.findOne({ _id: objectId }).exec();
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (session.sigDigest !== holoUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (session.status === sessionStatusEnum.REFUNDED) {
        return res.status(200).json({
          alreadyRefunded: true,
          txHashes: session.refundTxHashes ?? [],
        });
      }
      if (session.status !== sessionStatusEnum.VERIFICATION_FAILED) {
        return res.status(400).json({ error: "Session is not eligible for refund" });
      }
      if (!session.paymentCommitment || !session.chainId) {
        return res.status(400).json({ error: "Session missing payment metadata" });
      }

      const result = await forceRefundPayment(
        session.paymentCommitment,
        session.chainId,
        { logger: refundLogger, environment: config.environment },
      );
      if (!result.success) {
        return res.status(result.status).json({ error: result.error });
      }

      session.status = sessionStatusEnum.REFUNDED;
      session.refundTxHashes = [...(session.refundTxHashes ?? []), result.txHash];
      await session.save();

      return res.status(200).json({ txHash: result.txHash });
    } catch (err: any) {
      refundLogger.error(
        { error: makeUnknownErrorLoggable(err) },
        "Error processing zkPassport session refund",
      );
      return res.status(500).json({ error: "An unknown error occurred" });
    }
  };
}

export async function refundZkPassportSessionProd(req: Request, res: Response) {
  return createRefundZkPassportSessionHandler(getRouteHandlerConfig("live"))(req, res);
}

export async function refundZkPassportSessionSandbox(req: Request, res: Response) {
  return createRefundZkPassportSessionHandler(getRouteHandlerConfig("sandbox"))(req, res);
}
