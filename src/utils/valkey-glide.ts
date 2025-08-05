import { GlideClient, Logger } from "@valkey/valkey-glide";

if (typeof process.env.VALKEY_HOST != 'string') {
  throw new Error('process.env.VALKEY_HOST must be a string')
}

if (typeof process.env.VALKEY_PORT != 'string') {
  throw new Error('process.env.VALKEY_PORT must be a string')
}

let valkeyClient: GlideClient | undefined;

const addresses = [
  {
    host: process.env.VALKEY_HOST, // e.g., "localhost"
    port: Number(process.env.VALKEY_PORT) // e.g., 6379
  },
];
// Check `GlideClientConfiguration/GlideClusterClientConfiguration` for additional options.
GlideClient.createClient({
  addresses: addresses,
  useTLS: process.env.VALKEY_USE_TLS === 'true',
  requestTimeout: 500, // 500ms timeout
  clientName: "standalone_client",
}).then((client) => {
  valkeyClient = client;
  // The empty array signifies that there are no additional arguments.
  valkeyClient.customCommand(["PING"])
    .then((result) => console.log('Pinged valkey/redis server. Got response:', result))
    .catch((err) => console.error('Encountered error trying to ping valkey/redis server', err));
});

export {
  valkeyClient
}
