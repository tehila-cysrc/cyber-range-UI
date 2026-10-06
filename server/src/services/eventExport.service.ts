import ExcelJS from 'exceljs';
import { db } from '../db/index.js';
import { getActiveEventRunId } from '../db/seed.js';
import { techniqueLabel } from './mitreCatalog.js';

// Everything an instructor may want to keep before an event reset wipes the RUN tables: teams and
// their organization, members with their points, and for each scenario the timeline (with
// screenshots), canvas, every score award, help requests and ATT&CK credits. Deliberately excludes
// passwords, auth tokens and remote-access session internals.

interface TeamRow {
  id: number;
  name: string;
  organization: string | null;
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

interface EntryRow {
  id: number;
  createdAt: string;
  author: string;
  category: string | null;
  body: string;
  isImportantFinding: number;
  afterTimeLimit: number;
  imageDataUrl: string | null;
}

interface ScoreRow {
  points: number;
  note: string | null;
  source: string;
  createdAt: string;
  student: string | null;
  awardedBy: string | null;
}

interface CanvasNodeRow {
  id: number;
  type: string;
  label: string;
  body: string | null;
}

interface CanvasEdgeRow {
  fromNodeId: number;
  toNodeId: number;
  label: string | null;
}

interface HelpRow {
  createdAt: string;
  requestedBy: string;
  message: string | null;
  status: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

interface DetectionRow {
  taggedTechniqueId: string | null;
  expectedTechniqueId: string;
  points: number;
  status: string;
  source: string;
  detectedAt: string;
  student: string | null;
  voidReason: string | null;
}

export function buildEventExport({ includeImages = true }: { includeImages?: boolean } = {}) {
  const eventRunId = getActiveEventRunId();
  const eventRun = db.prepare('SELECT id, started_at AS startedAt FROM event_runs WHERE id = ?').get(eventRunId) as
    | { id: number; startedAt: string }
    | undefined;

  const teams = db
    .prepare(
      `SELECT t.id, t.name, o.name AS organization
       FROM teams t LEFT JOIN organizations o ON o.id = t.organization_id
       WHERE t.event_run_id = ? ORDER BY t.sort_order, t.name`,
    )
    .all(eventRunId) as unknown as TeamRow[];

  const membersStmt = db.prepare(
    `SELECT u.username, u.display_name AS displayName,
            (SELECT COALESCE(SUM(s.points), 0) FROM scores s WHERE s.student_user_id = u.id) AS points
     FROM users u WHERE u.team_id = ? AND u.role = 'student' ORDER BY u.display_name`,
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
            e.is_important_finding AS isImportantFinding, e.after_time_limit AS afterTimeLimit,
            e.image_data_url AS imageDataUrl
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
    `SELECT s.points AS points, s.note AS note, s.source AS source, s.created_at AS createdAt,
            u.display_name AS student, a.display_name AS awardedBy
     FROM scores s
     LEFT JOIN users u ON u.id = s.student_user_id
     LEFT JOIN users a ON a.id = s.awarded_by_user_id
     WHERE s.team_id = ? AND s.cyber_range_id IS ? ORDER BY s.created_at`,
  );
  const helpStmt = db.prepare(
    `SELECT h.created_at AS createdAt, u.display_name AS requestedBy, h.message AS message, h.status AS status,
            h.resolved_at AS resolvedAt,
            CASE WHEN h.resolved_at IS NULL THEN NULL
                 WHEN h.resolved_by_user_id IS NULL THEN 'closed when the scenario ended'
                 ELSE r.display_name END AS resolvedBy
     FROM help_requests h
     JOIN users u ON u.id = h.requested_by_user_id
     LEFT JOIN users r ON r.id = h.resolved_by_user_id
     WHERE h.team_id = ? AND h.cyber_range_id = ? ORDER BY h.created_at`,
  );
  const detectionsStmt = db.prepare(
    `SELECT et.technique_id AS taggedTechniqueId, x.technique_id AS expectedTechniqueId,
            d.points_awarded AS points, d.status AS status, d.source AS source, d.detected_at AS detectedAt,
            u.display_name AS student, d.void_reason AS voidReason
     FROM ttp_detections d
     JOIN cyber_range_expected_ttps x ON x.id = d.expected_ttp_id
     LEFT JOIN documentation_entry_ttps et ON et.id = d.documentation_entry_ttp_id
     LEFT JOIN users u ON u.id = d.credited_user_id
     WHERE d.team_id = ? AND d.cyber_range_id = ? ORDER BY d.detected_at`,
  );

  return {
    exportedAt: new Date().toISOString(),
    eventRun: eventRun ?? null,
    teams: teams.map((team) => {
      const scenarios = (progressStmt.all(team.id) as unknown as ProgressRow[]).map((p) => {
        const cyberRangeId = p.cyberRangeId;
        const entries = (entriesStmt.all(team.id, cyberRangeId) as unknown as EntryRow[]).map((e) => ({
          createdAt: e.createdAt,
          author: e.author,
          category: e.category ?? null,
          body: e.body,
          isImportantFinding: !!e.isImportantFinding,
          afterTimeLimit: !!e.afterTimeLimit,
          hasImage: e.imageDataUrl != null,
          ...(includeImages ? { imageDataUrl: e.imageDataUrl } : {}),
          techniques: (entryTtpsStmt.all(e.id) as { techniqueId: string }[]).map((t) => t.techniqueId),
        }));
        const scores = scoresStmt.all(team.id, cyberRangeId) as unknown as ScoreRow[];
        const nodes = canvasNodesStmt.all(team.id, cyberRangeId) as unknown as CanvasNodeRow[];
        const edges = canvasEdgesStmt.all(team.id, cyberRangeId) as unknown as CanvasEdgeRow[];
        const detections = (detectionsStmt.all(team.id, cyberRangeId) as unknown as DetectionRow[]).map((d) => ({
          technique: d.taggedTechniqueId ?? d.expectedTechniqueId,
          creditedFor: d.expectedTechniqueId,
          points: d.points,
          status: d.status,
          source: d.source,
          detectedAt: d.detectedAt,
          student: d.student,
          voidReason: d.voidReason,
        }));
        return {
          ...p,
          points: scores.reduce((sum, s) => sum + s.points, 0),
          entries,
          canvas: { nodes, edges },
          scores,
          helpRequests: helpStmt.all(team.id, cyberRangeId) as unknown as HelpRow[],
          attackDetections: detections,
        };
      });
      const unscopedScores = scoresStmt.all(team.id, null) as unknown as ScoreRow[];
      const totalPoints =
        scenarios.reduce((sum, s) => sum + s.points, 0) + unscopedScores.reduce((sum, s) => sum + s.points, 0);
      return {
        name: team.name,
        organization: team.organization,
        members: membersStmt.all(team.id) as unknown as { username: string; displayName: string; points: number }[],
        totalPoints,
        scenarios,
        otherScores: unscopedScores,
      };
    }),
  };
}

type EventExport = ReturnType<typeof buildEventExport>;

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// One row per team × scenario — kept for anyone scripting against ?format=csv; the UI offers the
// Excel workbook below instead.
export function buildEventExportCsv(): string {
  const data = buildEventExport({ includeImages: false });
  const header = ['Team', 'Members', 'Scenario', 'Day', 'Status', 'Started', 'Completed', 'Entries', 'Findings', 'Entries after time limit', 'Scenario points', 'Team total points'];
  const rows: unknown[][] = [];
  for (const team of data.teams) {
    const members = team.members.map((m) => m.displayName).join('; ');
    if (team.scenarios.length === 0) {
      rows.push([team.name, members, '', '', '', '', '', 0, 0, 0, 0, team.totalPoints]);
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
        s.entries.filter((e) => e.afterTimeLimit).length,
        s.points,
        team.totalPoints,
      ]);
    }
  }
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// "2026-10-06T14:37:39.618Z" -> "2026-10-06 14:37:39" (the column headers say UTC).
function utc(iso: string | null | undefined): string {
  return iso ? iso.replace('T', ' ').slice(0, 19) : '';
}

// Width/height of a PNG, JPEG or GIF, so an embedded screenshot keeps its aspect ratio. null if the
// header can't be read (the image is then embedded at a fixed box size).
function imageSize(buf: Buffer, ext: 'png' | 'jpeg' | 'gif'): { width: number; height: number } | null {
  try {
    if (ext === 'png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (ext === 'gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  } catch {
    // fall through
  }
  return null;
}

const MAX_IMAGE_WIDTH = 320;
const MAX_IMAGE_HEIGHT = 200;
const STATUS_LABEL: Record<string, string> = { active: 'In progress', paused: 'Paused', completed: 'Completed', not_started: 'Not started' };

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width: number; wrap?: boolean }[]) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    style: { alignment: { vertical: 'top', wrapText: !!c.wrap } },
  }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A33' } };
  header.alignment = { vertical: 'middle' };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

