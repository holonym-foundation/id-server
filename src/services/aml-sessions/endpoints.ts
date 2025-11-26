import axios from "axios";
import { ObjectId } from "mongodb";
import { HydratedDocument } from "mongoose";
import { poseidon } from "circomlibjs-old";
import ethersPkg from "ethers";
import { Request, Response } from "express";
const { ethers } = ethersPkg;
import { issue as issuev2 } from "holonym-wasm-issuer-v2";
// import { groth16 } from "snarkjs";
import { 
  UserVerifications, 
  SessionRefundMutex,
  CleanHandsSessionWhitelist,
  getRouteHandlerConfig
} from "../../init.js";
import { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js";
import { 
  getAccessToken as getPayPalAccessToken,
  capturePayPalOrder,
  refundMintFeePayPal
} from "../../utils/paypal.js";
import {
  validateTxForSessionCreation,
  refundMintFeeOnChain,
} from "../../utils/transactions.js";
import {
  cleanHandsDummyUserCreds,
  siIdentifierPrefixesToBlock
} from "../../utils/constants.js";
import { getDateAsInt, govIdUUID } from "../../utils/utils.js";
import {
  findOneNullifierAndCredsLast5Days
} from "../../utils/clean-hands-nullifier-and-creds.js";
import { parseStatementForUserCertification } from '../../utils/clean-hands-misc.js'
import {
  findOneCleanHandsUserVerification11Months5Days
} from "../../utils/user-verifications.js";
import { toAlreadyRegisteredStr } from "../../utils/errors.js";
import {
  supportedChainIds,
  amlSessionUSDPrice,
  payPalApiUrlBase,
  sessionStatusEnum,
  cleanHandsSessionStatusEnum,
} from "../../constants/misc.js";
import V3NameDOBVKey from "../../constants/zk/V3NameDOB.verification_key.json" with { type: "json" };
import { pinoOptions, logger } from "../../utils/logger.js";
import { upgradeLogger } from "./error-logger.js";
import { failSession } from "../../utils/sessions.js";
import { getOnfidoCheck, getOnfidoReports } from "../../utils/onfido.js";
import { validateCheck, validateReports, onfidoValidationToUserErrorMessage } from "../onfido/credentials/utils.js";
import { ISanctionsResult } from "../../types.js";


const issueCredsV2Logger = upgradeLogger(logger.child({
  msgPrefix: "[GET /aml-sessions/credentials/v2] ",
  base: {
    ...pinoOptions.base,
    feature: "holonym",
    subFeature: "clean-hands",
  },
}));

const issueCredsV3Logger = upgradeLogger(logger.child({
  msgPrefix: "[GET /aml-sessions/credentials/v3] ",
  base: {
    ...pinoOptions.base,
    feature: "holonym",
    subFeature: "clean-hands",
  },
}));

const issueCredsV4Logger = upgradeLogger(logger.child({
  msgPrefix: "[GET /aml-sessions/credentials/v4] ",
  base: {
    ...pinoOptions.base,
    feature: "holonym",
    subFeature: "clean-hands",
  },
}));

/**
 * ENDPOINT.
 * Creates a session.
 */
function createPostSessionRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const sigDigest = req.body.sigDigest;
      if (!sigDigest) {
        return res.status(400).json({ error: "sigDigest is required" });
      }

      let silkDiffWallet = null;
      if (req.body.silkDiffWallet === "silk") {
        silkDiffWallet = "silk";
      } else if (req.body.silkDiffWallet === "diff-wallet") {
        silkDiffWallet = "diff-wallet";
      }

      const session = new config.AMLChecksSessionModel({
        sigDigest: sigDigest,
        status: sessionStatusEnum.NEEDS_PAYMENT,
        silkDiffWallet,
      });
      await session.save();

      return res.status(201).json({ session });
    } catch (err: any) {
      console.log("POST /veriff-aml-sessions: Error encountered", err.message);
      return res.status(500).json({ error: "An unknown error occurred" });
    }
  };
}

async function postSessionLive(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPostSessionRouteHandler(config)(req, res);
}

async function postSessionSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPostSessionRouteHandler(config)(req, res);
}

/**
 * ENDPOINT.
 * Creates a session. Immediately sets session status to IN_PROGRESS to
 * bypass payment requirement.
 */
function createPostSessionv2RouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const sigDigest = req.body.sigDigest;
      if (!sigDigest) {
        return res.status(400).json({ error: "sigDigest is required" });
      }

      let silkDiffWallet = null;
      if (req.body.silkDiffWallet === "silk") {
        silkDiffWallet = "silk";
      } else if (req.body.silkDiffWallet === "diff-wallet") {
        silkDiffWallet = "diff-wallet";
      }

      // Only allow a user to create up to 15 sessions
      const existingSessions = await config.AMLChecksSessionModel.find({
        sigDigest: sigDigest,
        status: {
          "$in": [
            sessionStatusEnum.IN_PROGRESS,
            sessionStatusEnum.VERIFICATION_FAILED,
            sessionStatusEnum.ISSUED
          ]
        }
      }).exec();

      if (existingSessions.length >= 15) {
        return res.status(400).json({
          error: "User has reached the maximum number of sessions (15)"
        });
      }

      const session = new config.AMLChecksSessionModel({
        sigDigest: sigDigest,
        status: sessionStatusEnum.IN_PROGRESS,
        silkDiffWallet,
      });
      await session.save();

      return res.status(201).json({ session });
    } catch (err: any) {
      console.log("POST /aml-sessions/v2: Error encountered", err.message);
      return res.status(500).json({ error: "An unknown error occurred" });
    }
  };
}

async function postSessionv2Live(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPostSessionv2RouteHandler(config)(req, res);
}

async function postSessionv2Sandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPostSessionv2RouteHandler(config)(req, res);
}

/**
 * ENDPOINT.
 */
