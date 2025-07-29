import fs from "fs";
import assert from "assert";
import axios from "axios";
import { dirname } from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import * as AWS from "@aws-sdk/client-s3";
import { initialize } from "zokrates-js";
import logger from "./utils/logger.js";
import {
  userVerificationsSchema,
  idvSessionsSchema,
  sessionSchema,
  sessionRefundMutexSchema,
  userCredentialsSchema,
  userCredentialsV2Schema,
  userProofMetadataSchema,
  EncryptedNullifiersSchema,
  NullifierAndCredsSchema,
  CleanHandsNullifierAndCredsSchema,
  BiometricsNullifierAndCredsSchema,
  DailyVerificationCountSchema,
  DailyVerificationDeletionsSchema,
  VerificationCollisionMetadataSchema,
  amlChecksSessionSchema,
  biometricsSessionSchema,
  GalxeCampaignZeroUserSchema,
  SilkPeanutCampaignsMetadataSchema,
  OrderSchema,
  HumanIDPaymentGateWhitelistSchema,
  CleanHandsSessionWhitelistSchema,
  SanctionsResultSchema
} from "./schemas.js";
import dotenv from "dotenv";
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const { Schema } = mongoose;
if (process.env.ENVIRONMENT == "dev") mongoose.set("debug", true);

function validateEnv() {
  // assert.ok(process.env.PRIVATE_KEY, "PRIVATE_KEY environment variable is not set");
  // assert.ok(process.env.ADDRESS, "ADDRESS environment variable is not set");

  assert.ok(
    process.env.HOLONYM_ISSUER_PRIVKEY,
    "HOLONYM_ISSUER_PRIVKEY environment variable is not set"
  );

  assert.ok(process.env.ENVIRONMENT, "ENVIRONMENT environment variable is not set");
  assert.ok(process.env.NODE_ENV, "NODE_ENV environment variable is not set");

  assert.ok(
    process.env.VERIFF_PUBLIC_API_KEY,
    "VERIFF_PUBLIC_API_KEY environment variable is not set"
  );
  assert.ok(
    process.env.VERIFF_SECRET_API_KEY,
    "VERIFF_SECRET_API_KEY environment variable is not set"
  );

  assert.ok(
    process.env.MONGO_DB_CONNECTION_STR,
    "MONGO_DB_CONNECTION_STR environment variable is not set"
  );

  if (process.env.NODE_ENV !== "development") {
    assert.ok(process.env.BUCKET_NAME, "BUCKET_NAME environment variable is not set");
    assert.ok(
      process.env.MONGO_CERT_FILE_NAME,
      "MONGO_CERT_FILE_NAME environment variable is not set"
    );
    assert.ok(
      process.env.AWS_ACCESS_KEY_ID,
      "AWS_ACCESS_KEY_ID environment variable is not set"
    );
    assert.ok(
      process.env.AWS_SECRET_ACCESS_KEY,
      "AWS_SECRET_ACCESS_KEY environment variable is not set"
    );
    assert.ok(
      process.env.ADMIN_EMAILS,
      "ADMIN_EMAILS environment variable is not set"
    );
  }
}

async function initializeDailyVerificationCount(DailyVerificationCount) {
  const DailyverificationCountCollection = await DailyVerificationCount.find();
  if (DailyverificationCountCollection.length == 0) {
    // TODO: Get total Veriff verifications
    // TODO: Get total iDenfy verifications
    const newDailyVerificationCount = new DailyVerificationCount({
      date: new Date().toISOString().slice(0, 10),
      veriff: {
        sessionCount: 0,
      },
      idenfy: {
        sessionCount: 0,
      },
    });
    await newDailyVerificationCount.save();
  }
}

async function initializeDailyVerificationDeletions(DailyVerificationDeletions) {
  const DailyVerificationDeletionsCollection = await DailyVerificationDeletions.find();
  if (DailyVerificationDeletionsCollection.length == 0) {
    const newDailyVerificationDeletions = new DailyVerificationDeletions({
      date: new Date().toISOString().slice(0, 10),
      deletionCount: 0,
    });
    await newDailyVerificationDeletions.save();
  }
}

