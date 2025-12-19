import axios from "axios";
import { ObjectId } from "mongodb";
import { BiometricsSession } from "../../init.js";
import {
  sessionStatusEnum,
} from "../../constants/misc.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { v4 as uuidV4 } from "uuid";
import { rateLimitByTier } from "../../utils/rate-limiting.js";
import { getRateLimitTier } from "../../utils/whitelist.js";

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

export {
  postSessionV2,
  getSessions,
};
