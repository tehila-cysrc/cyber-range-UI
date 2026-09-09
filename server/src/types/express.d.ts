import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        role: 'student' | 'instructor';
        teamId: number | null;
      };
    }
  }
}

export {};
