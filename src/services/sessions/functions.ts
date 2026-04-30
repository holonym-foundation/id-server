import axios from "axios";
import { ethers } from "ethers";
import { HydratedDocument } from "mongoose";
import { Session } from "../../init.js";
import {
  idServerPaymentAddress,
  sessionStatusEnum,
  ethereumProvider,
  optimismProvider,
  optimismGoerliProvider,
  fantomProvider,
  avalancheProvider,
  auroraProvider,
  payPalApiUrlBase,
} from "../../constants/misc.js";
import {
  getAccessToken as getPayPalAccessToken,
  getOrder as getPayPalOrder,
  getRefundDetails as getPayPalRefundDetails,
} from "../../utils/paypal.js";
import { createVeriffSession } from "../../utils/veriff.js";
import { createIdenfyToken } from "../../services/idenfy/token.js";
import { DailyVerificationCount } from "../../init.js";
import {
  createOnfidoApplicant,
  createOnfidoSdkToken,
  createOnfidoCheck,
  createOnfidoWorkflowRun,
} from "../../utils/onfido.js";
import { createSumsubApplicant } from "../../utils/sumsub.js";
import { SUMSUB_LEVEL_NAME } from "../../constants/sumsub.js";
import { usdToETH, usdToFTM, usdToAVAX } from "../../utils/cmc.js";
import { campaignIdToWorkflowIdMap } from "../../utils/constants.js";
import { onfidoSDKTokenAndApplicantRateLimiter } from "../../utils/rate-limiting.js"
import { v4 as uuidV4 } from "uuid";
import { ISession, SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";
import pino from "pino";

function campaignIdToWorkflowId(campaignId: string) {
  return campaignIdToWorkflowIdMap[campaignId] || campaignIdToWorkflowIdMap["default"];
}

async function handleIdvSessionCreation(
  config: SandboxVsLiveKYCRouteHandlerConfig,
  session: HydratedDocument<ISession>,
  logger: pino.Logger
) {
  if (session.idvProvider === "veriff") {
    const veriffSession = await createVeriffSession();
    if (!veriffSession) {
      throw new Error("Error creating Veriff session");
    }

    session.sessionId = veriffSession.verification.id;
    session.veriffUrl = veriffSession.verification.url;
    await session.save();

    logger.info(
      { sessionId: veriffSession.verification.id, idvProvider: "veriff" },
      "Created Veriff session"
    );

    return {
      url: veriffSession.verification.url,
      id: veriffSession.verification.id,
    };
  } else if (session.idvProvider === "idenfy") {
    // Idempotent: if both fields already exist, skip the network call.
    if (session.idenfyAuthToken && session.idenfyScanRef) {
      logger.info(
        { idvProvider: "idenfy", scanRef: session.idenfyScanRef },
        "Returning existing iDenfy session (idempotent)"
      );
      return {
        url: `https://ui.idenfy.com/?authToken=${session.idenfyAuthToken}`,
        scanRef: session.idenfyScanRef,
        authToken: session.idenfyAuthToken,
      };
    }

    // clientId — see services/idenfy/token.ts for collision rationale.
    const clientId = session._id?.toString() ?? session.sigDigest!;
    const tokenData = await createIdenfyToken({
      clientId,
      sandbox: config.environment === "sandbox",
    });

    // Persist both fields atomically (single save call). Throws above the assignment
    // ensure no partial-write state.
    session.idenfyAuthToken = tokenData.authToken;
    session.idenfyScanRef = tokenData.scanRef;
    await session.save();

    // Increment daily counter (best-effort; mirrors veriff/onfido pattern).
    try {
      const today = new Date().toISOString().slice(0, 10);
      await DailyVerificationCount.updateOne(
        { date: today },
        { $inc: { "idenfy.sessionCount": 1 } },
        { upsert: true }
      );
    } catch (counterErr) {
      logger.warn(
        { error: counterErr, idvProvider: "idenfy" },
        "Failed to increment idenfy daily session count"
      );
    }

    logger.info(
      { idvProvider: "idenfy", scanRef: tokenData.scanRef },
      "Created iDenfy session"
    );

    return {
      url: `https://ui.idenfy.com/?authToken=${tokenData.authToken}`,
      scanRef: tokenData.scanRef,
      authToken: tokenData.authToken,
    };
  } else if (session.idvProvider === "onfido") {
    const rateLimitResult = await onfidoSDKTokenAndApplicantRateLimiter()
    if (rateLimitResult.limitExceeded) {
      throw new Error('The network is busy. Please try again in 10 minutes')
    }

    const applicant = await createOnfidoApplicant(config.onfidoAPIKey);
    if (!applicant) {
      throw new Error("Error creating Onfido applicant");
    }

    session.applicant_id = applicant.id;

    logger.info(
      { applicantId: applicant.id, idvProvider: "onfido" },
      "Created Onfido applicant"
    );

    if (session.campaignId && session.workflowId) {

      // https://documentation.onfido.com/api/latest/#create-workflow-run
      const workflowRun = await createOnfidoWorkflowRun(config.onfidoAPIKey, applicant.id, session.workflowId);
      if (!workflowRun) {
        throw new Error("Error creating Onfido workflow run");
      }

      session.onfido_sdk_token = workflowRun.sdk_token;
      await session.save();

      return {
        applicant_id: applicant.id,
        sdk_token: workflowRun.sdk_token,
        workflow_run_id: workflowRun.id,
      };
    } else {

      const sdkTokenData = await createOnfidoSdkToken(config.onfidoAPIKey, applicant.id);
      if (!sdkTokenData) {
        throw new Error("Error creating Onfido SDK token");
      }

      session.onfido_sdk_token = sdkTokenData.token;
      await session.save();

      return {
        applicant_id: applicant.id,
        sdk_token: sdkTokenData.token,
      };
    }
  } else if (session.idvProvider === "facetec") {
    session.num_facetec_liveness_checks = 0;
    session.externalDatabaseRefID = uuidV4();

    await session.save();

    return {
      externalDatabaseRefID: session.externalDatabaseRefID,
    };
  } else if (session.idvProvider === "sumsub") {
    const applicant = await createSumsubApplicant(
      config.environment,
      session.sigDigest!,
      SUMSUB_LEVEL_NAME
    );

    session.sumsub_applicant_id = applicant.id;
    await session.save();

    logger.info(
      { applicantId: applicant.id, idvProvider: "sumsub" },
      "Created Sumsub applicant"
    );

    return {
      sumsub_applicant_id: applicant.id,
    };
  } else {
    throw new Error("Invalid idvProvider");
  }
}

export { handleIdvSessionCreation, campaignIdToWorkflowId };
