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
import { createIdenfyToken } from "../../utils/idenfy.js";
import {
  createOnfidoApplicant,
  createOnfidoSdkToken,
  createOnfidoCheck,
  createOnfidoWorkflowRun,
} from "../../utils/onfido.js";
import { usdToETH, usdToFTM, usdToAVAX } from "../../utils/cmc.js";
import { campaignIdToWorkflowIdMap } from "../../utils/constants.js";
import { v4 as uuidV4 } from "uuid";
import { ISession } from "../../types.js";
import pino from "pino";

function campaignIdToWorkflowId(campaignId: string) {
  return campaignIdToWorkflowIdMap[campaignId] || campaignIdToWorkflowIdMap["default"];
}

async function handleIdvSessionCreation(
  session: HydratedDocument<ISession>,
  logger: pino.Logger<pino.LoggerOptions>
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
    const tokenData = await createIdenfyToken(session.sigDigest!);
    if (!tokenData) {
      throw new Error("Error creating iDenfy token");
    }

    session.scanRef = tokenData.scanRef;
    session.idenfyAuthToken = tokenData.authToken;
    await session.save();

    logger.info(
      { authToken: tokenData.authToken, idvProvider: "idenfy" },
      "Created iDenfy session"
    );

    return {
      url: `https://ivs.idenfy.com/api/v2/redirect?authToken=${tokenData.authToken}`,
      scanRef: tokenData.scanRef,
    };
  } else if (session.idvProvider === "onfido") {
    const applicant = await createOnfidoApplicant();
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
      const workflowRun = await createOnfidoWorkflowRun(applicant.id, session.workflowId);
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

      const sdkTokenData = await createOnfidoSdkToken(applicant.id);
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
  } else {
    throw new Error("Invalid idvProvider");
  }
}

export { handleIdvSessionCreation, campaignIdToWorkflowId };
