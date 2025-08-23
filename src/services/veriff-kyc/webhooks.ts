import { Request, Response } from "express";

async function decisionWebhook(req: Request, res: Response) {
  try {
    // TODO: CT: See https://developers.veriff.com/#handling-security
    console.log("veriff/decision-webhook: req.body", req.body);
    return res.status(200).json({ message: "OK" });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { decisionWebhook };
