import axios from "axios";
import { DailyVerificationCount, IDVSessions } from "../../init.js";
import { sendEmail } from "../../utils/utils.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { desiredOnfidoReports } from "../../constants/onfido.js";
import { ADMIN_EMAILS } from "../../utils/constants.js";

const v1EndpointLogger = logger.child({
  msgPrefix: "[POST /onfido/check] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "onfido",
  },
});
const v2EndpointLogger = logger.child({
  msgPrefix: "[POST /onfido/v2/check] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "onfido",
  },
});

async function v1CreateCheck(req, res) {
  // NOTE:
  // From Onfido docs:
  // "If you're requesting multiple checks for the same individual, you
  // should reuse the id returned in the initial applicant response object
  // in the applicant_id field when creating a check."
  // Perhaps we should associate sigDigest with applicant_id to accomplish this.
  try {
    const applicant_id = req.body.applicant_id;
    if (!applicant_id) {
      return res.status(400).json({ error: "Missing applicant ID" });
    }

    // Increment checkCount in today's verification count doc. If doc doesn't exist,
    // create it, and set Onfido checkCount to 1.
    // findOneAndUpdate is used so that the operation is atomic.
    const verificationCountDoc = await DailyVerificationCount.findOneAndUpdate(
      { date: new Date().toISOString().slice(0, 10) },
      { $inc: { "onfido.checkCount": 1 } },
      { upsert: true, returnOriginal: false }
    ).exec();
    const checkCountToday = verificationCountDoc.onfido.checkCount;

    // Send 2 emails after 5k applicants
    if (checkCountToday > 5000 && checkCountToday <= 5002) {
      for (const email of ADMIN_EMAILS) {
        const subject = "Onfido applicant count for the day exceeded 5000!!";
        const message = `Onfido applicant count for the day is ${checkCountToday}.`;
        // await sendEmail(email, subject, message);
      }
    }
    if (checkCountToday > 5000) {
      v1EndpointLogger.error(
        { checkCountToday },
        "Onfido check count for the day exceeded 5000"
      );
      return res.status(503).json({
        error:
          "We cannot service more verifications today. Please try again tomorrow.",
      });
    }

    const reqBody = {
      applicant_id,
      report_names: desiredOnfidoReports,
      // applicant_provides_data: true,
    };
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${process.env.ONFIDO_API_TOKEN}`,
      },
    };
    const resp = await axios.post(
      "https://api.us.onfido.com/v3.6/checks",
      reqBody,
      config
    );
    const check = resp?.data;
    v1EndpointLogger.info({ check_id: check.id }, "Created check with check ID");
    return res.status(200).json({
      // TODO: CT: I'm not quite sure whether form_uri is the URL we are looking for. Is
      // it the URL for the verification flow? Or is it just a form where user enters input?
      url: check.form_uri,
      id: check.id,
    });
  } catch (err) {
    v1EndpointLogger.error({ err }, "Error creating check");
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

async function v2CreateCheck(req, res) {
  // NOTE:
  // From Onfido docs:
  // "If you're requesting multiple checks for the same individual, you
  // should reuse the id returned in the initial applicant response object
  // in the applicant_id field when creating a check."
  // Perhaps we should associate sigDigest with applicant_id to accomplish this.
  try {
    const applicant_id = req.body.applicant_id;
    const sigDigest = req.body.sigDigest;
    if (!applicant_id) {
      return res.status(400).json({ error: "Missing applicant ID" });
    }

    if (!sigDigest) {
      return res.status(400).json({ error: "Missing sigDigest" });
    }

    // Increment checkCount in today's verification count doc. If doc doesn't exist,
    // create it, and set Onfido checkCount to 1.
    // findOneAndUpdate is used so that the operation is atomic.
    const verificationCountDoc = await DailyVerificationCount.findOneAndUpdate(
      { date: new Date().toISOString().slice(0, 10) },
      { $inc: { "onfido.checkCount": 1 } },
      { upsert: true, returnOriginal: false }
    ).exec();
    const checkCountToday = verificationCountDoc.onfido.checkCount;

    // Send 2 emails after 5k applicants
    if (checkCountToday > 5000 && checkCountToday <= 5002) {
      for (const email of ADMIN_EMAILS) {
        const subject = "Onfido applicant count for the day exceeded 5000!!";
        const message = `Onfido applicant count for the day is ${checkCountToday}.`;
        // await sendEmail(email, subject, message);
      }
    }
    if (checkCountToday > 5000) {
      v2EndpointLogger.error(
        { checkCountToday },
        "Onfido check count for the day exceeded 5000"
      );
      return res.status(503).json({
        error:
          "We cannot service more verifications today. Please try again tomorrow.",
      });
    }

    const reqBody = {
      applicant_id,
      report_names: desiredOnfidoReports,
      // applicant_provides_data: true,
    };
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${process.env.ONFIDO_API_TOKEN}`,
      },
    };
    const resp = await axios.post(
      "https://api.us.onfido.com/v3.6/checks",
      reqBody,
      config
    );
    const check = resp?.data;
    v2EndpointLogger.info({ check_id: check.id }, "Created check");

    // Upsert IDVSessions doc with sigDigest and session ID
    await IDVSessions.findOneAndUpdate(
      { sigDigest },
      {
        sigDigest,
        $push: {
          "onfido.checks": {
            check_id: check.id,
            createdAt: new Date(),
          },
        },
      },
      { upsert: true, returnOriginal: false }
    ).exec();

    return res.status(200).json({
      id: check.id,
    });
  } catch (err) {
    v2EndpointLogger.error(
      { error: err, applicant_id: req.body.applicant_id },
      "Error creating check"
    );
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { v1CreateCheck, v2CreateCheck };
