import { Request, Response } from "express"

import { pinoOptions, logger } from "../../utils/logger.js";
import { SSE_NAMESPACE } from "./constants.js";

export async function sseUpdates(req: Request, res: Response) {
  try {
    const sid = req.params.sid;

    if (!req.app.locals.sseManager) {
      console.error("SSE Manager not initialized");
      return res.status(500).json({ error: "SSE Manager not initialized" });
    }

    // Set headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Send an initial message
    res.write(
      `data: ${JSON.stringify({ message: "SSE connection established" })}\n\n`
    );

    // Create a function to send updates
    const sendUpdate = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Store the client's sendUpdate function
    req.app.locals.sseManager.addClient(SSE_NAMESPACE + sid, sendUpdate);

    // Handle client disconnect
    req.on("close", () => {
      req.app.locals.sseManager.removeClient(SSE_NAMESPACE + sid);
    });
  } catch (err) {
    console.error("Error in sseUpdates:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