async function createPayPalOrder(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  try {
    const _id = req.params._id;

    let objectId = null;
    try {
      objectId = new ObjectId(_id);
    } catch (err: any) {
      return res.status(400).json({ error: "Invalid _id" });
    }

    const session = await config.AMLChecksSessionModel.findOne({ _id: objectId }).exec();

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const accessToken = await getPayPalAccessToken();

    const url = `${payPalApiUrlBase}/v2/checkout/orders`;
    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: "1.00",
          },
        },
      ],
      // payment_source: {
      //   paypal: {
      //     experience_context: {
      //       payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
      //       brand_name: "EXAMPLE INC",
      //       locale: "en-US",
      //       landing_page: "LOGIN",
      //       shipping_preference: "SET_PROVIDED_ADDRESS",
      //       user_action: "PAY_NOW",
      //       return_url: "https://example.com/returnUrl",
      //       cancel_url: "https://example.com/cancelUrl",
      //     },
      //   },
      // },
    };
    const axiosConfig = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    };

    const resp = await axios.post(url, body, axiosConfig);

    const order = resp.data;

    if ((session.payPal?.orders ?? []).length > 0) {
      session.payPal!.orders!.push({ id: order.id, createdAt: new Date() });
    } else {
      session.payPal = {
        orders: [{ id: order.id, createdAt: new Date() }],
      };
    }

    await session.save();

    return res.status(201).json(order);
  } catch (err: any) {
    if (err.response) {
      console.error("Error creating PayPal order", err.response.data);
    } else if (err.request) {
      console.error("Error creating PayPal order", err.request.data);
    } else {
      console.error("Error creating PayPal order", err);
    }
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 * Pay for session and create a Veriff session.
 */
async function payForSession(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  try {
    const _id = req.params._id;
    const chainId = Number(req.body.chainId);
    const txHash = req.body.txHash;
    if (!chainId || supportedChainIds.indexOf(chainId) === -1) {
      return res.status(400).json({
        error: `Missing chainId. chainId must be one of ${supportedChainIds.join(
          ", "
        )}`,
      });
    }
    if (!txHash) {
      return res.status(400).json({ error: "txHash is required" });
    }

    let objectId = null;
    try {
      objectId = new ObjectId(_id);
    } catch (err: any) {
      return res.status(400).json({ error: "Invalid _id" });
    }

    const session = await config.AMLChecksSessionModel.findOne({ _id: objectId }).exec();

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status !== sessionStatusEnum.NEEDS_PAYMENT) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.NEEDS_PAYMENT}'`,
      });
    }

    if (session.txHash) {
      return res
        .status(400)
        .json({ error: "Session is already associated with a transaction" });
    }

    const otherSession = await config.AMLChecksSessionModel.findOne({ txHash: txHash }).exec();
    if (otherSession) {
      return res
        .status(400)
        .json({ error: "Transaction has already been used to pay for a session" });
    }

    const validationResult = await validateTxForSessionCreation(
      session,
      chainId,
      txHash,
      amlSessionUSDPrice
    );
    if (validationResult.error) {
      return res
        .status(validationResult.status)
        .json({ error: validationResult.error });
    }

    session.status = sessionStatusEnum.IN_PROGRESS;
    session.chainId = chainId;
    session.txHash = txHash;
    await session.save();

    return res.status(200).json({
      message: "success",
    });
  } catch (err: any) {
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 */
async function payForSessionV2(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  try {
    if (req.body.chainId && req.body.txHash) {
      return payForSession(req, res);
    }

    const _id = req.params._id;
    const orderId = req.body.orderId;

    if (!orderId) {
      return res.status(400).json({ error: "orderId is required" });
    }

    let objectId = null;
    try {
      objectId = new ObjectId(_id);
    } catch (err: any) {
      return res.status(400).json({ error: "Invalid _id" });
    }

    const session = await config.AMLChecksSessionModel.findOne({ _id: objectId }).exec();

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status !== sessionStatusEnum.NEEDS_PAYMENT) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.NEEDS_PAYMENT}'`,
      });
    }

    const filteredOrders = (session.payPal?.orders ?? []).filter(
      (order) => order.id === orderId
    );
    if (filteredOrders.length === 0) {
      return res.status(400).json({
        error: `Order ${orderId} is not associated with session ${_id}`,
      });
    }

    const sessions = await config.AMLChecksSessionModel.find({
      _id: { $ne: objectId },
      "payPal.orders": {
        $elemMatch: {
          id: orderId,
        },
      },
    }).exec();

    if (sessions.length > 0) {
      return res.status(400).json({
        error: `Order ${orderId} is already associated with session ${sessions[0]._id}`,
      });
    }

    const order = await capturePayPalOrder(orderId);

    if (order.status !== "COMPLETED") {
      return res.status(400).json({
        error: `Order ${orderId} has status ${order.status}. Must be COMPLETED`,
      });
    }

    const expectedAmountInUSD = 1;

    let successfulOrder;
    for (const pu of order.purchase_units) {
      for (const payment of pu.payments.captures) {
        if (payment.status === "COMPLETED") {
          if (Number(payment.amount.value) >= expectedAmountInUSD) {
            successfulOrder = order;
          }
          break;
        }
      }
    }

    if (!successfulOrder) {
      return res.status(400).json({
        error: `Order ${orderId} does not have a successful payment capture with amount >= ${expectedAmountInUSD}`,
      });
    }

    session.status = sessionStatusEnum.IN_PROGRESS;
    await session.save();

    return res.status(200).json({
      message: "success",
    });
  } catch (err: any) {
    if (err.response) {
      console.error('error paying for aml session', err.response.data);
    } else if (err.request) {
      console.error('error paying for aml session', err.request.data);
    } else {
      console.error('error paying for aml session', err);
    }

    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 * Use on-chain payment. Does not validate
 * transaction data. Requires admin API key.
 */
async function payForSessionV3(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const _id = req.params._id;
    const chainId = Number(req.body.chainId);
    const txHash = req.body.txHash;
    if (!chainId || supportedChainIds.indexOf(chainId) === -1) {
      return res.status(400).json({
        error: `Missing chainId. chainId must be one of ${supportedChainIds.join(
          ", "
        )}`,
      });
    }
    if (!txHash) {
      return res.status(400).json({ error: "txHash is required" });
    }

    let objectId = null;
    try {
      objectId = new ObjectId(_id);
    } catch (err: any) {
      return res.status(400).json({ error: "Invalid _id" });
    }

    const session = await config.AMLChecksSessionModel.findOne({ _id: objectId }).exec();

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status !== sessionStatusEnum.NEEDS_PAYMENT) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.NEEDS_PAYMENT}'`,
      });
    }

    if (session.txHash) {
      return res
        .status(400)
        .json({ error: "Session is already associated with a transaction" });
    }

    const otherSession = await config.AMLChecksSessionModel.findOne({ txHash: txHash }).exec();
    if (otherSession) {
      return res
        .status(400)
        .json({ error: "Transaction has already been used to pay for a session" });
    }

    const validationResult = await validateTxForSessionCreation(
      session,
      chainId,
      txHash,
      amlSessionUSDPrice
    );
    if (
      validationResult.error &&
      // We ignore "Invalid transaction data" here
      validationResult.error !== "Invalid transaction data"
    ) {
      // We ignore "Invalid transaction amount" here if the tx amount is
      // at least 50% of the expected amount.
      if (validationResult.error.includes("Invalid transaction amount")) {
        const expected = ethers.BigNumber.from(
          validationResult.error.split("Expected: ")[1].split(".")[0]
        );
        const found = ethers.BigNumber.from(
          validationResult.error.split("Found: ")[1].split(".")[0]
        );

        // Make sure found is at least 50% of expected
        if (found.lt(expected.div(2))) {
          return res
            .status(validationResult.status)
            .json({ error: validationResult.error });
        }
      } else {
        return res
          .status(validationResult.status)
          .json({ error: validationResult.error });
      }
    }

    // Note: We do not immediately call session.save() after adding txHash to
    // the session because we want the session to be saved only if the rest of
    // this function executes successfully.
    session.status = sessionStatusEnum.IN_PROGRESS;
    session.chainId = chainId;
    session.txHash = txHash;
    await session.save();

    return res.status(200).json({
      message: "success",
    });
  } catch (err: any) {
    console.log("err.message", err.message);
    if (err.response) {
      console.error(
        { error: err.response.data },
        "Error creating IDV session"
      );
    } else if (err.request) {
      console.error(
        { error: err.request.data },
        "Error creating IDV session"
      );
    } else {
      console.error({ error: err }, "Error creating IDV session");
    }

    return res.status(500).json({ error: "An unknown error occurred", err });
  }
}

/**
 * ENDPOINT.
 * Allows a user to request a refund for a failed session.
 */
