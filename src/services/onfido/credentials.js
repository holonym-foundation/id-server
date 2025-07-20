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
} from "../../utils/utils.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import {
  newDummyUserCreds,
  countryCodeToPrime,
} from "../../utils/constants.js";
import { sessionStatusEnum } from "../../constants/misc.js";
import {
  getOnfidoCheck,
  getOnfidoReports,
  deleteOnfidoApplicant,
} from "../../utils/onfido.js";
import { desiredOnfidoReports } from "../../constants/onfido.js";
import {
  findOneUserVerificationLast11Months,
  findOneUserVerification11Months5Days
} from "../../utils/user-verifications.js"
import { getSessionById, failSession } from "../../utils/sessions.js";
import { findOneNullifierAndCredsLast5Days } from "../../utils/nullifier-and-creds.js";
import { issuev2KYC, truncateToBytes } from "../../utils/issuance.js";
import { toAlreadyRegisteredStr } from "../../utils/errors.js"
import { upgradeV3Logger } from "./error-logger.js";

const endpointLogger = logger.child({
  msgPrefix: "[GET /onfido/credentials] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "onfido",
    feature: "holonym",
    subFeature: "gov-id",
  },
});

const endpointLoggerV3 = upgradeV3Logger(logger.child({
  msgPrefix: "[GET /onfido/v3/credentials] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "onfido",
    feature: "holonym",
    subFeature: "gov-id",
  },
}));

function validateCheck(check) {
  if (!check?.report_ids || check.report_ids.length == 0) {
    return {
      error: "No report_ids found in check",
      log: {
        msg: "No report_ids found in check",
        data: {
          check_id: check.id,
        },
      },
    };
  }
  if (check.status !== "complete") {
    return {
      error: `Check failed. Status is '${check.status}'. Expected 'complete'.`,
      log: {
        msg: "Check failed. status !== 'complete'",
        data: {
          status: check.status,
          check_id: check.id,
        },
      },
    };
  }
  if (check.result !== "clear") {
    return {
      error: `Check failed. Result is '${check.result}'. Expected 'clear'.`,
      hasReports: true,
      log: {
        msg: "Check failed. result !== 'clear'",
        data: {
          result: check.result,
          check_id: check.id,
        },
      },
    };
  }

  return { success: true };
}

