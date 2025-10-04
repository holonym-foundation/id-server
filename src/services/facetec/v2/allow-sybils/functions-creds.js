import { strict as assert } from "node:assert";
import { ethers } from "ethers";
import { poseidon } from "circomlibjs-old";
import {
  Session,
  UserVerifications,
  VerificationCollisionMetadata,
} from "../../../init.js";
import {
  getDateAsInt,
  sha256,
  govIdUUID,
  objectIdElevenMonthsAgo,
} from "../../../utils/utils.js";
import { pinoOptions, logger } from "../../../utils/logger.js";
import {
  newDummyUserCreds,
  countryCodeToPrime,
  faceTecCountryNameToCode,
} from "../../../utils/constants.js";
import { parseOCRStringToDate } from "../shared/functions-date.js";
// const postSessionsLogger = logger.child({
//   msgPrefix: "[POST /match-3d-2d-idscan-and-get-creds] ",
//   base: {
//     ...pinoOptions.base,
//   },
// });

export function flattenScannedValues(scannedValues) {
  const flattened = {};

  for (const group of scannedValues.groups) {
    for (const field of group.fields) {
      flattened[field.fieldKey] = field.value;
    }
  }

  return flattened;
}

/**
 * @returns <{ error, triggerRetry }>. triggerRetry indicates to the frontend whether we should
 * encourage the user to re-attempt verification (provided they haven't exceeded the retry limit).
 */
export function validateFaceTecResponse(data) {
  // DOING: currenly loose validation checks only, need to test more to find optimal checks
  // TODO: facetec: Should we check barcodeStatusEnumInt?
  // if (data.didCompleteIDScanWithUnexpectedMedia) {
  //   return {
  //     error: `Verification failed. didCompleteIDScanWithUnexpectedMedia is ${data.didCompleteIDScanWithUnexpectedMedia}. Expected false.`,
  //     triggerRetry: false,
  //   };
  // }
  if (data.didCompleteIDScanWithoutMatching) {
    return {
      error: `Verification failed. didCompleteIDScanWithoutMatching is ${data.didCompleteIDScanWithoutMatching}. Expected false.`,
      triggerRetry: true,
    };
  }
  if (data.didCompleteIDScanWithoutMatchingOCRTemplate) {
    return {
      error: `Verification failed. didCompleteIDScanWithoutMatchingOCRTemplate is ${data.didCompleteIDScanWithoutMatchingOCRTemplate}. Expected false.`,
      triggerRetry: false,
    };
  }
  // if (data.digitalIDSpoofStatusEnumInt != 0) {
  //   return {
  //     error: `Verification failed. digitalIDSpoofStatusEnumInt is ${data.digitalIDSpoofStatusEnumInt}. Expected 0.`,
  //     triggerRetry: false,
  //   };
  // }
  if (data.error) {
    return {
      error: `Verification failed. FaceTec returned an error. ${data.error}`,
      triggerRetry: false,
    };
  }
  if (data.fullIDStatusEnumInt != 0) {
    return {
      error: `Verification failed. fullIDStatusEnumInt is ${data.fullIDStatusEnumInt}. Expected 0.`,
      triggerRetry: true,
    };
  }
  console.log("data.matchLevel", data.matchLevel, "expected", process.env.FACETEC_3D_2D_IDSCAN_MIN_MATCH_LEVEL);
  if (data.matchLevel < process.env.FACETEC_3D_2D_IDSCAN_MIN_MATCH_LEVEL) {
    return {
      error: true,
      errorMessage: `Verification failed. matchLevel is ${data.matchLevel}. Expected ${process.env.FACETEC_3D_2D_IDSCAN_MIN_MATCH_LEVEL} or greater.`,
      triggerRetry: true,
    };
  }
  // TODO: facetec: maybe: Check mrzStatusEnumInt
  // TODO: facetec: maybe: Check scannedIDPhotoFaceFoundWithMinimumQuality
  // if (data.textOnDocumentStatusEnumInt != 1) {
  //   return {
  //     error: true,
  //     errorMessage: `Verification failed. textOnDocumentStatusEnumInt is ${data.textOnDocumentStatusEnumInt}. Expected 0.`,
  //     triggerRetry: true,
  //   };
  // }
  // if (data.unexpectedMediaEncounteredAtLeastOnce) {
  //   return {
  //     error: true,
  //     errorMessage: `Verification failed. unexpectedMediaEncounteredAtLeastOnce is ${data.unexpectedMediaEncounteredAtLeastOnce}. Expected false.`,
  //     triggerRetry: true,
  //   };
  // }
  const documentData = JSON.parse(data?.documentData ?? "{}");
  const scannedValues = documentData.scannedValues;
  // console.log("documentData.scannedValues", JSON.stringify(scannedValues));

  if (!scannedValues) {
    return {
      error: true,
      errorMessage: `Verification failed. documentData.scannedValues is missing.`,
      triggerRetry: false,
    };
  }
  // DONE
  // TODO: facetec: Modify return value shape. Instead of just sending an error message, send an object
  // like this: { error: true/fasle, errorMessage: "this is error", retry: true/false }
  const flattenedScannedValues = flattenScannedValues(scannedValues);
  if (!flattenedScannedValues.dateOfBirth) {
    return {
      error: true,
      errorMessage: `Verification failed. dateOfBirth is missing.`,
      triggerRetry: true,
    };
  }
  let dobIsValid = true;
  try {
    new Date(flattenedScannedValues.dateOfBirth);
  } catch (err) {
    dobIsValid = false;
  }
  if (!dobIsValid) {
    return {
      error: true,
      errorMessage: `Verification failed. Parsed dateOfBirth (${flattenedScannedValues.dateOfBirth}) is not a valid date.`,
      triggerRetry: true,
    };
  }
  const templateInfo = documentData.templateInfo;
  if (!templateInfo) {
    return {
      error: true,
      errorMessage: `Verification failed. documentData.templateInfo is missing.`,
      triggerRetry: true,
    };
  }
  return { success: true };
}

