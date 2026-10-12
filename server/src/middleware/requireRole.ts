import type { Request, Response, NextFunction } from 'express';
import type { Role } from '../authz/roles.js';

export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
