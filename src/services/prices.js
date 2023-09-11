import axios from "axios";
import { pinoOptions, logger } from "../utils/logger.js";

const endpointLogger = logger.child({
  msgPrefix: "[GET /prices] ",
  base: {
    ...pinoOptions.base,
  },
});

const ethereumCMCID = 1027;
const fantomCMCID = 3513;

const slugToID = {
  ethereum: ethereumCMCID,
  fantom: fantomCMCID,
};

async function getPrice(req, res) {
  try {
    const slug = req.query.slug;
    if (!slug) {
      return res.status(400).json({ error: "No slug provided." });
    }

    const id = slugToID[slug];

    const resp = await axios.get(
      `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=${id}`,
      {
        headers: {
          "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY,
          // "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );
    const price = resp?.data?.data?.[id]?.quote?.USD?.price;

    return res.status(200).json({
      price,
    });
  } catch (err) {
    if (err.response) {
      endpointLogger.error(
        { error: err.response.data },
        "Error getting price from CMC"
      );
    } else if (err.request) {
      endpointLogger.error(
        { error: err.request.data },
        "Error getting price from CMC"
      );
    } else {
      endpointLogger.error({ error: err.message }, "Error getting price from CMC");
    }
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { getPrice };
