import axios from "axios";
import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { ethers } from "ethers";
import {
  Session,
  SessionRefundMutex,
  getRouteHandlerConfig,
} from "../../init.js";
import {
  getAccessToken as getPayPalAccessToken,
  capturePayPalOrder,
  refundMintFeePayPal
} from "../../utils/paypal.js";
import { createOnfidoSdkToken, createOnfidoCheck, createOnfidoWorkflowRun } from "../../utils/onfido.js";
import {
  validateTxForSessionCreation,
  refundMintFeeOnChain,
} from "../../utils/transactions.js";
import {
  supportedChainIds,
  sessionStatusEnum,
  payPalApiUrlBase,
  idvSessionUSDPrice,
} from "../../constants/misc.js";
import {
  handleIdvSessionCreation,
  campaignIdToWorkflowId,
} from "./functions.js";
import { rateLimitByTier, onfidoSDKTokenAndApplicantRateLimiter } from "../../utils/rate-limiting.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { getSessionById } from "../../utils/sessions.js";
import { objectIdFiveDaysAgo } from "../../utils/utils.js";
import { getRateLimitTier } from "../../utils/whitelist.js";
import type { SandboxVsLiveKYCRouteHandlerConfig } from "../../types.js"
import { makeUnknownErrorLoggable } from "../../utils/errors.js";

const postSessionsV2Logger = logger.child({
  msgPrefix: "[POST /sessions/v2] ",
  base: {
    ...pinoOptions.base,
  },
});
const createIdvSessionLogger = logger.child({
  msgPrefix: "[POST /sessions/:_id/idv-session] ",
  base: {
    ...pinoOptions.base,
  },
});
const createIdvSessionV2Logger = logger.child({
  msgPrefix: "[POST /sessions/:_id/idv-session/v2] ",
  base: {
    ...pinoOptions.base,
  },
});
const createPayPalOrderLogger = logger.child({
  msgPrefix: "[POST /sessions/:_id/paypal-order] ",
  base: {
    ...pinoOptions.base,
  },
});
const capturePayPalOrderLogger = logger.child({
  msgPrefix: "[POST /sessions/:_id/paypal-order/capture] ",
  base: {
    ...pinoOptions.base,
  },
});
const refreshOnfidoTokenLogger = logger.child({
  msgPrefix: "[POST /sessions/:_id/idv-session/onfido/token] ",
  base: {
    ...pinoOptions.base,
  },
});
// const getSessionsLogger = logger.child({
//   msgPrefix: "[GET /sessions] ",
//   base: {
//     ...pinoOptions.base,
//   },
// });
const createOnfidoCheckLogger = logger.child({
  msgPrefix: "[POST /sessions/:_id/idv-session/onfido/check] ",
  base: {
    ...pinoOptions.base,
  },
});

// Session object
// - _id: created by id-server (not by an idv provider)
// - sigDigest: string, allows user to have the same session across multiple browser sessions
// - txHash: string
// - chainId: number
// - idvProvider: string, e.g., 'veriff'
// - [sessionId | scanRef | check_id]: string

// POST /sessions
// - Creates a session
// - body: { sigDigest, idvProvider }

// POST /sessions/:_id/idv-session
// - Allows a user to create an IDV session by associating a transaction with an id-server session

// GET /sessions?id=<id>&sigDigest=<sigDigest>
// - id or sigDigest or both must be provided.
// - Gets a session or array of sessions.
// - Helpful for frontend to check whether a session has been paid for

// POST /sessions
// - Creates a session
// - body: { sigDigest, idvProvider }

// POST /sessions/:_id/idv-session
// - Allows a user to create an IDV session by associating a transaction with an id-server session

// GET /sessions?id=<id>&sigDigest=<sigDigest>
// - id or sigDigest or both must be provided.
// - Gets a session or array of sessions.
// - Helpful for frontend to check whether a session has been paid for

/**
 * Creates a session.
 */