async function initializeMongoDb() {
  if (process.env.ENVIRONMENT != "dev") {
    // Download certificate used for TLS connection
    try {
      const s3 = new AWS.S3({
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
        region: "us-east-1",
      });
      const params = {
        Bucket: process.env.BUCKET_NAME,
        Key: process.env.MONGO_CERT_FILE_NAME,
      };
      await new Promise((resolve, reject) => {
        logger.info("Downloading certificate for MongoDB connection...");
        s3.getObject(params, async (getObjectErr, data) => {
          if (getObjectErr) reject(getObjectErr);
          const bodyStream = data.Body;
          const bodyAsString = await bodyStream.transformToString();
          fs.writeFile(
            `${__dirname}/../../${process.env.MONGO_CERT_FILE_NAME}`,
            bodyAsString,
            (writeFileErr) => {
              if (writeFileErr) {
                logger.error(
                  { error: writeFileErr },
                  "Encountered error while trying to write cert file for MongoDB connection."
                );
                return resolve();
              }
              logger.info(
                "Successfully downloaded certificate for MongoDB connection"
              );
              resolve();
            }
          );
        });
      });
    } catch (err) {
      logger.error(
        { error: err },
        "Unable to download certificate for MongoDB connection."
      );
      return;
    }
  }

  try {
    const mongoConfig = {
      ssl: true,
      sslValidate: true,
      sslCA: `${__dirname}/../../${process.env.MONGO_CERT_FILE_NAME}`,
    };
    await mongoose.connect(
      process.env.MONGO_DB_CONNECTION_STR,
      process.env.ENVIRONMENT == "dev" ? {} : mongoConfig
    );
    logger.info("Connected to MongoDB database.");
  } catch (err) {
    logger.error({ error: err }, "Unable to connect to MongoDB database.");
    return;
  }
  const UserVerifications = mongoose.model(
    "UserVerifications",
    userVerificationsSchema
  );
  const IDVSessions = mongoose.model("IDVSessions", idvSessionsSchema);

  const Session = mongoose.model("Session", sessionSchema);

  const SessionRefundMutex = mongoose.model(
    "SessionRefundMutex",
    sessionRefundMutexSchema
  );

  const UserCredentials = mongoose.model("UserCredentials", userCredentialsSchema);

  const UserCredentialsV2 = mongoose.model(
    "UserCredentialsV2",
    userCredentialsV2Schema
  );

  const UserProofMetadata = mongoose.model(
    "UserProofMetadata",
    userProofMetadataSchema
  );

  const EncryptedNullifiers = mongoose.model(
    "EncryptedNullifiers",
    EncryptedNullifiersSchema
  )

  const NullifierAndCreds = mongoose.model(
    "NullifierAndCreds",
    NullifierAndCredsSchema
  );

  const CleanHandsNullifierAndCreds = mongoose.model(
    "CleanHandsNullifierAndCreds",
    CleanHandsNullifierAndCredsSchema
  );

  const BiometricsNullifierAndCreds = mongoose.model(
    "BiometricsNullifierAndCreds",
    BiometricsNullifierAndCredsSchema
  );

  const DailyVerificationCount = mongoose.model(
    "DailyVerificationCount",
    DailyVerificationCountSchema
  );

  const DailyVerificationDeletions = mongoose.model(
    "DailyVerificationDeletionsSchema",
    DailyVerificationDeletionsSchema
  );

  const VerificationCollisionMetadata = mongoose.model(
    "VerificationCollisionMetadata",
    VerificationCollisionMetadataSchema
  );

  const AMLChecksSession = mongoose.model("AMLChecksSession", amlChecksSessionSchema);

  const BiometricsSession = mongoose.model("BiometricsSession", biometricsSessionSchema);

  const GalxeCampaignZeroUser = mongoose.model(
    "GalxeCampaignZeroUser",
    GalxeCampaignZeroUserSchema
  );

  const SilkPeanutCampaignsMetadata = mongoose.model(
    "SilkPeanutCampaignsMetadata",
    SilkPeanutCampaignsMetadataSchema
  );
  await initializeDailyVerificationCount(DailyVerificationCount);
  await initializeDailyVerificationDeletions(DailyVerificationDeletions);

  const Order = mongoose.model("Order", OrderSchema);

  const humanIDPaymenGateWhitelistName = "HumanIDPaymentGateWhitelist"
  const HumanIDPaymentGateWhitelist = mongoose.model(
    humanIDPaymenGateWhitelistName,
    HumanIDPaymentGateWhitelistSchema,
    humanIDPaymenGateWhitelistName
  );

  const cleanHandsSessionWhitelistName = "CleanHandsSessionWhitelist"
  const CleanHandsSessionWhitelist = mongoose.model(
    cleanHandsSessionWhitelistName,
    CleanHandsSessionWhitelistSchema,
    cleanHandsSessionWhitelistName
  );

  const SanctionsResult = mongoose.model(
    "SanctionsResult",
    SanctionsResultSchema,
  );

  return {
    UserVerifications,
    IDVSessions,
    Session,
    SessionRefundMutex,
    UserCredentials,
    UserCredentialsV2,
    UserProofMetadata,
    EncryptedNullifiers,
    NullifierAndCreds,
    CleanHandsNullifierAndCreds,
    BiometricsNullifierAndCreds,
    DailyVerificationCount,
    DailyVerificationDeletions,
    VerificationCollisionMetadata,
    AMLChecksSession,
    BiometricsSession,
    GalxeCampaignZeroUser,
    SilkPeanutCampaignsMetadata,
    Order,
    HumanIDPaymentGateWhitelist,
    CleanHandsSessionWhitelist,
    SanctionsResult,
  };
}