// Full results workbook: a Summary sheet plus one sheet per kind of record, every record in full —
// screenshots are embedded next to their timeline entry.
export async function buildEventExportXlsx(): Promise<Buffer> {
  const data: EventExport = buildEventExport({ includeImages: true });
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(data.exportedAt);

  const summary = addSheet(workbook, 'Summary', [
    { header: 'Team', key: 'team', width: 18 },
    { header: 'Organization', key: 'org', width: 18 },
    { header: 'Members', key: 'members', width: 30, wrap: true },
    { header: 'Scenario', key: 'scenario', width: 24 },
    { header: 'Day', key: 'day', width: 8 },
    { header: 'Difficulty', key: 'difficulty', width: 13 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Started (UTC)', key: 'started', width: 20 },
    { header: 'Completed (UTC)', key: 'completed', width: 20 },
    { header: 'Entries', key: 'entries', width: 9 },
    { header: 'Findings', key: 'findings', width: 10 },
    { header: 'After time limit', key: 'late', width: 15 },
    { header: 'Canvas items', key: 'canvas', width: 13 },
    { header: 'Help requests', key: 'help', width: 13 },
    { header: 'ATT&CK credits', key: 'attack', width: 15 },
    { header: 'Scenario points', key: 'points', width: 15 },
    { header: 'Team total points', key: 'total', width: 17 },
  ]);
  const timeline = addSheet(workbook, 'Timeline', [
    { header: 'Team', key: 'team', width: 16 },
    { header: 'Scenario', key: 'scenario', width: 22 },
    { header: 'Time (UTC)', key: 'time', width: 20 },
    { header: 'Author', key: 'author', width: 16 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Finding', key: 'finding', width: 9 },
    { header: 'After time limit', key: 'late', width: 15 },
    { header: 'ATT&CK techniques', key: 'techniques', width: 34, wrap: true },
    { header: 'Entry', key: 'body', width: 60, wrap: true },
    { header: 'Screenshot', key: 'image', width: 46 },
  ]);
  const scores = addSheet(workbook, 'Scores', [
    { header: 'Team', key: 'team', width: 16 },
    { header: 'Scenario', key: 'scenario', width: 22 },
    { header: 'Time (UTC)', key: 'time', width: 20 },
    { header: 'Points', key: 'points', width: 9 },
    { header: 'Awarded to', key: 'student', width: 18 },
    { header: 'Source', key: 'source', width: 10 },
    { header: 'Note', key: 'note', width: 50, wrap: true },
    { header: 'Awarded by', key: 'by', width: 18 },
  ]);
  const students = addSheet(workbook, 'Students', [
    { header: 'Team', key: 'team', width: 16 },
    { header: 'Organization', key: 'org', width: 18 },
    { header: 'Username', key: 'username', width: 18 },
    { header: 'Name', key: 'name', width: 20 },
    { header: 'Individual points', key: 'points', width: 17 },
  ]);
  const canvas = addSheet(workbook, 'Canvas', [
    { header: 'Team', key: 'team', width: 16 },
    { header: 'Scenario', key: 'scenario', width: 22 },
    { header: 'Type', key: 'type', width: 11 },
    { header: 'Item', key: 'label', width: 28, wrap: true },
    { header: 'Details', key: 'body', width: 50, wrap: true },
    { header: 'Links to', key: 'links', width: 40, wrap: true },
  ]);
  const help = addSheet(workbook, 'Help requests', [
    { header: 'Team', key: 'team', width: 16 },
    { header: 'Scenario', key: 'scenario', width: 22 },
    { header: 'Requested (UTC)', key: 'time', width: 20 },
    { header: 'Requested by', key: 'by', width: 16 },
    { header: 'Message', key: 'message', width: 50, wrap: true },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Closed (UTC)', key: 'closed', width: 20 },
    { header: 'Closed by', key: 'closedBy', width: 28 },
  ]);
  const attack = addSheet(workbook, 'ATT&CK credits', [
    { header: 'Team', key: 'team', width: 16 },
    { header: 'Scenario', key: 'scenario', width: 22 },
    { header: 'Detected (UTC)', key: 'time', width: 20 },
    { header: 'Technique tagged', key: 'technique', width: 40, wrap: true },
    { header: 'Credited for', key: 'expected', width: 40, wrap: true },
    { header: 'Points', key: 'points', width: 9 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Source', key: 'source', width: 11 },
    { header: 'Student', key: 'student', width: 16 },
    { header: 'Void reason', key: 'void', width: 30, wrap: true },
  ]);

  for (const team of data.teams) {
    const members = team.members.map((m) => m.displayName).join(', ');
    for (const m of team.members) {
      students.addRow({ team: team.name, org: team.organization ?? '', username: m.username, name: m.displayName, points: m.points });
    }
    if (team.scenarios.length === 0) {
      summary.addRow({ team: team.name, org: team.organization ?? '', members, total: team.totalPoints });
    }
    for (const s of team.scenarios) {
      summary.addRow({
        team: team.name,
        org: team.organization ?? '',
        members,
        scenario: s.name,
        day: s.dayLabel ?? '',
        difficulty: s.difficulty,
        status: STATUS_LABEL[s.status] ?? s.status,
        started: utc(s.startedAt),
        completed: utc(s.completedAt),
        entries: s.entries.length,
        findings: s.entries.filter((e) => e.isImportantFinding).length,
        late: s.entries.filter((e) => e.afterTimeLimit).length,
        canvas: s.canvas.nodes.length,
        help: s.helpRequests.length,
        attack: s.attackDetections.filter((d) => d.status === 'credited').length,
        points: s.points,
        total: team.totalPoints,
      });

      for (const e of s.entries) {
        const row = timeline.addRow({
          team: team.name,
          scenario: s.name,
          time: utc(e.createdAt),
          author: e.author,
          category: e.category ?? '',
          finding: e.isImportantFinding ? 'Yes' : '',
          late: e.afterTimeLimit ? 'Yes' : '',
          techniques: e.techniques.map(techniqueLabel).join('\n'),
          body: e.body,
        });
        const match = e.imageDataUrl ? /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(e.imageDataUrl) : null;
        if (match) {
          const type = match[1].toLowerCase();
          const ext = type === 'jpg' || type === 'jpeg' ? 'jpeg' : type === 'png' || type === 'gif' ? type : null;
          if (ext) {
            const buf = Buffer.from(match[2], 'base64');
            const size = imageSize(buf, ext) ?? { width: MAX_IMAGE_WIDTH, height: MAX_IMAGE_HEIGHT };
            const scale = Math.min(1, MAX_IMAGE_WIDTH / size.width, MAX_IMAGE_HEIGHT / size.height);
            const width = Math.round(size.width * scale);
            const height = Math.round(size.height * scale);
            const imageId = workbook.addImage({ base64: match[2], extension: ext });
            timeline.addImage(imageId, { tl: { col: 9, row: row.number - 1 }, ext: { width, height }, editAs: 'oneCell' });
            row.height = Math.max(row.height ?? 15, height * 0.75 + 6); // row height is in points
          } else {
            row.getCell('image').value = `attached (${type} — open the JSON archive to view)`;
          }
        }
      }

      const scenarioScores = s.scores;
      for (const sc of scenarioScores) {
        scores.addRow({
          team: team.name,
          scenario: s.name,
          time: utc(sc.createdAt),
          points: sc.points,
          student: sc.student ?? 'Team',
          source: sc.source === 'ttp' ? 'ATT&CK' : 'Manual',
          note: sc.note ?? '',
          by: sc.awardedBy ?? (sc.source === 'ttp' ? 'automatic' : ''),
        });
      }

      const labels = new Map(s.canvas.nodes.map((n) => [n.id, n.label]));
      for (const n of s.canvas.nodes) {
        const links = s.canvas.edges
          .filter((edge) => edge.fromNodeId === n.id)
          .map((edge) => `→ ${labels.get(edge.toNodeId) ?? '?'}${edge.label ? ` (${edge.label})` : ''}`)
          .join('\n');
        canvas.addRow({ team: team.name, scenario: s.name, type: n.type, label: n.label, body: n.body ?? '', links });
      }

      for (const h of s.helpRequests) {
        help.addRow({
          team: team.name,
          scenario: s.name,
          time: utc(h.createdAt),
          by: h.requestedBy,
          message: h.message ?? '',
          status: h.status === 'open' ? 'Open' : 'Closed',
          closed: utc(h.resolvedAt),
          closedBy: h.resolvedBy ?? '',
        });
      }

      for (const d of s.attackDetections) {
        attack.addRow({
          team: team.name,
          scenario: s.name,
          time: utc(d.detectedAt),
          technique: techniqueLabel(d.technique),
          expected: techniqueLabel(d.creditedFor),
          points: d.points,
          status: d.status === 'credited' ? 'Credited' : 'Voided',
          source: d.source === 'auto' ? 'Automatic' : 'Instructor',
          student: d.student ?? '',
          void: d.voidReason ?? '',
        });
      }
    }

    for (const sc of team.otherScores) {
      scores.addRow({
        team: team.name,
        scenario: '(not tied to a scenario)',
        time: utc(sc.createdAt),
        points: sc.points,
        student: sc.student ?? 'Team',
        source: sc.source === 'ttp' ? 'ATT&CK' : 'Manual',
        note: sc.note ?? '',
        by: sc.awardedBy ?? '',
      });
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
