import axios from "axios";
import { ObjectId } from "mongodb";
import { BiometricsSession, getRouteHandlerConfig } from "../../init.js";
import {
  sessionStatusEnum,
  PAYMENT_SERVICE_BIOMETRICS_VERIFICATION,
} from "../../constants/misc.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { v4 as uuidV4 } from "uuid";
import { rateLimitByTier } from "../../utils/rate-limiting.js";
import { getRateLimitTier } from "../../utils/whitelist.js";
import {
  reserveRedemption,
  completeRedemption,
  cancelRedemption,
  forceRefundPayment,
  PaymentError,
} from "../payments/functions.js";

// const postSessionsLogger = logger.child({
//   msgPrefix: "[POST /sessions] ",
//   base: {
//     ...pinoOptions.base,
//   },
// });
const createBiometricsSessionLogger = logger.child({
  msgPrefix: "[POST /sessions/:_id/biometrics-session] ",
  base: {
    ...pinoOptions.base,
  },
});

/**
 * Creates a session V2. Identical to v1, except it immediately sets session status to IN_PROGRESS.
 */
async function postSessionV2(req, res) {
  try {
    // Rate limiting with whitelist support
    const address = req.body.address || null // Optional blockchain address for whitelist lookup
    const ip = req.headers['x-forwarded-for'] ?? req.socket.remoteAddress
    const rateLimitKey = 'biometrics-sessions'

    // Check whitelist tier based on blockchain address (defaults to 0 if address is null or not whitelisted)
    const tier = await getRateLimitTier(address)

    const { count, limitExceeded, maxForTier } = await rateLimitByTier(tier, ip, rateLimitKey)

    if (limitExceeded) {
      logger.warn(
        {
          ip,
          address,
          rateLimitKey,
          count,
          tier,
        },
        'Rate limit exceeded'
      )
      return res.status(429).json({
        error: `This device has reached the maximum number of allowed biometrics sessions (${maxForTier}). Please try again in 30 days.`
      })
    }

    const sigDigest = req.body.sigDigest;
    // const idvProvider = req.body.idvProvider;
    if (!sigDigest) {
      return res.status(400).json({ error: "sigDigest is required" });
    }

    let domain = null;
    if (req.body.domain === "app.holonym.id") {
      domain = "app.holonym.id";
    } else if (req.body.domain === "silksecure.net") {
      domain = "silksecure.net";
    }

    let silkDiffWallet = null;
    if (req.body.silkDiffWallet === "silk") {
      silkDiffWallet = "silk";
    } else if (req.body.silkDiffWallet === "diff-wallet") {
      silkDiffWallet = "diff-wallet";
    }

    // Get country from IP address
    const userIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const resp = await axios.get(
      `https://ipapi.co/${userIp}/json?key=${process.env.IPAPI_SECRET_KEY}`
    );
    const ipCountry = resp?.data?.country;

    if (!ipCountry && process.env.NODE_ENV != 'development') {
      return res.status(500).json({ error: "Could not determine country from IP" });
    }

    const session = new BiometricsSession({
      sigDigest: sigDigest,
      status: sessionStatusEnum.IN_PROGRESS,
      frontendDomain: domain,
      silkDiffWallet,
      ipCountry: ipCountry,
      num_facetec_liveness_checks: 0,
      externalDatabaseRefID: uuidV4(),
    });

    console.log("biometrics session", session);

    // Only allow a user to create up to 3 sessions
    const existingSessions = await BiometricsSession.find({
      sigDigest: sigDigest,
      status: {
        "$in": [
          sessionStatusEnum.IN_PROGRESS,
          sessionStatusEnum.VERIFICATION_FAILED,
          sessionStatusEnum.ISSUED
        ]
      }
    }).exec();

    if (existingSessions.length >= 3) {
      return res.status(400).json({
        error: "User has reached the maximum number of sessions (3)"
      });
    }

    await session.save();

    return res.status(201).json({ session });
  } catch (err) {
    console.log("POST /sessions: Error encountered", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * Get session(s) associated with sigDigest or id.
 */
async function getSessions(req, res) {
  try {
    const sigDigest = req.query.sigDigest;
    const id = req.query.id;

    if (!sigDigest && !id) {
      return res.status(400).json({ error: "sigDigest or id is required" });
    }

    let sessions;
    if (id) {
      let objectId = null;
      try {
        objectId = new ObjectId(id);
      } catch (err) {
        return res.status(400).json({ error: "Invalid id" });
      }
      sessions = await BiometricsSession.find({ _id: objectId }).exec();
    } else {
      sessions = await BiometricsSession.find({ sigDigest }).exec();
    }

    return res.status(200).json(sessions);
  } catch (err) {
    console.log("GET /sessions: Error encountered", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

const postSessionsV3Logger = logger.child({
  msgPrefix: "[POST /biometrics-sessions/v3] ",
  base: {
    ...pinoOptions.base,
  },
});

/**
 * Creates a biometrics session V3. Same as v2 but requires paymentSecret
 * and paymentChainId. Payment is reserved before session creation and
 * completed after (or cancelled on failure).
 */
function createPostSessionV3(environment) {
  return async function postSessionV3(req, res) {
    let reservationToken = null;
    const routeHandlerConfig = getRouteHandlerConfig(environment);

    try {
      const paymentSecret = req.body.paymentSecret;
      const paymentChainId = req.body.paymentChainId;

      if (!paymentSecret || typeof paymentSecret !== "string") {
        return res.status(400).json({ error: "paymentSecret is required" });
      }
      const chainIdNum = typeof paymentChainId === "number" ? paymentChainId : Number(paymentChainId);
      if (!paymentChainId || isNaN(chainIdNum)) {
        return res.status(400).json({ error: "paymentChainId is required and must be a number" });
      }

      // Rate limiting with whitelist support
      const address = req.body.address || null;
      const ip = req.headers['x-forwarded-for'] ?? req.socket.remoteAddress;
      const rateLimitKey = 'biometrics-sessions';
      const tier = await getRateLimitTier(address);
      const { count, limitExceeded, maxForTier } = await rateLimitByTier(tier, ip, rateLimitKey);

      if (limitExceeded) {
        logger.warn(
          { ip, address, rateLimitKey, count, tier },
          'Rate limit exceeded'
        );
        return res.status(429).json({
          error: `This device has reached the maximum number of allowed biometrics sessions (${maxForTier}). Please try again in 30 days.`
        });
      }

      const sigDigest = req.body.sigDigest;
      if (!sigDigest) {
        return res.status(400).json({ error: "sigDigest is required" });
      }

      let domain = null;
      if (req.body.domain === "app.holonym.id") {
        domain = "app.holonym.id";
      } else if (req.body.domain === "silksecure.net") {
        domain = "silksecure.net";
      }

      let silkDiffWallet = null;
      if (req.body.silkDiffWallet === "silk") {
        silkDiffWallet = "silk";
      } else if (req.body.silkDiffWallet === "diff-wallet") {
        silkDiffWallet = "diff-wallet";
      }

      // Get country from IP address
      const userIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      const resp = await axios.get(
        `https://ipapi.co/${userIp}/json?key=${process.env.IPAPI_SECRET_KEY}`
      );
      const ipCountry = resp?.data?.country;

      if (!ipCountry && process.env.NODE_ENV != 'development') {
        return res.status(500).json({ error: "Could not determine country from IP" });
      }

      const session = new BiometricsSession({
        sigDigest: sigDigest,
        status: sessionStatusEnum.IN_PROGRESS,
        frontendDomain: domain,
        silkDiffWallet,
        ipCountry: ipCountry,
        num_facetec_liveness_checks: 0,
        externalDatabaseRefID: uuidV4(),
      });

      // Only allow a user to create up to 3 sessions
      const existingSessions = await BiometricsSession.find({
        sigDigest: sigDigest,
        status: {
          "$in": [
            sessionStatusEnum.IN_PROGRESS,
            sessionStatusEnum.VERIFICATION_FAILED,
            sessionStatusEnum.ISSUED
          ]
        }
      }).exec();

      if (existingSessions.length >= 3) {
        return res.status(400).json({
          error: "User has reached the maximum number of sessions (3)"
        });
      }

      // Reserve payment after all validation checks pass
      const reservation = await reserveRedemption({
        secret: paymentSecret,
        chainId: chainIdNum,
        service: PAYMENT_SERVICE_BIOMETRICS_VERIFICATION,
        config: routeHandlerConfig,
      });
      reservationToken = reservation.reservationToken;
      session.paymentCommitment = reservation.commitment;
      session.chainId = chainIdNum;

      await session.save();

      // Complete payment redemption after successful session creation
      await completeRedemption({
        reservationToken,
        service: PAYMENT_SERVICE_BIOMETRICS_VERIFICATION,
        fulfillmentReceipt: `biometrics-session:${session._id}`,
        config: routeHandlerConfig,
      });

      return res.status(201).json({ session });
    } catch (err) {
      // Cancel payment reservation on failure
      if (reservationToken) {
        try {
          await cancelRedemption({
            reservationToken,
            config: routeHandlerConfig,
          });
        } catch (cancelErr) {
          postSessionsV3Logger.error(
            { error: cancelErr.message, reservationToken },
            "Failed to cancel payment reservation"
          );
        }
      }

      if (err instanceof PaymentError) {
        return res.status(err.statusCode).json({ error: err.message });
      }

      console.log("POST /biometrics-sessions/v3: Error encountered", err.message);
      return res.status(500).json({ error: "An unknown error occurred" });
    }
  };
}

const postSessionV3 = createPostSessionV3("live");
const postSessionV3Sandbox = createPostSessionV3("sandbox");

const refundBiometricsLogger = logger.child({
  msgPrefix: "[POST /biometrics-sessions/:_id/refund] ",
  base: { ...pinoOptions.base, feature: "holonym", subFeature: "biometrics-refund" },
});

/**
 * POST /biometrics-sessions/:_id/refund
 *
 * User-initiated refund for a biometrics session that ended in VERIFICATION_FAILED.
 * Authorization: req.body.sigDigest must match session.sigDigest.
 */
async function refundBiometricsSession(req, res) {
  const routeHandlerConfig = getRouteHandlerConfig("live");
  try {
    const sid = req.params._id;
    const sigDigest = req.body?.sigDigest;

    if (!sid) {
      return res.status(400).json({ error: "session id is required" });
    }
    if (!sigDigest || typeof sigDigest !== "string") {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let objectId;
    try {
      objectId = new ObjectId(sid);
    } catch {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const session = await BiometricsSession.findOne({ _id: objectId }).exec();
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.sigDigest !== sigDigest) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (session.status === sessionStatusEnum.REFUNDED) {
      return res.status(200).json({
        alreadyRefunded: true,
        txHash: session.refundTxHash,
      });
    }
    if (session.status !== sessionStatusEnum.VERIFICATION_FAILED) {
      return res.status(400).json({ error: "Session is not eligible for refund" });
    }
    if (!session.paymentCommitment || !session.chainId) {
      return res.status(400).json({
        error: "Session predates refund-capable payment model",
      });
    }

    const result = await forceRefundPayment(
      session.paymentCommitment,
      session.chainId,
      { logger: refundBiometricsLogger, environment: routeHandlerConfig.environment }
    );

    if (!result.success) {
      return res.status(result.status).json({ error: result.error });
    }

    session.status = sessionStatusEnum.REFUNDED;
    session.refundTxHash = result.txHash;
    await session.save();

    return res.status(200).json({ txHash: result.txHash });
  } catch (err) {
    refundBiometricsLogger.error(
      { error: err?.message || String(err) },
      "Error processing biometrics refund"
    );
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export {
  postSessionV2,
  postSessionV3,
  postSessionV3Sandbox,
  getSessions,
  refundBiometricsSession,
};
