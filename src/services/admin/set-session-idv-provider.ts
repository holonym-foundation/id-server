import { Request, Response } from "express";
import { HydratedDocument } from "mongoose";
import { ObjectId } from "mongodb";
import { Session, UserVerifications } from "../../init.js";
import { createVeriffSession } from "../../utils/veriff.js";
import { createIdenfyToken } from "../../utils/idenfy.js";
import {
  createOnfidoApplicant,
  createOnfidoSdkToken,
  createOnfidoCheck,
} from "../../utils/onfido.js";
import { sessionStatusEnum } from "../../constants/misc.js";
import { ISession } from "../../types.js";
import logger from "../../utils/logger.js";

const postEndpointLogger = logger.child({
  msgPrefix: "[POST /admin/set-session-idv-provider] ",
});

/**
 * This endpoint sets the IDV provider used to verify a user. For example,
 * if a user tried verifying with Onfido but verification failed, we can
 * let them verify with Veriff by calling this endpoint and specifying
 * "veriff" as the idv-provider. Importantly, if a user has already tried
 * verifying with a provider and failed, we do not create a new session
 * with that provider; this is to prevent creating multiple sessions
 * with each provider, something we want to prevent to avoid excessive costs.
 */
async function setSessionIdvProvider(req: Request, res: Response) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const id: string = req.body.id;
    const newIdvProvider: string = req.body.idvProvider;

    if (!id) {
      return res.status(400).json({ error: "No user ID specified." });
    }

    if (!newIdvProvider) {
      return res.status(400).json({ error: "No IDV provider specified." });
    }

    const supportedIdvProviders = ["onfido", "veriff"];
    if (supportedIdvProviders.indexOf(newIdvProvider) === -1) {
      return res.status(400).json({
        error: `Invalid IDV provider. Must be one of ${supportedIdvProviders}`,
      });
    }

    let objectId: ObjectId | null = null;
    try {
      objectId = new ObjectId(id);
    } catch (err) {
      return res.status(400).json({ error: "Invalid _id" });
    }

    const session: HydratedDocument<ISession> | null = await Session.findOne({ _id: objectId }).exec();

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const acceptableSessionStatuses = [
      sessionStatusEnum.IN_PROGRESS,
      sessionStatusEnum.VERIFICATION_FAILED,
    ];
    if (acceptableSessionStatuses.indexOf(session.status as string) === -1) {
      // User might have other sessions that can be reset. If they do, we return
      // those session IDs to the admin, so the admin can reset a different session.
      try {
        const sigDigest = session.sigDigest;
        const sessions = await Session.find({ sigDigest }).exec();
        const filteredSids = sessions
          .filter((s) => {
            return acceptableSessionStatuses.indexOf(s.status as string) !== -1;
          })
          .map((s) => `'${s._id.toString()}'`);

        // User doesn't have other sessions. Simply return error
        if (filteredSids.length === 0) {
          return res.status(400).json({
            error: `Session status is ${session.status}. Must be one of ${acceptableSessionStatuses}`,
          });
        }

        return res.status(400).json({
          error: `Session status is ${session.status}. Must be one of ${acceptableSessionStatuses}.`,
          suggestion: `The user has other sessions. Try resetting one of these sessions: ${filteredSids.join(
            ", "
          )}`,
        });
      } catch (err) {
        // An error occurred, likely due to the database. Ignore this error, and return informative error.
        return res.status(400).json({
          error: `Session status is ${session.status}. Must be one of ${acceptableSessionStatuses}`,
        });
      }
    }

    if (session.idvProvider === newIdvProvider) {
      return res.status(400).json({
        message: `IDV provider for this session is already ${newIdvProvider}`,
      });
    }

    // TODO: Come back to this.
    // There's very likely a better way to do this, but... To avoid creating a new IDV session
    // with a provider the user has already verified with (for this session), we check that
    // the IDV session ID (e.g. Veriff's "sessionId") is null. If it's not null, that means
    // an IDV session has already been created with that provider.
    if (newIdvProvider === "idenfy" && session.scanRef) {
      return res.status(400).json({
        message:
          "Cannot change IDV provider to iDenfy. User has already verified with iDenfy",
      });
    }

    if (newIdvProvider === "veriff" && session.sessionId) {
      return res.status(400).json({
        message:
          "Cannot change IDV provider to Veriff. User has already verified with Veriff",
      });
    }

    if (newIdvProvider === "onfido" && session.check_id) {
      return res.status(400).json({
        message:
          "Cannot change IDV provider to Onfido. User has already verified with Onfido",
      });
    }

    session.status = sessionStatusEnum.IN_PROGRESS;
    session.idvProvider = newIdvProvider;

    if (newIdvProvider === "veriff") {
      const veriffSession = await createVeriffSession();
      if (!veriffSession) {
        return res.status(500).json({ error: "Error creating Veriff session" });
      }

      session.sessionId = veriffSession.verification.id;
      session.veriffUrl = veriffSession.verification.url;
      await session.save();

      postEndpointLogger.info(
        { sessionId: veriffSession.verification.id, idvProvider: "veriff" },
        "Created Veriff session"
      );

      // return res.status(200).json({
      //   url: veriffSession.verification.url,
      //   id: veriffSession.verification.id,
      // });
      return res.status(200).json({ message: "Veriff session created" });
    } else if (newIdvProvider === "idenfy") {
      const tokenData = await createIdenfyToken(session.sigDigest);
      if (!tokenData) {
        return res.status(500).json({ error: "Error creating iDenfy token" });
      }

      session.scanRef = tokenData.scanRef;
      session.idenfyAuthToken = tokenData.authToken;
      await session.save();

      postEndpointLogger.info(
        { authToken: tokenData.authToken, idvProvider: "idenfy" },
        "Created iDenfy session"
      );

      // return res.status(200).json({
      //   url: `https://ivs.idenfy.com/api/v2/redirect?authToken=${tokenData.authToken}`,
      //   scanRef: tokenData.scanRef,
      // });
      return res.status(200).json({ message: "iDenfy session created" });
    } else if (newIdvProvider === "onfido") {
      const applicant = await createOnfidoApplicant();
      if (!applicant) {
        return res.status(500).json({ error: "Error creating Onfido applicant" });
      }

      session.applicant_id = applicant.id;

      postEndpointLogger.info(
        { applicantId: applicant.id, idvProvider: "onfido" },
        "Created Onfido applicant"
      );

      // BIG NOTE: Once we start using Holonym with Silk, we should parameterize the
      // referrer passed to createOnfidoSdkToken. For now, we assume the admin is
      // always working with a Holonym user, but in the future, an admin might be
      // working with a Holonym-within-Silk user.
      const sdkTokenData = await createOnfidoSdkToken(applicant.id);
      if (!sdkTokenData) {
        return res.status(500).json({ error: "Error creating Onfido SDK token" });
      }

      session.onfido_sdk_token = sdkTokenData.token;
      await session.save();

      // return res.status(200).json({
      //   applicant_id: applicant.id,
      //   sdk_token: sdkTokenData.token,
      // });
      return res.status(200).json({ message: "Onfido session created" });
    }
  } catch (err) {
    postEndpointLogger.error({ error: err });
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { setSessionIdvProvider };
