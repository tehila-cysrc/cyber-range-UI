import type { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../authz/principal.js';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }

  const principal = authenticateToken(token);
  if (!principal) {
    res.status(401).json({ error: 'invalid token' });
    return;
  }

  req.user = principal;
  next();
}
