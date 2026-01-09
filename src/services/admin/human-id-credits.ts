import { Request, Response } from 'express';
import { Model, Types } from 'mongoose';
import {
  IHumanIDCreditsPriceOverride,
  IHumanIDCreditsUser,
  IPaymentCommitment,
  IHumanIDCreditsPaymentSecret,
} from '../../types.js';
import { validateService } from '../payments/human-id-credits/functions.js';
import { logger } from '../../utils/logger.js';
import { getRouteHandlerConfig } from '../../init.js';

const creditsLogger = logger.child({ feature: 'holonym', subFeature: 'human-id-credits-admin' });

interface AdminCreditsRouteHandlerConfig {
  HumanIDCreditsUserModel: Model<IHumanIDCreditsUser>;
  PaymentCommitmentModel: Model<IPaymentCommitment>;
  HumanIDCreditsPriceOverrideModel: Model<IHumanIDCreditsPriceOverride>;
  HumanIDCreditsPaymentSecretModel: Model<IHumanIDCreditsPaymentSecret>;
}

/**
 * POST /admin/payments/human-id-credits/price-overrides
 * Create new price override
 */
export function createPriceOverrideEndpoint(config: AdminCreditsRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers['x-api-key'];

      if (!apiKey || typeof apiKey !== 'string') {
        creditsLogger.warn('Missing or invalid x-api-key header in admin request');
        res.status(401).json({ error: 'Missing or invalid x-api-key header' });
        return;
      }
    
      const expectedApiKey = process.env.HUMAN_ID_CREDITS_ADMIN_API_KEY;
    
      if (!expectedApiKey) {
        return res.status(500).json({ error: 'Admin API key not configured' });
      }
    
      if (apiKey !== expectedApiKey) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      const { userId, priceUSD, maxCredits, services, expiresAt, description } = req.body;

      // Validate required fields
      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      if (priceUSD === undefined || priceUSD === null) {
        return res.status(400).json({ error: 'priceUSD is required' });
      }

      if (typeof priceUSD !== 'number' || priceUSD <= 0) {
        return res.status(400).json({ error: 'priceUSD must be a positive number' });
      }

      if (maxCredits === undefined || maxCredits === null) {
        return res.status(400).json({ error: 'maxCredits is required' });
      }

      if (typeof maxCredits !== 'number' || maxCredits <= 0 || !Number.isInteger(maxCredits)) {
        return res.status(400).json({ error: 'maxCredits must be a positive integer' });
      }

      if (!services) {
        return res.status(400).json({ error: 'services is required' });
      }

      if (!Array.isArray(services) || services.length === 0) {
        return res.status(400).json({ error: 'services must be a non-empty array' });
      }

      // Validate each service format
      for (const service of services) {
        const serviceValidation = validateService(service);
        if (!serviceValidation.valid) {
          return res.status(400).json({ error: `Invalid service in services array: ${serviceValidation.error}` });
        }
      }

      // Validate userId format
      let userIdObjectId: Types.ObjectId;
      try {
        userIdObjectId = new Types.ObjectId(userId);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid userId format. Must be a valid ObjectId.' });
      }

      // Validate user exists
      const user = await config.HumanIDCreditsUserModel.findById(userIdObjectId).exec();
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Validate expiresAt if provided
      let expiresAtDate: Date | undefined;
      if (expiresAt) {
        expiresAtDate = new Date(expiresAt);
        if (isNaN(expiresAtDate.getTime())) {
          return res.status(400).json({ error: 'Invalid expiresAt format. Must be a valid ISO date string.' });
        }
        if (expiresAtDate < new Date()) {
          return res.status(400).json({ error: 'expiresAt must be in the future' });
        }
      }

      // Create price override
      const priceOverride = await config.HumanIDCreditsPriceOverrideModel.create({
        userId: userIdObjectId,
        priceUSD,
        maxCredits,
        usedCredits: 0,
        services,
        isActive: true,
        expiresAt: expiresAtDate,
        description: description || undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      creditsLogger.info(
        { priceOverrideId: priceOverride._id, userId: userIdObjectId.toString(), priceUSD, maxCredits, services },
        'Created price override'
      );

      return res.status(201).json({
        id: priceOverride._id.toString(),
        userId: priceOverride.userId.toString(),
        priceUSD: priceOverride.priceUSD,
        maxCredits: priceOverride.maxCredits,
        usedCredits: priceOverride.usedCredits,
        services: priceOverride.services,
        isActive: priceOverride.isActive,
        expiresAt: priceOverride.expiresAt?.toISOString(),
        description: priceOverride.description,
        createdAt: priceOverride.createdAt.toISOString(),
        updatedAt: priceOverride.updatedAt.toISOString(),
      });
    } catch (error: any) {
      creditsLogger.error({ error: error.message }, 'Error creating price override');
      return res.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
  };
}

/**
 * GET /admin/payments/human-id-credits/price-overrides
 * List price overrides with pagination
 */
export function listPriceOverridesEndpoint(config: AdminCreditsRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers['x-api-key'];

      if (!apiKey || typeof apiKey !== 'string') {
        return res.status(401).json({ error: 'Missing or invalid x-api-key header' });
      }

      const expectedApiKey = process.env.HUMAN_ID_CREDITS_ADMIN_API_KEY;

      if (!expectedApiKey) {
        return res.status(500).json({ error: 'Admin API key not configured' });
      }

      if (apiKey !== expectedApiKey) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      const userId = req.query.userId as string | undefined;
      const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const cursor = req.query.cursor as string | undefined;
  
      if (isNaN(limit) || limit < 1 || limit > 1000) {
        return res.status(400).json({ error: 'limit must be a number between 1 and 1000' });
      }

      // Build query
      const query: any = {};
      if (userId) {
        try {
          query.userId = new Types.ObjectId(userId);
        } catch (error) {
          return res.status(400).json({ error: 'Invalid userId format. Must be a valid ObjectId.' });
        }
      }
      if (isActive !== undefined) {
        query.isActive = isActive;
      }

      // Handle cursor-based pagination
      if (cursor) {
        try {
          query._id = { $lt: new Types.ObjectId(cursor) };
        } catch (error) {
          return res.status(400).json({ error: 'Invalid cursor format. Cursor must be a valid ObjectId.' });
        }
      }

      // Fetch one extra to check for next page
      const overrides = await config.HumanIDCreditsPriceOverrideModel
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .exec();

      const hasNextPage = overrides.length > limit;
      const overridesToReturn = hasNextPage ? overrides.slice(0, limit) : overrides;
      const nextCursor = hasNextPage && overridesToReturn.length > 0
        ? overridesToReturn[overridesToReturn.length - 1]._id.toString()
        : null;

      const formattedOverrides = overridesToReturn.map(override => ({
        id: override._id.toString(),
        userId: override.userId.toString(),
        priceUSD: override.priceUSD,
        maxCredits: override.maxCredits,
        usedCredits: override.usedCredits,
        remainingCredits: override.maxCredits - override.usedCredits,
        services: override.services,
        isActive: override.isActive,
        expiresAt: override.expiresAt?.toISOString(),
        description: override.description,
        createdAt: override.createdAt.toISOString(),
        updatedAt: override.updatedAt.toISOString(),
      }));

      return res.status(200).json({
        overrides: formattedOverrides,
        limit,
        nextCursor,
        hasNextPage,
      });
    } catch (error: any) {
      creditsLogger.error({ error: error.message }, 'Error listing price overrides');
      return res.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
  };
}