function validateReports(reports, metaSession) {
  const reportIssues = {};
  const reportNames = reports.map((report) => report.name);
  const missingReports = desiredOnfidoReports.filter(
    (report) => !reportNames.includes(report)
  );
  if (missingReports.length > 0) {
    return {
      error: `Verification failed. Missing reports: ${missingReports.join(
        ", "
      )}`,
      log: {
        msg: "Missing reports",
        data: {
          missingReports: missingReports,
        },
      },
    };
  }

  let verificationFailed = false;
  const failureReasons = [];
  for (const report of reports) {
    reportIssues[report.name] = [];

    if (report.status !== "complete") {
      verificationFailed = true;
      reportIssues[report.name].push({
        type: "status",
        message: `Report status is '${report.status}'. Expected 'complete'.`,
      });
      failureReasons.push(
        `Report ${report.name} status is '${report.status}'. Expected 'complete'.`
      );
    }

    if (report.name === "document") {
      // if !metaSession.ipCountry, then the session was created before we added
      // the ipCountry attribute. Because this is only ~3k sessions and to reduce tickets,
      // we can ignore this check for such sessions.
      // NOTE: May 14, 2024: We are disablign the ipCountry check because it seems to be
      // turning down honest users while being game-able by sybils.
      if (!countryCodeToPrime[report.properties.issuing_country]) {
        return {
          error: `Verification failed. Unsupported country ${report.properties.issuing_country}`,
          log: {
            msg: "Unsupported country",
            data: {
              country: report.properties.issuing_country,
            },
          },
        };
      }

      // if (
      //   metaSession.ipCountry &&
      //   countryCodeToPrime[report.properties.issuing_country] !=
      //     countryCodeToPrime[metaSession.ipCountry]
      // ) {
      //   return {
      //     error: `Country code mismatch. Session country is '${metaSession.ipCountry}', but document country is '${report.properties.issuing_country}'.`,
      //     log: {
      //       msg: "Country code mismatch",
      //       data: {
      //         expected: countryCodeToPrime[metaSession.ipCountry],
      //         got: countryCodeToPrime[report.properties.issuing_country],
      //       },
      //     },
      //   };
      // }
    }

    if (report.name === "device_intelligence") {
      if (report?.properties?.device?.ip_reputation === "HIGH_RISK") {
        return {
          error: `Verification failed. IP address is high risk.`,
          log: {
            msg: "IP address is high risk",
            data: {
              ip: report?.properties?.ip?.address,
            },
          },
        };
      }
      const maxAllowedDeviceFingerprintReuse = 6;
      if (
        typeof report?.properties?.device?.device_fingerprint_reuse ===
          "number" &&
        report?.properties?.device?.device_fingerprint_reuse > maxAllowedDeviceFingerprintReuse
      ) {
        return {
          error: `Verification failed. device_fingerprint_reuse is ${report?.properties?.device?.device_fingerprint_reuse}.`,
          log: {
            msg: `device_fingerprint_reuse is greater than ${maxAllowedDeviceFingerprintReuse}`,
            data: {
              ip: report?.properties?.device?.device_fingerprint_reuse,
            },
          },
        };
      }
    }

    if (report.breakdown) {
      for (const [majorKey, majorValue] of Object.entries(report.breakdown)) {
        if (majorValue?.result !== "clear") {
          for (const [minorKey, minorValue] of Object.entries(
            majorValue.breakdown ?? {}
          )) {
            if (minorValue.result !== null && minorValue.result !== "clear") {
              verificationFailed = true;
              reportIssues[report.name].push({
                type: majorKey,
                subType: minorKey,
                result: minorValue.result,
                details: minorValue.details || minorValue.properties,
              });
              failureReasons.push(
                `Result of ${minorKey} in ${majorKey} breakdown is '${minorValue.result}'. Expected 'clear'.`
              );
            }
          }
        }
      }
    }

    if (reportIssues[report.name].length === 0) {
      delete reportIssues[report.name];
    }
  }

  if (verificationFailed) {
    return {
      error: `Onfido verification failed. Check console logs for more details.`,
      reasons: failureReasons,
      log: {
        msg: "Onfido verification failed",
        data: {
          reasons: failureReasons,
        },
      },
    };
  }

  return { success: true };
}

function onfidoValidationToUserErrorMessage(
  reportsValidation,
  validationResultCheck
) {
  return reportsValidation.reasons?.length
    ? `Verification failed: ${reportsValidation.reasons
      .map((reason) => {
        if (reason.includes("breakdown")) {
          const breakdownType = reason.match(/result of (\w+) in/)?.[1];
          return breakdownType
            ? `${breakdownType.replace(/_/g, " ")} verification failed`
            : "Document verification issue detected";
        }
        if (reason.includes("face")) {
          return "Face verification failed - please ensure your face is clearly visible";
        }
        if (reason.includes("quality")) {
          return "Image quality issue - please ensure photos are clear and well-lit";
        }
        if (reason.includes("supported")) {
          return "Document type not supported - please use a valid ID document";
        }
        return "Verification failed - please try again";
      })
      .join(". ")}`
    : (
      reportsValidation?.error ??
      validationResultCheck.error ??
      "Verification failed"
    );
}

function uuidOldFromOnfidoReport(documentReport) {
  const uuidConstituents =
    (documentReport.properties.first_name || "") +
    (documentReport.properties.last_name || "") +
    // Getting address info is in beta for Onfido, so we don't include it yet.
    // See: https://documentation.onfido.com/#document-with-address-information-beta
    // (documentReport.properties.addresses?.[0]?.postcode || "") +
    (documentReport.properties.date_of_birth || "");
  return sha256(Buffer.from(uuidConstituents)).toString("hex");
}

