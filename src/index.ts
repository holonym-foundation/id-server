// Import axios interceptor for Onfido API logging
import "./utils/axios-onfido-interceptor.js";

import express from "express";
import cors from "cors";
import veriff from "./routes/veriff-kyc.js";
import idenfy from "./routes/idenfy.js";
import onfido, { sandboxRouter as sandboxOnfido } from "./routes/onfido.js";
import credentials, { sandboxRouter as sandboxCredentials } from "./routes/credentials.js";
import proofMetadata from "./routes/proof-metadata.js";
import admin from "./routes/admin.js";
import sessionStatus, { sandboxRouter as sandboxSessionStatus } from "./routes/session-status.js";
import ipInfo from "./routes/ip-info.js";
import prices from "./routes/prices.js";
import sessions, { sandboxRouter as sandboxSessions } from "./routes/sessions.js";
import amlSessions, { sandboxRouter as sandboxAmlSessions } from "./routes/aml-sessions.js";
import biometricsSessions from "./routes/biometrics-sessions.js";
import silk from "./routes/silk.js";
import facetec from "./routes/facetec.js";
import nullifiers, { sandboxRouter as sandboxNullifiers } from "./routes/nullifiers.js";
import orders, { sandboxRouter as sandboxOrders } from "./routes/orders.js";
import whitelists from "./routes/whitelists.js";
import constants from "./routes/constants.js";
import directVerification from "./routes/direct-verification.js"
import phone, { phoneRouterSandbox } from "./routes/phone.js";
import payments, { sandboxRouter as sandboxPayments } from "./routes/payments.js";
import paymentSecrets, { sandboxRouter as sandboxPaymentSecrets } from "./routes/payment-secrets.js";
import sumsub, { sandboxRouter as sandboxSumsub } from "./routes/sumsub.js";

const app = express();

var corsOptions = {
  origin: true,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};
app.use(cors(corsOptions));

// Middleware to capture raw body for webhook signature verification
app.use('/onfido/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));
app.use('/sumsub/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// ---------- SSE client manager ----------
const sseManager = {
  clients: new Map(), // Map user IDs to their SSE connections
  
  // When creating a client, it is recommended to add a namespace prefix to the sid to
  // avoid accidentally using the same sid across different services.

  addClient: (
    sid: string,
    sendUpdate: (data: any) => void
  ) => {
    console.log(`Adding SSE client with SID: ${sid}`);
    sseManager.clients.set(sid, sendUpdate);
  },
  
  removeClient: (sid: string) => {
    sseManager.clients.delete(sid);
  },
  
  sendToClient: (sid: string, data: any) => {
    const sendUpdate = sseManager.clients.get(sid);
    console.log('Sending SSE to client with SID:', sid, sendUpdate);
    if (sendUpdate) {
      sendUpdate(data);
      return true;
    }
    return false;
  },
};

// sse manager is available to all routes
app.use((req, res, next) => {
  req.app.locals.sseManager = sseManager;
  next();
});

// ---------- Prod routes ----------
app.use("/credentials", credentials);
app.use("/proof-metadata", proofMetadata);
app.use("/veriff", veriff);
app.use("/idenfy", idenfy);
app.use("/onfido", onfido);
app.use("/admin", admin);
app.use("/session-status", sessionStatus);
app.use("/ip-info", ipInfo);
app.use("/sessions", sessions);
// TODO: Rename these to "ctf-sessions"
app.use("/aml-sessions", amlSessions);
app.use("/biometrics-sessions", biometricsSessions);
app.use("/prices", prices);
app.use("/silk", silk); // temporary
app.use("/facetec", facetec);
app.use("/nullifiers", nullifiers);
app.use("/orders", orders);
app.use("/whitelists", whitelists);
app.use("/constants", constants);
app.use("/direct-verification", directVerification)
app.use("/phone", phone);
app.use("/payments", payments);
app.use("/payment-secrets", paymentSecrets);
app.use("/sumsub", sumsub);

// ---------- Sandbox routes ----------
app.use("/sandbox/sessions", sandboxSessions);
app.use("/sandbox/session-status", sandboxSessionStatus);
app.use("/sandbox/onfido", sandboxOnfido);
app.use("/sandbox/aml-sessions", sandboxAmlSessions);
app.use("/sandbox/credentials", sandboxCredentials);
app.use("/sandbox/nullifiers", sandboxNullifiers);
app.use("/sandbox/orders", sandboxOrders);
app.use("/sandbox/phone", phoneRouterSandbox);
app.use("/sandbox/payments", sandboxPayments);
app.use("/sandbox/payment-secrets", sandboxPaymentSecrets);
app.use("/sandbox/sumsub", sandboxSumsub);

// Trust the X-Forwarded-For header from the load balancer or the user's proxy
app.set("trust proxy", true);

app.get("/", (req, res) => {
  const routes = [
    "GET /veriff/credentials",
    "GET /credentials",
    "POST /credentials",
    "GET /proof-metadata",
    "POST /proof-metadata",
  ];
  res.status(200).json({ routes: routes });
});

app.get("/aws-health", (req, res) => {
  return res.status(200).json({ healthy: true });
});

export { app };