/**
 * GET /admin/payments/human-id-credits/price-overrides/:id
 * Get single price override by ID
 */
export function getPriceOverrideEndpoint(config: AdminCreditsRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers['x-api-key'];

      if (!apiKey || typeof apiKey !== 'string') {
        return res.status(401).json({ error: 'Missing or invalid x-api-key header' });
      }
    
      const expectedApiKey = process.env.HUMAN_ID_CREDITS_ADMIN_API_KEY;
    
      if (!expectedApiKey) {
        return res.status(500).json({ error: 'Admin API key not configured' });
      }
    
      if (apiKey !== expectedApiKey) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      let overrideId: Types.ObjectId;
      try {
        overrideId = new Types.ObjectId(id);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid id format. Must be a valid ObjectId.' });
      }

      const override = await config.HumanIDCreditsPriceOverrideModel.findById(overrideId).exec();

      if (!override) {
        return res.status(404).json({ error: 'Price override not found' });
      }

      // Count related secrets
      const secretsCount = await config.HumanIDCreditsPaymentSecretModel
        .countDocuments({ priceOverrideId: overrideId })
        .exec();

      return res.status(200).json({
        id: override._id.toString(),
        userId: override.userId.toString(),
        priceUSD: override.priceUSD,
        maxCredits: override.maxCredits,
        usedCredits: override.usedCredits,
        remainingCredits: override.maxCredits - override.usedCredits,
        services: override.services,
        isActive: override.isActive,
        expiresAt: override.expiresAt?.toISOString(),
        description: override.description,
        createdAt: override.createdAt.toISOString(),
        updatedAt: override.updatedAt.toISOString(),
        secretsCount,
      });
    } catch (error: any) {
      creditsLogger.error({ error: error.message }, 'Error getting price override');
      return res.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
  };
}

