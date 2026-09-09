import { db } from '../db/index.js';

export interface LeaderboardEntry {
  teamId: number;
  teamName: string;
  totalPoints: number;
}

// Pluggable by design (scoring_config.method_key) — sum_points is the only strategy implemented,
// since the PRD leaves "final leaderboard scoring mechanism" as an open question (see
// CLAUDE/invariants.md). Swap this function's body, not the schema, if a different method is needed.
export function computeLeaderboard(): LeaderboardEntry[] {
  return db
    .prepare(
      `SELECT t.id AS teamId, t.name AS teamName, COALESCE(SUM(s.points), 0) AS totalPoints
       FROM teams t
       LEFT JOIN scores s ON s.team_id = t.id
       GROUP BY t.id
       ORDER BY totalPoints DESC, t.sort_order ASC`,
    )
    .all() as unknown as LeaderboardEntry[];
}

export function isLeaderboardEnabled(): boolean {
  const row = db.prepare('SELECT leaderboard_enabled AS enabled FROM scoring_config WHERE id = 1').get() as
    | { enabled: number }
    | undefined;
  return row?.enabled === 1;
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
