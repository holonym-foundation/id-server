import fs from "fs";
import assert from "assert";
import { dirname } from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import * as AWS from "@aws-sdk/client-s3";
import {
  userVerificationsSchema,
  idvSessionsSchema,
  sessionSchema,
  sessionRefundMutexSchema,
  amlChecksSessionSchema,
} from "./schemas.js";
import { logAndPersistLogUpdate } from './logger.js'
import dotenv from "dotenv";
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const { Schema } = mongoose;
// if (process.env.ENVIRONMENT == "dev") 
mongoose.set("debug", true);

async function initializeMongoDb() {
  // if (process.env.ENVIRONMENT != "dev") {
  //   // Download certificate used for TLS connection
  //   try {
  //     const s3 = new AWS.S3({
  //       credentials: {
  //         accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
  //         secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  //       },
  //       region: "us-east-1",
  //     });
  //     const params = {
  //       Bucket: process.env.BUCKET_NAME,
  //       Key: process.env.MONGO_CERT_FILE_NAME,
  //     };
  //     await new Promise<void>((resolve, reject) => {
  //       logAndPersistLogUpdate("Downloading certificate for MongoDB connection...");
  //       s3.getObject(params, async (getObjectErr: any, data: any) => {
  //         logAndPersistLogUpdate('entered s3.getObject callback')
  //         if (getObjectErr) reject(getObjectErr);
  //         const bodyStream = data.Body;
  //         const bodyAsString = await bodyStream.transformToString();
  //         logAndPersistLogUpdate(`writing to file (${__dirname}/../../${process.env.MONGO_CERT_FILE_NAME})`)
  //         fs.writeFile(
  //           `${__dirname}/../../${process.env.MONGO_CERT_FILE_NAME}`,
  //           bodyAsString,
  //           (writeFileErr) => {
  //             if (writeFileErr) {
  //               logAndPersistLogUpdate(
  //                 { error: writeFileErr },
  //                 "Encountered error while trying to write cert file for MongoDB connection."
  //               );
  //               return resolve();
  //             }
  //             logAndPersistLogUpdate(
  //               "Successfully downloaded certificate for MongoDB connection"
  //             );
  //             resolve();
  //           }
  //         );
  //       });
  //     });
  //   } catch (err) {
  //     logAndPersistLogUpdate(
  //       { error: err },
  //       "Unable to download certificate for MongoDB connection."
  //     );
  //     return;
  //   }
  // }

  try {
    const mongoConfig = {
      ssl: true,
      sslValidate: true,
      sslCA: `${__dirname}/../${process.env.MONGO_CERT_FILE_NAME}`,
    };
    await mongoose.connect(
      process.env.MONGO_DB_CONNECTION_STR as string,
      process.env.ENVIRONMENT == "dev" ? {} : mongoConfig
    );
    logAndPersistLogUpdate("Connected to MongoDB database.");
  } catch (err) {
    logAndPersistLogUpdate({ error: err }, "Unable to connect to MongoDB database.");
    return;
  }
//   const UserVerifications = mongoose.model(
//     "UserVerifications",
//     userVerificationsSchema
//   );
//   const IDVSessions = mongoose.model("IDVSessions", idvSessionsSchema);

//   const Session = mongoose.model("Session", sessionSchema);

//   const SessionRefundMutex = mongoose.model(
//     "SessionRefundMutex",
//     sessionRefundMutexSchema
//   );

//   const AMLChecksSession = mongoose.model("AMLChecksSession", amlChecksSessionSchema);

  return {
    // UserVerifications,
    // IDVSessions,
    // Session,
    // SessionRefundMutex,
    // AMLChecksSession,
  };
}

// let UserVerifications,
//   IDVSessions,
//   Session,
//   SessionRefundMutex,
//   AMLChecksSession;

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

const AMLChecksSession = mongoose.model("AMLChecksSession", amlChecksSessionSchema);


initializeMongoDb().then((result) => {
  if (result) {
    logAndPersistLogUpdate("Initialized MongoDB connection");
    // UserVerifications = result.UserVerifications;
    // IDVSessions = result.IDVSessions;
    // Session = result.Session;
    // SessionRefundMutex = result.SessionRefundMutex;
    // AMLChecksSession = result.AMLChecksSession;
  } else {
    logAndPersistLogUpdate("MongoDB initialization failed");
  }
});

export {
  mongoose,
  UserVerifications,
  IDVSessions,
  Session,
  SessionRefundMutex,
  AMLChecksSession,
};
