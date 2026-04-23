import { strict as assert } from "node:assert";
import ethersPkg from "ethers";
const { ethers } = ethersPkg;
import { poseidon } from "circomlibjs-old";
import { ObjectId } from "mongodb";
import {
  Session,
  UserVerifications,
  VerificationCollisionMetadata,
  NullifierAndCreds,
} from "../../init.js";
import { issue } from "holonym-wasm-issuer";
// import { issue as issuev2 } from "holonym-wasm-issuer-v2";
import {
  getDateAsInt,
  sha256,
  govIdUUID,
  objectIdElevenMonthsAgo,
  objectIdFiveDaysAgo,
  dateElevenMonthsAgo,
  dateElevenMonthsFromNow,
  dateFiveDaysAgo,
} from "../../utils/utils.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import {
  newDummyUserCreds,
  countryCodeToPrime,
} from "../../utils/constants.js";
import { sessionStatusEnum } from "../../constants/misc.js";
import {
  getVeriffSessionDecision,
  deleteVeriffSession,
} from "../../utils/veriff.js";
import { findUserVerification } from "../../utils/user-verifications.js"
import { getSessionById, failSession } from "../../utils/sessions.js"
import {
  findOneNullifierAndCredsLast5Days
} from "../../utils/nullifier-and-creds.js"
import { issuev2KYC } from "../../utils/issuance.js";
import { toAlreadyRegisteredStr } from "../../utils/errors.js"
import { upgradeV3Logger } from "./error-logger.js"

const endpointLogger = logger.child({
  msgPrefix: "[GET /veriff/credentials] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "veriff",
    feature: "holonym",
    subFeature: "gov-id",
  },
});

const endpointLoggerV3 = upgradeV3Logger(logger.child({
  msgPrefix: "[GET /veriff/v3/credentials] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "veriff",
    feature: "holonym",
    subFeature: "gov-id",
  },
}));

//TODO: Improve dd logs and error messages

