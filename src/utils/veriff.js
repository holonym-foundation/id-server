import { createHmac } from "crypto";
import axios from "axios";
import { v4 as uuidV4 } from "uuid";

export async function createVeriffSession() {
  try {
    const frontendUrl =
      process.NODE_ENV === "development"
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
    return resp.data;
  } catch (err) {
    console.error("Error creating veriff session:", err.message, err.response?.data);
  }
}

/**
 * @param {string} sessionId
 */
export async function getVeriffSessionDecision(sessionId) {
  try {
    const hmacSignature = createHmac("sha256", process.env.VERIFF_SECRET_API_KEY)
      .update(Buffer.from(sessionId, "utf8"))
      .digest("hex")
      .toLowerCase();
    const resp = await axios.get(
      `https://api.veriff.me/v1/sessions/${sessionId}/decision`,
      {
        headers: {
          "X-AUTH-CLIENT": process.env.VERIFF_PUBLIC_API_KEY,
          "X-HMAC-SIGNATURE": hmacSignature,
          "Content-Type": "application/json",
        },
      }
    );
    return resp.data;
  } catch (err) {
    console.error(
      "Error getting veriff session decision:",
      err.message,
      err.response?.data
    );
  }
}

/**
 * @param {string} sessionId
 */
export async function deleteVeriffSession(sessionId) {
  try {
    const hmacSignature = createHmac("sha256", process.env.VERIFF_SECRET_API_KEY)
      .update(Buffer.from(sessionId, "utf8"))
      .digest("hex")
      .toLowerCase();
    const resp = await axios.delete(`https://api.veriff.me/v1/sessions/${sessionId}`, {
      headers: {
        "X-AUTH-CLIENT": process.env.VERIFF_PUBLIC_API_KEY,
        "X-HMAC-SIGNATURE": hmacSignature,
        "Content-Type": "application/json",
      },
    });
    return resp.data;
  } catch (err) {
    console.error("Error deleting veriff session:", err.message, err.response?.data);
  }
}
