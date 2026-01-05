import { Request, Response } from 'express';
import { Model, Types } from 'mongoose';
import { SiweMessage } from 'siwe';
import { ethers } from 'ethers';
import {
  verifySIWEMessage,
  generateNonce,
  generateSessionToken,
  storeSession,
  getOrCreateCreditsUser,
  rateLimitSecretGeneration,
  generatePaymentSecretsBatch,
  validateService,
} from './functions.js';
import { generatePaymentSignature } from '../functions.js';
import {
  IPaymentCommitment,
  IHumanIDCreditsUser,
  IHumanIDCreditsPaymentSecret,
  IPaymentRedemption,
} from '../../../types.js';
import { logger } from '../../../utils/logger.js';
import { CreditsAuthenticatedRequest } from './middleware.js';
import { getCreditsRouteHandlerConfig } from '../../../init.js';

const creditsLogger = logger.child({ feature: 'holonym', subFeature: 'human-id-credits' });

interface CreditsRouteHandlerConfig {
  HumanIDCreditsUserModel: Model<IHumanIDCreditsUser>;
  PaymentCommitmentModel: Model<IPaymentCommitment>;
  HumanIDCreditsPaymentSecretModel: Model<IHumanIDCreditsPaymentSecret>;
  PaymentRedemptionModel: Model<IPaymentRedemption>;
}

if (!process.env.HUMAN_ID_CREDITS_SIWE_DOMAIN) {
  throw new Error('HUMAN_ID_CREDITS_SIWE_DOMAIN is not set');
}

/**
 * GET /payments/human-id-credits/auth/challenge
 * Generate a complete SIWE message challenge for the client to sign
 * Requires address query parameter. Returns the prepared message string.
 */
export function createChallengeEndpoint(config: CreditsRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const address = req.query.address as string;

      if (!address || typeof address !== 'string') {
        return res.status(400).json({ error: 'address query parameter is required' });
      }

      // Convert address to checksum format (EIP-55)
      let checksumAddress: string;
      try {
        checksumAddress = ethers.utils.getAddress(address);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid Ethereum address' });
      }

      // Generate nonce
      const nonce = await generateNonce();

      // Get SIWE configuration from environment or use defaults
      const domain = process.env.HUMAN_ID_CREDITS_SIWE_DOMAIN;
      const uri = `https://${domain}`;
      const statement = 'Sign in with Ethereum to Human ID.';
      const chainId = 1;

      // Construct SIWE message
      const siweMessage = new SiweMessage({
        domain,
        address: checksumAddress, // Use checksum format (EIP-55)
        statement,
        uri,
        version: '1',
        chainId,
        nonce,
        expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
      });

      // Prepare the message string for signing
      const messageToSign = siweMessage.prepareMessage();

      creditsLogger.info({ address: checksumAddress }, 'Generated SIWE challenge');

      return res.status(200).json({
        message: messageToSign,
      });
    } catch (error: any) {
      creditsLogger.error({ error: error.message }, 'Error generating SIWE challenge');
      return res.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
  };
}

/**
 * POST /payments/human-id-credits/auth/siwe
 * Authenticate with SIWE to get a session token
 * Requires a challenge from the /auth/challenge endpoint to prevent replay attacks
 */
export function createSIWEAuthEndpoint(config: CreditsRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const { message, signature } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required and must be a string' });
      }

      if (!signature || typeof signature !== 'string') {
        return res.status(400).json({ error: 'signature is required and must be a string' });
      }

      // Verify SIWE message
      const verification = await verifySIWEMessage(message, signature);

      if (!verification.success) {
        creditsLogger.warn(
          { error: verification.error?.type || 'Verification failed' },
          'SIWE verification failed'
        );
        return res.status(401).json({ error: verification.error || 'Invalid SIWE message or signature' });
      }

      // Get or create user
      const userId = await getOrCreateCreditsUser(
        verification.address,
        config.HumanIDCreditsUserModel
      );

      // Generate JWT session token
      const sessionToken = generateSessionToken(userId.toString(), verification.address);

      // Store session in Valkey for potential revocation
      await storeSession(sessionToken, userId.toString(), verification.address);

      const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour from now

      creditsLogger.info(
        { userId: userId.toString(), walletAddress: verification.address },
        'SIWE authentication successful'
      );

      return res.status(200).json({
        sessionToken,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error: any) {
      creditsLogger.error({ error: error.message || 'Unknown error' }, 'Error in SIWE authentication');
      return res.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
  };
}

/**
 * POST /payments/human-id-credits/secrets/batch
 * Generate batch of payment secrets
 */
