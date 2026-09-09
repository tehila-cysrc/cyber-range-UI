import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';

interface TokenRow {
  id: number;
  role: string;
  teamId: number | null;
  username: string;
  expiresAt: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }

  const row = db
    .prepare(
      `SELECT u.id AS id, u.role AS role, u.team_id AS teamId, u.username AS username, at.expires_at AS expiresAt
       FROM auth_tokens at
       JOIN users u ON u.id = at.user_id
       WHERE at.token = ?`,
    )
    .get(token) as TokenRow | undefined;

  if (!row) {
    res.status(401).json({ error: 'invalid token' });
    return;
  }

  if (new Date(row.expiresAt).getTime() < Date.now()) {
    res.status(401).json({ error: 'token expired' });
    return;
  }

  req.user = { id: row.id, role: row.role as 'student' | 'instructor', teamId: row.teamId, username: row.username };
  next();
}
