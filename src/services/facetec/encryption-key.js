import axios from "axios";
import { facetecServerBaseURL } from "../../constants/misc.js";
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
      `${facetecServerBaseURL}/production-encryption-key-text`,
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

    // Convert YAML text to JSON. The response looks something like this
    // "  appToken    = dscV7M...\n  expiryDate  = 2025-09-10\n  key         = 0030...\n",
    const encryptionKeyStr = resp.data.encryptionKeyText
    // Create an array that looks like ['appToken', 'dsc...', ...]
    const arr = encryptionKeyStr.trim().split(/=|\n/).map(x=> x.trim())
    // Create a json object that looks like this { appToken: 'dsc...', ... }
    const json = arr.reduce((acc, curr, idx) => {
      if (idx % 2 === 0) {
        acc[curr] = arr[idx + 1];
      }
      return acc;
    }, {})

    return res.status(200).json(json)
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
