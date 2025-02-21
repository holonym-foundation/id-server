import express from "express";
import cors from "cors";
import veriff from "./routes/veriff-kyc.js";
import idenfy from "./routes/idenfy.js";
import onfido from "./routes/onfido.js";
import credentials from "./routes/credentials.js";
import proofMetadata from "./routes/proof-metadata.js";
import admin from "./routes/admin.js";
import sessionStatus from "./routes/session-status.js";
import ipInfo from "./routes/ip-info.js";
import prices from "./routes/prices.js";
import sessions from "./routes/sessions.js";
import amlSessions from "./routes/aml-sessions.js";
import silk from "./routes/silk.js";
import facetec from "./routes/facetec.js";
import orders from "./routes/orders.js";

const app = express();

var corsOptions = {
  origin: true,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};
app.use(cors(corsOptions));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

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
app.use("/prices", prices);
app.use("/silk", silk); // temporary
app.use("/facetec", facetec);
app.use("/orders", orders);

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