export function createGenerateSecretsEndpoint(config: CreditsRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const authenticatedReq = req as CreditsAuthenticatedRequest;
      const userId = authenticatedReq.creditsUserId;
      const { count, service, chainId } = req.body;

      if (!count || typeof count !== 'number' || count < 1) {
        return res.status(400).json({ error: 'count is required and must be a positive number' });
      }

      if (count > 1000) {
        return res.status(400).json({ error: 'count cannot exceed 1000' });
      }

      // Validate service parameter
      const serviceValidation = validateService(service);
      if (!serviceValidation.valid) {
        return res.status(400).json({ error: serviceValidation.error });
      }

      if (chainId === undefined || chainId === null) {
        return res.status(400).json({ error: 'chainId is required' });
      }

      const chainIdNum = typeof chainId === 'number' ? chainId : Number(chainId);
      if (isNaN(chainIdNum)) {
        return res.status(400).json({ error: 'chainId must be a number' });
      }

      // Rate limit check
      const rateLimitResult = await rateLimitSecretGeneration(userId);
      if (!rateLimitResult.allowed) {
        creditsLogger.warn({ userId, error: rateLimitResult.error }, 'Rate limit exceeded');
        return res.status(429).json({ error: rateLimitResult.error || 'Rate limit exceeded' });
      }

      // Generate secrets
      const secrets = await generatePaymentSecretsBatch(
        count,
        service,
        chainIdNum,
        new Types.ObjectId(userId),
        config.PaymentCommitmentModel,
        config.HumanIDCreditsPaymentSecretModel
      );

      creditsLogger.info(
        { userId, count, service, chainId: chainIdNum },
        'Generated payment secrets batch'
      );

      return res.status(200).json({
        secrets,
      });
    } catch (error: any) {
      creditsLogger.error({ error: error.message }, 'Error generating payment secrets');
      return res.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
  };
}

/**
 * GET /payments/human-id-credits/secrets
 * Get list of generated payment secrets
 * Uses cursor-based pagination with ObjectId as cursor
 */
