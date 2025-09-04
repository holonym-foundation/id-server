The "direct verification service" operates independently of the other services in this repo. It will be moved into its own repo eventually. It DOES, however, rely on our FaceTec server implementation and uses similar patterns to the other FaceTec endpoints in this server.

The direct verification service allows integrators to integrate Human ID verification flows without the use of crypto wallets. It has a more traditional integration path. Instead of using blockchains for SBTs and crypto wallets for self-sovereign payment and data storage, it relies on centralized servers and databases to allow integrators to pay for their users and for users to complete verification without having a crypto wallet or exposing any data on-chain.

IMPORTANTLY, data is still kept private. This code is run inside an enclave, and user data (other than metadata, such as number of sessions created, used for accounting purposes) is never stored in persistent storage.
