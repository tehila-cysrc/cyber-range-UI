import { db } from '../db/index.js';
import { getActiveEventRunId } from '../db/seed.js';
import type { Principal } from './principal.js';

// Which teams and scenarios a principal may touch (RBAC design review §2.4). Always derived from the
// row loaded from the DB — never from an id in the URL or body alone.
//
// An instructor's scope is a set of (organization, scenario) PAIRS. Data of team T on scenario S is in
// scope only when (T.organization_id, S) is one of the pairs. Holding organization A (with S1) and
// scenario S2 (with organization B) does NOT open A's work on S2 — that cross product is the leak this
// shape exists to prevent. A team without an organization is admin-only.

export interface Scope {
  all: boolean;
  pairs: { orgId: number; rangeId: number }[];
  orgIds: Set<number>;
  rangeIds: Set<number>;
}

const NONE: Scope = { all: false, pairs: [], orgIds: new Set(), rangeIds: new Set() };
const ALL: Scope = { all: true, pairs: [], orgIds: new Set(), rangeIds: new Set() };

// Read fresh on every call (no cache across requests): removing an assignment takes effect at once.
export function loadScope(p: Principal): Scope {
  if (p.role === 'admin') return ALL;
  if (p.role !== 'instructor' || p.accountId === null) return NONE;
  const pairs = db
    .prepare(
      `SELECT ia.organization_id AS orgId, ia.cyber_range_id AS rangeId
       FROM instructor_assignments ia JOIN accounts a ON a.id = ia.account_id
       WHERE ia.account_id = ? AND a.disabled_at IS NULL`,
    )
    .all(p.accountId) as { orgId: number; rangeId: number }[];
  return {
    all: false,
    pairs: pairs.map((r) => ({ orgId: r.orgId, rangeId: r.rangeId })),
    orgIds: new Set(pairs.map((r) => r.orgId)),
    rangeIds: new Set(pairs.map((r) => r.rangeId)),
  };
}

function hasPair(scope: Scope, orgId: number | null, rangeId: number): boolean {
  if (orgId === null) return false;
  return scope.pairs.some((pair) => pair.orgId === orgId && pair.rangeId === rangeId);
}

// The team's organization, or undefined when the team doesn't exist in the active run.
export function teamOrganization(teamId: number): { orgId: number | null } | undefined {
  const row = db
    .prepare('SELECT organization_id AS orgId FROM teams WHERE id = ? AND event_run_id IS ?')
    .get(teamId, getActiveEventRunId()) as { orgId: number | null } | undefined;
  return row ? { orgId: row.orgId } : undefined;
}

// The team itself (its roster, its organization). Instructor: any team of an assigned organization.
export function teamInScope(p: Principal, teamId: number): boolean {
  if (p.role === 'student') return p.teamId !== null && p.teamId === teamId;
  const team = teamOrganization(teamId);
  if (!team) return false;
  if (p.role === 'admin') return true;
  return team.orgId !== null && loadScope(p).orgIds.has(team.orgId);
}

// A team's work on one scenario (timeline, canvas, scores, help, detections, progress).
export function pairInScope(p: Principal, teamId: number, rangeId: number): boolean {
  if (p.role === 'student') return p.teamId !== null && p.teamId === teamId;
  const team = teamOrganization(teamId);
  if (!team) return false;
  if (p.role === 'admin') return true;
  return hasPair(loadScope(p), team.orgId, rangeId);
}

// Scenario content (topology draft, answer key, briefing). Students are never in scope here — their
// read path is the published topology of a scenario their team was assigned (cyberRangeProgress).
export function scenarioInScope(p: Principal, rangeId: number): boolean {
  if (p.role === 'admin') return true;
  if (p.role !== 'instructor') return false;
  return loadScope(p).rangeIds.has(rangeId);
}

export function organizationInScope(p: Principal, orgId: number): boolean {
  if (p.role === 'admin') return true;
  if (p.role !== 'instructor') return false;
  return loadScope(p).orgIds.has(orgId);
}

// Shared Azure environment / shared scenario state (RBAC review §4.6): an instructor may operate VMs
// of a scenario, or record a TTP occurrence on it, only while EVERY team currently on that scenario
// (active or paused) is in their scope. Otherwise the action would reach another organization's run.
export function scenarioExclusiveFor(p: Principal, rangeId: number): boolean {
  if (p.role === 'admin') return true;
  if (!scenarioInScope(p, rangeId)) return false;
  const teams = db
    .prepare(
      `SELECT t.organization_id AS orgId FROM team_cyber_range_progress pr JOIN teams t ON t.id = pr.team_id
       WHERE pr.cyber_range_id = ? AND pr.status IN ('active', 'paused')`,
    )
    .all(rangeId) as { orgId: number | null }[];
  const scope = loadScope(p);
  return teams.every((t) => hasPair(scope, t.orgId, rangeId));
}

export interface SqlFilter {
  sql: string;
  params: number[];
}

// SQL filter for list queries and aggregates — filtered in the query, never in JS afterwards.
// orgColumn/rangeColumn are SQL column expressions written in code (never user input). With a
// rangeColumn the filter is per (organization, scenario) pair; without one it is per organization.
export function scopeWhere(p: Principal, orgColumn: string, rangeColumn?: string): SqlFilter {
  if (p.role === 'admin') return { sql: '1 = 1', params: [] };
  if (p.role !== 'instructor' || p.accountId === null) return { sql: '1 = 0', params: [] };
  if (rangeColumn) {
    return {
      sql: `EXISTS (SELECT 1 FROM instructor_assignments ia WHERE ia.account_id = ?
              AND ia.organization_id = ${orgColumn} AND ia.cyber_range_id = ${rangeColumn})`,
      params: [p.accountId],
    };
  }
  return {
    sql: `${orgColumn} IN (SELECT ia.organization_id FROM instructor_assignments ia WHERE ia.account_id = ?)`,
    params: [p.accountId],
  };
}

// SQL filter on a scenario column alone (scenario lists, scenario-level content).
export function scenarioWhere(p: Principal, rangeColumn: string): SqlFilter {
  if (p.role === 'admin') return { sql: '1 = 1', params: [] };
  if (p.role !== 'instructor' || p.accountId === null) return { sql: '1 = 0', params: [] };
  return {
    sql: `${rangeColumn} IN (SELECT ia.cyber_range_id FROM instructor_assignments ia WHERE ia.account_id = ?)`,
    params: [p.accountId],
  };
}