async function refund(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  const _id = req.params._id;
  const to = req.body.to;
  try {
    if (!to || to.length !== 42) {
      return res.status(400).json({
        error: "to is required and must be a 42-character hexstring (including 0x)",
      });
    }
    let objectId = null;
    try {
      objectId = new ObjectId(_id);
    } catch (err: any) {
      return res.status(400).json({ error: "Invalid _id" });
    }
    const session = await config.AMLChecksSessionModel.findOne({ _id: objectId }).exec();
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.status !== sessionStatusEnum.VERIFICATION_FAILED) {
      return res
        .status(400)
        .json({ error: "Only failed verifications can be refunded." });
    }
    if (session.refundTxHash) {
      return res
        .status(400)
        .json({ error: "This session has already been refunded." });
    }
    // Create mutex. We use mutex here so that only one refund request
    // per session can be processed at a time. Otherwise, if the user
    // spams this refund endpoint, we could send multiple transactions
    // before the first one is confirmed.
    const mutex = await SessionRefundMutex.findOne({ _id: objectId }).exec();
    if (mutex) {
      return res.status(400).json({ error: "Refund already in progress" });
    }
    const newMutex = new SessionRefundMutex({ _id: objectId });
    await newMutex.save();
    // Perform refund logic
    const response = await refundMintFeeOnChain(session, to);
    // Delete mutex
    await SessionRefundMutex.deleteOne({ _id: _id }).exec();
    // Return response
    return res.status(response.status).json(response.data);
  } catch (err: any) {
    // Delete mutex. We have this here in case an unknown error occurs above.
    try {
      await SessionRefundMutex.deleteOne({ _id: _id }).exec();
    } catch (err: any) {
      console.log(
        "POST refund AML checks session: Error encountered while deleting mutex",
        err.message
      );
    }
    if (err.response) {
      console.error({ error: err.response.data }, "Error during refund");
    } else if (err.request) {
      console.error({ error: err.request.data }, "Error during refund");
    } else {
      console.error({ error: err }, "Error during refund");
    }
    console.log("POST refund AML checks session: Error encountered", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 */
async function refundV2(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  if (req.body.to) {
    return refund(req, res);
  }
  const _id = req.params._id;
  try {
    let objectId = null;
    try {
      objectId = new ObjectId(_id);
    } catch (err: any) {
      return res.status(400).json({ error: "Invalid _id" });
    }
    const session = await config.AMLChecksSessionModel.findOne({ _id: objectId }).exec();
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.status !== sessionStatusEnum.VERIFICATION_FAILED) {
      return res
        .status(400)
        .json({ error: "Only failed verifications can be refunded." });
    }
    if (session.refundTxHash) {
      return res
        .status(400)
        .json({ error: "This session has already been refunded." });
    }
    // Create mutex. We use mutex here so that only one refund request
    // per session can be processed at a time. Otherwise, if the user
    // spams this refund endpoint, we could send multiple transactions
    // before the first one is confirmed.
    const mutex = await SessionRefundMutex.findOne({ _id: _id }).exec();
    if (mutex) {
      return res.status(400).json({ error: "Refund already in progress" });
    }
    const newMutex = new SessionRefundMutex({ _id: _id });
    await newMutex.save();
    // Perform refund logic
    const response = await refundMintFeePayPal(session);
    // Delete mutex
    await SessionRefundMutex.deleteOne({ _id: _id }).exec();
    // Return response
    return res.status(response.status).json(response.data);
  } catch (err: any) {
    // Delete mutex. We have this here in case an unknown error occurs above.
    try {
      await SessionRefundMutex.deleteOne({ _id: _id }).exec();
    } catch (err: any) {
      console.log(
        "POST /aml-sessions/:_id/refund/v2: Error encountered while deleting mutex",
        err.message
      );
    }
    if (err.response) {
      console.error(
        { error: JSON.stringify(err.response.data, null, 2) },
        "Error during refund"
      );
    } else if (err.request) {
      console.error(
        { error: JSON.stringify(err.request.data, null, 2) },
        "Error during refund"
      );
    } else {
      console.error({ error: err }, "Error during refund");
    }
    console.log(
      "POST /aml-sessions/:_id/refund/v2: Error encountered",
      err.message
    );
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

function parsePublicSignals(publicSignals: Array<string>) {
  return {
    expiry: new Date(Number(publicSignals[1]) * 1000),
    firstName: Buffer.from(BigInt(publicSignals[2]).toString(16), 'hex').toString(),
    lastName: Buffer.from(BigInt(publicSignals[3]).toString(16), 'hex').toString(),
    dateOfBirth: (new Date((Number(publicSignals[4]) - 2208988800) * 1000)).toISOString().slice(0, 10)
  };
}

/**
 * @typedef Groth16FullProveResult
 * @property {object} proof
 * @property {array} publicSignals
 */


function validateScreeningResult(result: { count: number, status: string }) {
  if (result.count > 0) {
    return {
      error: `Verification failed. count is '${result.count}'. Expected '0'.`,
      log: {
        msg: "Verification failed. count > 0",
        data: {
          status: result.status,
        },
      },
    };
  }
  // TODO: How strict do we want to be? Maybe some hits are acceptable?
  return { success: true };
}

// 18/07/2025: Truncate, character by character in utf8 compatible way
function truncateToBytes(str: string, maxBytes: number) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  if (typeof maxBytes !== 'number' || maxBytes < 0) return '';
  if (maxBytes === 0) return '';
  
  const buffer = Buffer.from(str, 'utf8');
  if (buffer.length <= maxBytes) return str;
  
  let result = '';
  let currentBytes = 0;
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const charBytes = Buffer.from(char, 'utf8').length;
    
    if (currentBytes + charBytes <= maxBytes) {
      result += char;
      currentBytes += charBytes;
    } else {
      break;
    }
  }
  
  return result;
}

type Person = {
  firstName: string | undefined
  lastName: string | undefined
  dateOfBirth: string | undefined
}

function extractCreds(person: Person) {
  const birthdate = person.dateOfBirth ? person.dateOfBirth : "";
  // const birthdateNum = birthdate ? getDateAsInt(birthdate) : 0;
  const firstNameStr = person.firstName ? person.firstName : "";
  const lastNameStr = person.lastName ? person.lastName : "";
    
  const truncatedFirstNameStr = truncateToBytes(firstNameStr, 24);
  const truncatedLastNameStr = truncateToBytes(lastNameStr, 24);

  // Log original byte lengths
  const originalFirstNameBytes = Buffer.from(firstNameStr, 'utf8').length;
  const originalLastNameBytes = Buffer.from(lastNameStr, 'utf8').length;

  if (originalFirstNameBytes > 24 || originalLastNameBytes > 24) {
    issueCredsV2Logger.nameTruncation({
      originalFirstName: {
        byteLength: originalFirstNameBytes,
        charLength: firstNameStr.length
      },
      originalLastName: {
        byteLength: originalLastNameBytes,
        charLength: lastNameStr.length
      }
    });
  }

  const firstNameBuffer = truncatedFirstNameStr ? Buffer.from(truncatedFirstNameStr, 'utf8') : Buffer.alloc(1);
  const lastNameBuffer = truncatedLastNameStr ? Buffer.from(truncatedLastNameStr, 'utf8') : Buffer.alloc(1);
  const nameArgs = [firstNameBuffer, lastNameBuffer].map((x) =>
    ethers.BigNumber.from(x).toString()
  );
  const nameHash = ethers.BigNumber.from(poseidon(nameArgs)).toString();

  return {
    rawCreds: {
      birthdate,
      firstName: truncatedFirstNameStr,
      lastName: truncatedLastNameStr
    },
    derivedCreds: {
      nameHash: {
        value: nameHash,
        derivationFunction: "poseidon",
        inputFields: [
          "rawCreds.firstName",
          "rawCreds.lastName",
        ],
      },
    },
    fieldsInLeaf: [
      "issuer",
      "secret",
      "rawCreds.birthdate",
      "derivedCreds.nameHash",
      "iat", // TODO: Is this correct?
      "scope",
    ],
  };
}

async function saveUserToDb(uuid: string) {
  const userVerificationsDoc = new UserVerifications({
    aml: {
      uuid: uuid,
      issuedAt: new Date(),
    },
  });
  try {
    await userVerificationsDoc.save();
  } catch (err: any) {
    console.error(
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

/**
 * Util function that wraps issuev2 from holonym-wasm-issuer
 */
function issuev2CleanHands(
  cleanHandsIssuerPrivateKey: string,
  issuanceNullifier: string,
  creds: { rawCreds: { birthdate: string }, derivedCreds: { nameHash: { value: string } } }
) {
  return JSON.parse(
    issuev2(
      cleanHandsIssuerPrivateKey,
      issuanceNullifier,
      getDateAsInt(creds.rawCreds.birthdate).toString(),
      creds.derivedCreds.nameHash.value,
    )
  );
}

async function issueCreds(req: Request, res: Response) {
  // Block usage of this endpoint
  return res.status(404).send()

  // try {
  //   const issuanceNullifier = req.params.nullifier;
  //   const _id = req.params._id;

  //   if (process.env.ENVIRONMENT == "dev") {
  //     const creds = cleanHandsDummyUserCreds;

  //     const response = JSON.parse(
  //       issuev2(
  //         process.env.HOLONYM_ISSUER_CLEAN_HANDS_PRIVKEY,
  //         issuanceNullifier,
  //         getDateAsInt(creds.rawCreds.birthdate).toString(),
  //         creds.derivedCreds.nameHash.value,
  //       )
  //     );
  //     response.metadata = cleanHandsDummyUserCreds;
  
  //     return res.status(200).json(response);
  //   }
  
  //   // zkp should be of type Groth16FullProveResult (a proof generated with snarkjs.groth16)
  //   // it should be stringified
  //   let zkp = null;
  //   try {
  //     zkp = JSON.parse(req.query.zkp);
  //   } catch (err: any) {
  //     return res.status(400).json({ error: "Invalid zkp" });
  //   }
    
  //   if (!zkp?.proof || !zkp?.publicSignals) {
  //     return res.status(400).json({ error: "No zkp found" });
  //   }

  //   let objectId = null;
  //   try {
  //     objectId = new ObjectId(_id);
  //   } catch (err: any) {
  //     return res.status(400).json({ error: "Invalid _id" });
  //   }
  
  //   const session = await AMLChecksSession.findOne({ _id: objectId }).exec();
  
  //   if (!session) {
  //     return res.status(404).json({ error: "Session not found" });
  //   }

  //   if (session.status !== sessionStatusEnum.IN_PROGRESS) {
  //     if (session.status === sessionStatusEnum.VERIFICATION_FAILED) {
  //       return res.status(400).json({
  //         error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
  //       });
  //     }
  //     return res.status(400).json({
  //       error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
  //     });
  //   }
  
  //   const zkpVerified = await groth16.verify(V3NameDOBVKey, zkp.publicSignals, zkp.proof);
  //   if (!zkpVerified) {
  //     return res.status(400).json({ error: "ZKP verification failed" });
  //   }
  
  //   const { 
  //     expiry,
  //     firstName, 
  //     lastName, 
  //     dateOfBirth, 
  //   } = parsePublicSignals(zkp.publicSignals);
  
  //   if (expiry < new Date()) {
  //     return res.status(400).json({ error: "Credentials have expired" });
  //   }

  //   // sanctions.io returns 301 if we query "<base-url>/search" but returns the actual result
  //   // when we query "<base-url>/search/" (with trailing slash).
  //   const sanctionsUrl = 'https://api.sanctions.io/search/' +
  //     '?min_score=0.85' +
  //     // TODO: Create a constant for the data sources
  //     // `&data_source=${encodeURIComponent('CFSP')}` +
  //     `&data_source=${encodeURIComponent('CAP,CCMC,CMIC,DPL,DTC,EL,FATF,FBI,FINCEN,FSE,INTERPOL,ISN,MEU,NONSDN,NS-MBS LIST,OFAC-COMPREHENSIVE,OFAC-MILITARY,OFAC-OTHERS,PEP,PLC,SDN,SSI,US-DOS-CRS')}` +
  //     `&name=${encodeURIComponent(`${firstName} ${lastName}`)}` +
  //     `&date_of_birth=${encodeURIComponent(dateOfBirth)}` +
  //     '&entity_type=individual';
  //   // TODO: Add country_residence to zkp
  //   // sanctionsUrl.searchParams.append('country_residence', 'us')
  //   const config = {
  //     headers: {
  //       'Accept': 'application/json; version=2.2',
  //       'Authorization': 'Bearer ' + process.env.SANCTIONS_API_KEY
  //     }
  //   }
  //   const resp = await fetch(sanctionsUrl, config)
  //   const data = await resp.json()

  //   if (data.count > 0) {
  //     return res.status(400).json({ error: 'Sanctions match found' });
  //   }
  
  //   const validationResult = validateScreeningResult(data);
  //   if (validationResult.error) {
  //     console.error(validationResult.log.data, validationResult.log.msg);

  //     session.status = sessionStatusEnum.VERIFICATION_FAILED;
  //     session.verificationFailureReason = validationResult.error;
  //     await session.save()

  //     return res.status(400).json({ error: validationResult.error });
  //   }
  
  //   const uuid = govIdUUID(
  //     firstName, 
  //     lastName, 
  //     dateOfBirth, 
  //   );

  //   const dbResponse = await saveUserToDb(uuid);
  //   if (dbResponse.error) return res.status(400).json(dbResponse);

  //   const creds = extractCreds({
  //     firstName, 
  //     lastName, 
  //     dateOfBirth,
  //   });
  
  //   const response = JSON.parse(
  //     issuev2(
  //       process.env.HOLONYM_ISSUER_CLEAN_HANDS_PRIVKEY,
  //       issuanceNullifier,
  //       getDateAsInt(creds.rawCreds.birthdate).toString(),
  //       creds.derivedCreds.nameHash.value,
  //     )
  //   );
  //   response.metadata = creds;
    
  //   session.status = sessionStatusEnum.ISSUED;
  //   await session.save()
  
  //   return res.status(200).json(response);
  // } catch (err: any) {
  //   console.error(err);
  //   return res.status(500).json({ error: "An unknown error occurred" });
  // }
}

/**
 * Allows user to retrieve their signed verification info.
 * 
 * Compared to the v1 endpoint, this one allows the user to get their
 * credentials up to 5 days after initial issuance, if they provide the
 * same nullifier.
 */
async function issueCredsV2(req: Request, res: Response) {
  // Block usage of this endpoint
  return res.status(404).send()

  // try {
  //   // Caller must specify a session ID and a nullifier. We first lookup the user's creds
  //   // using the nullifier. If no hit, then we lookup the credentials using the session ID.
  //   const issuanceNullifier = req.params.nullifier;
  //   const _id = req.params._id;

  //   try {
  //     const _number = BigInt(issuanceNullifier)
  //   } catch (err: any) {
  //     return res.status(400).json({
  //       error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`
  //     });
  //   }

  //   // if (process.env.ENVIRONMENT == "dev") {
  //   //   const creds = cleanHandsDummyUserCreds;
  //   //   const response = issuev2CleanHands(issuanceNullifier, creds);
  //   //   response.metadata = cleanHandsDummyUserCreds;
  //   //   return res.status(200).json(response);
  //   // }

  //   let objectId = null;
  //   try {
  //     objectId = new ObjectId(_id);
  //   } catch (err: any) {
  //     return res.status(400).json({ error: "Invalid _id" });
  //   }

  //   const session = await AMLChecksSession.findOne({ _id: objectId }).exec();
  
  //   if (!session) {
  //     return res.status(404).json({ error: "Session not found" });
  //   }

  //   if (session.status === sessionStatusEnum.VERIFICATION_FAILED) {
  //     return res.status(400).json({
  //       error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
  //     });
  //   }

  //   // First, check if the user is looking up their credentials using their nullifier
  //   const nullifierAndCreds = await findOneNullifierAndCredsLast5Days(issuanceNullifier);
  //   const govIdCreds = nullifierAndCreds?.govIdCreds
  //   if (govIdCreds?.firstName && govIdCreds?.lastName && govIdCreds?.dateOfBirth) {
  //     // Note that we don't need to validate the ZKP or creds here. If the creds are in
  //     // the database, validation has passed.

  //     if (govIdCreds?.expiry < new Date()) {
  //       return res.status(400).json({
  //         error: "Gov ID credentials have expired. Cannot issue Clean Hands credentials."
  //       });
  //     }

  //     // Get UUID
  //     const uuid = govIdUUID(
  //       govIdCreds.firstName, 
  //       govIdCreds.lastName, 
  //       govIdCreds.dateOfBirth, 
  //     );

  //     // Assert user hasn't registered yet.
  //     // This step is not strictly necessary since we are only considering nullifiers
  //     // from the last 5 days (in the nullifierAndCreds query above) and the user
  //     // is only getting the credentials+nullifier that they were already issued.
  //     // However, we keep it here to be extra safe.
  //     const user = await findOneCleanHandsUserVerification11Months5Days(uuid);
  //     if (user) {
  //       // await saveCollisionMetadata(uuidOld, uuidNew, checkIdFromNullifier, documentReport);
  //       issueCredsV2Logger.alreadyRegistered(uuid);
  //       // Fail session and return
  //       await failSession(session, toAlreadyRegisteredStr(user._id))
  //       return res.status(400).json({ error: toAlreadyRegisteredStr(user._id) });
  //     }

  //     const creds = extractCreds({
  //       firstName: govIdCreds.firstName, 
  //       lastName: govIdCreds.lastName,
  //       dateOfBirth: govIdCreds.dateOfBirth,
  //     });
  //     const response = issuev2CleanHands(issuanceNullifier, creds);
  //     response.metadata = creds;

  //     issueCredsV2Logger.info({ uuid }, "Issuing credentials");

  //     session.status = sessionStatusEnum.ISSUED;
  //     await session.save();

  //     return res.status(200).json(response);
  //   }

  //   // If the session isn't in progress, we do not issue credentials. If the session is ISSUED,
  //   // then the lookup via nullifier should have worked above.
  //   if (session.status !== sessionStatusEnum.IN_PROGRESS) {
  //     return res.status(400).json({
  //       error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
  //     });
  //   }

  //   // zkp should be of type Groth16FullProveResult (a proof generated with snarkjs.groth16)
  //   // it should be stringified
  //   let zkp = null;
  //   try {
  //     zkp = JSON.parse(req.query.zkp);
  //   } catch (err: any) {
  //     return res.status(400).json({ error: "Invalid zkp" });
  //   }
    
  //   if (!zkp?.proof || !zkp?.publicSignals) {
  //     return res.status(400).json({ error: "No zkp found" });
  //   }
  
  //   const zkpVerified = await groth16.verify(V3NameDOBVKey, zkp.publicSignals, zkp.proof);
  //   if (!zkpVerified) {
  //     return res.status(400).json({ error: "ZKP verification failed" });
  //   }
  
  //   const { 
  //     expiry,
  //     firstName, 
  //     lastName, 
  //     dateOfBirth, 
  //   } = parsePublicSignals(zkp.publicSignals);
  
  //   if (expiry < new Date()) {
  //     return res.status(400).json({ error: "Credentials have expired" });
  //   }

  //   // sanctions.io returns 301 if we query "<base-url>/search" but returns the actual result
  //   // when we query "<base-url>/search/" (with trailing slash).
  //   const sanctionsUrl = 'https://api.sanctions.io/search/' +
  //     '?min_score=0.93' +
  //     // TODO: Create a constant for the data sources
  //     // `&data_source=${encodeURIComponent('CFSP')}` +
  //     `&data_source=${encodeURIComponent('CAP,CCMC,CMIC,DPL,DTC,EL,FATF,FBI,FINCEN,FSE,INTERPOL,ISN,MEU,NONSDN,NS-MBS LIST,OFAC-COMPREHENSIVE,OFAC-MILITARY,OFAC-OTHERS,PEP,PLC,SDN,SSI,US-DOS-CRS')}` +
  //     `&name=${encodeURIComponent(`${firstName} ${lastName}`)}` +
  //     `&date_of_birth=${encodeURIComponent(dateOfBirth)}` +
  //     '&entity_type=individual';
  //   // TODO: Add country_residence to zkp
  //   // sanctionsUrl.searchParams.append('country_residence', 'us')
  //   const config = {
  //     headers: {
  //       'Accept': 'application/json; version=2.2',
  //       'Authorization': 'Bearer ' + process.env.SANCTIONS_API_KEY
  //     }
  //   }
  //   const resp = await fetch(sanctionsUrl, config)
  //   const data = await resp.json()

  //   if (data.count > 0) {
  //     const whitelistItem = await CleanHandsSessionWhitelist.findOne({ sessionId: session._id }).exec();
  //     if (!whitelistItem) {
  //       issueCredsV2Logger.sanctionsMatchFound(data.results);
  //       const confidenceScores = data?.results?.map(result => {
  //         return `(${result.data_source?.name}: ${result?.confidence_score})`
  //       }).join(', ')
  //       await failSession(session, `Sanctions match found. Confidence scores: ${confidenceScores}`)
  //       return res.status(400).json({ error: 'Sanctions match found' });
  //     } else {
  //       issueCredsV2Logger.info({ sessionId: session._id }, "Ignoring sanctions match for whitelisted session");
  //     }
  //   }
  
  //   // Commented out since the only validation we do is to check if count > 0, which we do above.
  //   // TODO: In the future, once we add more validation, we should use this pattern.
  //   // const validationResult = validateScreeningResult(data);
  //   // if (validationResult.error) {
  //   //   issueCredsV2Logger.error(validationResult.log.data, validationResult.log.msg);
  //   //   await failSession(session, validationResult.error)
  //   //   return res.status(400).json({ error: validationResult.error });
  //   // }
  
  //   const uuid = govIdUUID(
  //     firstName, 
  //     lastName, 
  //     dateOfBirth, 
  //   );

  //   // Assert user hasn't registered yet
  //   const user = await findOneCleanHandsUserVerification11Months5Days(uuid);
  //   if (user) {
  //     // await saveCollisionMetadata(uuidOld, uuidNew, checkIdFromNullifier, documentReport);
  //     issueCredsV2Logger.alreadyRegistered(uuid);
  //     // Fail session and return
  //     await failSession(session, toAlreadyRegisteredStr(user._id))
  //     return res.status(400).json({ error: toAlreadyRegisteredStr(user._id) });
  //   }

  //   const dbResponse = await saveUserToDb(uuid);
  //   if (dbResponse.error) return res.status(400).json(dbResponse);

  //   const creds = extractCreds({
  //     firstName, 
  //     lastName, 
  //     dateOfBirth,
  //   });
  
  //   const response = issuev2CleanHands(issuanceNullifier, creds);
  //   response.metadata = creds;
    
  //   issueCredsV2Logger.info({ uuid }, "Issuing credentials");

  //   const newNullifierAndCreds = new CleanHandsNullifierAndCreds({
  //     holoUserId: session.sigDigest,
  //     issuanceNullifier,
  //     uuid,
  //     govIdCreds: {
  //       firstName,
  //       lastName,
  //       dateOfBirth,
  //       expiry
  //     },
  //   });
  //   await newNullifierAndCreds.save();

  //   session.status = sessionStatusEnum.ISSUED;
  //   await session.save()
  
  //   return res.status(200).json(response);
  // } catch (err: any) {
  //   console.error(err);
  //   return res.status(500).json({ error: "An unknown error occurred" });
  // }
}

/**
 * Allows user to retrieve their credentials from Onfido directly.
 */
async function issueCredsV3(req: Request, res: Response) {
  // Block usage of this endpoint
  return res.status(404).send()

  // try {
  //   // Caller must specify a session ID and a nullifier. We first lookup the user's creds
  //   // using the nullifier. If no hit, then we lookup the credentials using the session ID.
  //   const issuanceNullifier = req.params.nullifier;
  //   const _id = req.params._id;

  //   try {
  //     const _number = BigInt(issuanceNullifier);
  //   } catch (err: any) {
  //     return res.status(400).json({
  //       error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`
  //     });
  //   }

  //   // if (process.env.ENVIRONMENT == "dev") {
  //   //   const creds = cleanHandsDummyUserCreds;
  //   //   const response = issuev2CleanHands(issuanceNullifier, creds);
  //   //   response.metadata = cleanHandsDummyUserCreds;
  //   //   return res.status(200).json(response);
  //   // }

  //   let objectId = null;
  //   try {
  //     objectId = new ObjectId(_id);
  //   } catch (err: any) {
  //     return res.status(400).json({ error: "Invalid _id" });
  //   }

  //   const session = await AMLChecksSession.findOne({ _id: objectId }).exec();
  
  //   if (!session) {
  //     return res.status(404).json({ error: "Session not found" });
  //   }

  //   if (session.status === sessionStatusEnum.VERIFICATION_FAILED) {
  //     return res.status(400).json({
  //       error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
  //     });
  //   }

  //   // First, check if the user is looking up their credentials using their nullifier
  //   const nullifierAndCreds = await findOneNullifierAndCredsLast5Days(issuanceNullifier);
  //   const nullifierIdvSessionId = nullifierAndCreds?.idvSessionId;

  //   // as idvSessionId is already set in DB, we can directly get the creds from Onfido
  //   // without stringent validation
  //   if (nullifierIdvSessionId) {
  //     const idvSessionResult = await getSessionById(nullifierIdvSessionId);
  //     if (idvSessionResult.error) {
  //       return res.status(400).json({ error: idvSessionResult.error });
  //     }

  //     const check_id = idvSessionResult.session.check_id;
  //     if (!check_id) {
  //       return res.status(400).json({ error: "Unexpected: No onfido check_id in the idv session" });
  //     }

  //     const check = await getOnfidoCheck(liveConfig.onfidoAPIKey, check_id);  
  //     const reports = await getOnfidoReports(liveConfig.onfidoAPIKey, check.report_ids);
  //     const documentReport = reports.find((report) => report.name == "document");

  //     // get creds from onfido report
  //     const firstName = documentReport.properties.first_name || "";
  //     const lastName = documentReport.properties.last_name || "";
  //     const dateOfBirth = documentReport.properties.date_of_birth || "";

  //     // expiry - not needed?
  //     const expiry = documentReport.properties.expiry || "";

  //     const uuid = govIdUUID(
  //       firstName, 
  //       lastName, 
  //       dateOfBirth, 
  //     );

  //     // Assert user hasn't registered yet.
  //     // This step is not strictly necessary since we are only considering nullifiers
  //     // from the last 5 days (in the nullifierAndCreds query above) and the user
  //     // is only getting the credentials+nullifier that they were already issued.
  //     // However, we keep it here to be extra safe.
  //     const user = await findOneCleanHandsUserVerification11Months5Days(uuid);
  //     if (user) {
  //       // await saveCollisionMetadata(uuidOld, uuidNew, checkIdFromNullifier, documentReport);
  //       issueCredsV3Logger.alreadyRegistered(uuid);
  //       // Fail session and return
  //       await failSession(session, toAlreadyRegisteredStr(user._id))
  //       return res.status(400).json({ error: toAlreadyRegisteredStr(user._id) });
  //     }

  //     const creds = extractCreds({
  //       firstName, 
  //       lastName, 
  //       dateOfBirth,
  //     });
    
  //     const response = issuev2CleanHands(issuanceNullifier, creds);
  //     response.metadata = creds;

  //     issueCredsV3Logger.info({ uuid }, "Issuing credentials");

  //     session.status = sessionStatusEnum.ISSUED;
  //     await session.save();

  //     return res.status(200).json(response);
  //   }

  //   // If the session isn't in progress, we do not issue credentials. If the session is ISSUED,
  //   // then the lookup via nullifier should have worked above.
  //   if (session.status !== sessionStatusEnum.IN_PROGRESS) {
  //     return res.status(400).json({
  //       error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
  //     });
  //   }

  //   // here instead of zkp, we get from onfido directly
  //   const idvSessionId = req.query.idvSessionId;
  //   const idvSessionResult = await getSessionById(idvSessionId);
  //   if (idvSessionResult.error) {
  //     return res.status(400).json({ error: idvSessionResult.error });
  //   }
  //   const idvSession = idvSessionResult.session;

  //   console.log("idvSession", idvSession);
  //   const check_id = idvSession.check_id;
  //   if (!check_id) {
  //     return res.status(400).json({ error: "Unexpected: No onfido check_id in the idv session" });
  //   }

  //   const check = await getOnfidoCheck(liveConfig.onfidoAPIKey, check_id);
  //   const validationResultCheck = validateCheck(check);
  //   if (!validationResultCheck.success && !validationResultCheck.hasReports) {
  //     issueCredsV3Logger.info(validationResultCheck, "Check validation failed")
  //     await failSession(session, validationResultCheck.error)
  //     return res.status(400).json({
  //       error: validationResultCheck.error,
  //       details: validationResultCheck.log.data
  //     });
  //   }

  //   const reports = await getOnfidoReports(liveConfig.onfidoAPIKey, check.report_ids);
  //   if (!validationResultCheck.success && (!reports || reports.length == 0)) {
  //     issueCredsV3Logger.info({ report_ids: check.report_ids }, "No reports found: "+ check_id)

  //     await failSession(session, "No onfido reports found")
  //     return res.status(400).json({ error: "No reports found" });
  //   }
  //   const reportsValidation = validateReports(reports, session);
  //   if (validationResultCheck.error || reportsValidation.error) {
  //     const userErrorMessage = onfidoValidationToUserErrorMessage(
  //       reportsValidation,
  //       validationResultCheck
  //     )
  //     issueCredsV3Logger.info(reportsValidation, "Verification failed: "+ check_id)
  //     await failSession(session, userErrorMessage)

  //     throw {
  //       status: 400,
  //       error: userErrorMessage,
  //       details: {
  //         reasons: reportsValidation.reasons,
  //       },
  //     };
  //   }

  //   const documentReport = reports.find((report) => report.name == "document");

  //   // get creds from onfido report
  //   const firstName = documentReport.properties.first_name || "";
  //   const lastName = documentReport.properties.last_name || "";
  //   const dateOfBirth = documentReport.properties.date_of_birth || "";
    
  //   // expiry - not needed?
  //   const expiry = documentReport.properties.expiry || "";

  //   // sanctions.io returns 301 if we query "<base-url>/search" but returns the actual result
  //   // when we query "<base-url>/search/" (with trailing slash).
  //   const sanctionsUrl = 'https://api.sanctions.io/search/' +
  //     '?min_score=0.93' +
  //     // TODO: Create a constant for the data sources
  //     // `&data_source=${encodeURIComponent('CFSP')}` +
  //     `&data_source=${encodeURIComponent('CAP,CCMC,CMIC,DPL,DTC,EL,FATF,FBI,FINCEN,FSE,INTERPOL,ISN,MEU,NONSDN,NS-MBS LIST,OFAC-COMPREHENSIVE,OFAC-MILITARY,OFAC-OTHERS,PEP,PLC,SDN,SSI,US-DOS-CRS')}` +
  //     `&name=${encodeURIComponent(`${firstName} ${lastName}`)}` +
  //     `&date_of_birth=${encodeURIComponent(dateOfBirth)}` +
  //     '&entity_type=individual';
  //   // TODO: Add country_residence to zkp
  //   // sanctionsUrl.searchParams.append('country_residence', 'us')
  //   const config = {
  //     headers: {
  //       'Accept': 'application/json; version=2.2',
  //       'Authorization': 'Bearer ' + process.env.SANCTIONS_API_KEY
  //     }
  //   }
  //   const resp = await fetch(sanctionsUrl, config)
  //   const data = await resp.json()

  //   const resultsObjectsToStore = []
  //   const filteredResults = data.results.filter(result => {
  //     // Keep all non-PEP results
  //     if (result?.data_source?.short_name !== 'PEP') {
  //       return true
  //     }

  //     // Log and persist the PEP hit
  //     const resultToLog = {
  //       data_source: result.data_source,
  //       nationality: result.nationality,
  //       confidence_score: result.confidence_score,
  //       si_identifier: result.si_identifier,
  //     }
  //     issueCredsV3Logger.info({ result: resultToLog }, "PEP result found");
  //     const resultsObj = new SanctionsResult({
  //       message: "PEP result found",
  //       ...resultToLog
  //     })
  //     resultsObjectsToStore.push(resultsObj)

  //     return true
  //   })

  //   await Promise.all(resultsObjectsToStore.map(result => result.save()))

  //   if (filteredResults.length > 0) {
  //     const whitelistItem = await CleanHandsSessionWhitelist.findOne({ sessionId: session._id }).exec();
  //     if (!whitelistItem) {
  //       issueCredsV3Logger.sanctionsMatchFound(data.results);
  //       const confidenceScores = data?.results?.map(result => {
  //         return `(${result.data_source?.name}: ${result?.confidence_score})`
  //       }).join(', ')
  //       await failSession(session, `Sanctions match found. Confidence scores: ${confidenceScores}`)
  //       return res.status(400).json({ error: 'Sanctions match found' });
  //     } else {
  //       issueCredsV3Logger.info({ sessionId: session._id }, "Ignoring sanctions match for whitelisted session");
  //     }
  //   }
  
  //   // Commented out since the only validation we do is to check if count > 0, which we do above.
  //   // TODO: In the future, once we add more validation, we should use this pattern.
  //   // const validationResult = validateScreeningResult(data);
  //   // if (validationResult.error) {
  //   //   issueCredsV3Logger.error(validationResult.log.data, validationResult.log.msg);
  //   //   await failSession(session, validationResult.error)
  //   //   return res.status(400).json({ error: validationResult.error });
  //   // }
  
  //   const uuid = govIdUUID(
  //     firstName, 
  //     lastName, 
  //     dateOfBirth, 
  //   );

  //   // Assert user hasn't registered yet
  //   const user = await findOneCleanHandsUserVerification11Months5Days(uuid);
  //   if (user) {
  //     // await saveCollisionMetadata(uuidOld, uuidNew, checkIdFromNullifier, documentReport);
  //     issueCredsV3Logger.alreadyRegistered(uuid);
  //     // Fail session and return
  //     await failSession(session, toAlreadyRegisteredStr(user._id))
  //     return res.status(400).json({ error: toAlreadyRegisteredStr(user._id) });
  //   }

  //   const dbResponse = await saveUserToDb(uuid);
  //   if (dbResponse.error) return res.status(400).json(dbResponse);

  //   const creds = extractCreds({
  //     firstName, 
  //     lastName, 
  //     dateOfBirth,
  //   });
  
  //   const response = issuev2CleanHands(issuanceNullifier, creds);
  //   response.metadata = creds;
    
  //   issueCredsV3Logger.info({ uuid }, "Issuing credentials");

  //   const newNullifierAndCreds = new CleanHandsNullifierAndCreds({
  //     holoUserId: session.sigDigest,
  //     issuanceNullifier,
  //     uuid,
  //     idvSessionId,
  //   });
  //   await newNullifierAndCreds.save();

  //   session.status = sessionStatusEnum.ISSUED;
  //   await session.save()
  
  //   return res.status(200).json(response);
  // } catch (err: any) {
  //   console.error(err);
  //   return res.status(500).json({ error: "An unknown error occurred" });
  // }
}

/**
 * Same as v3, except it marks the session as NEEDS_USER_DECLARATION if certain
 * PEP hits are found.
 */
function createIssueCredsV4RouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      // Caller must specify a session ID and a nullifier. We first lookup the user's creds
      // using the nullifier. If no hit, then we lookup the credentials using the session ID.
      const issuanceNullifier = req.params.nullifier;
      const _id = req.params._id;

      try {
        const _number = BigInt(issuanceNullifier);
      } catch (err: any) {
        return res.status(400).json({
          error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`
        });
      }

    // if (process.env.ENVIRONMENT == "dev") {
    //   const creds = cleanHandsDummyUserCreds;
    //   const response = issuev2CleanHands(issuanceNullifier, creds);
    //   response.metadata = cleanHandsDummyUserCreds;
    //   return res.status(200).json(response);
    // }

    let objectId = null;
    try {
      objectId = new ObjectId(_id);
    } catch (err: any) {
      return res.status(400).json({ error: "Invalid _id" });
    }

    const session = await config.AMLChecksSessionModel.findOne({ _id: objectId }).exec();
  
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status === sessionStatusEnum.VERIFICATION_FAILED) {
      return res.status(400).json({
        error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
      });
    }

    if (session.status === cleanHandsSessionStatusEnum.NEEDS_USER_DECLARATION) {
      return res.status(202).json({
        message: "User action required. User must confirm that they are not any of the PEPs mentioned in the results.",
        statement: session?.userDeclaration?.statement,
      });
    }

    // First, check if the user is looking up their credentials using their nullifier
    const nullifierAndCreds = await findOneNullifierAndCredsLast5Days(config.CleanHandsNullifierAndCredsModel, issuanceNullifier);
    const nullifierIdvSessionId = nullifierAndCreds?.idvSessionId;

    // as idvSessionId is already set in DB, we can directly get the creds from Onfido
    // without stringent validation
    if (nullifierIdvSessionId) {
      let idvSessionObjectId = null;
      try {
        idvSessionObjectId = new ObjectId(nullifierIdvSessionId);
      } catch (err: any) {
        return res.status(400).json({ error: "Invalid idvSessionId" });
      }

      const idvSession = await config.SessionModel.findOne({ _id: idvSessionObjectId }).exec();
      if (!idvSession) {
        return res.status(404).json({ error: "IDV session not found" });
      }

      const check_id = idvSession.check_id;
      if (!check_id) {
        return res.status(400).json({ error: "Unexpected: No onfido check_id in the idv session" });
      }

      const check = await getOnfidoCheck(config.onfidoAPIKey, check_id);  
      const reports = await getOnfidoReports(config.onfidoAPIKey, check.report_ids);
      const documentReport = reports?.find((report) => report.name == "document");

      // get creds from onfido report
      const firstName = documentReport.properties.first_name || "";
      const lastName = documentReport.properties.last_name || "";
      const dateOfBirth = documentReport.properties.date_of_birth || "";

      // expiry - not needed?
      const expiry = documentReport.properties.expiry || "";

      const uuid = govIdUUID(
        firstName, 
        lastName, 
        dateOfBirth, 
      );

      // Assert user hasn't registered yet.
      // This step is not strictly necessary since we are only considering nullifiers
      // from the last 5 days (in the nullifierAndCreds query above) and the user
      // is only getting the credentials+nullifier that they were already issued.
      // However, we keep it here to be extra safe.
      if (config.environment === "live") {
        const user = await findOneCleanHandsUserVerification11Months5Days(uuid);
        if (user) {
          // await saveCollisionMetadata(uuidOld, uuidNew, checkIdFromNullifier, documentReport);
          issueCredsV4Logger.alreadyRegistered(uuid);
          // Fail session and return
          await failSession(session, toAlreadyRegisteredStr(user._id.toString()))
          return res.status(400).json({ error: toAlreadyRegisteredStr(user._id.toString()) });
        }
      }

      const creds = extractCreds({
        firstName, 
        lastName, 
        dateOfBirth,
      });
    
      const response = issuev2CleanHands(config.cleanHandsIssuerPrivateKey, issuanceNullifier, creds);
      response.metadata = creds;

      issueCredsV4Logger.info({ uuid }, "Issuing credentials");

      session.status = sessionStatusEnum.ISSUED;
      await session.save();

      return res.status(200).json(response);
    }

    // If the session isn't in progress, we do not issue credentials. If the session is ISSUED,
    // then the lookup via nullifier should have worked above.
    if (session.status !== sessionStatusEnum.IN_PROGRESS) {
      return res.status(400).json({
        error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
      });
    }

    // here instead of zkp, we get from onfido directly
    const idvSessionId = req.query.idvSessionId;
    let idvSessionObjectId = null;
    try {
      idvSessionObjectId = new ObjectId(idvSessionId as string);
    } catch (err: any) {
      return res.status(400).json({ error: "Invalid idvSessionId" });
    }

    const idvSession = await config.SessionModel.findOne({ _id: idvSessionObjectId }).exec();
    if (!idvSession) {
      return res.status(404).json({ error: "IDV session not found" });
    }

    const check_id = idvSession.check_id;
    if (!check_id) {
      return res.status(400).json({ error: "Unexpected: No onfido check_id in the idv session" });
    }

    const check = await getOnfidoCheck(config.onfidoAPIKey, check_id);
    const validationResultCheck = validateCheck(check);
    if (!validationResultCheck.success && !validationResultCheck.hasReports) {
      issueCredsV4Logger.info(validationResultCheck, "Check validation failed")
      await failSession(session, validationResultCheck.error as string)
      return res.status(400).json({
        error: validationResultCheck.error,
        details: validationResultCheck?.log?.data
      });
    }

    const reports = await getOnfidoReports(config.onfidoAPIKey, check.report_ids);
    if (!validationResultCheck.success && (!reports || reports.length == 0)) {
      issueCredsV4Logger.info({ report_ids: check.report_ids }, "No reports found: "+ check_id)

      await failSession(session, "No onfido reports found")
      return res.status(400).json({ error: "No reports found" });
    }
    const reportsValidation = validateReports(reports ?? [], session);
    if (validationResultCheck.error || reportsValidation.error) {
      const userErrorMessage = onfidoValidationToUserErrorMessage(
        reportsValidation,
        validationResultCheck
      )
      issueCredsV4Logger.info(reportsValidation, "Verification failed: "+ check_id)
      await failSession(session, userErrorMessage)

      throw {
        status: 400,
        error: userErrorMessage,
        details: {
          reasons: reportsValidation.reasons,
        },
      };
    }

    const documentReport = reports?.find((report) => report.name == "document");

    // get creds from onfido report
    const firstName = documentReport.properties.first_name || "";
    const lastName = documentReport.properties.last_name || "";
    const dateOfBirth = documentReport.properties.date_of_birth || "";
    
    // expiry - not needed?
    const expiry = documentReport.properties.expiry || "";

    // If:
    // - A sanctions check has recently been done for this session AND
    // - The user was found to not be on any blocklists AND
    // - The user was identified as a potential PEP in a non-high risk country,
    // (all of the above should be true for session.userDeclaration.statement to exist)
    // then:
    // - Check if the user has confirmed the required statement saying they are not
    //   any of the identified PEPs.
    // If the user has confirmed recently, then skip the sanctions check.
    const fiveDaysAgo = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000))
    const skipSanctionsCheck = session.userDeclaration?.confirmed && 
      ((session.userDeclaration?.statementGeneratedAt ?? 0) > fiveDaysAgo)

    if (!skipSanctionsCheck) {
      // sanctions.io returns 301 if we query "<base-url>/search" but returns the actual result
      // when we query "<base-url>/search/" (with trailing slash).
      const sanctionsUrl = 'https://api.sanctions.io/search/' +
        '?min_score=0.93' +
        // TODO: Create a constant for the data sources
        // `&data_source=${encodeURIComponent('CFSP')}` +
        `&data_source=${encodeURIComponent('CAP,CCMC,CMIC,DPL,DTC,EL,FATF,FBI,FINCEN,FSE,INTERPOL,ISN,MEU,NONSDN,NS-MBS LIST,OFAC-COMPREHENSIVE,OFAC-MILITARY,OFAC-OTHERS,PEP,PLC,SDN,SSI,US-DOS-CRS')}` +
        `&name=${encodeURIComponent(`${firstName} ${lastName}`)}` +
        `&date_of_birth=${encodeURIComponent(dateOfBirth)}` +
        '&entity_type=individual';
      // sanctionsUrl.searchParams.append('country_residence', 'us')
      const reqConfig = {
        headers: {
          'Accept': 'application/json; version=2.2',
          'Authorization': 'Bearer ' + process.env.SANCTIONS_API_KEY
        }
      }
      const resp = await fetch(sanctionsUrl, reqConfig)
      const data = await resp.json()

      // if (process.env.NODE_ENV == 'development') {
      //   data.results.push({
      //     data_hash: 'abc123',
      //     data_source: {
      //       short_name: 'PEP',
      //       long_name: 'INT / Politically Exposed Persons'
      //     },
      //     si_identifier: 'PEP-US-1234',
      //     name: 'Satoshi Nakamoto',
      //     title: 'Bitcoin author',
      //     confidence_score: 0.99
      //   })
      // }

      const resultsObjectsToStore: Array<HydratedDocument<ISanctionsResult> & {
        message: string
      }> = []
      const resultsToBlock = data.results.filter((result: any) => {
        // Keep all non-PEP results
        if (result?.data_source?.short_name !== 'PEP') {
          return true
        }

        // Log and persist the PEP hit
        const resultToLog = {
          data_source: result.data_source,
          nationality: result.nationality,
          confidence_score: result.confidence_score,
          si_identifier: result.si_identifier,
        }
        issueCredsV4Logger.info({ result: resultToLog }, "PEP result found");
        const resultsObj = new config.SanctionsResultModel({
          message: "PEP result found",
          ...resultToLog
        })
        resultsObjectsToStore.push(resultsObj)

        // Filter for PEP results from certain countries
        for (const prefix of siIdentifierPrefixesToBlock) {
          if (!result.si_identifier) {
            issueCredsV4Logger.warn({ result }, "No si_identifier found for PEP result");
            return true
          }
          if (result.si_identifier?.startsWith(prefix)) {
            return true
          }
        }

        return false
      })

      await Promise.all(resultsObjectsToStore.map((result) => result.save()))

      // Get all PEP results that do not trigger an automatic block.
      // For all countries that we don't block, allow the user to declare that they are not the PEP with a similar name.
      const resultsThatRequireDeclaration = data.results.filter((result: any) => {
        // Ignore all non-PEP results
        if (result?.data_source?.short_name !== 'PEP') {
          return false
        }

        // If data_hash is missing for some reason, include it. It should be present.
        // If we see enough of these errors, we can change this logic.
        if (!result.data_hash) {
          issueCredsV4Logger.error({ result }, "Sanctions io PEP result is missing data_hash")
          return true
        }

        // If this PEP result is already in the results to block, ignore it
        for (const resultToBlock of resultsToBlock) {
          if (
            resultToBlock.data_hash &&
            (result.data_hash === resultToBlock.data_hash)
          ) {
            return false
          } else if (!resultToBlock.data_hash) {
            issueCredsV4Logger.error({ result: resultToBlock }, "Sanctions io PEP result is missing data_hash")
            return true
          }
        }

        return true
      })

      if (resultsToBlock.length > 0) {
        const whitelistItem = await CleanHandsSessionWhitelist.findOne({ sessionId: session._id }).exec();
        if (!whitelistItem) {
          issueCredsV4Logger.sanctionsMatchFound(data.results);
          const confidenceScores = data?.results?.map((result: any) => {
            return `(${result.data_source?.name}: ${result?.confidence_score})`
          }).join(', ')
          await failSession(session, `Sanctions match found. Confidence scores: ${confidenceScores}`)
          return res.status(400).json({ error: 'Sanctions match found' });
        } else {
          issueCredsV4Logger.info({ sessionId: session._id }, "Ignoring sanctions match for whitelisted session");
        }
      }

      if (resultsThatRequireDeclaration.length > 0) {
        session.status = cleanHandsSessionStatusEnum.NEEDS_USER_DECLARATION;
        const statement = parseStatementForUserCertification(resultsThatRequireDeclaration)
        session.userDeclaration = {
          statement,
          confirmed: false,
          statementGeneratedAt: new Date()
        }
        await session.save();

        issueCredsV4Logger.info({ sessionId: session._id }, "Clean Hands session requires user declaration")

        return res.status(202).json({
          message: "User action required. User must confirm that they are not any of the PEPs mentioned in the results.",
          statement,
        })
      }
    
      // Commented out since the only validation we do is to check if count > 0, which we do above.
      // TODO: In the future, once we add more validation, we should use this pattern.
      // const validationResult = validateScreeningResult(data);
      // if (validationResult.error) {
      //   issueCredsV4Logger.error(validationResult.log.data, validationResult.log.msg);
      //   await failSession(session, validationResult.error)
      //   return res.status(400).json({ error: validationResult.error });
      // }
    }
  
    const uuid = govIdUUID(
      firstName, 
      lastName, 
      dateOfBirth, 
    );

    // Assert user hasn't registered yet
    if (config.environment === "live") {
      const user = await findOneCleanHandsUserVerification11Months5Days(uuid);
      if (user) {
        // await saveCollisionMetadata(uuidOld, uuidNew, checkIdFromNullifier, documentReport);
        issueCredsV4Logger.alreadyRegistered(uuid);
        // Fail session and return
        await failSession(session, toAlreadyRegisteredStr(user._id.toString()))
        return res.status(400).json({ error: toAlreadyRegisteredStr(user._id.toString()) });
      }
    }

    const dbResponse = await saveUserToDb(uuid);
    if (dbResponse.error) return res.status(400).json(dbResponse);

    const creds = extractCreds({
      firstName, 
      lastName, 
      dateOfBirth,
    });
  
      const response = issuev2CleanHands(config.cleanHandsIssuerPrivateKey, issuanceNullifier, creds);
    response.metadata = creds;
    
    issueCredsV4Logger.info({ uuid }, "Issuing credentials");

    const newNullifierAndCreds = new config.CleanHandsNullifierAndCredsModel({
      holoUserId: session.sigDigest,
      issuanceNullifier,
      uuid,
      idvSessionId,
    });
    await newNullifierAndCreds.save();

    session.status = sessionStatusEnum.ISSUED;
    await session.save()
  
    return res.status(200).json(response);
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "An unknown error occurred" });
    }
  };
}

async function issueCredsV4Live(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createIssueCredsV4RouteHandler(config)(req, res);
}

async function issueCredsV4Sandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createIssueCredsV4RouteHandler(config)(req, res);
}

/**
 * Endpoint to allow the user to confirm the statement stored under "userDeclaration"
 * in the Clean Hands session. For v4 issuance.
 */
function createConfirmStatementRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const _id = req.params._id;

      let objectId = null;
      try {
        objectId = new ObjectId(_id);
      } catch (err: any) {
        return res.status(400).json({ error: "Invalid _id" });
      }

      const session = await config.AMLChecksSessionModel.findOne({ _id: objectId }).exec();
    
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (session.status !== cleanHandsSessionStatusEnum.NEEDS_USER_DECLARATION) {
        return res.status(400).json({
          error: `Session status is '${session.status}'. Expected '${cleanHandsSessionStatusEnum.NEEDS_USER_DECLARATION}'`,
        });
      }

    if (!session?.userDeclaration?.statement) {
      return res.status(400).json({
        error: `Unexpected. Session has no associated statement'`,
      });
    }

    session.userDeclaration.confirmed = true
    session.status = sessionStatusEnum.IN_PROGRESS
    await session.save()

    return res.status(200).json({ message: 'Success' })
  } catch (err: any) {
    console.log("POST /aml-sessions/statement/confirm: Error encountered", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
    }
  };
}

async function confirmStatementLive(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createConfirmStatementRouteHandler(config)(req, res);
}

async function confirmStatementSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createConfirmStatementRouteHandler(config)(req, res);
}

/**
 * Get session(s) associated with sigDigest or id.
 */
function createGetSessionsRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const sigDigest = req.query.sigDigest;
      const id = req.query.id;

      if (!sigDigest && !id) {
        return res.status(400).json({ error: "sigDigest or id is required" });
      }

      let sessions;
      if (id) {
        let objectId = null;
        try {
          objectId = new ObjectId(id as string);
        } catch (err: any) {
          return res.status(400).json({ error: "Invalid id" });
        }
        sessions = await config.AMLChecksSessionModel.find({ _id: objectId }).exec();
      } else {
        sessions = await config.AMLChecksSessionModel.find({ sigDigest }).exec();
      }

      return res.status(200).json(sessions);
  } catch (err: any) {
    console.log("GET /aml-sessions: Error encountered", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
    }
  };
}

async function getSessionsLive(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createGetSessionsRouteHandler(config)(req, res);
}

async function getSessionsSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createGetSessionsRouteHandler(config)(req, res);
}

export {
  postSessionLive as postSession,
  postSessionSandbox,
  postSessionv2Live as postSessionv2,
  postSessionv2Sandbox,
  createPayPalOrder,
  payForSession,
  payForSessionV2,
  payForSessionV3,
  refund,
  refundV2,
  issueCreds,
  issueCredsV2,
  issueCredsV3,
  issueCredsV4Live as issueCredsV4,
  issueCredsV4Sandbox,
  confirmStatementLive as confirmStatement,
  confirmStatementSandbox,
  getSessionsLive as getSessions,
  getSessionsSandbox,
};