function validateSession(session, metaSession) {
  if (session.status !== "success") {
    return {
      error: `Verification failed. Status '${session.status}' indicates the verification was not successful.`,
      log: {
        msg: "Verification failed due to unsuccessful status",
        data: {
          status: session.status,
          details:
            "The verification session did not complete successfully. This could mean the session was abandoned, expired, or had technical issues.",
          tags: [
            "action:validateSession",
            "error:unsuccessfulStatus",
            "stage:sessionValidation",
          ],
        },
      },
    };
  }

  if (session.verification?.code !== 9001) {
    // Map verification codes to human-readable messages
    const verificationMessages = {
      9102: "The verification was declined. This could be due to: suspected document tampering, document/person mismatch, suspicious behavior, or known fraud patterns.",
      9103: "Verification requires resubmission. Common reasons include: poor image quality, incomplete document visibility, or expired documents.",
      9104: "The verification session has expired. Please start a new verification session.",
      9121: "The verification was abandoned before completion.",
    };

    return {
      error: `Verification failed: ${
        verificationMessages[session.verification?.code] ||
        "Unknown verification code"
      }`,
      log: {
        msg: "Verification failed due to non-approval code",
        data: {
          code: session.verification?.code,
          expectedCode: 9001,
          details:
            verificationMessages[session.verification?.code] ||
            "Unknown verification reason",
          tags: [
            "action:validateSession",
            "error:invalidVerificationCode",
            "stage:verificationValidation",
          ],
        },
      },
    };
  }

  if (session.verification.status !== "approved") {
    return {
      error: `Verification status '${session.verification.status}' indicates the verification was not approved. This could be due to document issues, identity mismatch, or quality problems.`,
      log: {
        msg: "Verification failed due to non-approved status",
        data: {
          status: session.verification.status,
          details:
            "The verification was completed but did not receive approval. This typically indicates issues with document validity or identity verification.",
          tags: [
            "action:validateSession",
            "error:notApproved",
            "stage:verificationValidation",
          ],
        },
      },
    };
  }

  const necessaryPersonFields = ["firstName", "lastName", "dateOfBirth"];
  const person = session.verification.person;
  for (const field of necessaryPersonFields) {
    if (!(field in person)) {
      return {
        error: `Verification missing necessary field: ${field}.`,
        log: {
          msg: `Verification missing necessary field: ${field}.`,
        },
      };
    }
  }
  // NOTE: Veriff does not include addresses in test sessions
  // BIG NOTE: We are removing address temporarily since Veriff only supports
  // it for their enterprise clients.
  // const address = person.addresses?.[0]?.parsedAddress;
  // if (!address) {
  //   return {
  //     error: "Verification missing necessary field: address.",
  //     log: `Verification missing necessary field: address. Exiting.`,
  //   };
  // }
  // if (!("postcode" in address)) {
  //   return {
  //     error: "Verification missing necessary field: postcode.",
  //     log: `Verification missing necessary field: postcode. Exiting.`,
  //   };
  // }
  const doc = session.verification.document;
  if (!doc) {
    return {
      error: "Verification missing necessary field: document.",
      log: {
        msg: "Verification missing necessary field: document.",
      },
    };
  }
  if (!("country" in doc)) {
    return {
      error: "Verification missing necessary field: country.",
      log: {
        msg: "Verification missing necessary field: country.",
      },
    };
  }
  const countryCode =
    countryCodeToPrime[session?.verification?.document?.country];
  if (!countryCode) {
    return {
      error: `Unsupported country: ${session?.verification?.document?.country}.`,
      log: {
        msg: `Unsupported country`,
        data: {
          country: session?.verification?.document?.country,
        },
      },
    };
  }
  // if !metaSession.ipCountry, then the session was created before we added
  // the ipCountry attribute. Because this is only ~3k sessions and to reduce tickets,
  // we can ignore this check for such sessions.
  // NOTE: May 14, 2024: We are disablign the ipCountry check because it seems to be
  // turning down honest users while being game-able by sybils.
  // if (metaSession.ipCountry && (countryCode != countryCodeToPrime[metaSession.ipCountry])) {
  //   return {
  //     error: `Country code mismatch. Session country is '${metaSession.ipCountry}', but document country is '${session?.verification?.document?.country}'.`,
  //     log: {
  //       msg: "Country code mismatch",
  //       data: { expected: countryCodeToPrime[metaSession.ipCountry], got: countryCode },
  //     },
  //   };
  // }
  return { success: true };
}

function throwVeriffSessionValidationError(validationResult, veriffSession) {
  throw {
    status: 400,
    error: validationResult.error,
    details: {
      status: veriffSession.status,
      verification: {
        code: veriffSession.verification?.code,
        status: veriffSession.verification?.status,
      },
    },
  };
}

function throwVeriffSessionTempUnavailable() {
  throw {
    status: 503,
    error:
      "Unable to check verification status at this moment. Please try again in a few minutes.",
    details: {
      retryable: true,
    },
  };
}

function uuidOldFromVeriffSession(veriffSession) {
  const uuidConstituents =
    (veriffSession.verification.person.firstName || "") +
    (veriffSession.verification.person.lastName || "") +
    (veriffSession.verification.person.addresses?.[0]?.postcode || "") +
    (veriffSession.verification.person.dateOfBirth || "");
  return sha256(Buffer.from(uuidConstituents)).toString("hex");
}

function uuidNewFromVeriffSession(veriffSession) {
  return govIdUUID(
    veriffSession.verification.person.firstName,
    veriffSession.verification.person.lastName,
    veriffSession.verification.person.dateOfBirth
  )
}

