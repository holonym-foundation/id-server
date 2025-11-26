import axios from "axios";
import { Request, Response } from "express";
import { v4 as uuidV4 } from "uuid";
import { DailyVerificationCount, IDVSessions } from "../../init.js";
import { sendEmail } from "../../utils/utils.js";
import { pinoOptions, logger } from "../../utils/logger.js";

const v1EndpointLogger = logger.child({
  msgPrefix: "[POST /veriff/session] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "veriff",
  },
});
const v2EndpointLogger = logger.child({
  msgPrefix: "[POST /veriff/v2/session] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "veriff",
  },
});

async function v1CreateSession(req: Request, res: Response) {
  // Increment sessionCount in today's verification count doc. If doc doesn't exist,
  // create it, and set Veriff sessionCount to 1.
  // findOneAndUpdate is used so that the operation is atomic.
  const verificationCountDoc = await DailyVerificationCount.findOneAndUpdate(
    { date: new Date().toISOString().slice(0, 10) },
    { $inc: { "veriff.sessionCount": 1 } },
    { upsert: true, returnOriginal: false }
  ).exec();
  const sessionCountToday = verificationCountDoc?.veriff?.sessionCount ?? 0;

  // Send 2 emails after 5k verifications
  // if (sessionCountToday > 5000 && sessionCountToday <= 5002) {
  //   for (const email of ADMIN_EMAILS) {
  //     const subject = "Veriff session count for the day exceeded 5000!!";
  //     const message = `Veriff session count for the day is ${sessionCountToday}.`;
  //     // await sendEmail(email, subject, message);
  //   }
  // }
  if (sessionCountToday > 5000) {
    v1EndpointLogger.error(
      { sessionCountToday },
      "Veriff session count for the day exceeded 5000"
    );
    return res.status(503).json({
      error: "We cannot service more verifications today. Please try again tomorrow.",
    });
  }

  // Prepare request and create session
  const frontendUrl =
    process.env.NODE_ENV === "development"
      ? "http://localhost:3002"
      : "https://holonym.id";
  const reqBody = {
    verification: {
      // TODO: Is callback necessary if we handle "FINISHED" event in frontend?
      callback: `${frontendUrl}/mint`,
      // document: {
      //   type: "DRIVERS_LICENSE",
      // },
      vendorData: uuidV4(),
      timestamp: new Date().toISOString(),
    },
  };
  // if (process.env.NODE_ENV === "development") {
  //   reqBody.verification.person = {
  //     firstName: "John",
  //     lastName: "Doe",
  //     dateOfBirth: "1990-01-01",
  //   };
  // }
  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-CLIENT": process.env.VERIFF_PUBLIC_API_KEY,
      },
    };
    const resp = await axios.post(
      "https://api.veriff.me/v1/sessions",
      reqBody,
      config
    );
    const verification = resp?.data?.verification;
    v1EndpointLogger.info({ sessionId: verification?.id }, "Created Veriff session");
    return res.status(200).json({ url: verification?.url, id: verification?.id });
  } catch (err) {
    v1EndpointLogger.error({ error: err }, "Error creating Veriff session");
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

async function v2CreateSession(req: Request, res: Response) {
  const sigDigest = req.body.sigDigest;

  if (!sigDigest) {
    return res.status(400).json({ error: "Missing sigDigest" });
  }

  // Increment sessionCount in today's verification count doc. If doc doesn't exist,
  // create it, and set Veriff sessionCount to 1.
  // findOneAndUpdate is used so that the operation is atomic.
  const verificationCountDoc = await DailyVerificationCount.findOneAndUpdate(
    { date: new Date().toISOString().slice(0, 10) },
    { $inc: { "veriff.sessionCount": 1 } },
    { upsert: true, returnOriginal: false }
  ).exec();
  const sessionCountToday = verificationCountDoc?.veriff?.sessionCount ?? 0;

  // Send 2 emails after 5k verifications
  // if (sessionCountToday > 5000 && sessionCountToday <= 5002) {
  //   for (const email of ADMIN_EMAILS) {
  //     const subject = "Veriff session count for the day exceeded 5000!!";
  //     const message = `Veriff session count for the day is ${sessionCountToday}.`;
  //     // await sendEmail(email, subject, message);
  //   }
  // }
  if (sessionCountToday > 5000) {
    v2EndpointLogger.error(
      { sessionCountToday },
      "Veriff session count for the day exceeded 5000"
    );
    return res.status(503).json({
      error: "We cannot service more verifications today. Please try again tomorrow.",
    });
  }

  // Prepare request and create session
  const frontendUrl =
    process.env.NODE_ENV === "development"
      ? "http://localhost:3002"
      : "https://holonym.id";
  const reqBody = {
    verification: {
      // TODO: Is callback necessary if we handle "FINISHED" event in frontend?
      callback: `${frontendUrl}/mint`,
      // document: {
      //   type: "DRIVERS_LICENSE",
      // },
      vendorData: uuidV4(),
      timestamp: new Date().toISOString(),
    },
  };
  // if (process.env.NODE_ENV === "development") {
  //   reqBody.verification.person = {
  //     firstName: "John",
  //     lastName: "Doe",
  //     dateOfBirth: "1990-01-01",
  //   };
  // }
  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-CLIENT": process.env.VERIFF_PUBLIC_API_KEY,
      },
    };
    const resp = await axios.post(
      "https://api.veriff.me/v1/sessions",
      reqBody,
      config
    );
    const verification = resp?.data?.verification;
    v2EndpointLogger.info({ sessionId: verification?.id }, "Created Veriff session");

    // Upsert IDVSessions doc with sigDigest and session ID
    await IDVSessions.findOneAndUpdate(
      { sigDigest },
      {
        sigDigest,
        $push: {
          "veriff.sessions": {
            sessionId: verification?.id,
            createdAt: new Date(),
          },
        },
      },
      { upsert: true, returnOriginal: false }
    ).exec();

    return res.status(200).json({ url: verification?.url, id: verification?.id });
  } catch (err) {
    v2EndpointLogger.error({ error: err }, "Error creating Veriff session");
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { v1CreateSession, v2CreateSession };
