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
 * Middleware to validate session token from Authorization header
 * Adds userId and walletAddress to req object
 */
export async function validateSessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Extract token from Authorization: Bearer <token> header
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    creditsLogger.warn('Missing Authorization header');
    res.status(401).json({ error: 'Missing Authorization header. Use "Authorization: Bearer <token>" format.' });
    return;
  }

  // Check if header starts with "Bearer "
  if (!authHeader.startsWith('Bearer ')) {
    creditsLogger.warn('Invalid Authorization header format');
    res.status(401).json({ error: 'Invalid Authorization header format. Use "Bearer <token>" format.' });
    return;
  }

  // Extract the token (everything after "Bearer ")
  const sessionToken = authHeader.substring(7);

  if (!sessionToken) {
    creditsLogger.warn('Missing token in Authorization header');
    res.status(401).json({ error: 'Missing token in Authorization header.' });
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

