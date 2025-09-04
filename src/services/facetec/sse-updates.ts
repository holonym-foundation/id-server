import { Request, Response } from "express"

import { pinoOptions, logger } from "../../utils/logger.js";

export async function sseUpdates(req: Request, res: Response) {
  const sid = req.params.sid;

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
  req.app.locals.sseManager.addClient(sid, sendUpdate);

  // Handle client disconnect
  req.on("close", () => {
    req.app.locals.sseManager.removeClient(sid);
  });
}