function uuidNewFromOnfidoReport(documentReport) {
  return govIdUUID(
    documentReport.properties.first_name,
    documentReport.properties.last_name,
    documentReport.properties.date_of_birth
  );
}

function extractCreds(documentReport) {
  const countryCode =
    countryCodeToPrime[documentReport.properties.issuing_country];
  const birthdate = documentReport.properties.date_of_birth ?? "";
  const birthdateNum = birthdate ? getDateAsInt(birthdate) : 0;
  const firstNameStr = truncateToBytes(documentReport.properties.first_name ?? "", 24);
  const firstNameBuffer = firstNameStr
    ? Buffer.from(firstNameStr)
    : Buffer.alloc(1);
  // Onfido doesn't seem to support middle names, but we keep this line in case they
  // do for some documents.
  const middleNameStr =
    documentReport.properties.middle_name ??
    documentReport.properties.barcode?.[0]?.middle_name ??
    "";
  const middleNameBuffer = middleNameStr
    ? Buffer.from(middleNameStr)
    : Buffer.alloc(1);
  const lastNameStr = truncateToBytes(documentReport.properties.last_name ?? "", 24);
  const lastNameBuffer = lastNameStr
    ? Buffer.from(lastNameStr)
    : Buffer.alloc(1);

  // Log original byte lengths if truncation occurred
  const originalFirstNameBytesLength = Buffer.from(documentReport.properties.first_name ?? "", 'utf8').length;
  const originalLastNameBytesLength = Buffer.from(documentReport.properties.last_name ?? "", 'utf8').length;
  
  if (originalFirstNameBytesLength > 24 || originalLastNameBytesLength > 24) {
    endpointLogger.info({ 
      firstNameBytes: originalFirstNameBytesLength, 
      lastNameBytes: originalLastNameBytesLength 
    }, "truncation for Onfido govId credentials");
  }

  const nameArgs = [firstNameBuffer, middleNameBuffer, lastNameBuffer].map(
    (x) => ethers.BigNumber.from(x).toString()
  );
  const nameHash = ethers.BigNumber.from(poseidon(nameArgs)).toString();
  // BIG NOTE: We assume all address fields are empty since getting address info is
  // in beta for Onfido and we haven't activated the feature.
  // See: https://documentation.onfido.com/#document-with-address-information-beta
  const cityStr = documentReport.properties.city ?? "";
  const cityBuffer = cityStr ? Buffer.from(cityStr) : Buffer.alloc(1);
  const subdivisionStr = documentReport.properties.state ?? "";
  const subdivisionBuffer = subdivisionStr
    ? Buffer.from(subdivisionStr)
    : Buffer.alloc(1);
  const streetNumber = Number(documentReport.properties.houseNumber ?? 0);
  const streetNameStr = documentReport.properties.street ?? "";
  const streetNameBuffer = streetNameStr
    ? Buffer.from(streetNameStr)
    : Buffer.alloc(1);
  const streetUnit = documentReport.properties.unit?.includes("apt ")
    ? Number(documentReport.properties.unit?.replace("apt ", ""))
    : documentReport.properties.unit != null &&
      typeof Number(documentReport.properties.unit) == "number"
    ? Number(documentReport.properties.unit)
    : 0;
  const addrArgs = [streetNumber, streetNameBuffer, streetUnit].map((x) =>
    ethers.BigNumber.from(x).toString()
  );
  const streetHash = ethers.BigNumber.from(poseidon(addrArgs)).toString();
  const zipCode = Number(documentReport.properties.postcode ?? 0);
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
      zipCode: documentReport.properties.postcode ?? 0,
      streetNumber: streetNumber,
      streetName: streetNameStr,
      streetUnit: streetUnit,
      completedAt: documentReport.properties.created_at
        ? documentReport.properties.created_at.split("T")[0]
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

async function saveCollisionMetadata(uuid, uuidV2, check_id, documentReport) {
  try {
    const collisionMetadataDoc = new VerificationCollisionMetadata({
      uuid: uuid,
      uuidV2: uuidV2,
      timestamp: new Date(),
      check_id: check_id,
      // uuidConstituents: {
      //   firstName: {
      //     populated: !!documentReport.properties.first_name,
      //   },
      //   lastName: {
      //     populated: !!documentReport.properties.last_name,
      //   },
      //   postcode: {
      //     populated: false,
      //   },
      //   dateOfBirth: {
      //     populated: !!documentReport.properties.date_of_birth,
      //   },
      // },
    });

    await collisionMetadataDoc.save();
  } catch (err) {
    console.log("Error recording collision metadata", err);
  }
}

async function saveUserToDb(uuidV2, check_id) {
  const userVerificationsDoc = new UserVerifications({
    govId: {
      uuidV2: uuidV2,
      sessionId: check_id,
      issuedAt: new Date(),
    },
  });
  try {
    await userVerificationsDoc.save();
  } catch (err) {
    endpointLogger.error(
      { error: err },
      "An error occurred while saving user verification to database"
    );
    return {
      error:
        "An error occurred while trying to save object to database. Please try again.",
    };
  }
  return { success: true };
}

async function getSession(check_id) {
  const metaSession = await Session.findOne({ check_id }).exec();

  if (!metaSession) {
    throw new Error("Session not found");
  }

  return metaSession;
}

async function updateSessionStatus(check_id, status, failureReason) {
  try {
    // TODO: Once pay-first frontend is pushed, remove the try-catch. We want
    // this endpoint to fail if we can't update the session.
    const metaSession = await Session.findOne({ check_id }).exec();
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

    const check_id = req.query.check_id;
    if (!check_id) {
      return res.status(400).json({ error: "No check_id specified" });
    }

    const metaSession = await getSession(check_id);
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

    const check = await getOnfidoCheck(check_id);
    const validationResultCheck = validateCheck(check);
    if (validationResultCheck.error) {
      endpointLogger.error(
        validationResultCheck.log.data,
        validationResultCheck.log.msg
      );
      return res.status(400).json({ error: validationResultCheck.error });
    }

    const reports = await getOnfidoReports(check.report_ids);
    if (!reports || reports.length == 0) {
      endpointLogger.error("No reports found");
      return res.status(400).json({ error: "No reports found" });
    }
    const validationResult = validateReports(reports, metaSession);
    if (validationResult.error) {
      endpointLogger.error(validationResult.log.data, validationResult.log.msg);
      const failureReason = validationResult.reasons
        ? validationResult.reasons.join(";")
        : validationResult.error;
      await updateSessionStatus(
        check_id,
        sessionStatusEnum.VERIFICATION_FAILED,
        failureReason
      );
      return res.status(400).json({
        error: validationResult.error,
        reasons: validationResult.reasons,
      });
    }

    const documentReport = reports.find((report) => report.name == "document");
    // Get UUID
    const uuidOld = uuidOldFromOnfidoReport(documentReport);
    const uuidNew = uuidNewFromOnfidoReport(documentReport);

    // We started using a new UUID generation method on May 24, 2024, but we still
    // want to check the database for the old UUIDs too.

    // Assert user hasn't registered yet
    const user = await findOneUserVerificationLast11Months(uuidOld, uuidNew);
    if (user) {
      await saveCollisionMetadata(uuidOld, uuidNew, check_id, documentReport);

      endpointLogger.error({ uuidV2: uuidNew }, "User has already registered");
      await updateSessionStatus(
        check_id,
        sessionStatusEnum.VERIFICATION_FAILED,
        `User has already registered. User ID: ${user._id}`
      );
      return res
        .status(400)
        .json({ error: `User has already registered. User ID: ${user._id}` });
    }

    // Store UUID for Sybil resistance
    const dbResponse = await saveUserToDb(uuidNew, check_id);
    if (dbResponse.error) return res.status(400).json(dbResponse);

    const creds = extractCreds(documentReport);

    const response = issue(
      process.env.HOLONYM_ISSUER_PRIVKEY,
      creds.rawCreds.countryCode.toString(),
      creds.derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value
    );
    response.metadata = creds;

    await deleteOnfidoApplicant(check.applicant_id);

    endpointLogger.info({ uuidV2: uuidNew, check_id }, "Issuing credentials");

    await updateSessionStatus(check_id, sessionStatusEnum.ISSUED);

    return res.status(200).json(response);
  } catch (err) {
    console.error(err);
    return res.status(500).send();
  }
}

/**
 * ENDPOINT
 *
 * Allows user to retrieve their signed verification info
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

    const check_id = req.query.check_id;
    if (!check_id) {
      throw {
        status: 400,
        error: "No check_id specified",
        details: null,
      };
    }

    const metaSession = await getSession(check_id);
    if (metaSession.status !== sessionStatusEnum.IN_PROGRESS) {
      if (metaSession.status === sessionStatusEnum.VERIFICATION_FAILED) {
        endpointLogger.error(
          {
            check_id,
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

    const check = await getOnfidoCheck(check_id);
    const validationResultCheck = validateCheck(check);
    if (!validationResultCheck.success && !validationResultCheck.hasReports) {
      endpointLogger.error(
        validationResultCheck.log.data,
        validationResultCheck.log.msg,
        {
          tags: ["action:validateSession", "error:verificationFailed"],
        }
      );
      await updateSessionStatus(
        check_id,
        sessionStatusEnum.VERIFICATION_FAILED,
        validationResultCheck.error
      );
      throw {
        status: 400,
        error: validationResultCheck.error,
        details: validationResultCheck.log.data,
      };
    }

    const reports = await getOnfidoReports(check.report_ids);
    if (!validationResultCheck.success && (!reports || reports.length == 0)) {
      endpointLogger.error(
        {
          check_id,
          report_ids: check.report_ids ?? "unknown",
          tags: ["action:getReports", "error:noReportsFound"],
        },
        "No reports found"
      );

      await updateSessionStatus(
        check_id,
        sessionStatusEnum.VERIFICATION_FAILED,
        "No reports found"
      );
      throw {
        status: 400,
        error: "No reports found",
        details: null,
      };
    }

    const reportsValidation = validateReports(reports, metaSession);
    if (validationResultCheck.error || reportsValidation.error) {
      const userErrorMessage = onfidoValidationToUserErrorMessage(
        reportsValidation,
        validationResultCheck
      )

      endpointLogger.error(
        {
          check_id,
          detailed_reasons: reportsValidation.reasons,
          tags: ["action:validateVerification", "error:verificationFailed"],
        },
        "Verification failed"
      );

      await updateSessionStatus(
        check_id,
        sessionStatusEnum.VERIFICATION_FAILED,
        userErrorMessage
      );

      throw {
        status: 400,
        error: userErrorMessage,
        details: {
          reasons: reportsValidation.reasons,
        },
      };
    }

    const documentReport = reports.find((report) => report.name == "document");
    // Get UUID
    const uuidOld = uuidOldFromOnfidoReport(documentReport);
    const uuidNew = uuidNewFromOnfidoReport(documentReport);

    // We started using a new UUID generation method on May 24, 2024, but we still
    // want to check the database for the old UUIDs too.

    // Assert user hasn't registered yet
    const user = await findOneUserVerificationLast11Months(uuidOld, uuidNew);
    if (user) {
      await saveCollisionMetadata(uuidOld, uuidNew, check_id, documentReport);

      endpointLogger.error(
        {
          uuidV2: uuidNew,
          tags: [
            "action:registeredUserCheck",
            "error:userAlreadyRegistered",
            "stage:registration",
          ],
        },
        "User has already registered"
      );
      await updateSessionStatus(
        check_id,
        sessionStatusEnum.VERIFICATION_FAILED,
        `User has already registered. User ID: ${user._id}`
      );
      return res
        .status(400)
        .json({ error: `User has already registered. User ID: ${user._id}` });
    }

    // Store UUID for Sybil resistance
    const dbResponse = await saveUserToDb(uuidNew, check_id);
    if (dbResponse.error) return res.status(400).json(dbResponse);

    const creds = extractCreds(documentReport);

    const response = issuev2KYC(issuanceNullifier, creds);
    response.metadata = creds;

    await deleteOnfidoApplicant(check.applicant_id);

    endpointLogger.info({ uuidV2: uuidNew, check_id }, "Issuing credentials");

    await updateSessionStatus(check_id, sessionStatusEnum.ISSUED);

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
    });
  }
}

/**
 * ENDPOINT
 *
 * Allows user to retrieve their signed verification info.
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
      endpointLoggerV3.verificationPreviouslyFailed(session.check_id, session)
      return res.status(400).json({
        error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
      });
    }

    // First, check if the user is looking up their credentials using their nullifier
    const nullifierAndCreds = await findOneNullifierAndCredsLast5Days(issuanceNullifier);
    const checkIdFromNullifier = nullifierAndCreds?.idvSessionIds?.onfido?.check_id
    if (checkIdFromNullifier) {
      const check = await getOnfidoCheck(checkIdFromNullifier);
      
      if (!check) {
        endpointLoggerV3.failedToGetCheck(checkIdFromNullifier);
        return res.status(400).json({
          error: "Unexpected error: Failed to retrieve Onfido check while executing lookup from nullifier branch."
        });
      }

      const reports = await getOnfidoReports(check.report_ids);

      if (!reports || reports.length == 0) {
        endpointLoggerV3.failedToGetReports(checkIdFromNullifier, check.report_ids);
        return res.status(400).json({
          error: "Unexpected error: Failed to retrieve Onfido reports while executing lookup from nullifier branch."
        });
      }

      // Note that validation of the Onfido checks and reports is unnecessary here. The
      // Onfido check ID should not have been stored if the corresponding checks and
      // reports didn't pass validation.

      const documentReport = reports.find((report) => report.name == "document");

      if (!documentReport) {
        endpointLoggerV3.noDocumentReport(reports)
        return res.status(400).json({
          error: "Unexpected error: Failed to get Onfido document report while executing lookup from nullifier branch."
        });
      }

      // Get UUID
      const uuidOld = uuidOldFromOnfidoReport(documentReport);
      const uuidNew = uuidNewFromOnfidoReport(documentReport);

      // Assert user hasn't registered yet.
      // This step is not strictly necessary since we are only considering nullifiers
      // from the last 5 days (in the nullifierAndCreds query above) and the user
      // is only getting the credentials+nullifier that they were already issued.
      // However, we keep it here to be extra safe.
      const user = await findOneUserVerification11Months5Days(uuidOld, uuidNew);
      if (user) {
        await saveCollisionMetadata(uuidOld, uuidNew, checkIdFromNullifier, documentReport);
        endpointLoggerV3.alreadyRegistered(uuidNew);
        await failSession(session, toAlreadyRegisteredStr(user._id))
        return res.status(400).json({ error: toAlreadyRegisteredStr(user._id) });
      }

      const creds = extractCreds(documentReport);
      const response = issuev2KYC(issuanceNullifier, creds);
      response.metadata = creds;

      endpointLoggerV3.info({ uuidV2: uuidNew, check_id: checkIdFromNullifier }, "Issuing credentials");

      await updateSessionStatus(checkIdFromNullifier, sessionStatusEnum.ISSUED);

      return res.status(200).json(response);
    }

    const check_id = session.check_id;
    if (!check_id) {
      return res.status(400).json({ error: "Unexpected: No onfido check_id in session" });
    }

    // If the session isn't in progress, we do not issue credentials. If the session is ISSUED,
    // then the lookup via nullifier should have worked above.
    if (session.status !== sessionStatusEnum.IN_PROGRESS) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
      });
    }

    const check = await getOnfidoCheck(check_id);
    const validationResultCheck = validateCheck(check);
    if (!validationResultCheck.success && !validationResultCheck.hasReports) {
      endpointLoggerV3.checkValidationFailed(validationResultCheck)
      await failSession(session, validationResultCheck.error)
      return res.status(400).json({
        error: validationResultCheck.error,
        details: validationResultCheck.log.data
      });
    }

    const reports = await getOnfidoReports(check.report_ids);
    if (!validationResultCheck.success && (!reports || reports.length == 0)) {
      endpointLoggerV3.noReportsFound(check_id, check.report_ids)

      await failSession(session, "No onfido reports found")
      return res.status(400).json({ error: "No reports found" });
    }
    const reportsValidation = validateReports(reports, session);
    if (validationResultCheck.error || reportsValidation.error) {
      const userErrorMessage = onfidoValidationToUserErrorMessage(
        reportsValidation,
        validationResultCheck
      )
      endpointLoggerV3.verificationFailed(check_id, reportsValidation)
      await failSession(session, userErrorMessage)

      throw {
        status: 400,
        error: userErrorMessage,
        details: {
          reasons: reportsValidation.reasons,
        },
      };
    }

    const documentReport = reports.find((report) => report.name == "document");
    // Get UUID
    const uuidOld = uuidOldFromOnfidoReport(documentReport);
    const uuidNew = uuidNewFromOnfidoReport(documentReport);

    // We started using a new UUID generation method on May 24, 2024, but we still
    // want to check the database for the old UUIDs too.

    // Assert user hasn't registered yet
    const user = await findOneUserVerificationLast11Months(uuidOld, uuidNew);
    if (user) {
      await saveCollisionMetadata(uuidOld, uuidNew, check_id, documentReport);

      endpointLoggerV3.alreadyRegistered(uuidNew);
      await failSession(session, toAlreadyRegisteredStr(user._id))
      return res.status(400).json({ error: toAlreadyRegisteredStr(user._id) });
    }

    // Store UUID for Sybil resistance
    const dbResponse = await saveUserToDb(uuidNew, check_id);
    if (dbResponse.error) return res.status(400).json(dbResponse);

    const creds = extractCreds(documentReport);
    const response = issuev2KYC(issuanceNullifier, creds);
    response.metadata = creds;

    endpointLoggerV3.info({ uuidV2: uuidNew, check_id }, "Issuing credentials");

    // It's important that an Onfido check ID gets associated with a nullifier ONLY
    // if the Onfido check results in successful issuance. Otherwise, a user might
    // fail verification with one session, pass with another, and when they query this
    // endpoint, they might not be able to get creds because their initial session failed.
    const newNullifierAndCreds = new NullifierAndCreds({
      holoUserId: session.sigDigest,
      issuanceNullifier,
      uuidV2: uuidNew,
      idvSessionIds: {
        onfido: {
          check_id,
        },
      },
    });
    await newNullifierAndCreds.save();

    await updateSessionStatus(check_id, sessionStatusEnum.ISSUED);

    return res.status(200).json(response);
  } catch (err) {
    // If this is our custom error, use its properties
    if (err.status && err.error) {
      return res.status(err.status).json(err);
    }

    // Otherwise, log the unexpected error
    endpointLoggerV3.unexpected(err)

    return res.status(500).json({
      error: "An unexpected error occurred.",
    });
  }
}

export { getCredentials, getCredentialsV2, getCredentialsV3 };
