import axios from "axios";
import { getFaceTecBaseURL } from "../../utils/facetec.js";
import { pinoOptions, logger } from "../../utils/logger.js";

// const postSessionsLogger = logger.child({
//   msgPrefix: "[POST /sessions] ",
//   base: {
//     ...pinoOptions.base,
//   },
// });

export async function getProductionEncryptionKeyText(req, res) {
  try {
    const resp = await axios.get(
      `${getFaceTecBaseURL(req)}/production-encryption-key-text`,
      {
        headers: {
          "X-Api-Key": process.env.FACETEC_SERVER_API_KEY,
        },
      }
    );

    if (!resp.data.success) {
      console.error("Error fetching production encryption key text:", resp.data);
      return res.status(500).json({
        error: "Failed to fetch production encryption key text. Received non-successful response from FaceTec server",
      });
    }

    const encryptionKeyStr = resp.data.encryptionKeyText

    return res.status(200).json({
      encryptionKeyText: encryptionKeyStr
    })
  } catch (err) {
    if (err.request) {
      console.error(
        { error: err.request.data },
        "(err.request) Error during getProductionEncryptionKeyText"
      );

      return res.status(502).json({
        error: "Did not receive a response from the server during getProductionEncryptionKeyText",
      });
    } else if (err.response) {
      console.error(
        { error: err.response.data },
        "(err.response) Error during getProductionEncryptionKeyText"
      );

      return res.status(err.response.status).json({
        error: "Server returned an error during getProductionEncryptionKeyText",
      });
    } else {
      console.error({ error: err }, "Error during getProductionEncryptionKeyText");
      return res.status(500).json({
        error: "An unknown error occurred",
      });
    }
  }
}