validateEnv();

let UserVerifications,
  IDVSessions,
  Session,
  SessionRefundMutex,
  UserCredentials,
  UserCredentialsV2,
  UserProofMetadata,
  EncryptedNullifiers,
  NullifierAndCreds,
  CleanHandsNullifierAndCreds,
  BiometricsNullifierAndCreds,
  DailyVerificationCount,
  DailyVerificationDeletions,
  VerificationCollisionMetadata,
  AMLChecksSession,
  BiometricsSession,
  GalxeCampaignZeroUser,
  SilkPeanutCampaignsMetadata,
  Order,
  HumanIDPaymentGateWhitelist,
  CleanHandsSessionWhitelist,
  SanctionsResult;
initializeMongoDb().then((result) => {
  if (result) {
    logger.info("Initialized MongoDB connection");
    UserVerifications = result.UserVerifications;
    IDVSessions = result.IDVSessions;
    Session = result.Session;
    SessionRefundMutex = result.SessionRefundMutex;
    UserCredentials = result.UserCredentials;
    UserCredentialsV2 = result.UserCredentialsV2;
    UserProofMetadata = result.UserProofMetadata;
    EncryptedNullifiers = result.EncryptedNullifiers;
    NullifierAndCreds = result.NullifierAndCreds;
    CleanHandsNullifierAndCreds = result.CleanHandsNullifierAndCreds;
    BiometricsNullifierAndCreds = result.BiometricsNullifierAndCreds;
    DailyVerificationCount = result.DailyVerificationCount;
    DailyVerificationDeletions = result.DailyVerificationDeletions;
    VerificationCollisionMetadata = result.VerificationCollisionMetadata;
    AMLChecksSession = result.AMLChecksSession;
    BiometricsSession = result.BiometricsSession;
    GalxeCampaignZeroUser = result.GalxeCampaignZeroUser;
    SilkPeanutCampaignsMetadata = result.SilkPeanutCampaignsMetadata;
    Order = result.Order;
    HumanIDPaymentGateWhitelist = result.HumanIDPaymentGateWhitelist;
    CleanHandsSessionWhitelist = result.CleanHandsSessionWhitelist;
    SanctionsResult = result.SanctionsResult
  } else {
    logger.error("MongoDB initialization failed");
  }
});

let zokProvider;
initialize().then((provider) => {
  logger.info("Initialized zokProvider");
  zokProvider = provider;
});

export {
  mongoose,
  UserVerifications,
  IDVSessions,
  Session,
  SessionRefundMutex,
  UserCredentials,
  UserCredentialsV2,
  UserProofMetadata,
  EncryptedNullifiers,
  NullifierAndCreds,
  CleanHandsNullifierAndCreds,
  BiometricsNullifierAndCreds,
  DailyVerificationCount,
  DailyVerificationDeletions,
  VerificationCollisionMetadata,
  AMLChecksSession,
  BiometricsSession,
  GalxeCampaignZeroUser,
  SilkPeanutCampaignsMetadata,
  Order,
  HumanIDPaymentGateWhitelist,
  CleanHandsSessionWhitelist,
  SanctionsResult,
  zokProvider,
};
