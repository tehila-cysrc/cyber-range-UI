import { db } from '../db/index.js';
import { getActiveEventRunId } from '../db/seed.js';

// Everything an instructor may want to keep before an event reset wipes the RUN tables: teams,
// members, each scenario's timeline, canvas and scores. Deliberately excludes passwords, auth tokens,
// screenshot image data (flagged with hasImage instead — they can be many MB) and remote-access
// session internals.

interface TeamRow {
  id: number;
  name: string;
}

interface ProgressRow {
  cyberRangeId: number;
  name: string;
  dayLabel: string | null;
  difficulty: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}

export function buildEventExport() {
  const eventRunId = getActiveEventRunId();
  const eventRun = db.prepare('SELECT id, started_at AS startedAt FROM event_runs WHERE id = ?').get(eventRunId) as
    | { id: number; startedAt: string }
    | undefined;

  const teams = db.prepare('SELECT id, name FROM teams WHERE event_run_id = ? ORDER BY sort_order, name').all(eventRunId) as unknown as TeamRow[];

  const membersStmt = db.prepare(
    `SELECT username, display_name AS displayName FROM users WHERE team_id = ? AND role = 'student' ORDER BY display_name`,
  );
  const progressStmt = db.prepare(
    `SELECT p.cyber_range_id AS cyberRangeId, cr.name AS name, d.label AS dayLabel, cr.difficulty AS difficulty,
            p.status AS status, p.started_at AS startedAt, p.completed_at AS completedAt
     FROM team_cyber_range_progress p
     JOIN cyber_ranges cr ON cr.id = p.cyber_range_id
     LEFT JOIN days d ON d.id = cr.day_id
     WHERE p.team_id = ? ORDER BY p.started_at`,
  );
  const entriesStmt = db.prepare(
    `SELECT e.id AS id, e.created_at AS createdAt, u.display_name AS author, c.label AS category, e.body AS body,
            e.is_important_finding AS isImportantFinding, (e.image_data_url IS NOT NULL) AS hasImage
     FROM documentation_entries e
     JOIN users u ON u.id = e.author_user_id
     LEFT JOIN documentation_categories c ON c.id = e.category_id
     WHERE e.team_id = ? AND e.cyber_range_id = ? ORDER BY e.created_at`,
  );
  const entryTtpsStmt = db.prepare(
    `SELECT technique_id AS techniqueId FROM documentation_entry_ttps
     WHERE documentation_entry_id = ? AND removed_at IS NULL ORDER BY technique_id`,
  );
  const canvasNodesStmt = db.prepare(
    `SELECT id, node_type AS type, label, body FROM investigation_canvas_nodes WHERE team_id = ? AND cyber_range_id = ? ORDER BY id`,
  );
  const canvasEdgesStmt = db.prepare(
    `SELECT from_node_id AS fromNodeId, to_node_id AS toNodeId, label FROM investigation_canvas_edges
     WHERE team_id = ? AND cyber_range_id = ? ORDER BY id`,
  );
  const scoresStmt = db.prepare(
    `SELECT s.points AS points, s.note AS note, s.source AS source, s.created_at AS createdAt, u.display_name AS student
     FROM scores s LEFT JOIN users u ON u.id = s.student_user_id
     WHERE s.team_id = ? AND s.cyber_range_id IS ? ORDER BY s.created_at`,
  );

  return {
    exportedAt: new Date().toISOString(),
    eventRun: eventRun ?? null,
    teams: teams.map((team) => {
      const scenarios = (progressStmt.all(team.id) as unknown as ProgressRow[]).map((p) => {
        const cyberRangeId = p.cyberRangeId;
        const entries = (entriesStmt.all(team.id, cyberRangeId) as Record<string, unknown>[]).map((e) => ({
          createdAt: e.createdAt,
          author: e.author,
          category: e.category ?? null,
          body: e.body,
          isImportantFinding: !!e.isImportantFinding,
          hasImage: !!e.hasImage,
          techniques: (entryTtpsStmt.all(e.id as number) as { techniqueId: string }[]).map((t) => t.techniqueId),
        }));
        const scores = scoresStmt.all(team.id, cyberRangeId) as { points: number }[];
        return {
          ...p,
          points: scores.reduce((sum, s) => sum + s.points, 0),
          entries,
          canvas: {
            nodes: canvasNodesStmt.all(team.id, cyberRangeId),
            edges: canvasEdgesStmt.all(team.id, cyberRangeId),
          },
          scores,
        };
      });
      const unscopedScores = scoresStmt.all(team.id, null) as { points: number }[];
      const totalPoints =
        scenarios.reduce((sum, s) => sum + s.points, 0) + unscopedScores.reduce((sum, s) => sum + s.points, 0);
      return {
        name: team.name,
        members: membersStmt.all(team.id),
        totalPoints,
        scenarios,
        otherScores: unscopedScores,
      };
    }),
  };
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// One row per team × scenario — opens directly in Excel for a quick results summary.
export function buildEventExportCsv(): string {
  const data = buildEventExport();
  const header = ['Team', 'Members', 'Scenario', 'Day', 'Status', 'Started', 'Completed', 'Entries', 'Findings', 'Scenario points', 'Team total points'];
  const rows: unknown[][] = [];
  for (const team of data.teams) {
    const members = (team.members as { displayName: string }[]).map((m) => m.displayName).join('; ');
    if (team.scenarios.length === 0) {
      rows.push([team.name, members, '', '', '', '', '', 0, 0, 0, team.totalPoints]);
    }
    for (const s of team.scenarios) {
      rows.push([
        team.name,
        members,
        s.name,
        s.dayLabel,
        s.status,
        s.startedAt,
        s.completedAt,
        s.entries.length,
        s.entries.filter((e) => e.isImportantFinding).length,
        s.points,
        team.totalPoints,
      ]);
    }
  }
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