function extractCreds(session) {
  const person = session.verification.person;
  const address = person.addresses?.[0]?.parsedAddress;
  const countryCode = countryCodeToPrime[session.verification.document.country];
  assert.ok(countryCode, "Unsupported country");
  const birthdate = person.dateOfBirth ? person.dateOfBirth : "";
  const birthdateNum = birthdate ? getDateAsInt(birthdate) : 0;
  const firstNameStr = person.firstName ? person.firstName : "";
  const firstNameBuffer = firstNameStr
    ? Buffer.from(firstNameStr)
    : Buffer.alloc(1);
  // Veriff doesn't support middle names, but we keep it for backwards compatibility
  // const middleNameStr = person.middleName ? person.middleName : "";
  // const middleNameBuffer = middleNameStr
  //   ? Buffer.from(middleNameStr)
  //   : Buffer.alloc(1);
  const middleNameStr = "";
  const middleNameBuffer = Buffer.alloc(1);
  const lastNameStr = person.lastName ? person.lastName : "";
  const lastNameBuffer = lastNameStr
    ? Buffer.from(lastNameStr)
    : Buffer.alloc(1);
  const nameArgs = [firstNameBuffer, middleNameBuffer, lastNameBuffer].map(
    (x) => ethers.BigNumber.from(x).toString()
  );
  const nameHash = ethers.BigNumber.from(poseidon(nameArgs)).toString();
  // BIG NOTE: We assume all address fields are empty since Veriff only supports
  // parsedAddress field for their enterprise clients. If you are reading this
  // and we have become an enterprise client with the parsedAddress option, this
  // note is obsolete.
  const cityStr = address?.city ? address.city : "";
  const cityBuffer = cityStr ? Buffer.from(cityStr) : Buffer.alloc(1);
  const subdivisionStr = address?.state ? address.state : "";
  const subdivisionBuffer = subdivisionStr
    ? Buffer.from(subdivisionStr)
    : Buffer.alloc(1);
  const streetNumber = Number(address?.houseNumber ? address.houseNumber : 0);
  const streetNameStr = address?.street ? address.street : "";
  const streetNameBuffer = streetNameStr
    ? Buffer.from(streetNameStr)
    : Buffer.alloc(1);
  const streetUnit = address?.unit?.includes("apt ")
    ? Number(address?.unit?.replace("apt ", ""))
    : address?.unit != null && typeof Number(address?.unit) == "number"
    ? Number(address?.unit)
    : 0;
  const addrArgs = [streetNumber, streetNameBuffer, streetUnit].map((x) =>
    ethers.BigNumber.from(x).toString()
  );
  const streetHash = ethers.BigNumber.from(poseidon(addrArgs)).toString();
  const zipCode = Number(address?.postcode ? address.postcode : 0);
  const addressArgs = [cityBuffer, subdivisionBuffer, zipCode, streetHash].map(
    (x) => ethers.BigNumber.from(x)
  );
  const addressHash = ethers.BigNumber.from(poseidon(addressArgs)).toString();
  // BIG NOTE: We are not including expiration date in issued credentials, but
  // we might in the future.
  // const expireDateSr = session.verification.document?.validUntil ?? "";
  const expireDateSr = "";
  const expireDateNum = expireDateSr ? getDateAsInt(expireDateSr) : 0;
  const nameDobAddrExpireArgs = [
    nameHash,
    birthdateNum,
    addressHash,
    expireDateNum,
  ].map((x) => ethers.BigNumber.from(x).toString());
  const nameDobAddrExpire = ethers.BigNumber.from(
    poseidon(nameDobAddrExpireArgs)
  ).toString();
  return {
    rawCreds: {
      countryCode: countryCode,
      firstName: firstNameStr,
      middleName: middleNameStr,
      lastName: lastNameStr,
      city: cityStr,
      subdivision: subdivisionStr,
      zipCode: address?.postcode ? address.postcode : 0,
      streetNumber: streetNumber,
      streetName: streetNameStr,
      streetUnit: streetUnit,
      completedAt: session.verification.decisionTime
        ? session.verification.decisionTime.split("T")[0]
        : "",
      birthdate: birthdate,
      expirationDate: expireDateSr,
    },
    derivedCreds: {
      nameDobCitySubdivisionZipStreetExpireHash: {
        value: nameDobAddrExpire,
        derivationFunction: "poseidon",
        inputFields: [
          "derivedCreds.nameHash.value",
          "rawCreds.birthdate",
          "derivedCreds.addressHash.value",
          "rawCreds.expirationDate",
        ],
      },
      streetHash: {
        value: streetHash,
        derivationFunction: "poseidon",
        inputFields: [
          "rawCreds.streetNumber",
          "rawCreds.streetName",
          "rawCreds.streetUnit",
        ],
      },
      addressHash: {
        value: addressHash,
        derivationFunction: "poseidon",
        inputFields: [
          "rawCreds.city",
          "rawCreds.subdivision",
          "rawCreds.zipCode",
          "derivedCreds.streetHash.value",
        ],
      },
      nameHash: {
        value: nameHash,
        derivationFunction: "poseidon",
        inputFields: [
          "rawCreds.firstName",
          "rawCreds.middleName",
          "rawCreds.lastName",
        ],
      },
    },
    fieldsInLeaf: [
      "issuer",
      "secret",
      "rawCreds.countryCode",
      "derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value",
      "rawCreds.completedAt",
      "scope",
    ],
  };
}

