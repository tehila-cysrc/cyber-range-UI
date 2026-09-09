import type { Request, Response, NextFunction } from 'express';

export function requireRole(role: 'instructor' | 'student') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
