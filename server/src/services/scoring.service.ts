import { db } from '../db/index.js';

export interface LeaderboardEntry {
  teamId: number;
  teamName: string;
  totalPoints: number;
}

// Pluggable by design (scoring_config.method_key) — sum_points is the only strategy implemented,
// since the PRD leaves "final leaderboard scoring mechanism" as an open question (see
// CLAUDE/invariants.md). Swap this function's body, not the schema, if a different method is needed.
// organizationId limits the board to one organization's teams (the student view).
export function computeLeaderboard(organizationId?: number): LeaderboardEntry[] {
  const where = organizationId === undefined ? '' : 'WHERE t.organization_id = ?';
  return db
    .prepare(
      `SELECT t.id AS teamId, t.name AS teamName, COALESCE(SUM(s.points), 0) AS totalPoints
       FROM teams t
       LEFT JOIN scores s ON s.team_id = t.id
       ${where}
       GROUP BY t.id
       ORDER BY totalPoints DESC, t.sort_order ASC`,
    )
    .all(...(organizationId === undefined ? [] : [organizationId])) as unknown as LeaderboardEntry[];
}

// What /leaderboard returns. The instructor always sees every team. A student sees only the teams of
// their own organization — their team and the team(s) it competes with — and nothing at all (the
// tab is hidden) while their team has no organization or is alone in it. There is no instructor
// on/off switch: the board is on by default.
export function leaderboardFor(user: { role: string; teamId: number | null }): { enabled: boolean; teams: LeaderboardEntry[] } {
  if (user.role === 'instructor') return { enabled: true, teams: computeLeaderboard() };
  const row = user.teamId === null
    ? undefined
    : (db.prepare('SELECT organization_id AS orgId FROM teams WHERE id = ?').get(user.teamId) as { orgId: number | null } | undefined);
  if (!row || row.orgId === null) return { enabled: false, teams: [] };
  const teams = computeLeaderboard(row.orgId);
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