async function saveCollisionMetadata(uuid, uuidV2, sessionId, session) {
  try {
    const collisionMetadataDoc = new VerificationCollisionMetadata({
      uuid: uuid,
      uuidV2: uuidV2,
      timestamp: new Date(),
      sessionId: sessionId,
      // uuidConstituents: {
      //   firstName: {
      //     populated: !!session.verification.person.firstName,
      //   },
      //   lastName: {
      //     populated: !!session.verification.person.lastName,
      //   },
      //   postcode: {
      //     populated: !!session.verification.person.addresses?.[0]?.postcode,
      //   },
      //   dateOfBirth: {
      //     populated: !!session.verification.person.dateOfBirth,
      //   },
      // },
    });

    await collisionMetadataDoc.save();
  } catch (err) {
    console.log("Error recording collision metadata", err);
  }
}

async function saveUserToDb(uuidV2, sessionId) {
  const userVerificationsDoc = new UserVerifications({
    govId: {
      uuidV2: uuidV2,
      sessionId: sessionId,
      issuedAt: new Date(),
      expiresAt: dateElevenMonthsFromNow(),
    },
  });
  try {
    await userVerificationsDoc.save();
  } catch (err) {
    endpointLogger.error(
      { error: err },
      "An error occurred while saving userVerificationsDoc to database"
    );
    return {
      error:
        "An error occurred while trying to save object to database. Please try again.",
    };
  }
  return { success: true };
}

async function getSession(sessionId) {
  const metaSession = await Session.findOne({ sessionId }).exec();

  if (!metaSession) {
    throw new Error("Session not found");
  }

  return metaSession;
}

async function updateSessionStatus(sessionId, status, failureReason) {
  try {
    // TODO: Once pay-first frontend is pushed, remove the try-catch. We want
    // this endpoint to fail if we can't update the session.
    const metaSession = await Session.findOne({ sessionId }).exec();
    metaSession.status = status;
    if (failureReason) metaSession.verificationFailureReason = failureReason;
    await metaSession.save();
  } catch (err) {
    console.log("onfido/credentials: Error updating session status", err);
  }
}

/**
 * ENDPOINT
 *
 * Allows user to retrieve their signed verification info
 */
