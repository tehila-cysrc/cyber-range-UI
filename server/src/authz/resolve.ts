import type { Request, Response } from 'express';
import { db } from '../db/index.js';
import { isStudent } from './roles.js';
import { auditDenied, notFoundOutOfScope } from './requirePermission.js';
import {
  organizationInScope,
  pairInScope,
  scenarioExclusiveFor,
  scenarioInScope,
  scopeWhere,
  teamInScope,
  teamOrganization,
  type SqlFilter,
} from './scope.js';

// Route-side helpers on top of scope.ts. Each one loads/derives ownership from the DB, answers
// out-of-scope exactly like "not found" (audited), and returns null after responding.

// The team a team-work route (timeline, canvas, debrief) is about. A student always gets their own
// team; staff must name one with ?teamId= and hold it in scope — for one scenario (pair scope) when
// the route is about a scenario, else the team itself.
export function resolveTeamForPrincipal(req: Request, res: Response, cyberRangeId?: number): number | null {
  const p = req.user!;
  if (isStudent(p.role)) {
    if (!p.teamId) {
      res.status(409).json({ error: 'user has no team assigned' });
      return null;
    }
    return p.teamId;
  }
  const teamId = Number(req.query.teamId);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    res.status(400).json({ error: 'staff must pass ?teamId=' });
    return null;
  }
  const allowed = cyberRangeId === undefined ? teamInScope(p, teamId) : pairInScope(p, teamId, cyberRangeId);
  if (!allowed) {
    notFoundOutOfScope(req, res, 'team', { cyberRangeId: cyberRangeId ?? null, organizationId: teamOrganization(teamId)?.orgId ?? null });
    return null;
  }
  return teamId;
}

export function assertTeamInScope(req: Request, res: Response, teamId: number): boolean {
  if (teamInScope(req.user!, teamId)) return true;
  notFoundOutOfScope(req, res, 'team', { organizationId: teamOrganization(teamId)?.orgId ?? null });
  return false;
}

export function assertPairInScope(req: Request, res: Response, teamId: number, cyberRangeId: number, what = 'team'): boolean {
  if (pairInScope(req.user!, teamId, cyberRangeId)) return true;
  notFoundOutOfScope(req, res, what, { organizationId: teamOrganization(teamId)?.orgId ?? null, cyberRangeId });
  return false;
}

export function assertScenarioInScope(req: Request, res: Response, cyberRangeId: number, what = 'cyber range'): boolean {
  if (scenarioInScope(req.user!, cyberRangeId)) return true;
  notFoundOutOfScope(req, res, what, { cyberRangeId });
  return false;
}

export function assertOrganizationInScope(req: Request, res: Response, organizationId: number): boolean {
  if (organizationInScope(req.user!, organizationId)) return true;
  notFoundOutOfScope(req, res, 'organization', { organizationId });
  return false;
}

// The scenario a topology node belongs to, or null (404 sent) when the node is missing/out of scope.
export function nodeScenarioInScope(req: Request, res: Response, nodeId: number): number | null {
  const node = db.prepare('SELECT cyber_range_id AS cyberRangeId FROM topology_nodes WHERE id = ?').get(nodeId) as
    | { cyberRangeId: number }
    | undefined;
  if (!node) {
    res.status(404).json({ error: 'node not found' });
    return null;
  }
  return assertScenarioInScope(req, res, node.cyberRangeId, 'node') ? node.cyberRangeId : null;
}

// For staff lists of one team's rows: limits them to the scenarios that are in pair scope for that
// team (rows without a scenario fall back to the team's organization, already checked by the caller).
// A student's rows are already pinned to their own team, so nothing more is filtered.
export function teamWorkWhere(req: Request, orgColumn: string, rangeColumn: string): SqlFilter {
  if (isStudent(req.user!.role)) return { sql: '1 = 1', params: [] };
  const pair = scopeWhere(req.user!, orgColumn, rangeColumn);
  return { sql: `(${rangeColumn} IS NULL OR ${pair.sql})`, params: pair.params };
}

// Shared VMs / shared scenario state (RBAC §4.6): refused while a team outside the caller's scope is
// active or paused on the scenario. 409 (not 404): the scenario itself is in scope.
export function assertScenarioExclusive(req: Request, res: Response, cyberRangeId: number): boolean {
  if (scenarioExclusiveFor(req.user!, cyberRangeId)) return true;
  auditDenied(req, 'scenario_shared', { cyberRangeId });
  res.status(409).json({
    error: "another organization's team is working this scenario right now — only an admin can do this until it finishes",
    reason: 'scenario_shared',
  });
  return false;
}

// Express route middleware: the URL's :cyberRangeId must be an existing scenario in the caller's scope.
export function scenarioParam(req: Request, res: Response, next: () => void) {
  const cyberRangeId = Number(req.params.cyberRangeId);
  if (!db.prepare('SELECT 1 FROM cyber_ranges WHERE id = ?').get(cyberRangeId)) {
    res.status(404).json({ error: 'cyber range not found' });
    return;
  }
  if (!assertScenarioInScope(req, res, cyberRangeId)) return;
  next();
}

// A child row addressed together with :cyberRangeId must really belong to that scenario — checking
// only the URL's scenario would let a request edit another scenario's row by id (RBAC §4.2).
export function rowInScenario(table: 'topology_nodes' | 'topology_zones' | 'topology_edges', id: unknown, cyberRangeId: number): boolean {
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND cyber_range_id = ?`).get(Number(id), cyberRangeId);
}