export function extractCreds(data) {
  // To see all fields that FaceTec can parse, see this page in FaceTec docs:
  // https://dev.facetec.com/technical-support-facetec-api-components-querying-ocr-barcode-nfc-data-from-documentdata
  const documentData = JSON.parse(data.documentData);
  const flattenedScannedValues = flattenScannedValues(documentData.scannedValues);
  // const address = person.addresses?.[0]?.parsedAddress; // todo
  const countryCode =
    countryCodeToPrime[
      faceTecCountryNameToCode[documentData.templateInfo.documentCountry]
    ];
  assert.ok(countryCode, "Unsupported country");
  // console.log("extractCreds flattenedScannedValues", flattenedScannedValues);

  // DOING, with parseOCRStringToDate it gets better, but FaceTec returned date format should be checked too
  // TODO: facetec: check for dateOfBirth
  // date returned from OCR might not be in proper format, sometimes not even a valid date
  let dobIsValid = true;
  let parsedDOB = null;
  try {
    // console.log("extractCreds flattenedScannedValues.dateOfBirth", flattenedScannedValues.dateOfBirth)
    parsedDOB = parseOCRStringToDate(flattenedScannedValues.dateOfBirth);
  } catch (err) {
    console.log("extractCreds err", err)
    dobIsValid = false;
  }

  if (!dobIsValid) {
    console.log("extractCreds dobIsValid", dobIsValid)
    return {
      error: true,
      errorMessage: `Verification failed. Parsed dateOfBirth (${flattenedScannedValues.dateOfBirth}) is not a valid date.`,
      triggerRetry: true,
    };
  }

  // const birthdate = flattenedScannedValues.dateOfBirth ? new Date(flattenedScannedValues.dateOfBirth).toISOString().split('T')[0] : "";
  const birthdate = parsedDOB;
  const birthdateNum = birthdate ? getDateAsInt(birthdate) : 0;
  console.log("extractCreds birthdate", birthdate, "birthdateNum", birthdateNum);
  
  // Note: FaceTec might return a full name
  // then make it into firstName, middleName, lastName
  let _firstName = "", _lastName = "";
  if(flattenedScannedValues.fullName) {
    const fullName = flattenedScannedValues.fullName.split(" ");
    _lastName = fullName.slice(-1)[0];
    _firstName = fullName.slice(0, -1).join(" ");
  }
  // console.log("after fullName", _firstName, _lastName);

  const firstNameStr = flattenedScannedValues.firstName
    ? flattenedScannedValues.firstName
    : _firstName;
  const firstNameBuffer = firstNameStr
    ? Buffer.from(firstNameStr)
    : Buffer.alloc(1);
  // FaceTec doesn't seem to support middle names, but we keep it for backwards compatibility
  // const middleNameStr = person.middleName ? person.middleName : "";
  // const middleNameBuffer = middleNameStr
  //   ? Buffer.from(middleNameStr)
  //   : Buffer.alloc(1);
  const middleNameStr = "";
  const middleNameBuffer = Buffer.alloc(1);
  const lastNameStr = flattenedScannedValues.lastName
    ? flattenedScannedValues.lastName
    : _lastName;
  const lastNameBuffer = lastNameStr
    ? Buffer.from(lastNameStr)
    : Buffer.alloc(1);
  const nameArgs = [firstNameBuffer, middleNameBuffer, lastNameBuffer].map(
    (x) => ethers.BigNumber.from(x).toString()
  );
  const nameHash = ethers.BigNumber.from(poseidon(nameArgs)).toString();
  // NOTE: FaceTec's parsing of the address fields (other than zip code) has not been the
  // best in the few tests that I've done. If we need to be 100% sure these fields are
  // populated and correct, we might want to do additional parsing of the ID image.
  const cityStr = flattenedScannedValues?.city ? flattenedScannedValues.city : "";
  const cityBuffer = cityStr ? Buffer.from(cityStr) : Buffer.alloc(1);
  const subdivisionStr = flattenedScannedValues?.state
    ? flattenedScannedValues.state
    : "";
  const subdivisionBuffer = subdivisionStr
    ? Buffer.from(subdivisionStr)
    : Buffer.alloc(1);
  // TODO: facetec: Figure out how to get street number, street name, street unit from
  // the data provided in FaceTec's response.
  // const streetNumber = Number(address?.houseNumber ? address.houseNumber : 0); // todo
  const streetNumber = 0;
  // const streetNameStr = address?.street ? address.street : ""; // todo
  const streetNameStr = "";
  const streetNameBuffer = streetNameStr
    ? Buffer.from(streetNameStr)
    : Buffer.alloc(1);
  // const streetUnit = address?.unit?.includes("apt ")
  //   ? Number(address?.unit?.replace("apt ", ""))
  //   : address?.unit != null && typeof Number(address?.unit) == "number"
  //   ? Number(address?.unit)
  //   : 0; // todo
  const streetUnit = 0;
  const addrArgs = [streetNumber, streetNameBuffer, streetUnit].map((x) =>
    ethers.BigNumber.from(x).toString()
  );
  const streetHash = ethers.BigNumber.from(poseidon(addrArgs)).toString();
  // const zipCode = Number(address?.postcode ? address.postcode : 0);
  const zipCode = Number(
    flattenedScannedValues?.zipCode
      ? flattenedScannedValues.zipCode.substring(0, 5)
      : 0
  );
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
      zipCode: zipCode,
      streetNumber: streetNumber,
      streetName: streetNameStr,
      streetUnit: streetUnit,
      completedAt: new Date().toISOString().split("T")[0],
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

export async function saveCollisionMetadata(uuid, uuidV2, sessionId) {
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

export async function saveUserToDb(uuidV2, sessionId) {
  const userVerificationsDoc = new UserVerifications({
    govId: {
      uuidV2: uuidV2,
      sessionId: sessionId,
      issuedAt: new Date(),
    },
  });
  try {
    await userVerificationsDoc.save();
  } catch (err) {
    // endpointLogger.error(
    //   { error: err },
    //   "An error occurred while saving userVerificationsDoc to database"
    // );
    console.error(
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

export async function updateSessionStatus(metaSession, status, failureReason) {
  metaSession.status = status;
  if (failureReason) metaSession.verificationFailureReason = failureReason;
  await metaSession.save();
}
