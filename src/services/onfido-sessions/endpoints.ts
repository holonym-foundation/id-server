import { Request, Response } from "express";
import { getRouteHandlerConfig } from "../../init.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import {
  createOnfidoCheck as createOnfidoCheckUtil,
  createOnfidoSdkToken,
} from "../../utils/onfido.js";
import {
  getOnfidoSessionById,
  getOnfidoCheckAsync,
} from "./functions.js";
import { onfidoSDKTokenAndApplicantRateLimiter } from "../../utils/rate-limiting.js";

const endpointLogger = logger.child({
  msgPrefix: "[Onfido Sessions Endpoints] ",
  base: {
    ...pinoOptions.base,
    service: "onfido-sessions-endpoints",
  },
});

// ---------- POST /onfido-sessions/:id/check ----------

function createCheckHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const onfidoSession = await getOnfidoSessionById(config, id);
      if (!onfidoSession) {
        return res.status(404).json({ error: "Onfido session not found" });
      }

      // 1-check-per-applicant guard: reject if check already exists
      if (onfidoSession.check_id) {
        return res.status(409).json({
          error: "Check already exists for this session",
          check_id: onfidoSession.check_id,
        });
      }

      if (!onfidoSession.applicant_id) {
        return res
          .status(400)
          .json({ error: "Session has no applicant_id" });
      }

      const check = await createOnfidoCheckUtil(
        config.onfidoAPIKey,
        onfidoSession.applicant_id
      );

      onfidoSession.check_id = check.id;
      onfidoSession.check_status = check.status;
      onfidoSession.check_result = check.result;
      onfidoSession.check_report_ids = check.report_ids || [];
      onfidoSession.check_last_updated_at = new Date();
      await onfidoSession.save();

      endpointLogger.info(
        { onfidoSessionId: id, checkId: check.id },
        "Created Onfido check"
      );

      return res.status(200).json({
        check_id: check.id,
        status: check.status,
      });
    } catch (err: any) {
      endpointLogger.error(
        { error: err.message, sessionId: req.params.id },
        "Error creating Onfido check"
      );
      return res.status(500).json({ error: "An unexpected error occurred while creating Onfido check" });
    }
  };
}

// ---------- POST /onfido-sessions/:id/token ----------

function refreshTokenHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const rateLimitResult = await onfidoSDKTokenAndApplicantRateLimiter();
      if (rateLimitResult.limitExceeded) {
        return res
          .status(429)
          .json({ error: "Rate limit exceeded. Please try again later." });
      }

      const id = req.params.id as string;

      const onfidoSession = await getOnfidoSessionById(config, id);
      if (!onfidoSession) {
        return res.status(404).json({ error: "Onfido session not found" });
      }

      if (!onfidoSession.applicant_id) {
        return res
          .status(400)
          .json({ error: "Session has no applicant_id" });
      }

      const sdkTokenData = await createOnfidoSdkToken(
        config.onfidoAPIKey,
        onfidoSession.applicant_id
      );
      if (!sdkTokenData) {
        return res
          .status(500)
          .json({ error: "Error refreshing Onfido SDK token" });
      }

      onfidoSession.onfido_sdk_token = sdkTokenData.token;
      await onfidoSession.save();

      return res.status(200).json({ token: sdkTokenData.token });
    } catch (err: any) {
      endpointLogger.error(
        { error: err.message, sessionId: req.params.id },
        "Error refreshing Onfido token"
      );
      return res.status(500).json({ error: "An unexpected error occurred while refreshing Onfido token" });
    }
  };
}

// ---------- GET /onfido-sessions/:id/status ----------

function getStatusHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const onfidoSession = await getOnfidoSessionById(config, id);
      if (!onfidoSession) {
        return res.status(404).json({ error: "Onfido session not found" });
      }

      if (!onfidoSession.check_id) {
        // No check created yet — return current status
        return res.status(200).json({
          status: onfidoSession.status,
          check_status: null,
          check_result: null,
          check_id: null,
        });
      }

      const checkData = await getOnfidoCheckAsync(config, onfidoSession.toObject());

      if (!checkData) {
        return res.status(200).json({
          status: onfidoSession.status,
          check_status: onfidoSession.check_status,
          check_result: onfidoSession.check_result,
          check_id: onfidoSession.check_id,
        });
      }

      return res.status(200).json({
        status: onfidoSession.status,
        check_status: checkData.status,
        check_result: checkData.result,
        check_id: checkData.id,
      });
    } catch (err: any) {
      endpointLogger.error(
        { error: err.message, sessionId: req.params.id },
        "Error getting Onfido session status"
      );
      return res.status(500).json({ error: "An unexpected error occurred while getting Onfido session status" });
    }
  };
}

// ---------- GET /onfido-sessions?sigDigest=... ----------

function findBySignDigestHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const { sigDigest } = req.query;

      if (!sigDigest || typeof sigDigest !== "string") {
        return res.status(400).json({ error: "sigDigest query parameter is required" });
      }

      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const sessions = await config.OnfidoSessionModel.find({
        sigDigest,
        createdAt: { $gte: fiveDaysAgo },
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .exec();

      return res.status(200).json(sessions);
    } catch (err: any) {
      endpointLogger.error(
        { error: err.message },
        "Error finding Onfido sessions by sigDigest"
      );
      return res.status(500).json({ error: "An unexpected error occurred while finding Onfido sessions" });
    }
  };
}

// ---------- Prod + Sandbox wrappers ----------
// Config is resolved at request time (not module load time) because
// MongoDB models are initialized asynchronously.

async function createCheckProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createCheckHandler(config)(req, res);
}

async function createCheckSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createCheckHandler(config)(req, res);
}

async function refreshTokenProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return refreshTokenHandler(config)(req, res);
}

async function refreshTokenSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return refreshTokenHandler(config)(req, res);
}

async function getStatusProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return getStatusHandler(config)(req, res);
}

async function getStatusSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return getStatusHandler(config)(req, res);
}

async function findBySignDigestProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return findBySignDigestHandler(config)(req, res);
}

async function findBySignDigestSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return findBySignDigestHandler(config)(req, res);
}

export {
  createCheckProd,
  createCheckSandbox,
  refreshTokenProd,
  refreshTokenSandbox,
  getStatusProd,
  getStatusSandbox,
  findBySignDigestProd,
  findBySignDigestSandbox,
};
