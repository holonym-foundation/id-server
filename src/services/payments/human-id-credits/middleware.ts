import { Request, Response, NextFunction } from 'express';
import { validateSessionToken } from './functions.js';
import { logger } from '../../../utils/logger.js';

const creditsLogger = logger.child({ feature: 'holonym', subFeature: 'human-id-credits' });

/**
 * Request type for routes that have passed through validateSessionMiddleware
 * The middleware adds creditsUserId and creditsWalletAddress to the request
 */
export interface CreditsAuthenticatedRequest extends Request {
  creditsUserId: string;
  creditsWalletAddress: string;
}

/**
 * Middleware to validate session token
 * Adds userId and walletAddress to req object
 */
export async function validateSessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sessionToken = req.headers['x-session-token'] as string;

  if (!sessionToken) {
    creditsLogger.warn('Missing session token in request');
    res.status(401).json({ error: 'Missing session token. Include X-Session-Token header.' });
    return;
  }

  const validation = await validateSessionToken(sessionToken);

  if (!validation.valid) {
    creditsLogger.warn({ error: validation.error }, 'Invalid session token');
    res.status(401).json({ error: validation.error || 'Invalid or expired session token' });
    return;
  }

  // Add user info to request object
  (req as CreditsAuthenticatedRequest).creditsUserId = validation.userId;
  (req as CreditsAuthenticatedRequest).creditsWalletAddress = validation.walletAddress;

  next();
}