async function postSession(req: Request, res: Response) {
  try {
    const sigDigest = req.body.sigDigest;
    const idvProvider = req.body.idvProvider;
    if (!sigDigest) {
      return res.status(400).json({ error: "sigDigest is required" });
    }
    if (!idvProvider || ["veriff", "onfido", "facetec"].indexOf(idvProvider) === -1) {
      return res
        .status(400)
        .json({ error: "idvProvider must be one of 'veriff' or 'onfido'" });
    }

    let domain = null;
    if (req.body.domain === "app.holonym.id") {
      domain = "app.holonym.id";
    } else if (req.body.domain === "silksecure.net") {
      domain = "silksecure.net";
    }

    let silkDiffWallet = null;
    if (req.body.silkDiffWallet === "silk") {
      silkDiffWallet = "silk";
    } else if (req.body.silkDiffWallet === "diff-wallet") {
      silkDiffWallet = "diff-wallet";
    }

    // Get country from IP address
    const userIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const resp = await axios.get(
      `https://ipapi.co/${userIp}/json?key=${process.env.IPAPI_SECRET_KEY}`
    );
    const ipCountry = resp?.data?.country;

    if (!ipCountry && process.env.NODE_ENV != 'development') {
      return res.status(500).json({ error: "Could not determine country from IP" });
    }

    const session = new Session({
      sigDigest: sigDigest,
      idvProvider: idvProvider,
      status: sessionStatusEnum.NEEDS_PAYMENT,
      frontendDomain: domain,
      silkDiffWallet,
      ipCountry: ipCountry,
    });
    await session.save();

    return res.status(201).json({ session });
  } catch (err: any) {
    console.log("POST /sessions: Error encountered", makeUnknownErrorLoggable(err).message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

function createPostSessionV2RouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const sigDigest = req.body.sigDigest;
      const idvProvider = req.body.idvProvider;
      const address = req.body.address || null // Optional blockchain address for whitelist lookup
      if (!sigDigest) {
        return res.status(400).json({ error: "sigDigest is required" });
      }
      if (!idvProvider || ["veriff", "onfido", "facetec"].indexOf(idvProvider) === -1) {
        return res
          .status(400)
          .json({ error: "idvProvider must be one of 'veriff' or 'onfido' or 'facetec'" });
      }

      let domain = null;
      if (req.body.domain === "app.holonym.id") {
        domain = "app.holonym.id";
      } else if (req.body.domain === "silksecure.net") {
        domain = "silksecure.net";
      }

      let silkDiffWallet = null;
      if (req.body.silkDiffWallet === "silk") {
        silkDiffWallet = "silk";
      } else if (req.body.silkDiffWallet === "diff-wallet") {
        silkDiffWallet = "diff-wallet";
      }

      // Get country from IP address
      const userIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      const resp = await axios.get(
        `https://ipapi.co/${userIp}/json?key=${process.env.IPAPI_SECRET_KEY}`
      );
      const ipCountry = resp?.data?.country;

      if (!ipCountry && process.env.NODE_ENV != 'development') {
        return res.status(500).json({ error: "Could not determine country from IP" });
      }

      // Rate limiting with whitelist support
      const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress) as string
      const rateLimitKey = 'kyc-sessions'

      // Check whitelist tier based on blockchain address (defaults to 0 if address is null or not whitelisted)
      const tier = await getRateLimitTier(address)

      const { count, limitExceeded, maxForTier } = await rateLimitByTier(tier, ip, rateLimitKey)

      if (limitExceeded) {
        postSessionsV2Logger.warn(
          {
            ip,
            // address, // do not log user addresses
            rateLimitKey,
            count,
            tier,
          },
          'Rate limit exceeded'
        )
        return res.status(429).json({
          error: `This device has reached the maximum number of allowed KYC sessions (${maxForTier}). Please try again in 30 days.`
        })
      }

      const campaignId = req.body.campaignId;
      const workflowId = campaignIdToWorkflowId(campaignId);

      // console.log("postSessionV2:", campaignId, workflowId);

      const session = new config.SessionModel({
        sigDigest: sigDigest,
        idvProvider: idvProvider,
        status: sessionStatusEnum.IN_PROGRESS,
        frontendDomain: domain,
        silkDiffWallet,
        ipCountry: ipCountry,
        campaignId: campaignId,
        workflowId: workflowId,
      });

      console.log("session", session);

      // Only allow a user to create up to 6 sessions
      const existingSessions = await config.SessionModel.find({
        sigDigest: sigDigest,
        status: {
          "$in": [
            sessionStatusEnum.IN_PROGRESS,
            sessionStatusEnum.VERIFICATION_FAILED,
            sessionStatusEnum.ISSUED
          ]
        }
      }).exec();

      if (existingSessions.length >= 10) {
        return res.status(400).json({
          error: "User has reached the maximum number of sessions (10)"
        });
      }

      // session is only saved if idvSessionCreation is successful
      const _idvSession = await handleIdvSessionCreation(config, session, createIdvSessionLogger);

      return res.status(201).json({ session });
    } catch (err: any) {
      console.log("POST /sessions: Error encountered", makeUnknownErrorLoggable(err).message);
      return res.status(500).json({ error: "An unknown error occurred" });
    }
  }
}