export function createGetSecretsEndpoint(config: CreditsRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const authenticatedReq = req as CreditsAuthenticatedRequest;
      const userId = authenticatedReq.creditsUserId;
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const cursor = req.query.cursor as string | undefined;
      const chainId = req.query.chainId ? Number(req.query.chainId) : undefined;
      const status = req.query.status as 'redeemed' | 'unredeemed' | undefined;
      const service = req.query.service as string | undefined;

      if (isNaN(limit) || limit < 1 || limit > 1000) {
        return res.status(400).json({ error: 'limit must be a number between 1 and 1000' });
      }

      // Validate service parameter
      const serviceValidation = validateService(service);
      if (!serviceValidation.valid) {
        return res.status(400).json({ error: serviceValidation.error });
      }
      // After validation, service is guaranteed to be a string
      const validatedService = service as string;

      // Validate status if provided
      if (status && status !== 'redeemed' && status !== 'unredeemed') {
        return res.status(400).json({ error: 'status must be either "redeemed" or "unredeemed"' });
      }

      // Validate cursor if provided
      let cursorObjectId: Types.ObjectId | undefined;
      if (cursor) {
        try {
          cursorObjectId = new Types.ObjectId(cursor);
        } catch (error) {
          return res.status(400).json({ error: 'Invalid cursor format. Cursor must be a valid ObjectId.' });
        }
      }

      // - Get the user's payment secrets.
      // - Filter by chainId
      // - If user passed the `status` query parameter, filter payment secrets by status:
      //   - If "redeemed", only include secrets that have a corresponding PaymentRedemption document (i.e., redemptionDoc is not empty).
      //   - If "unredeemed", only include secrets that do NOT have a corresponding PaymentRedemption document (i.e., redemptionDoc is empty).
      //   - This requires performing a $lookup to the PaymentRedemption collection to check if each secret's commitment has a redemption.

      // Build query
      const query: any = { userId: new Types.ObjectId(userId) };
      if (chainId !== undefined && !isNaN(chainId)) {
        query.chainId = chainId;
      }

      // Build aggregation pipeline for efficient database-level filtering
      const pipeline: any[] = [];

      // Stage 1: Match by userId, chainId, and cursor
      const matchStage: any = {
        userId: new Types.ObjectId(userId),
      };
      if (chainId !== undefined && !isNaN(chainId)) {
        matchStage.chainId = chainId;
      }
      if (cursorObjectId) {
        matchStage._id = { $lt: cursorObjectId };
      }
      pipeline.push({ $match: matchStage });

      // Stage 2: Lookup PaymentCommitment to get commitment string
      pipeline.push({
        $lookup: {
          from: config.PaymentCommitmentModel.collection.name,
          localField: 'commitmentId',
          foreignField: '_id',
          as: 'commitmentDoc',
        },
      });

      // Stage 3: Unwind commitmentDoc to get commitment string
      pipeline.push({
        // Since we used _id for the commitmentDoc lookup, and _id is unique, we don't have
        // to worry about commitmentDoc being an array with multiple documents. The array
        // should have either 0 or 1 documents, so we can safely unwind without worrying
        // about duplicates.
        $unwind: {
          path: '$commitmentDoc',
          preserveNullAndEmptyArrays: false, // Exclude secrets without commitment
        },
      });

      // Stage 4: Lookup PaymentRedemption to check if redeemed
      pipeline.push({
        $lookup: {
          from: config.PaymentRedemptionModel.collection.name,
          localField: 'commitmentId',
          foreignField: 'commitmentId',
          as: 'redemptionDoc',
        },
      });

      // Stage 5: Filter by redemption status if provided
      if (status === 'redeemed') {
        // Only include secrets that have a redemption record (array is not empty)
        pipeline.push({
          $match: {
            'redemptionDoc': { $ne: [] }, // Has at least one redemption
          },
        });
      } else if (status === 'unredeemed') {
        // Only include secrets that don't have a redemption record (array is empty)
        pipeline.push({
          $match: {
            'redemptionDoc': { $size: 0 }, // Empty redemption array
          },
        });
      }

      // Stage 6: Sort by createdAt desc, then _id desc
      pipeline.push({
        $sort: { createdAt: -1, _id: -1 },
      });

      // Stage 7: Limit to check for next page
      pipeline.push({
        $limit: limit + 1,
      });

      // Stage 8: Project the fields we need
      pipeline.push({
        $project: {
          _id: 1,
          secret: 1,
          commitment: '$commitmentDoc.commitment',
          chainId: 1,
          price: 1,
          createdAt: 1,
        },
      });

      // Execute aggregation
      const secrets = await config.HumanIDCreditsPaymentSecretModel.aggregate(pipeline).exec();

      // Check if there's a next page
      const hasNextPage = secrets.length > limit;
      const secretsToReturn = hasNextPage ? secrets.slice(0, limit) : secrets;

      // Get the cursor for the next page (last item's _id)
      const nextCursor = hasNextPage && secretsToReturn.length > 0
        ? secretsToReturn[secretsToReturn.length - 1]._id.toString()
        : null;

      // Generate timestamp for signatures (use same timestamp for all secrets in this response)
      const timestamp = Math.floor(Date.now() / 1000);

      // Sign secrets with signatures
      const formattedSecrets = await Promise.all(
        secretsToReturn.map(async (secret: any) => {
          const commitment = secret.commitment || '';
          
          // Generate signature using stored params
          const signature = await generatePaymentSignature(
            secret.price,
            commitment,
            validatedService,
            secret.chainId,
            timestamp
          );

          return {
            id: secret._id.toString(),
            secret: secret.secret,
            commitment,
            chainId: secret.chainId,
            price: secret.price,
            signature,
            timestamp,
            createdAt: new Date(secret.createdAt).toISOString(),
          };
        })
      );

      creditsLogger.info({ userId, limit, cursor, chainId, status, hasNextPage }, 'Retrieved payment secrets');

      return res.status(200).json({
        secrets: formattedSecrets,
        limit,
        nextCursor,
        hasNextPage,
      });
    } catch (error: any) {
      creditsLogger.error({ error: error.message }, 'Error retrieving payment secrets');
      return res.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
  };
}

// Production endpoint wrappers
export async function challengeProd(req: Request, res: Response) {
  const config = getCreditsRouteHandlerConfig("live");
  return createChallengeEndpoint(config)(req, res);
}

export async function siweAuthProd(req: Request, res: Response) {
  const config = getCreditsRouteHandlerConfig("live");
  return createSIWEAuthEndpoint(config)(req, res);
}

export async function generateSecretsProd(req: Request, res: Response) {
  const config = getCreditsRouteHandlerConfig("live");
  return createGenerateSecretsEndpoint(config)(req, res);
}

export async function getSecretsProd(req: Request, res: Response) {
  const config = getCreditsRouteHandlerConfig("live");
  return createGetSecretsEndpoint(config)(req, res);
}

// Sandbox endpoint wrappers
export async function challengeSandbox(req: Request, res: Response) {
  const config = getCreditsRouteHandlerConfig("sandbox");
  return createChallengeEndpoint(config)(req, res);
}

export async function siweAuthSandbox(req: Request, res: Response) {
  const config = getCreditsRouteHandlerConfig("sandbox");
  return createSIWEAuthEndpoint(config)(req, res);
}

export async function generateSecretsSandbox(req: Request, res: Response) {
  const config = getCreditsRouteHandlerConfig("sandbox");
  return createGenerateSecretsEndpoint(config)(req, res);
}

export async function getSecretsSandbox(req: Request, res: Response) {
  const config = getCreditsRouteHandlerConfig("sandbox");
  return createGetSecretsEndpoint(config)(req, res);
}

