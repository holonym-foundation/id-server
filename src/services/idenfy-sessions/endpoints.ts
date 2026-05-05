import { Request, Response } from "express";
import { getRouteHandlerConfig } from "../../init.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";
import {
  getIdenfySessionById,
  getIdenfyStatusForSession,
} from "./functions.js";

const endpointLogger = logger.child({
  msgPrefix: "[/idenfy-sessions] ",
  base: {
    ...pinoOptions.base,
    service: "idenfy-sessions",
  },
});

// ---------- GET /idenfy-sessions/:id/status ----------

function getStatusHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const doc = await getIdenfySessionById(config, id);
      if (!doc) {
        return res.status(404).json({ error: "iDenfy session not found" });
      }

      const resolved = await getIdenfyStatusForSession(config, doc.toObject());

      return res.status(200).json({
        status: resolved?.status ?? null,
        idenfyVerificationStatus:
          resolved?.idenfyVerificationStatus ?? null,
        idenfyAuthToken: resolved?.idenfyAuthToken ?? null,
        idenfyScanRef: resolved?.idenfyScanRef ?? null,
        failureReason: resolved?.verificationFailureReason ?? undefined,
      });
    } catch (err: any) {
      endpointLogger.error(
        { error: err?.message, sessionId: req.params.id },
        "Error getting iDenfy session status"
      );
      return res
        .status(500)
        .json({ error: "An unexpected error occurred while getting iDenfy session status" });
    }
  };
}

// ---------- GET /idenfy-sessions?sigDigest=... ----------

function findBySignDigestHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const { sigDigest } = req.query;

      if (!sigDigest || typeof sigDigest !== "string") {
        return res
          .status(400)
          .json({ error: "sigDigest query parameter is required" });
      }

      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const sessions = await config.IdenfySessionModel.find({
        sigDigest,
        createdAt: { $gte: fiveDaysAgo },
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .exec();

      return res.status(200).json({ sessions: sessions.map((s) => s.toObject()) });
    } catch (err: any) {
      endpointLogger.error(
        { error: err?.message },
        "Error finding iDenfy sessions by sigDigest"
      );
      return res
        .status(500)
        .json({ error: "An unexpected error occurred while finding iDenfy sessions" });
    }
  };
}

// ---------- Prod + Sandbox wrappers ----------
// Config is resolved at request time (not module load time) because
// MongoDB models are initialized asynchronously.

async function getStatusProd(req: Request, res: Response) {
  return getStatusHandler(getRouteHandlerConfig("live"))(req, res);
}

async function getStatusSandbox(req: Request, res: Response) {
  return getStatusHandler(getRouteHandlerConfig("sandbox"))(req, res);
}

async function findBySignDigestProd(req: Request, res: Response) {
  return findBySignDigestHandler(getRouteHandlerConfig("live"))(req, res);
}

async function findBySignDigestSandbox(req: Request, res: Response) {
  return findBySignDigestHandler(getRouteHandlerConfig("sandbox"))(req, res);
}

export {
  getStatusProd,
  getStatusSandbox,
  findBySignDigestProd,
  findBySignDigestSandbox,
};