/**
 * Creates a session V2. Identical to v1, except it immediately sets session status to IN_PROGRESS.
 */
async function postSessionV2Prod(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPostSessionV2RouteHandler(config)(req, res);
}

async function postSessionV2Sandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createPostSessionV2RouteHandler(config)(req, res);
}


async function createPayPalOrder(req: Request, res: Response) {
  try {
    const _id = req.params._id;

    const { session: potentialSession, error: getSessionError } = await getSessionById(_id);
    if (getSessionError) {
      return res.status(400).json({ error: getSessionError });
    }
    const session = potentialSession!

    const accessToken = await getPayPalAccessToken();

    const url = `${payPalApiUrlBase}/v2/checkout/orders`;
    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          // reference_id: `idv-session-${_id}`,
          amount: {
            currency_code: "USD",
            value: "10.00",
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
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    };

    // ignoring "Property 'post' does not exist on type 'typeof import(...)'"
    // @ts-ignore
    const resp = await axios.post(url, body, config);

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
    createPayPalOrderLogger.error(
      { error: makeUnknownErrorLoggable(err) },
      "Error creating PayPal order"
    );
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * Allows a user to create an IDV session by associating a transaction
 * with an id-server session.
 */
async function createIdvSession(req: Request, res: Response) {
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

    const { session: potentialSession, error: getSessionError } = await getSessionById(_id);
    if (getSessionError) {
      return res.status(400).json({ error: getSessionError });
    }
    const session = potentialSession!

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

    const otherSession = await Session.findOne({ txHash: txHash }).exec();
    if (otherSession) {
      return res
        .status(400)
        .json({ error: "Transaction has already been used to pay for a session" });
    }

    const validationResult = await validateTxForSessionCreation(
      session,
      chainId,
      txHash,
      idvSessionUSDPrice
    );
    if (validationResult.error) {
      createIdvSessionLogger.error(
        { error: validationResult.error, txHash, chainId, _id },
        "Error validating tx for IDV session creation"
      );
      return res
        .status(validationResult.status)
        .json({ error: validationResult.error });
    }

    // Note: We do not immediately call session.save() after adding txHash to
    // the session because we want the session to be saved only if the rest of
    // this function executes successfully.
    session.status = sessionStatusEnum.IN_PROGRESS;
    session.chainId = chainId;
    session.txHash = txHash;

    const idvSession = await handleIdvSessionCreation(config, session, createIdvSessionLogger);
    return res.status(201).json(idvSession);
  } catch (err: any) {
    createIdvSessionLogger.error(
      { error: makeUnknownErrorLoggable(err) },
      "Error creating IDV session"
    );

    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * Allows a user to create an IDV session by either (a) associating a
 * transaction with an id-server session or (b) associating a PayPal
 * order with an id-server session.
 */
async function createIdvSessionV2(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");

  try {
    if (req.body.chainId && req.body.txHash) {
      return createIdvSession(req, res);
    }

    const _id = req.params._id;
    const orderId = req.body.orderId;

    if (!orderId) {
      return res.status(400).json({ error: "orderId is required" });
    }

    const { session: potentialSession, error: getSessionError, objectId } = await getSessionById(_id);
    if (getSessionError) {
      return res.status(400).json({ error: getSessionError });
    }
    const session = potentialSession!

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

    const sessions = await Session.find({
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

    const expectedAmountInUSD = idvSessionUSDPrice;

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

    // Note: We do not immediately call session.save() after adding updating
    // session status because we want the session to be saved only if the rest
    // of this function executes successfully.
    session.status = sessionStatusEnum.IN_PROGRESS;

    const idvSession = await handleIdvSessionCreation(config, session, createIdvSessionLogger);
    return res.status(201).json(idvSession);
  } catch (err: any) {
    createIdvSessionV2Logger.error(
      { error: makeUnknownErrorLoggable(err) },
      "Error creating IDV session"
    );

    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * Create an IDV session. Use on-chain payment. Does not validate
 * transaction data. Requires admin API key.
 */
async function createIdvSessionV3(req: Request, res: Response) {
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

    const { session: potentialSession, error: getSessionError } = await getSessionById(_id);
    if (getSessionError) {
      return res.status(400).json({ error: getSessionError });
    }
    const session = potentialSession!

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

    const otherSession = await Session.findOne({ txHash: txHash }).exec();
    if (otherSession) {
      return res
        .status(400)
        .json({ error: "Transaction has already been used to pay for a session" });
    }

    const validationResult = await validateTxForSessionCreation(
      session,
      chainId,
      txHash,
      idvSessionUSDPrice
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

        // Make sure found is at least 80% of expected
        if (found.lt(expected.mul(8).div(10))) {
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

    const idvSession = await handleIdvSessionCreation(config, session, createIdvSessionLogger);
    return res.status(201).json(idvSession);
  } catch (err: any) {
    createIdvSessionLogger.error(
      { error: makeUnknownErrorLoggable(err) },
      "Error creating IDV session"
    );

    return res.status(500).json({ error: "An unknown error occurred", err });
  }
}

/**
 * Set IDV Provider in the session document
 * 
 */
async function setIdvProvider(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");

  try {
    const _id = req.params._id;
    const idvProvider = req.params.idvProvider;

    // check the idvProvider is either veriff or onfido
    if (!(idvProvider === "onfido" || idvProvider === "veriff")) {
      return res.status(400).json({ error: "IDV provider can only be either onfido or veriff" });
    }

    const { session: potentialSession, error: getSessionError } = await getSessionById(_id);
    if (getSessionError) {
      return res.status(400).json({ error: getSessionError });
    }
    const session = potentialSession!

    // check the session idvProvider
    if (session.idvProvider === idvProvider) {
      return res.status(400).json({ error: "IDV provider is already set the same" });
    }

    // check the session status of current idvProvider,
    // only proceed with if it is "VERIFICATION_FAILED"
    if (session.status !== "VERIFICATION_FAILED") {
      return res.status(400).json({ error: "Another IDV can be set only when current verification has failed" });
    }

    // check the session does not already have idv session of the requested idvProvider
    // if setting to veriff, session.sessionId and session.veriffUrl must be undefined
    if (idvProvider === "veriff" && session.sessionId && session.veriffUrl) {
      return res.status(400).json({ error: "Veriff IDV session has already been tried" });
    }

    // if setting to onfido, session.onfido_sdk_token and session.applicant_id must be undefined
    if (idvProvider === "onfido" && session.onfido_sdk_token && session.applicant_id) {
      return res.status(400).json({ error: "Onfido IDV session has already been tried" });
    }

    // if all clear then proceed
    // session is not saved unless IdvSessionCreation is successful

    // set session.idvProvider to the requested provider
    session.idvProvider = idvProvider;
    // set session.status to IN_PROGRESS for the "new" session with the requested provider
    session.status = "IN_PROGRESS";

    const idvSession = await handleIdvSessionCreation(config, session, createIdvSessionLogger);
    return res.status(201).json(idvSession);
  } catch (err: any) {
    createIdvSessionLogger.error(
      { error: makeUnknownErrorLoggable(err) },
      "Error setting IDV provider and creating IDV session"
    );

    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

function createRefreshOnfidoTokenRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    const _id = req.params._id;

    // Optional req body parameter. Either 'holonym' or 'silk'
    const referrer = req.body.referrer;

    try {
      let objectId = null;
      try {
        objectId = new ObjectId(_id);
      } catch (err) {
        return res.status(400).json({ error: "Invalid _id" });
      }

      const session = await config.SessionModel.findOne({ _id: objectId }).exec();
      if (!session) {
        return res.status(400).json({ error: "Session not found" });
      }

      if (!session.applicant_id) {
        return res.status(400).json({ error: "Session is missing applicant_id" });
      }

      const rateLimitResult = await onfidoSDKTokenAndApplicantRateLimiter()
      if (rateLimitResult.limitExceeded) {
        return res.status(429).json({
          error: 'The network is busy. Please try again in 10 minutes'
        })
      }

      // creating workflow run returns sdk_token as well
      // so return back sdk_token and workflow_id for initiating Onfido with workflow run
      if (session.campaignId && session.workflowId) {
        const workflowRun = await createOnfidoWorkflowRun(config.onfidoAPIKey, session.applicant_id, session.workflowId);

        console.log("refreshOnfidoToken: workflowRun", workflowRun);

        session.onfido_sdk_token = workflowRun.sdk_token;
        session.workflowId = workflowRun.workflow_id;
        await session.save();

        return res.status(200).json({
          sdk_token: workflowRun.sdk_token,
          workflow_run_id: workflowRun.id,
        });
      }

      let actualReferrer = "";
      if (referrer && referrer === "silk") {
        actualReferrer =
          process.env.NODE_ENV === "development"
            ? "http://localhost:3000/*"
            : "https://silksecure.net/*";
      } else if (referrer && referrer === "human-id") {
        actualReferrer =
          process.env.NODE_ENV === "development"
            ? "http://localhost:3000/*"
            : "https://id.human.tech/*";
      } else {
        actualReferrer =
          process.env.NODE_ENV === "development"
            ? "http://localhost:3002/*"
            : "https://app.holonym.id/*";
      }
      const sdkTokenData = await createOnfidoSdkToken(
        config.onfidoAPIKey,
        session.applicant_id,
        actualReferrer
      );

      session.onfido_sdk_token = sdkTokenData.token;
      await session.save();

      refreshOnfidoTokenLogger.info({ sessionId: _id }, `Refreshed Onfido token for ${_id}`);

      return res.status(200).json({
        sdk_token: sdkTokenData.token,
      });
    } catch (err: any) {
      refreshOnfidoTokenLogger.error({ error: makeUnknownErrorLoggable(err) }, "Error refreshing Onfido token");
      return res.status(500).json({ error: "An unknown error occurred" });
    }
  }
}

async function refreshOnfidoTokenProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createRefreshOnfidoTokenRouteHandler(config)(req, res);
}

async function refreshOnfidoTokenSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createRefreshOnfidoTokenRouteHandler(config)(req, res);
}

function createCreateOnfidoCheckEndpointRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    // NOTE:
    // From Onfido docs:
    // "If you're requesting multiple checks for the same individual, you
    // should reuse the id returned in the initial applicant response object
    // in the applicant_id field when creating a check."
    // Perhaps we should associate sigDigest with applicant_id to accomplish this.
    try {
      const _id = req.params._id;

      let objectId = null;
      try {
        objectId = new ObjectId(_id);
      } catch (err) {
        return res.status(400).json({ error: "Invalid _id" });
      }

      const session = await config.SessionModel.findOne({ _id: objectId }).exec();
      if (!session) {
        return res.status(400).json({ error: "Session not found" });
      }

      if (!session.applicant_id) {
        return res.status(400).json({ error: "Session is missing applicant_id" });
      }

      const check = await createOnfidoCheck(config.onfidoAPIKey, session.applicant_id);

      session.check_id = check.id;
      session.check_status = check.status;
      session.check_report_ids = check.report_ids;
      await session.save();

      createOnfidoCheckLogger.info(
        { check_id: check.id, applicant_id: session.applicant_id },
        "Created Onfido check"
      );

      return res.status(200).json({
        id: check.id,
      });
    } catch (err: any) {
      createOnfidoCheckLogger.error(
        {
          error: makeUnknownErrorLoggable(err),
          applicant_id: req.body.applicant_id,
        },
        "Error creating Onfido check"
      );
      return res.status(500).json({ error: "An unknown error occurred" });
    }
  }
}

async function createOnfidoCheckEndpointProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createCreateOnfidoCheckEndpointRouteHandler(config)(req, res);
}

async function createOnfidoCheckEndpointSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createCreateOnfidoCheckEndpointRouteHandler(config)(req, res);
}

/**
 * Allows a user to request a refund for a failed IDV session.
 */
async function refund(req: Request, res: Response) {
  const _id = req.params._id;
  const to = req.body.to;

  try {
    const { session: potentialSession, error: getSessionError, objectId } = await getSessionById(_id);
    if (getSessionError) {
      return res.status(400).json({ error: getSessionError });
    }
    const session = potentialSession!

    if (!to || to.length !== 42) {
      return res.status(400).json({
        error: "to is required and must be a 42-character hexstring (including 0x)",
      });
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
    // TODO: Do not use MongoDB for mutex purposes. Use something like
    // like Redis instead.
    const mutex = await SessionRefundMutex.findOne({ _id: objectId }).exec();
    if (mutex) {
      return res.status(400).json({ error: "Refund already in progress" });
    }
    const newMutex = new SessionRefundMutex({ _id: objectId });
    await newMutex.save();

    // Perform refund logic
    const response = await refundMintFeeOnChain(session, to);

    // Delete mutex
    await SessionRefundMutex.deleteOne({ _id: objectId }).exec();

    // Return response
    return res.status(response.status).json(response.data);
  } catch (err: any) {
    // Delete mutex. We have this here in case an unknown error occurs above.
    try {
      await SessionRefundMutex.deleteOne({ _id: new Object(_id) }).exec();
    } catch (err: any) {
      console.log(
        "POST /sessions/:_id/idv-session/refund/v2: Error encountered while deleting mutex",
        err.message
      );
    }

    console.log(
      "POST /sessions/:_id/idv-session/refund/v2: Error encountered",
      makeUnknownErrorLoggable(err)
    );
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

async function refundV2(req: Request, res: Response) {
  if (req.body.to) {
    return refund(req, res);
  }

  const _id = req.params._id;

  try {
    const { session: potentialSession, error: getSessionError } = await getSessionById(_id);
    if (getSessionError) {
      return res.status(400).json({ error: getSessionError });
    }
    const session = potentialSession!

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
    // TODO: Do not use MongoDB for mutex purposes. Use something like
    // like Redis instead.
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
        "POST /sessions/:_id/idv-session/refund: Error encountered while deleting mutex",
        err.message
      );
    }

    console.log(
      "POST /sessions/:_id/idv-session/refund: Error encountered",
      makeUnknownErrorLoggable(err)
    );
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

function createGetSessionsRouteHandler(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const sigDigest = req.query.sigDigest;
      const id = req.query.id;
      const last5days = req.query.last5days === "true" || false;

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
        sessions = await config.SessionModel.find({ _id: objectId }).exec();
      } else {
        if (last5days) {
          sessions = await config.SessionModel.find({ sigDigest, _id: { $gt: objectIdFiveDaysAgo() } }).exec();
        } else {
          sessions = await config.SessionModel.find({ sigDigest }).exec();
        }
      }

      return res.status(200).json(sessions);
    } catch (err: any) {
      console.log("GET /sessions: Error encountered", makeUnknownErrorLoggable(err));
      return res.status(500).json({ error: "An unknown error occurred" });
    }
  }
}

async function getSessionsProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createGetSessionsRouteHandler(config)(req, res);
}

async function getSessionsSandbox(req: Request, res: Response) {
  const config = getRouteHandlerConfig("sandbox");
  return createGetSessionsRouteHandler(config)(req, res);
}

export {
  postSession,
  postSessionV2Prod,
  postSessionV2Sandbox,
  createPayPalOrder,
  createIdvSession,
  createIdvSessionV2,
  createIdvSessionV3,
  setIdvProvider,
  refreshOnfidoTokenProd,
  refreshOnfidoTokenSandbox,
  createOnfidoCheckEndpointProd,
  createOnfidoCheckEndpointSandbox,
  refund,
  refundV2,
  getSessionsProd,
  getSessionsSandbox,
  createPostSessionV2RouteHandler,
  createRefreshOnfidoTokenRouteHandler,
  createCreateOnfidoCheckEndpointRouteHandler,
  createGetSessionsRouteHandler,
};
