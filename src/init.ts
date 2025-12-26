import fs from "fs";
import assert from "assert";
import axios from "axios";
import { dirname } from "path";
import { fileURLToPath } from "url";
import mongoose, { Model } from "mongoose";
import * as AWS from "@aws-sdk/client-s3";
import { initialize } from "zokrates-js";
import logger from "./utils/logger.js";
import {
  userVerificationsSchema,
  idvSessionsSchema,
  sandboxIdvSessionsSchema,
  sessionSchema,
  sandboxSessionSchema,
  sessionRefundMutexSchema,
  userCredentialsSchema,
  userCredentialsV2Schema,
  sandboxUserCredentialsV2Schema,
  userProofMetadataSchema,
  EncryptedNullifiersSchema,
  sandboxEncryptedNullifiersSchema,
  NullifierAndCredsSchema,
  SandboxNullifierAndCredsSchema,
  CleanHandsNullifierAndCredsSchema,
  sandboxCleanHandsNullifierAndCredsSchema,
  BiometricsNullifierAndCredsSchema,
  DailyVerificationCountSchema,
  DailyVerificationDeletionsSchema,
  VerificationCollisionMetadataSchema,
  amlChecksSessionSchema,
  sandboxAmlChecksSessionSchema,
  biometricsSessionSchema,
  GalxeCampaignZeroUserSchema,
  SilkPeanutCampaignsMetadataSchema,
  OrderSchema,
  SandboxOrderSchema,
  HumanIDPaymentGateWhitelistSchema,
  CleanHandsSessionWhitelistSchema,
  SessionRetryWhitelistSchema,
  SanctionsResultSchema,
  DirectVerification as DirectVerificationSchemas,
  PaymentRedemptionSchema,
  SandboxPaymentRedemptionSchema,
  PaymentSecretSchema,
  SandboxPaymentSecretSchema,
  PaymentCommitmentSchema,
  SandboxPaymentCommitmentSchema,
  HumanIDCreditsUserSchema,
  SandboxHumanIDCreditsUserSchema,
  HumanIDCreditsPaymentSecretSchema,
  SandboxHumanIDCreditsPaymentSecretSchema
} from "./schemas.js";
import dotenv from "dotenv";
import {
  IDailyVerificationCount,
  IDailyVerificationDeletions,
  IUserVerifications,
  IIdvSessions,
  ISandboxIdvSessions,
  ISession,
  ISandboxSession,
  ISessionRefundMutex,
  IUserCredentials,
  IUserCredentialsV2,
  ISandboxUserCredentialsV2,
  IUserProofMetadata,
  IEncryptedNullifiers,
  ISandboxEncryptedNullifiers,
  INullifierAndCreds,
  ISandboxNullifierAndCreds,
  ICleanHandsNullifierAndCreds,
  ISandboxCleanHandsNullifierAndCreds,
  IBiometricsNullifierAndCreds,
  IVerificationCollisionMetadata,
  IAmlChecksSession,
  ISandboxAmlChecksSession,
  IBiometricsSession,
  IGalxeCampaignZeroUser,
  ISilkPeanutCampaignsMetadata,
  IOrder,
  ISandboxOrder,
  IHumanIDPaymentGateWhitelist,
  ICleanHandsSessionWhitelist,
  ISessionRetryWhitelist,
  ISanctionsResult,
  DirectVerification,
  SandboxVsLiveKYCRouteHandlerConfig,
  IPaymentRedemption,
  ISandboxPaymentRedemption,
  IPaymentSecret,
  ISandboxPaymentSecret,
  IPaymentCommitment,
  ISandboxPaymentCommitment,
  IHumanIDCreditsUser,
  ISandboxHumanIDCreditsUser,
  IHumanIDCreditsPaymentSecret,
  ISandboxHumanIDCreditsPaymentSecret
} from "./types.js";
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
      process.env.AWS_S3_ACCESS_KEY_ID,
      "AWS_S3_ACCESS_KEY_ID environment variable is not set"
    );
    assert.ok(
      process.env.AWS_S3_SECRET_ACCESS_KEY,
      "AWS_S3_SECRET_ACCESS_KEY environment variable is not set"
    );
    assert.ok(
      process.env.ADMIN_EMAILS,
      "ADMIN_EMAILS environment variable is not set"
    );
  }
}

