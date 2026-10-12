import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { can, type Permission } from './permissions.js';
import { writeAudit } from '../services/audit.service.js';

// Marks a middleware with the permission it enforces, so the route-inventory test can prove every
// route declares one (tests/routeInventory.test.mjs).
export type PermissionGuard = RequestHandler & { permission: Permission };

// Role-level gate: fails closed (403) when the caller's role lacks the permission entirely. Which
// rows the caller may touch is checked afterwards, in the handler, on the loaded row (scope.ts).
export function requirePermission(permission: Permission): PermissionGuard {
  const guard = ((req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !can(req.user.role, permission)) {
      auditDenied(req, permission);
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  }) as PermissionGuard;
  guard.permission = permission;
  return guard;
}

// A looping client must not flood the (never-pruned, CONFIG) audit trail: the same denial from the same
// account/IP is written at most once a minute.
const DENIAL_WINDOW_MS = 60_000;
const recentDenials = new Map<string, number>();

export function auditDenied(req: Request, reason: string, context: { organizationId?: number | null; cyberRangeId?: number | null } = {}) {
  const now = Date.now();
  const key = `${req.user?.id ?? req.ip}|${req.method}|${req.originalUrl.split('?')[0]}|${reason}`;
  if ((recentDenials.get(key) ?? 0) > now - DENIAL_WINDOW_MS) return;
  recentDenials.set(key, now);
  if (recentDenials.size > 5000) {
    for (const [k, at] of recentDenials) if (at <= now - DENIAL_WINDOW_MS) recentDenials.delete(k);
  }
  writeAudit(req.user?.username ?? null, 'authz.denied', 'request', null, { method: req.method, path: req.originalUrl.split('?')[0], reason }, {
    ...context,
    outcome: 'denied',
  });
}

// Out-of-scope rows answer exactly like missing ones (no enumeration) and are audited.
export function notFoundOutOfScope(req: Request, res: Response, what: string, context: { organizationId?: number | null; cyberRangeId?: number | null } = {}) {
  auditDenied(req, `out_of_scope:${what}`, context);
  res.status(404).json({ error: `${what} not found` });
}
