import 'express';
import type { Principal } from '../authz/principal.js';

declare global {
  namespace Express {
    interface Request {
      user?: Principal;
    }
  }
}

export {};
