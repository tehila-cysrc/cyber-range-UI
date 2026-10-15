// "AI Assessment" worksheet of the team results workbook (plan §E "Excel export", decision 6).
// Appended LAST by buildEventExportXlsx; read-only; existing sheets, the CSV and the JSON archive are
// untouched. One row per (team, scenario session) in the export's scope with the most recent APPROVED
// (approved / edited) final assessment, or "No approved AI assessment". The AI score is reference only —
// it is never part of any team or leaderboard total. Instructor-only analysis is not exported.
import type ExcelJS from 'exceljs';
import { db } from '../../db/index.js';
import { getActiveEventRunId } from '../../db/seed.js';

export const AI_SHEET_NAME = 'AI Assessment';
export const AI_SHEET_NOTE = 'AI-assisted assessment scores are recorded for reference only and are not included in team or leaderboard totals.';

const COLUMNS: { header: string; key: string; width: number; wrap?: boolean }[] = [
  { header: 'Team', key: 'team', width: 16 },
  { header: 'Organization', key: 'org', width: 18 },
  { header: 'Scenario', key: 'scenario', width: 22 },
  { header: 'Status', key: 'status', width: 24 },
  { header: 'Approved final score', key: 'approved', width: 20 },
  { header: 'AI recommended score', key: 'recommended', width: 21 },
  { header: 'Max score', key: 'max', width: 10 },
  { header: 'Ground-truth version', key: 'version', width: 19 },
  { header: 'Overall level', key: 'level', width: 13 },
  { header: 'Investigation summary', key: 'summary', width: 60, wrap: true },
  { header: 'Strengths', key: 'strengths', width: 40, wrap: true },
  { header: 'Areas for improvement', key: 'improve', width: 40, wrap: true },
  { header: 'Student-safe final feedback', key: 'feedback', width: 50, wrap: true },
  { header: 'Instructor decision note', key: 'note', width: 40, wrap: true },
  { header: 'Decided by', key: 'decidedBy', width: 16 },
  { header: 'Decided at (UTC)', key: 'decidedAt', width: 20 },
  { header: 'Assessment ID', key: 'id', width: 14 },
  { header: 'Agent version', key: 'agent', width: 14 },
  { header: 'Model', key: 'model', width: 16 },
];

// Same format as the other sheets: "2026-10-06 14:37:39" (header says UTC).
const utc = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 19) : '');

interface SessionRow {
  teamId: number;
  team: string;
  org: string | null;
  cyberRangeId: number;
  scenario: string;
}

interface ApprovedRow {
  id: number;
  decision: 'approved' | 'edited';
  decidedScore: number | null;
  documentVersion: number;
  resultJson: string;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  agentVersion: string | null;
  model: string | null;
}

interface FinalResult {
  investigationSummary?: string;
  overallAssessment?: { level?: string };
  strengths?: string[];
  areasForImprovement?: string[];
  score?: { recommendedTotal?: number; maxTotal?: number };
  suggestedFinalFeedback?: { studentSafeVersion?: string };
}

export function addAiAssessmentSheet(workbook: ExcelJS.Workbook, teamId?: number) {
  const sheet = workbook.addWorksheet(AI_SHEET_NAME, { views: [{ state: 'frozen', ySplit: 2 }] });
  // No `header` on the columns: row 1 is the note, row 2 the header.
  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width, style: { alignment: { vertical: 'top', wrapText: !!c.wrap } } }));
  const note = sheet.addRow([AI_SHEET_NOTE]);
  note.font = { italic: true, color: { argb: 'FF555555' } };
  sheet.mergeCells(1, 1, 1, COLUMNS.length);
  const header = sheet.addRow(COLUMNS.map((c) => c.header));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A33' } };
  header.alignment = { vertical: 'middle' };
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: COLUMNS.length } };

  // Same scope and order as the rest of the workbook: the active run's teams (or one), sessions by start.
  const sessions = db
    .prepare(
      `SELECT t.id AS teamId, t.name AS team, o.name AS org, p.cyber_range_id AS cyberRangeId, cr.name AS scenario
       FROM teams t
       LEFT JOIN organizations o ON o.id = t.organization_id
       JOIN team_cyber_range_progress p ON p.team_id = t.id
       JOIN cyber_ranges cr ON cr.id = p.cyber_range_id
       WHERE t.event_run_id = ? AND (? IS NULL OR t.id = ?)
       ORDER BY t.sort_order, t.name, p.started_at`,
    )
    .all(getActiveEventRunId(), teamId ?? null, teamId ?? null) as unknown as SessionRow[];

  const approvedStmt = db.prepare(
    `SELECT id, decision, decided_score AS decidedScore, document_version AS documentVersion, result_json AS resultJson,
            decision_note AS decisionNote, decided_by_username AS decidedBy, decided_at AS decidedAt,
            agent_version AS agentVersion, model
     FROM ai_assessments
     WHERE team_id = ? AND cyber_range_id = ? AND mode = 'final' AND status = 'succeeded'
       AND decision IN ('approved', 'edited') AND result_json IS NOT NULL
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  );

  for (const s of sessions) {
    const base = { team: s.team, org: s.org ?? '', scenario: s.scenario };
    const a = approvedStmt.get(s.teamId, s.cyberRangeId) as unknown as ApprovedRow | undefined;
    if (!a) {
      sheet.addRow({ ...base, status: 'No approved AI assessment' });
      continue;
    }
    let r: FinalResult = {};
    try {
      r = (JSON.parse(a.resultJson) as { result?: FinalResult }).result ?? {};
    } catch {
      /* stored by us; leave the analysis cells empty */
    }
    sheet.addRow({
      ...base,
      status: a.decision === 'edited' ? 'Approved (edited score)' : 'Approved',
      approved: a.decidedScore,
      recommended: r.score?.recommendedTotal ?? '',
      max: r.score?.maxTotal ?? 100,
      version: a.documentVersion,
      level: r.overallAssessment?.level ?? '',
      summary: r.investigationSummary ?? '',
      strengths: (r.strengths ?? []).map((x) => `• ${x}`).join('\n'),
      improve: (r.areasForImprovement ?? []).map((x) => `• ${x}`).join('\n'),
      feedback: r.suggestedFinalFeedback?.studentSafeVersion ?? '',
      note: a.decisionNote ?? '',
      decidedBy: a.decidedBy ?? '',
      decidedAt: utc(a.decidedAt),
      id: a.id,
      agent: a.agentVersion ?? '',
      model: a.model ?? '',
    });
  }
  return sheet;
}
