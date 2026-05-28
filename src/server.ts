import { mongoose } from "./init.js";
import { app } from "./index.js";
import logger from "./utils/logger.js";
import { makeUnknownErrorLoggable } from "./utils/errors.js";
import { valkeyClient } from "./utils/valkey-glide.js";
import type { Server } from "http";

// Bun terminates on unhandled rejection by default. The @aztec/bb.js native
// backend used by @zkpassport/sdk can reject its connectionPromise from a
// child-process exit handler after the awaiter has already settled, which
// escapes the verify() try/catch and kills the ECS task. Log and swallow so
// one bb crash doesn't take down the server.
process.on("unhandledRejection", (reason) => {
  logger.error(
    { error: makeUnknownErrorLoggable(reason) },
    "unhandledRejection"
  );
});
process.on("uncaughtException", (err) => {
  logger.error(
    { error: makeUnknownErrorLoggable(err) },
    "uncaughtException"
  );
});

const PORT = process.env.ENVIRONMENT == "dev" ? 3031 : 3000;
const server: Server = app.listen(PORT, (err?: Error) => {
  if (err) throw err;
  logger.info(`Server running, exposed at http://127.0.0.1:${PORT}`);
});

async function terminate() {
  try {
    await mongoose.connection.close();
    logger.info("Closed MongoDB database connection");
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while attempting to close the MongoDB connection"
    );
  }
  try {
    if (valkeyClient) {
      valkeyClient.close();
      logger.info("Closed valkey connection");
    }
  } catch (err) {
    logger.error(
      { error: err },
      "An error occurred while attempting to close the valkey connection"
    );
  }
  logger.info("Closing server");
  server.close(() => {
    logger.info("Closed server");
    process.exit(0);
  });
}

process.on("SIGTERM", terminate);
process.on("SIGINT", terminate);
