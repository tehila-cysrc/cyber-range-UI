import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../authz/requirePermission.js';
import { pairInScope, scopeWhere } from '../../authz/scope.js';
import { teamTtpSummary } from '../../services/ttpScoring.service.js';

const router = Router();

router.use(requireAuth);

interface TeamRow {
  id: number;
  name: string;
  organizationId: number | null;
  organizationName: string | null;
}

interface ActiveRow {
  cyberRangeId: number;
  name: string;
  difficulty: string;
  dayLabel: string;
  startedAt: string;
  timeLimitSeconds: number | null;
}

// US-006: instructor sees every team from one view — day, active range, time remaining, progress
// state, open help request count. Renders as an array so the client can grid N teams, not 2.
// Instructor: the teams of their assigned organizations; a team's live scenario (and its activity)
// only when that (organization, scenario) pair is theirs — otherwise `active` is null and
// `activeOutOfScope` says another instructor runs it.
router.get('/dashboard', requirePermission('dashboard.read'), (req, res) => {
  // Organization fields let the dashboard's sidebar filter/group teams by organization.
  const scoped = scopeWhere(req.user!, 't.organization_id');
  const teams = db
    .prepare(
      `SELECT t.id, t.name, t.organization_id AS organizationId, o.name AS organizationName
       FROM teams t LEFT JOIN organizations o ON o.id = t.organization_id
       WHERE ${scoped.sql} ORDER BY t.sort_order`,
    )
    .all(...scoped.params) as unknown as TeamRow[];

  const activeStmt = db.prepare(
    `SELECT
       cr.id AS cyberRangeId, cr.name AS name, cr.difficulty AS difficulty, d.label AS dayLabel,
       p.started_at AS startedAt, p.time_limit_seconds AS timeLimitSeconds
     FROM team_cyber_range_progress p
     JOIN cyber_ranges cr ON cr.id = p.cyber_range_id
     JOIN days d ON d.id = cr.day_id
     WHERE p.team_id = ? AND p.status = 'active'
     LIMIT 1`,
  );

  // Counters and totals only include the caller's pairs (team-level awards without a scenario count).
  const helpScope = scopeWhere(req.user!, 't.organization_id', 'h.cyber_range_id');
  const openHelpCountStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM help_requests h JOIN teams t ON t.id = h.team_id
     WHERE h.team_id = ? AND h.status = 'open' AND ${helpScope.sql}`,
  );

  const progressScope = scopeWhere(req.user!, 't.organization_id', 'p.cyber_range_id');
  const completedCountStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM team_cyber_range_progress p JOIN teams t ON t.id = p.team_id
     WHERE p.team_id = ? AND p.status = 'completed' AND ${progressScope.sql}`,
  );

  // Live progress signals for the active scenario, so an instructor can spot a stalled team (no
  // entries for a while) without opening each team's timeline one by one.
  const activityStmt = db.prepare(
    `SELECT COUNT(*) AS entryCount,
            COALESCE(SUM(is_important_finding), 0) AS findingCount,
            MAX(created_at) AS lastEntryAt
     FROM documentation_entries WHERE team_id = ? AND cyber_range_id = ?`,
  );
  const scoreScope = scopeWhere(req.user!, 't.organization_id', 's.cyber_range_id');
  const totalPointsStmt = db.prepare(
    `SELECT COALESCE(SUM(s.points), 0) AS total FROM scores s JOIN teams t ON t.id = s.team_id
     WHERE s.team_id = ? AND (s.cyber_range_id IS NULL OR ${scoreScope.sql})`,
  );
  const memberCountStmt = db.prepare("SELECT COUNT(*) AS n FROM users WHERE team_id = ? AND role = 'student' AND deactivated_at IS NULL");

  const result = teams.map((team) => {
    const live = activeStmt.get(team.id) as ActiveRow | undefined;
    const active = live && pairInScope(req.user!, team.id, live.cyberRangeId) ? live : undefined;
    const openHelpCount = (openHelpCountStmt.get(team.id, ...helpScope.params) as { n: number }).n;
    const completedCount = (completedCountStmt.get(team.id, ...progressScope.params) as { n: number }).n;
    const activity = active
      ? (activityStmt.get(team.id, active.cyberRangeId) as { entryCount: number; findingCount: number; lastEntryAt: string | null })
      : null;

    const remainingSeconds =
      active?.timeLimitSeconds != null
        ? Math.max(
            0,
            active.timeLimitSeconds -
              Math.floor((Date.now() - new Date(active.startedAt).getTime()) / 1000),
          )
        : null;

    return {
      teamId: team.id,
      teamName: team.name,
      organizationId: team.organizationId,
      organizationName: team.organizationName,
      active: active
        ? {
            cyberRangeId: active.cyberRangeId,
            name: active.name,
            difficulty: active.difficulty,
            dayLabel: active.dayLabel,
            remainingSeconds,
            entryCount: activity!.entryCount,
            findingCount: activity!.findingCount,
            lastEntryAt: activity!.lastEntryAt,
            // null when the scenario defines no expected ATT&CK techniques.
            ttp: teamTtpSummary(team.id, active.cyberRangeId),
          }
        : null,
      activeOutOfScope: !!live && !active,
      openHelpCount,
      completedCount,
      totalPoints: (totalPointsStmt.get(team.id, ...scoreScope.params) as { total: number }).total,
      memberCount: (memberCountStmt.get(team.id) as { n: number }).n,
    };
  });

  res.json({ teams: result });
});

export default router;
