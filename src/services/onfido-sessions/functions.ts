import axios from "axios";
import { Types } from "mongoose";
import { pinoOptions, logger } from "../../utils/logger.js";
import {
  IOnfidoSession,
  ISandboxOnfidoSession,
  SandboxVsLiveKYCRouteHandlerConfig,
} from "../../types.js";
import {
  createOnfidoApplicant,
  createOnfidoSdkToken,
  createOnfidoWorkflowRun,
} from "../../utils/onfido.js";

const onfidoSessionLogger = logger.child({
  msgPrefix: "[Onfido Sessions] ",
  base: {
    ...pinoOptions.base,
    service: "onfido-sessions",
  },
});

/**
 * Create a new Onfido session: creates an Onfido applicant and SDK token
 * (or workflow run if campaignId/workflowId are provided).
 *
 * This is an internal function — NOT exposed as an HTTP route.
 * Only flow session creation endpoints (sessions/v3, aml-sessions/v3) call this.
 */
export async function createOnfidoSession(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  sigDigest: string,
  flowType: "gov-id" | "clean-hands",
  flowSessionId: Types.ObjectId,
  opts?: { campaignId?: string; workflowId?: string }
): Promise<IOnfidoSession | ISandboxOnfidoSession> {
  const applicant = await createOnfidoApplicant(config.onfidoAPIKey);
  if (!applicant) {
    throw new Error("Error creating Onfido applicant");
  }

  onfidoSessionLogger.info(
    { applicantId: applicant.id, flowType },
    "Created Onfido applicant"
  );

  let sdkToken: string | undefined;

  if (opts?.campaignId && opts?.workflowId) {
    const workflowRun = await createOnfidoWorkflowRun(
      config.onfidoAPIKey,
      applicant.id,
      opts.workflowId
    );
    if (!workflowRun) {
      throw new Error("Error creating Onfido workflow run");
    }
    sdkToken = workflowRun.sdk_token;
  } else {
    const sdkTokenData = await createOnfidoSdkToken(
      config.onfidoAPIKey,
      applicant.id
    );
    if (!sdkTokenData) {
      throw new Error("Error creating Onfido SDK token");
    }
    sdkToken = sdkTokenData.token;
  }

  const onfidoSession = new config.OnfidoSessionModel({
    sigDigest,
    applicant_id: applicant.id,
    onfido_sdk_token: sdkToken,
    status: "in_progress",
    createdByFlow: flowType,
    createdBySessionId: flowSessionId,
    createdAt: new Date(),
  });
  await onfidoSession.save();

  onfidoSessionLogger.info(
    { onfidoSessionId: onfidoSession._id, flowType, applicantId: applicant.id },
    "Created Onfido session"
  );

  return onfidoSession.toObject();
}

/**
 * Find a reusable Onfido session: same sigDigest, status complete,
 * result clear, and created within the last 5 days.
 */
export async function findReusableOnfidoSession(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  sigDigest: string
): Promise<(IOnfidoSession | ISandboxOnfidoSession) | null> {
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  const session = await config.OnfidoSessionModel.findOne({
    sigDigest,
    status: "complete",
    check_result: "clear",
    createdAt: { $gte: fiveDaysAgo },
  })
    .sort({ createdAt: -1 })
    .exec();

  return session ? session.toObject() : null;
}

/**
 * Simple lookup by ID.
 */
export async function getOnfidoSessionById(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  id: string | Types.ObjectId
) {
  return config.OnfidoSessionModel.findById(id).exec();
}

// ---------- Smart check cache (ported from services/onfido/get-check-async.ts) ----------

const checkAsyncLogger = logger.child({
  msgPrefix: "[Onfido Session Check Async] ",
  base: {
    ...pinoOptions.base,
    service: "onfido-session-check-async",
  },
});

function shouldCallCheckAPI(
  session: IOnfidoSession | ISandboxOnfidoSession,
  checkCreatedAt: Date
): boolean {
  if (
    session.check_status === "withdrawn" ||
    session.check_status === "paused"
  ) {
    return false;
  }

  if (session.check_status === "complete" && !session.check_result) {
    return true;
  }

  if (!session.check_status) {
    return true;
  }

  if (session.check_status !== "complete") {
    const now = new Date();
    let mostRecentTime = checkCreatedAt;

    if (session.check_last_updated_at) {
      const lastUpdatedAt = new Date(session.check_last_updated_at as any);
      if (lastUpdatedAt > checkCreatedAt) {
        mostRecentTime = lastUpdatedAt;
      }
    }

    const checkAgeSeconds =
      (now.getTime() - mostRecentTime.getTime()) / 1000;
    const checkCreatedAgeSeconds =
      (now.getTime() - checkCreatedAt.getTime()) / 1000;

    const thresholdSeconds = checkCreatedAgeSeconds > 900 ? 70 : 35;

    if (checkAgeSeconds > thresholdSeconds) {
      return true;
    }
  }

  if (session.check_status === "complete" && session.check_result) {
    return false;
  }

  return false;
}

async function callOnfidoCheckAPI(
  onfidoAPIKey: string,
  check_id: string
): Promise<any> {
  try {
    const resp = await axios.get(
      `https://api.us.onfido.com/v3.6/checks/${check_id}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token token=${onfidoAPIKey}`,
        },
      }
    );
    return resp.data;
  } catch (err: any) {
    checkAsyncLogger.error(
      { error: err.message, check_id },
      "An error occurred while polling Onfido API"
    );
    return null;
  }
}

/**
 * getOnfidoCheckAsync - reads from IOnfidoSession first, calls Onfido API when stale.
 *
 * Ported from src/services/onfido/get-check-async.ts but adapted
 * to work with IOnfidoSession instead of ISession.
 */
export async function getOnfidoCheckAsync(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  onfidoSession: IOnfidoSession | ISandboxOnfidoSession
): Promise<any> {
  const check_id = onfidoSession.check_id;
  if (!check_id) {
    return null;
  }

  try {
    const createdAt = onfidoSession.createdAt
      ? new Date(onfidoSession.createdAt)
      : new Date(
          parseInt(onfidoSession._id!.toString().substring(0, 8), 16) * 1000
        );

    const shouldCall = shouldCallCheckAPI(onfidoSession, createdAt);

    if (!shouldCall) {
      return {
        id: check_id,
        status: onfidoSession.check_status || "in_progress",
        result: onfidoSession.check_result,
        report_ids: onfidoSession.check_report_ids || [],
      };
    }

    const apiResult = await callOnfidoCheckAPI(config.onfidoAPIKey, check_id);

    if (apiResult) {
      // Update the IOnfidoSession with fresh data
      await config.OnfidoSessionModel.findByIdAndUpdate(onfidoSession._id, {
        check_status: apiResult.status,
        check_result: apiResult.result,
        check_report_ids: apiResult.report_ids || [],
        check_last_updated_at: new Date(),
        ...(apiResult.status === "complete" && apiResult.result
          ? { status: apiResult.result === "clear" ? "complete" : "failed" }
          : {}),
      }).exec();
    }

    return apiResult;
  } catch (err) {
    checkAsyncLogger.error(
      { error: err, check_id },
      "Error in smart check, falling back to API"
    );
    return await callOnfidoCheckAPI(config.onfidoAPIKey, check_id);
  }
}
