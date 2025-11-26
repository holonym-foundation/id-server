import axios from "axios";
import { Request, Response } from "express"

async function getCountry(req: Request, res: Response) {
  try {
    const userIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    const resp = await axios.get(
      `https://ipapi.co/${userIp}/json?key=${process.env.IPAPI_SECRET_KEY}`
    );
    const country = resp?.data?.country_name;

    return res.status(200).json({
      country,
    });
  } catch (err: any) {
    console.log("GET ip-info/country: Error encountered (a)", err.message);
    console.log("GET ip-info/country: Error encountered (b)", err?.response?.data);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

async function getIpAndCountry(req: Request, res: Response) {
  try {
    const userIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    const resp = await axios.get(
      `https://ipapi.co/${userIp}/json?key=${process.env.IPAPI_SECRET_KEY}`
    );
    const ip = resp?.data?.ip;
    const country = resp?.data?.country_name;

    return res.status(200).json({
      ip,
      country,
    });
  } catch (err: any) {
    console.log("GET ip-info/ip-and-country: Error encountered (a)", err.message);
    console.log(
      "GET ip-info/ip-and-country: Error encountered (b)",
      err?.response?.data
    );
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { getCountry, getIpAndCountry };
