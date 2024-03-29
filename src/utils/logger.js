import pino from "pino";

const pinoOptions = {
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
      // NOTE for future: We output logs using both pino-pretty and
      // pino-datadog-transport so that logs get sent to both AWS CloudWatch
      // and Datadog. Perhaps in the future, we should send logs to one place.
      { target: "pino-pretty", options: { colorize: false } },
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
      },
    ],
  };
}

const logger = pino(pinoOptions);

export { pinoOptions, logger };
export default logger;
