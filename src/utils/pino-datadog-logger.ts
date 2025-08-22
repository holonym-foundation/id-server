import pinoDataDog from "pino-datadog-transport";

// https://github.com/pinojs/pino-pretty#handling-non-serializable-options
// Functions as options on the pino transport config are not serializable as they
// are workers, so we create this worker file which includes our callbacks

const pinoDataDogTransport = (opts: any) => {
  // TODO: Create types for this
  // @ts-ignore
  return pinoDataDog({
    ...opts,
    onError: (data: any, logItems: any) => {
      console.log("Encountered an error while trying to log to DataDog:", data);
      console.log("logItems", logItems);
    },
  });
};

export default pinoDataDogTransport;