/**
 * PATCH /admin/payments/human-id-credits/price-overrides/:id
 * Update price override (only allowed fields)
 */
export function updatePriceOverrideEndpoint(config: AdminCreditsRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers['x-api-key'];

      if (!apiKey || typeof apiKey !== 'string') {
        return res.status(401).json({ error: 'Missing or invalid x-api-key header' });
      }
    
      const expectedApiKey = process.env.HUMAN_ID_CREDITS_ADMIN_API_KEY;
    
      if (!expectedApiKey) {
        return res.status(500).json({ error: 'Admin API key not configured' });
      }
    
      if (apiKey !== expectedApiKey) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      const { id } = req.params;
      const { maxCredits, isActive, expiresAt, description } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      let overrideId: Types.ObjectId;
      try {
        overrideId = new Types.ObjectId(id);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid id format. Must be a valid ObjectId.' });
      }

      const override = await config.HumanIDCreditsPriceOverrideModel.findById(overrideId).exec();

      if (!override) {
        return res.status(404).json({ error: 'Price override not found' });
      }

      // Build update object (only allowed fields)
      const updateData: any = {
        updatedAt: new Date(),
      };

      if (maxCredits !== undefined) {
        if (typeof maxCredits !== 'number' || maxCredits <= 0 || !Number.isInteger(maxCredits)) {
          return res.status(400).json({ error: 'maxCredits must be a positive integer' });
        }
        // Ensure new maxCredits is not less than usedCredits
        if (maxCredits < override.usedCredits) {
          return res.status(400).json({ 
            error: `maxCredits cannot be less than usedCredits (${override.usedCredits})` 
          });
        }
        updateData.maxCredits = maxCredits;
      }

      if (isActive !== undefined) {
        if (typeof isActive !== 'boolean') {
          return res.status(400).json({ error: 'isActive must be a boolean' });
        }
        updateData.isActive = isActive;
      }

      if (expiresAt !== undefined) {
        if (expiresAt === null) {
          updateData.expiresAt = undefined;
        } else {
          const expiresAtDate = new Date(expiresAt);
          if (isNaN(expiresAtDate.getTime())) {
            return res.status(400).json({ error: 'Invalid expiresAt format. Must be a valid ISO date string or null.' });
          }
          if (expiresAtDate < new Date()) {
            return res.status(400).json({ error: 'expiresAt must be in the future' });
          }
          updateData.expiresAt = expiresAtDate;
        }
      }

      if (description !== undefined) {
        updateData.description = description || undefined;
      }

      // Update the override
      const updatedOverride = await config.HumanIDCreditsPriceOverrideModel
        .findByIdAndUpdate(overrideId, updateData, { new: true })
        .exec();

      if (!updatedOverride) {
        return res.status(404).json({ error: 'Price override not found after update' });
      }

      creditsLogger.info(
        { priceOverrideId: overrideId, updates: updateData },
        'Updated price override'
      );

      return res.status(200).json({
        id: updatedOverride._id.toString(),
        userId: updatedOverride.userId.toString(),
        priceUSD: updatedOverride.priceUSD,
        maxCredits: updatedOverride.maxCredits,
        usedCredits: updatedOverride.usedCredits,
        remainingCredits: updatedOverride.maxCredits - updatedOverride.usedCredits,
        services: updatedOverride.services,
        isActive: updatedOverride.isActive,
        expiresAt: updatedOverride.expiresAt?.toISOString(),
        description: updatedOverride.description,
        createdAt: updatedOverride.createdAt.toISOString(),
        updatedAt: updatedOverride.updatedAt.toISOString(),
      });
    } catch (error: any) {
      creditsLogger.error({ error: error.message }, 'Error updating price override');
      return res.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
  };
}

