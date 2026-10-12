import 'express';
import type { Role } from '../authz/roles.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        role: Role;
        teamId: number | null;
        username: string;
      };
    }
  }
}

export {};