async function getCredentials(req, res) {
  try {
    if (process.env.ENVIRONMENT == "dev") {
      const creds = newDummyUserCreds;

      const response = issue(
        process.env.HOLONYM_ISSUER_PRIVKEY,
        creds.rawCreds.countryCode.toString(),
        creds.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
      );
      response.metadata = newDummyUserCreds;

      return res.status(200).json(response);
    }

    if (!req?.query?.sessionId) {
      return res.status(400).json({ error: "No sessionId specified" });
    }

    const metaSession = await getSession(req.query.sessionId);
    if (metaSession.status !== sessionStatusEnum.IN_PROGRESS) {
      if (metaSession.status === sessionStatusEnum.VERIFICATION_FAILED) {
        return res.status(400).json({
          error: `Verification failed. Reason(s): ${metaSession.verificationFailureReason}`,
        });
      }
      return res.status(400).json({
        error: `Session status is '${metaSession.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
      });
    }

    const session = await getVeriffSessionDecision(req.query.sessionId);

    if (!session) {
      endpointLogger.error(
        {
          sessionId: req.query.sessionId,
          tags: [
            "action:getVeriffSessionDecision",
            "error:noSession",
            "stage:getVeriffSessionDecision",
          ],
        },
        "Failed to retrieve Verrif session."
      );
      return res
        .status(400)
        .json({ error: "Failed to retrieve Verrif session." });
    }

    const validationResult = validateSession(session, metaSession);
    if (validationResult.error) {
      endpointLogger.error(validationResult.log.data, validationResult.log.msg);
      await updateSessionStatus(
        req.query.sessionId,
        sessionStatusEnum.VERIFICATION_FAILED,
        validationResult.error
      );
      return res.status(400).json({
        error: validationResult.error,
        details: {
          status: session.status,
          verification: {
            code: session.verification?.code,
            status: session.verification?.status,
          },
        },
      });
    }

    // Get UUID
    const uuidOld = uuidOldFromVeriffSession(session);
    const uuidNew = uuidNewFromVeriffSession(session);

    // We started using a new UUID generation method on May 24, 2024, but we still
    // want to check the database for the old UUIDs too.

    // Assert user hasn't registered yet
    const user = await findUserVerification(uuidNew, "govId", {
      issuedAt: { after: dateElevenMonthsAgo() },
      // Ignore expired user verifications
      expiresAt: { after: new Date() }
    });
    if (user) {
      await saveCollisionMetadata(
        uuidOld,
        uuidNew,
        req.query.sessionId,
        session
      );

      endpointLogger.error(
        {
          uuidV2: uuidNew,
          tags: [
            "action:RegisterUser",
            "error:UserAlreadyRegistered",
            "stage:RegisterUser",
          ],
        },
        "User has already registered."
      );
      await updateSessionStatus(
        req.query.sessionId,
        sessionStatusEnum.VERIFICATION_FAILED,
        `User has already registered. User ID: ${user._id}`
      );
      return res
        .status(400)
        .json({ error: `User has already registered. User ID: ${user._id}` });
    }

    // Store UUID for Sybil resistance
    const dbResponse = await saveUserToDb(uuidNew, req.query.sessionId);
    if (dbResponse.error) return res.status(400).json(dbResponse);

    const creds = extractCreds(session);

    const response = issue(
      process.env.HOLONYM_ISSUER_PRIVKEY,
      creds.rawCreds.countryCode.toString(),
      creds.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
    );
    response.metadata = creds;

    await deleteVeriffSession(req.query.sessionId);

    // TODO: MAYBE: Update IDVSessions. Set the status to "credentials-issued" and add the UUID.
    // This will help us ensure that we never display a "completed - click here to retrieve your
    // credentials" message to the user if their verification is complete but their creds haven't
    // been signed by Holonym (and returned) yet. It's not necessary to set status to
    // "credentials-issued" since the frontend can check for the presence of gov ID creds; however,
    // if there's a bug between the end of this function and credential storage logic in the
    // frontend, then the user might see "completed - click, etc." even after their creds have
    // been issued.

    endpointLogger.info(
      { uuidV2: uuidNew, sessionId: req.query.sessionId },
      "Issuing credentials"
    );

    await updateSessionStatus(req.query.sessionId, sessionStatusEnum.ISSUED);

    return res.status(200).json(response);
  } catch (err) {
    console.error(err);
    return res.status(500).send();
  }
}

/**
 * ENDPOINT
 *
 * Allows user to retrieve their signed verification info.
 *
 * This endpoint is for the V3 Holonym architecture. (The version numbers for
 * the endpoints do not necessarily correspond to the version numbers for the
 * protocol as a whole.)
 */
async function getCredentialsV2(req, res) {
  try {
    const issuanceNullifier = req.params.nullifier;

    if (process.env.ENVIRONMENT == "dev") {
      const creds = newDummyUserCreds;
      const response = issuev2KYC(issuanceNullifier, creds);
      response.metadata = newDummyUserCreds;
      return res.status(200).json(response);
    }

    if (!req?.query?.sessionId) {
      throw {
        status: 400,
        error: "No sessionId specified",
        details: null,
      };
    }

    const metaSession = await getSession(req.query.sessionId);
    if (metaSession.status !== sessionStatusEnum.IN_PROGRESS) {
      if (metaSession.status === sessionStatusEnum.VERIFICATION_FAILED) {
        endpointLogger.error(
          {
            sessionId: req.query.sessionId,
            session_status: metaSession.status,
            failure_reason: metaSession.verificationFailureReason,
            tags: ["action:validateSession", "error:verificationFailed"],
          },
          "Session verification previously failed"
        );

        throw {
          status: 400,
          error: `Verification failed. Reason(s): ${metaSession.verificationFailureReason}`,
          details: null,
        };
      }

      throw {
        status: 400,
        error: `Session status is '${metaSession.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
        details: null,
      };
    }

    const session = await getVeriffSessionDecision(req.query.sessionId);

    if (!session) {
      // Check if this was a temporary error (from the getVeriffSessionDecision function)
      if (session === null) {
        // null specifically indicates API/network error
        endpointLogger.error(
          {
            sessionId: req.query.sessionId,
            tags: [
              "action:getVeriffSessionDecision",
              "error:temporaryFailure",
              "stage:getVeriffSessionDecision",
            ],
          },
          "Temporary error retrieving Veriff session."
        );

        throw {
          status: 503,
          error:
            "Unable to check verification status at this moment. Please try again in a few minutes.",
          details: {
            retryable: true,
          },
        };
      }

      // If session is undefined, it means the session doesn't exist or was deleted
      endpointLogger.error(
        {
          sessionId: req.query.sessionId,
          tags: [
            "action:getVeriffSessionDecision",
            "error:sessionNotFound",
            "stage:getVeriffSessionDecision",
          ],
        },
        "Veriff session not found."
      );

      await updateSessionStatus(
        req.query.sessionId,
        sessionStatusEnum.VERIFICATION_FAILED,
        "Verification session not found. Please start a new verification."
      );

      throw {
        status: 400,
        error:
          "Verification session not found. Please start a new verification.",
        details: null,
      };
    }

    const validationResult = validateSession(session, metaSession);
    if (validationResult.error) {
      endpointLogger.error(
        {
          sessionId: req.query.sessionId,
          reason: validationResult.error,
          details: {
            status: session.status,
            verification: {
              code: session.verification?.code,
              status: session.verification?.status,
            },
          },
          tags: ["action:validateSession", "error:validationFailed"],
        },
        "Verification failed"
      );

      await updateSessionStatus(
        req.query.sessionId,
        sessionStatusEnum.VERIFICATION_FAILED,
        validationResult.error
      );

      throw {
        status: 400,
        error: validationResult.error,
        details: {
          status: session.status,
          verification: {
            code: session.verification?.code,
            status: session.verification?.status,
          },
        },
      };
    }

    const uuidNew = uuidNewFromVeriffSession(session);

    // Assert user hasn't registered yet
    const user = await findUserVerification(uuidNew, "govId", {
      issuedAt: { after: dateElevenMonthsAgo() },
      // Ignore expired user verifications
      expiresAt: { after: new Date() }
    });

    if (user) {
      endpointLogger.error(
        {
          uuidV2: uuidNew,
          tags: [
            "action:RegisterUser",
            "error:UserAlreadyRegistered",
            "stage:RegisterUser",
          ],
        },
        "User has already registered."
      );

      await updateSessionStatus(
        req.query.sessionId,
        sessionStatusEnum.VERIFICATION_FAILED,
        `User has already registered. User ID: ${user._id}`
      );

      throw {
        status: 400,
        error: `User has already registered. User ID: ${user._id}`,
        details: null,
      };
    }

    // Store UUID for Sybil resistance
    const dbResponse = await saveUserToDb(uuidNew, req.query.sessionId);
    if (dbResponse.error) {
      throw {
        status: 400,
        error: dbResponse.error,
        details: null,
      };
    }

    const creds = extractCreds(session);

    const response = issuev2KYC(issuanceNullifier, creds);
    response.metadata = creds;

    await deleteVeriffSession(req.query.sessionId);

    endpointLogger.info(
      { uuidV2: uuidNew, sessionId: req.query.sessionId },
      "Issuing credentials"
    );

    await updateSessionStatus(req.query.sessionId, sessionStatusEnum.ISSUED);

    return res.status(200).json(response);
  } catch (err) {
    // If this is our custom error, use its properties
    if (err.status && err.error) {
      return res.status(err.status).json(err);
    }

    // Otherwise, log the unexpected error
    endpointLogger.error(
      {
        error: err,
        tags: [
          "action:getCredentialsV2",
          "error:unexpectedError",
          "stage:unknown",
        ],
      },
      "Unexpected error occurred"
    );

    return res.status(500).json({
      error: "An unexpected error occurred. Please try again later.",
      details: null,
    });
  }
}


/**
 * ENDPOINT
 *
 * Allows user to retrieve their signed verification info.
 *
 * This endpoint is for the V3 Holonym architecture. (The version numbers for
 * the endpoints do not necessarily correspond to the version numbers for the
 * protocol as a whole.)
 * 
 * Compared to the v1 and v2 endpoints, this one allows the user to get their
 * credentials up to 5 days after initial issuance, if they provide the
 * same nullifier.
 */
async function getCredentialsV3(req, res) {
  try {
    // Caller must specify a session ID and a nullifier. We first lookup the user's creds
    // using the nullifier. If no hit, then we lookup the credentials using the session ID.
    const _id = req.params._id;
    const issuanceNullifier = req.params.nullifier;
    
    try {
      const _number = BigInt(issuanceNullifier)
    } catch (err) {
      return res.status(400).json({
        error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`
      });
    }

    // if (process.env.ENVIRONMENT == "dev") {
    //   const creds = newDummyUserCreds;
    //   const response = issuev2KYC(issuanceNullifier, creds);
    //   response.metadata = newDummyUserCreds;
    //   return res.status(200).json(response);
    // }

    const { session, error: getSessionError } = await getSessionById(_id);
    if (getSessionError) {
      return res.status(400).json({ error: getSessionError });
    }

    if (session.status === sessionStatusEnum.VERIFICATION_FAILED) {
      endpointLoggerV3.verificationPreviouslyFailed(
        session.sessionId,
        session
      )
      return res.status(400).json({
        error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
      });
    }

    // First, check if the user is looking up their credentials using their nullifier
    const nullifierAndCreds = await findOneNullifierAndCredsLast5Days(issuanceNullifier);
    const veriffSessionIdFromNullifier = nullifierAndCreds?.idvSessionIds?.veriff?.sessionId
    if (veriffSessionIdFromNullifier) {
      const veriffSession = await getVeriffSessionDecision(veriffSessionIdFromNullifier)

      if (!veriffSession) {
        endpointLoggerV3.veriffSessionNotFound(veriffSessionIdFromNullifier)
        return res.status(400).json({ error: "Unexpected error: Failed to retrieve Verrif session while executing lookup from nullifier branch." });
      }

      // Note that validation of the Veriff session is unnecessary here. This Veriff session
      // ID should not have been stored if the corresponding session didn't pass validation.

      // We expect there to be a UserVerification record for this user. If it was created
      // within the last 5 days, then it is within the buffer period, and we ignore it.
      const uuidNew = uuidNewFromVeriffSession(veriffSession);

      // This step is not strictly necessary since we are only considering nullifiers
      // from the last 5 days (in the nullifierAndCreds query above) and the user
      // is only getting the credentials+nullifier that they were already issued.
      // However, we keep it here to be extra safe.
      const user = await findUserVerification(uuidNew, "govId", {
        issuedAt: { after: dateElevenMonthsAgo(), before: dateFiveDaysAgo() },
        // Ignore expired user verifications
        expiresAt: { after: new Date() }
      });
      if (user) {
        endpointLoggerV3.error({ uuidV2: uuidNew }, "User has already registered.");
        await failSession(session, toAlreadyRegisteredStr(user._id));
        return res.status(400).json({ error: toAlreadyRegisteredStr(user._id) });
      }

      const creds = extractCreds(veriffSession);
      const response = issuev2KYC(issuanceNullifier, creds);
      response.metadata = creds;

      endpointLoggerV3.info(
        { uuidV2: uuidNew, sessionId: veriffSessionIdFromNullifier },
        "Issuing credentials"
      );

      await updateSessionStatus(veriffSessionIdFromNullifier, sessionStatusEnum.ISSUED);

      return res.status(200).json(response);
    }

    const veriffSessionIdFromSession = session.sessionId;

    if (!veriffSessionIdFromSession) {
      return res.status(400).json({ error: "Unexpected: No veriff sessionId in session" });
    }

    // If the session isn't in progress, we do not issue credentials. If the session is ISSUED,
    // then the lookup via nullifier should have worked above.
    if (session.status !== sessionStatusEnum.IN_PROGRESS) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
      });
    }

    const veriffSession = await getVeriffSessionDecision(veriffSessionIdFromSession);

    if (!veriffSession) {
      // Check if this was a temporary error (from the getVeriffSessionDecision function)
      if (veriffSession === null) {
        // null specifically indicates API/network error
        endpointLoggerV3.veriffSessionTemporarilyUnavailable(
          veriffSessionIdFromSession
        )

        throwVeriffSessionTempUnavailable()
      }

      // If session is undefined, it means the session doesn't exist or was deleted
      endpointLoggerV3.veriffSessionNotFound(veriffSessionIdFromSession)
      return res.status(400).json({ error: "Failed to retrieve Verrif session." });
    }

    const validationResult = validateSession(veriffSession, session);
    if (validationResult.error) {
      endpointLoggerV3.veriffSessionValidationFailed(
        veriffSessionIdFromSession,
        veriffSession,
        validationResult
      )
      await failSession(session, validationResult.error);
      throwVeriffSessionValidationError(validationResult, veriffSession);
    }

    // Get UUID
    const uuidOld = uuidOldFromVeriffSession(veriffSession);
    const uuidNew = uuidNewFromVeriffSession(veriffSession);

    // We started using a new UUID generation method on May 24, 2024, but we still
    // want to check the database for the old UUIDs too.

    // Assert user hasn't registered yet
    const user = await findUserVerification(uuidNew, "govId", {
      issuedAt: { after: dateElevenMonthsAgo() },
      // Ignore expired user verifications
      expiresAt: { after: new Date() }
    });
    if (user) {
      await saveCollisionMetadata(uuidOld, uuidNew, veriffSessionIdFromSession, veriffSession);

      endpointLoggerV3.alreadyRegistered(uuidNew)
      await failSession(session, toAlreadyRegisteredStr(user._id));
      return res.status(400).json({ error: toAlreadyRegisteredStr(user._id) });
    }

    // Store UUID for Sybil resistance
    const dbResponse = await saveUserToDb(uuidNew, veriffSessionIdFromSession);
    if (dbResponse.error) return res.status(400).json(dbResponse);

    const creds = extractCreds(veriffSession);
    const response = issuev2KYC(issuanceNullifier, creds);
    response.metadata = creds;

    endpointLoggerV3.info(
      { uuidV2: uuidNew, sessionId: veriffSessionIdFromSession },
      "Issuing credentials"
    );

    // It's important that a veriff session ID gets associated with a nullifier ONLY
    // if the veriff session results in successful issuance. Otherwise, a user might
    // fail verification with one session, pass with another, and when they query this
    // endpoint, they might not be able to get creds because their initial session failed.
    const newNullifierAndCreds = new NullifierAndCreds({
      holoUserId: session.sigDigest,
      issuanceNullifier,
      uuidV2: uuidNew,
      idvSessionIds: {
        veriff: {
          sessionId: veriffSessionIdFromSession,
        },
      },
    });
    await newNullifierAndCreds.save();

    await updateSessionStatus(veriffSessionIdFromSession, sessionStatusEnum.ISSUED);

    return res.status(200).json(response);
  } catch (err) {
    // If this is our custom error, use its properties
    if (err.status && err.error) {
      return res.status(err.status).json(err);
    }

    // Otherwise, log the unexpected error
    endpointLoggerV3.unexpected(err)
    return res.status(500).send();
  }
}

export { getCredentials, getCredentialsV2, getCredentialsV3 };