/**
 * DELETE /admin/payments/human-id-credits/price-overrides/:id
 * Soft delete price override (set isActive: false)
 */
export function deletePriceOverrideEndpoint(config: AdminCreditsRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers['x-api-key'];

      if (!apiKey || typeof apiKey !== 'string') {
        creditsLogger.warn('Missing or invalid x-api-key header in admin request');
        res.status(401).json({ error: 'Missing or invalid x-api-key header' });
        return;
      }
    
      const expectedApiKey = process.env.HUMAN_ID_CREDITS_ADMIN_API_KEY;
    
      if (!expectedApiKey) {
        creditsLogger.error('HUMAN_ID_CREDITS_ADMIN_API_KEY environment variable not set');
        res.status(500).json({ error: 'Admin API key not configured' });
        return;
      }
    
      if (apiKey !== expectedApiKey) {
        creditsLogger.warn('Invalid admin API key provided');
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }

      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      let overrideId: Types.ObjectId;
      try {
        overrideId = new Types.ObjectId(id);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid id format. Must be a valid ObjectId.' });
      }

      const override = await config.HumanIDCreditsPriceOverrideModel.findById(overrideId).exec();

      if (!override) {
        return res.status(404).json({ error: 'Price override not found' });
      }

      // Soft delete: set isActive to false
      const updatedOverride = await config.HumanIDCreditsPriceOverrideModel
        .findByIdAndUpdate(overrideId, { isActive: false, updatedAt: new Date() }, { new: true })
        .exec();

      creditsLogger.info(
        { priceOverrideId: overrideId },
        'Soft deleted price override'
      );

      return res.status(200).json({
        message: 'Price override deactivated (soft delete)',
        id: updatedOverride!._id.toString(),
        isActive: false,
      });
    } catch (error: any) {
      creditsLogger.error({ error: error.message }, 'Error deleting price override');
      return res.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
  };
}

// Production endpoint wrappers
export async function createPriceOverrideProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return createPriceOverrideEndpoint({
    HumanIDCreditsUserModel: config.HumanIDCreditsUserModel,
    PaymentCommitmentModel: config.PaymentCommitmentModel,
    HumanIDCreditsPriceOverrideModel: config.HumanIDCreditsPriceOverrideModel,
    HumanIDCreditsPaymentSecretModel: config.HumanIDCreditsPaymentSecretModel,
  })(req, res);
}

export async function listPriceOverridesProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return listPriceOverridesEndpoint({
    HumanIDCreditsUserModel: config.HumanIDCreditsUserModel,
    PaymentCommitmentModel: config.PaymentCommitmentModel,
    HumanIDCreditsPriceOverrideModel: config.HumanIDCreditsPriceOverrideModel,
    HumanIDCreditsPaymentSecretModel: config.HumanIDCreditsPaymentSecretModel,
  })(req, res);
}

export async function getPriceOverrideProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return getPriceOverrideEndpoint({
    HumanIDCreditsUserModel: config.HumanIDCreditsUserModel,
    PaymentCommitmentModel: config.PaymentCommitmentModel,
    HumanIDCreditsPriceOverrideModel: config.HumanIDCreditsPriceOverrideModel,
    HumanIDCreditsPaymentSecretModel: config.HumanIDCreditsPaymentSecretModel,
  })(req, res);
}

export async function updatePriceOverrideProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return updatePriceOverrideEndpoint({
    HumanIDCreditsUserModel: config.HumanIDCreditsUserModel,
    PaymentCommitmentModel: config.PaymentCommitmentModel,
    HumanIDCreditsPriceOverrideModel: config.HumanIDCreditsPriceOverrideModel,
    HumanIDCreditsPaymentSecretModel: config.HumanIDCreditsPaymentSecretModel,
  })(req, res);
}

export async function deletePriceOverrideProd(req: Request, res: Response) {
  const config = getRouteHandlerConfig("live");
  return deletePriceOverrideEndpoint({
    HumanIDCreditsUserModel: config.HumanIDCreditsUserModel,
    PaymentCommitmentModel: config.PaymentCommitmentModel,
    HumanIDCreditsPriceOverrideModel: config.HumanIDCreditsPriceOverrideModel,
    HumanIDCreditsPaymentSecretModel: config.HumanIDCreditsPaymentSecretModel,
  })(req, res);
}