async function initializeDailyVerificationCount(
  DailyVerificationCount: Model<IDailyVerificationCount>
) {
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

async function initializeDailyVerificationDeletions(
  DailyVerificationDeletions: Model<IDailyVerificationDeletions>
) {
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
  if (process.env.NODE_ENV != "development") {
    // Download certificate used for TLS connection
    try {
      const s3 = new AWS.S3({
        credentials: {
          accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID as string,
          secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY as string,
        },
        region: "us-east-1",
      });
      const params = {
        Bucket: process.env.BUCKET_NAME,
        Key: process.env.MONGO_CERT_FILE_NAME,
      };
      await new Promise<void>((resolve, reject) => {
        logger.info("Downloading certificate for MongoDB connection...");
        s3.getObject(params, async (getObjectErr: any, data: any) => {
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
    const mongoProdConfig = {
      ssl: true,
      sslValidate: true,
      sslCA: `${__dirname}/../../${process.env.MONGO_CERT_FILE_NAME}`,
      autoIndex: false
    };
    const mongoDevConfig = { autoIndex: true }
    await mongoose.connect(
      process.env.MONGO_DB_CONNECTION_STR as string,
      process.env.ENVIRONMENT == "dev" ? mongoDevConfig : mongoProdConfig
    );
    logger.info("Connected to MongoDB database.");
  } catch (err) {
    logger.error({ error: err }, "Unable to connect to MongoDB database.");
    throw err
  }
  const UserVerifications = mongoose.model(
    "UserVerifications",
    userVerificationsSchema
  );
  const IDVSessions = mongoose.model("IDVSessions", idvSessionsSchema);

  const SandboxIDVSessions = mongoose.model("SandboxIDVSessions", sandboxIdvSessionsSchema);

  const Session = mongoose.model("Session", sessionSchema);

  const SandboxSession = mongoose.model("SandboxSession", sandboxSessionSchema);

  const SessionRefundMutex = mongoose.model(
    "SessionRefundMutex",
    sessionRefundMutexSchema
  );

  const UserCredentials = mongoose.model("UserCredentials", userCredentialsSchema);

  const UserCredentialsV2 = mongoose.model(
    "UserCredentialsV2",
    userCredentialsV2Schema
  );

  const SandboxUserCredentialsV2 = mongoose.model(
    "SandboxUserCredentialsV2",
    sandboxUserCredentialsV2Schema
  );

  const UserProofMetadata = mongoose.model(
    "UserProofMetadata",
    userProofMetadataSchema
  );

  const EncryptedNullifiers = mongoose.model(
    "EncryptedNullifiers",
    EncryptedNullifiersSchema
  );

  const SandboxEncryptedNullifiers = mongoose.model(
    "SandboxEncryptedNullifiers",
    sandboxEncryptedNullifiersSchema
  );

  const NullifierAndCreds = mongoose.model(
    "NullifierAndCreds",
    NullifierAndCredsSchema
  );

  const SandboxNullifierAndCreds = mongoose.model(
    "SandboxNullifierAndCreds",
    SandboxNullifierAndCredsSchema
  );

  const CleanHandsNullifierAndCreds = mongoose.model(
    "CleanHandsNullifierAndCreds",
    CleanHandsNullifierAndCredsSchema
  );

  const SandboxCleanHandsNullifierAndCreds = mongoose.model(
    "SandboxCleanHandsNullifierAndCreds",
    sandboxCleanHandsNullifierAndCredsSchema
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

  const SandboxAMLChecksSession = mongoose.model("SandboxAMLChecksSession", sandboxAmlChecksSessionSchema);

  const BiometricsSession = mongoose.model("BiometricsSession", biometricsSessionSchema);

  // Even though we use the BiometricsSession schema here, we still want it to be
  // a separate collection. This makes sybil resistance management easier.
  const BiometricsAllowSybilsSession = mongoose.model("BiometricsAllowSybilsSession", biometricsSessionSchema);

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

  const SandboxOrder = mongoose.model("SandboxOrder", SandboxOrderSchema);

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

  const sessionRetryWhitelistName = "SessionRetryWhitelist"
  const SessionRetryWhitelist = mongoose.model(
    sessionRetryWhitelistName,
    SessionRetryWhitelistSchema,
    sessionRetryWhitelistName
  );

  const SanctionsResult = mongoose.model(
    "SanctionsResult",
    SanctionsResultSchema,
  );

  const DVCustomer = mongoose.model(
    "DirectVerificationCustomer",
    DirectVerificationSchemas.CustomerSchema
  );

  const DVAPIKey = mongoose.model(
    "DirectVerificationAPIKey",
    DirectVerificationSchemas.APIKeySchema
  );

  const DVOrder = mongoose.model(
    "DirectVerificationOrder",
    DirectVerificationSchemas.OrderSchema
  );

  const DVSession = mongoose.model(
    "DirectVerificationSession",
    DirectVerificationSchemas.SessionSchema
  );

  const PaymentRedemption = mongoose.model(
    "PaymentRedemption",
    PaymentRedemptionSchema
  );

  const SandboxPaymentRedemption = mongoose.model(
    "SandboxPaymentRedemption",
    SandboxPaymentRedemptionSchema
  );

  const PaymentSecret = mongoose.model(
    "PaymentSecret",
    PaymentSecretSchema
  );

  const SandboxPaymentSecret = mongoose.model(
    "SandboxPaymentSecret",
    SandboxPaymentSecretSchema
  );

  const PaymentCommitment = mongoose.model(
    "PaymentCommitment",
    PaymentCommitmentSchema
  );

  const SandboxPaymentCommitment = mongoose.model(
    "SandboxPaymentCommitment",
    SandboxPaymentCommitmentSchema
  );

  const HumanIDCreditsUser = mongoose.model(
    "HumanIDCreditsUser",
    HumanIDCreditsUserSchema
  );

  const SandboxHumanIDCreditsUser = mongoose.model(
    "SandboxHumanIDCreditsUser",
    SandboxHumanIDCreditsUserSchema
  );

  const HumanIDCreditsPaymentSecret = mongoose.model(
    "HumanIDCreditsPaymentSecret",
    HumanIDCreditsPaymentSecretSchema
  );

  const SandboxHumanIDCreditsPaymentSecret = mongoose.model(
    "SandboxHumanIDCreditsPaymentSecret",
    SandboxHumanIDCreditsPaymentSecretSchema
  );

  return {
    UserVerifications,
    IDVSessions,
    SandboxIDVSessions,
    Session,
    SandboxSession,
    SessionRefundMutex,
    UserCredentials,
    UserCredentialsV2,
    SandboxUserCredentialsV2,
    UserProofMetadata,
    EncryptedNullifiers,
    SandboxEncryptedNullifiers,
    NullifierAndCreds,
    SandboxNullifierAndCreds,
    CleanHandsNullifierAndCreds,
    SandboxCleanHandsNullifierAndCreds,
    BiometricsNullifierAndCreds,
    DailyVerificationCount,
    DailyVerificationDeletions,
    VerificationCollisionMetadata,
    AMLChecksSession,
    SandboxAMLChecksSession,
    BiometricsSession,
    BiometricsAllowSybilsSession,
    GalxeCampaignZeroUser,
    SilkPeanutCampaignsMetadata,
    Order,
    SandboxOrder,
    HumanIDPaymentGateWhitelist,
    CleanHandsSessionWhitelist,
    SessionRetryWhitelist,
    SanctionsResult,
    DVCustomer,
    DVAPIKey,
    DVOrder,
    DVSession,
    PaymentRedemption,
    SandboxPaymentRedemption,
    PaymentSecret,
    SandboxPaymentSecret,
    PaymentCommitment,
    SandboxPaymentCommitment,
    HumanIDCreditsUser,
    SandboxHumanIDCreditsUser,
    HumanIDCreditsPaymentSecret,
    SandboxHumanIDCreditsPaymentSecret
  };
}

validateEnv();

let UserVerifications: Model<IUserVerifications>,
  IDVSessions: Model<IIdvSessions>,
  SandboxIDVSessions: Model<ISandboxIdvSessions>,
  Session: Model<ISession>,
  SandboxSession: Model<ISandboxSession>,
  SessionRefundMutex: Model<ISessionRefundMutex>,
  UserCredentials: Model<IUserCredentials>,
  UserCredentialsV2: Model<IUserCredentialsV2>,
  SandboxUserCredentialsV2: Model<ISandboxUserCredentialsV2>,
  UserProofMetadata: Model<IUserProofMetadata>,
  EncryptedNullifiers: Model<IEncryptedNullifiers>,
  SandboxEncryptedNullifiers: Model<ISandboxEncryptedNullifiers>,
  NullifierAndCreds: Model<INullifierAndCreds>,
  SandboxNullifierAndCreds: Model<ISandboxNullifierAndCreds>,
  CleanHandsNullifierAndCreds: Model<ICleanHandsNullifierAndCreds>,
  SandboxCleanHandsNullifierAndCreds: Model<ISandboxCleanHandsNullifierAndCreds>,
  BiometricsNullifierAndCreds: Model<IBiometricsNullifierAndCreds>,
  DailyVerificationCount: Model<IDailyVerificationCount>,
  DailyVerificationDeletions: Model<IDailyVerificationDeletions>,
  VerificationCollisionMetadata: Model<IVerificationCollisionMetadata>,
  AMLChecksSession: Model<IAmlChecksSession>,
  SandboxAMLChecksSession: Model<ISandboxAmlChecksSession>,
  BiometricsSession: Model<IBiometricsSession>,
  BiometricsAllowSybilsSession: Model<IBiometricsSession>,
  GalxeCampaignZeroUser: Model<IGalxeCampaignZeroUser>,
  SilkPeanutCampaignsMetadata: Model<ISilkPeanutCampaignsMetadata>,
  Order: Model<IOrder>,
  SandboxOrder: Model<ISandboxOrder>,
  HumanIDPaymentGateWhitelist: Model<IHumanIDPaymentGateWhitelist>,
  CleanHandsSessionWhitelist: Model<ICleanHandsSessionWhitelist>,
  SessionRetryWhitelist: Model<ISessionRetryWhitelist>,
  SanctionsResult: Model<ISanctionsResult>,
  DVCustomer: Model<DirectVerification.ICustomer>,
  DVAPIKey: Model<DirectVerification.IAPIKey>,
  DVOrder: Model<DirectVerification.IOrder>,
  DVSession: Model<DirectVerification.ISession>,
  PaymentRedemption: Model<IPaymentRedemption>,
  SandboxPaymentRedemption: Model<ISandboxPaymentRedemption>,
  PaymentSecret: Model<IPaymentSecret>,
  SandboxPaymentSecret: Model<ISandboxPaymentSecret>,
  PaymentCommitment: Model<IPaymentCommitment>,
  SandboxPaymentCommitment: Model<ISandboxPaymentCommitment>,
  HumanIDCreditsUser: Model<IHumanIDCreditsUser>,
  SandboxHumanIDCreditsUser: Model<ISandboxHumanIDCreditsUser>,
  HumanIDCreditsPaymentSecret: Model<IHumanIDCreditsPaymentSecret>,
  SandboxHumanIDCreditsPaymentSecret: Model<ISandboxHumanIDCreditsPaymentSecret>;
initializeMongoDb().then((result) => {
  if (result) {
    logger.info("Initialized MongoDB connection");
    UserVerifications = result.UserVerifications;
    IDVSessions = result.IDVSessions;
    SandboxIDVSessions = result.SandboxIDVSessions;
    Session = result.Session;
    SandboxSession = result.SandboxSession;
    SessionRefundMutex = result.SessionRefundMutex;
    UserCredentials = result.UserCredentials;
    UserCredentialsV2 = result.UserCredentialsV2;
    SandboxUserCredentialsV2 = result.SandboxUserCredentialsV2;
    UserProofMetadata = result.UserProofMetadata;
    EncryptedNullifiers = result.EncryptedNullifiers;
    SandboxEncryptedNullifiers = result.SandboxEncryptedNullifiers;
    NullifierAndCreds = result.NullifierAndCreds;
    SandboxNullifierAndCreds = result.SandboxNullifierAndCreds;
    CleanHandsNullifierAndCreds = result.CleanHandsNullifierAndCreds;
    SandboxCleanHandsNullifierAndCreds = result.SandboxCleanHandsNullifierAndCreds;
    BiometricsNullifierAndCreds = result.BiometricsNullifierAndCreds;
    DailyVerificationCount = result.DailyVerificationCount;
    DailyVerificationDeletions = result.DailyVerificationDeletions;
    VerificationCollisionMetadata = result.VerificationCollisionMetadata;
    AMLChecksSession = result.AMLChecksSession;
    SandboxAMLChecksSession = result.SandboxAMLChecksSession;
    BiometricsSession = result.BiometricsSession;
    BiometricsAllowSybilsSession = result.BiometricsAllowSybilsSession;
    GalxeCampaignZeroUser = result.GalxeCampaignZeroUser;
    SilkPeanutCampaignsMetadata = result.SilkPeanutCampaignsMetadata;
    Order = result.Order;
    SandboxOrder = result.SandboxOrder;
    HumanIDPaymentGateWhitelist = result.HumanIDPaymentGateWhitelist;
    CleanHandsSessionWhitelist = result.CleanHandsSessionWhitelist;
    SessionRetryWhitelist = result.SessionRetryWhitelist;
    SanctionsResult = result.SanctionsResult;
    DVCustomer = result.DVCustomer;
    DVAPIKey = result.DVAPIKey;
    DVOrder = result.DVOrder;
    DVSession = result.DVSession;
    PaymentRedemption = result.PaymentRedemption;
    SandboxPaymentRedemption = result.SandboxPaymentRedemption;
    PaymentSecret = result.PaymentSecret;
    SandboxPaymentSecret = result.SandboxPaymentSecret;
    PaymentCommitment = result.PaymentCommitment;
    SandboxPaymentCommitment = result.SandboxPaymentCommitment;
    HumanIDCreditsUser = result.HumanIDCreditsUser;
    SandboxHumanIDCreditsUser = result.SandboxHumanIDCreditsUser;
    HumanIDCreditsPaymentSecret = result.HumanIDCreditsPaymentSecret;
    SandboxHumanIDCreditsPaymentSecret = result.SandboxHumanIDCreditsPaymentSecret;
  } else {
    logger.error("MongoDB initialization failed");
    throw new Error("MongoDB initialization failed");
  }
});

let zokProvider;
initialize().then((provider) => {
  logger.info("Initialized zokProvider");
  zokProvider = provider;
});

function getRouteHandlerConfig(environment: "sandbox" | "live"): SandboxVsLiveKYCRouteHandlerConfig {
  if (environment === "sandbox") {
    return {
      environment: "sandbox",
      onfidoAPIKey: process.env.ONFIDO_SANDBOX_API_TOKEN!,
      onfidoWebhookToken: process.env.ONFIDO_SANDBOX_WEBHOOK_TOKEN!,
      SessionModel: SandboxSession,
      IDVSessionsModel: SandboxIDVSessions,
      NullifierAndCredsModel: SandboxNullifierAndCreds,
      UserCredentialsV2Model: SandboxUserCredentialsV2,
      EncryptedNullifiersModel: SandboxEncryptedNullifiers,
      OrderModel: SandboxOrder,
      AMLChecksSessionModel: SandboxAMLChecksSession,
      CleanHandsNullifierAndCredsModel: SandboxCleanHandsNullifierAndCreds,
      SanctionsResultModel: SanctionsResult,
      PaymentRedemptionModel: SandboxPaymentRedemption,
      PaymentSecretModel: SandboxPaymentSecret,
      PaymentCommitmentModel: SandboxPaymentCommitment,
      issuerPrivateKey: process.env.HOLONYM_SANDBOX_KYC_ISSUER_PRIVKEY!,
      cleanHandsIssuerPrivateKey: process.env.HOLONYM_SANDBOX_CLEAN_HANDS_ISSUER_PRIVKEY!,
    }
  }

  return {
    environment: "live",
    onfidoAPIKey: process.env.ONFIDO_API_TOKEN!,
    onfidoWebhookToken: process.env.ONFIDO_WEBHOOK_TOKEN!,
    SessionModel: Session,
    IDVSessionsModel: IDVSessions,
    NullifierAndCredsModel: NullifierAndCreds,
    UserCredentialsV2Model: UserCredentialsV2,
    EncryptedNullifiersModel: EncryptedNullifiers,
    OrderModel: Order,
    PaymentRedemptionModel: PaymentRedemption,
    PaymentSecretModel: PaymentSecret,
    PaymentCommitmentModel: PaymentCommitment,
    AMLChecksSessionModel: AMLChecksSession,
    CleanHandsNullifierAndCredsModel: CleanHandsNullifierAndCreds,
    SanctionsResultModel: SanctionsResult,
    issuerPrivateKey: process.env.HOLONYM_ISSUER_PRIVKEY!,
    cleanHandsIssuerPrivateKey: process.env.HOLONYM_ISSUER_CLEAN_HANDS_PRIVKEY!,
  }
}

/**
 * Get route handler config for Human ID Credits endpoints
 */
function getCreditsRouteHandlerConfig(environment: "sandbox" | "live") {
  if (environment === "sandbox") {
    return {
      HumanIDCreditsUserModel: SandboxHumanIDCreditsUser,
      PaymentCommitmentModel: SandboxPaymentCommitment,
      HumanIDCreditsPaymentSecretModel: SandboxHumanIDCreditsPaymentSecret,
      PaymentRedemptionModel: SandboxPaymentRedemption,
    };
  }
  return {
    HumanIDCreditsUserModel: HumanIDCreditsUser,
    PaymentCommitmentModel: PaymentCommitment,
    HumanIDCreditsPaymentSecretModel: HumanIDCreditsPaymentSecret,
    PaymentRedemptionModel: PaymentRedemption,
  };
}

export {
  mongoose,
  UserVerifications,
  IDVSessions,
  SandboxIDVSessions,
  Session,
  SandboxSession,
  SessionRefundMutex,
  UserCredentials,
  UserCredentialsV2,
  SandboxUserCredentialsV2,
  UserProofMetadata,
  EncryptedNullifiers,
  SandboxEncryptedNullifiers,
  NullifierAndCreds,
  SandboxNullifierAndCreds,
  CleanHandsNullifierAndCreds,
  BiometricsNullifierAndCreds,
  DailyVerificationCount,
  DailyVerificationDeletions,
  VerificationCollisionMetadata,
  AMLChecksSession,
  SandboxAMLChecksSession,
  BiometricsSession,
  BiometricsAllowSybilsSession,
  GalxeCampaignZeroUser,
  SilkPeanutCampaignsMetadata,
  Order,
  SandboxOrder,
  HumanIDPaymentGateWhitelist,
  CleanHandsSessionWhitelist,
  SessionRetryWhitelist,
  SanctionsResult,
  DVCustomer,
  DVAPIKey,
  DVOrder,
  DVSession,
  PaymentRedemption,
  SandboxPaymentRedemption,
  PaymentCommitment,
  SandboxPaymentCommitment,
  HumanIDCreditsUser,
  SandboxHumanIDCreditsUser,
  HumanIDCreditsPaymentSecret,
  SandboxHumanIDCreditsPaymentSecret,
  zokProvider,
  getRouteHandlerConfig,
  getCreditsRouteHandlerConfig
};
