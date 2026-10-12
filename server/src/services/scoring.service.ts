import { isStudent } from '../authz/roles.js';
import type { Principal } from '../authz/principal.js';
import { scopeWhere, type SqlFilter } from '../authz/scope.js';
import { db } from '../db/index.js';

export interface LeaderboardEntry {
  teamId: number;
  teamName: string;
  organizationId: number | null;
  totalPoints: number;
}

// Pluggable by design (scoring_config.method_key) — sum_points is the only strategy implemented,
// since the PRD leaves "final leaderboard scoring mechanism" as an open question (see
// CLAUDE/invariants.md). Swap this function's body, not the schema, if a different method is needed.
// `filter` limits the board to some teams (a student's organization, an instructor's organizations);
// it is applied inside the query, aggregates included.
export function computeLeaderboard(filter?: SqlFilter): LeaderboardEntry[] {
  const where = filter ? `WHERE ${filter.sql}` : '';
  return db
    .prepare(
      `SELECT t.id AS teamId, t.name AS teamName, t.organization_id AS organizationId, COALESCE(SUM(s.points), 0) AS totalPoints
       FROM teams t
       LEFT JOIN scores s ON s.team_id = t.id
       ${where}
       GROUP BY t.id
       ORDER BY totalPoints DESC, t.sort_order ASC`,
    )
    .all(...(filter?.params ?? [])) as unknown as LeaderboardEntry[];
}

// What /leaderboard returns. An admin sees every team; an instructor the teams of their assigned
// organizations (with organizationId, so the client can group them). A student sees only the teams of
// their own organization — their team and the team(s) it competes with — and nothing at all (the tab
// is hidden) while their team has no organization or is alone in it. There is no on/off switch.
export function leaderboardFor(user: Principal): { enabled: boolean; teams: LeaderboardEntry[] } {
  if (!isStudent(user.role)) return { enabled: true, teams: computeLeaderboard(scopeWhere(user, 't.organization_id')) };
  const row = user.teamId === null
    ? undefined
    : (db.prepare('SELECT organization_id AS orgId FROM teams WHERE id = ?').get(user.teamId) as { orgId: number | null } | undefined);
  if (!row || row.orgId === null) return { enabled: false, teams: [] };
  const teams = computeLeaderboard({ sql: 't.organization_id = ?', params: [row.orgId] });
  return teams.length >= 2 ? { enabled: true, teams } : { enabled: false, teams: [] };
}

export function teamTotal(teamId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(points), 0) AS total FROM scores WHERE team_id = ?')
    .get(teamId) as { total: number };
  return row.total;
}

export function studentTotal(studentUserId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(points), 0) AS total FROM scores WHERE student_user_id = ?')
    .get(studentUserId) as { total: number };
  return row.total;
}
