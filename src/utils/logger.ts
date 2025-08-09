import pino, { LoggerOptions, TransportMultiOptions } from "pino";

const pinoOptions: LoggerOptions = {
  base: {
    src: "id-server",
  },
};

if (process.env.NODE_ENV === "development") {
  // Pretty print to console
  pinoOptions.transport = { target: "pino-pretty", options: { colorize: true } };
} else {
  // Send logs to Datadog
  pinoOptions.transport = {
    targets: [
      // NOTE for future: We output logs using both pino/file (for stdout) and
      // pino-datadog-transport so that logs get sent to both AWS CloudWatch
      // and Datadog. Perhaps in the future, we should send logs to one place.
      {
        target: 'pino/file',
        options: {
          destination: 1
        },
        level: "info",
      },
      {
        // target: "pino-datadog-transport",
        target: "./pino-datadog-logger",
        options: {
          ddClientConf: {
            authMethods: {
              apiKeyAuth: process.env.DATADOG_API_KEY,
            },
          },
          ddServerConf: {
            site: "us5.datadoghq.com",
          },
        },
        level: "info",
      },
    ],
  };
}

const logger = pino.default(pinoOptions);

export { pinoOptions, logger };
export default logger;
