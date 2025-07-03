import { GlideClient, Logger } from "@valkey/valkey-glide";

let valkeyClient;

const addresses = [
  {
    host: process.env.VALKEY_HOST, // e.g., "localhost"
    port: process.env.VALKEY_PORT // e.g., 6379
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
