import { db } from '../db/index.js';

// Instructor feedback on a student's Timeline entry. Unscored (points go through `scores`); the team
// sees it under the entry. Any number per entry, newest last; an instructor can delete one.
export const FEEDBACK_VERDICTS = ['on_track', 'off_track', 'comment'] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];
export const MAX_FEEDBACK_BODY_LENGTH = 1000;

export interface EntryFeedback {
  id: number;
  verdict: FeedbackVerdict;
  body: string | null;
  authorName: string | null;
  createdAt: string;
}

const FEEDBACK_COLUMNS = `
  f.id AS id, f.documentation_entry_id AS entryId, f.verdict AS verdict, f.body AS body,
  u.display_name AS authorName, f.created_at AS createdAt`;

// Every entry's feedback for one team+range, keyed by entry id (one query, not one per entry).
export function feedbackByEntry(teamId: number, cyberRangeId: number): Map<number, EntryFeedback[]> {
  const rows = db
    .prepare(
      `SELECT ${FEEDBACK_COLUMNS}
       FROM documentation_feedback f
       JOIN documentation_entries e ON e.id = f.documentation_entry_id
       LEFT JOIN users u ON u.id = f.author_user_id
       WHERE f.team_id = ? AND e.cyber_range_id = ?
       ORDER BY f.created_at ASC, f.id ASC`,
    )
    .all(teamId, cyberRangeId) as unknown as (EntryFeedback & { entryId: number })[];
  const map = new Map<number, EntryFeedback[]>();
  for (const { entryId, ...feedback } of rows) map.set(entryId, [...(map.get(entryId) ?? []), feedback]);
  return map;
}

type Result = { ok: true; teamId: number; cyberRangeId: number } | { ok: false; status: number; error: string };

function entryScope(entryId: number, cyberRangeId: number): { teamId: number } | undefined {
  return db
    .prepare('SELECT team_id AS teamId FROM documentation_entries WHERE id = ? AND cyber_range_id = ?')
    .get(entryId, cyberRangeId) as { teamId: number } | undefined;
}

export function addFeedback(
  entryId: number,
  cyberRangeId: number,
  authorUserId: number,
  input: { verdict?: unknown; body?: unknown },
): Result & { feedbackId?: number } {
  const verdict = input.verdict ?? 'comment';
  if (typeof verdict !== 'string' || !(FEEDBACK_VERDICTS as readonly string[]).includes(verdict)) {
    return { ok: false, status: 400, error: `verdict must be one of: ${FEEDBACK_VERDICTS.join(', ')}` };
  }
  if (input.body != null && typeof input.body !== 'string') return { ok: false, status: 400, error: 'body must be text' };
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  // A bare "on/off track" mark is enough on its own; a plain comment needs words.
  if (verdict === 'comment' && !body) return { ok: false, status: 400, error: 'write a comment, or mark the entry on/off track' };
  if (body.length > MAX_FEEDBACK_BODY_LENGTH) {
    return { ok: false, status: 400, error: `feedback is limited to ${MAX_FEEDBACK_BODY_LENGTH} characters` };
  }
  const scope = entryScope(entryId, cyberRangeId);
  if (!scope) return { ok: false, status: 404, error: 'entry not found' };

  const result = db
    .prepare(
      `INSERT INTO documentation_feedback (documentation_entry_id, team_id, author_user_id, verdict, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(entryId, scope.teamId, authorUserId, verdict, body || null, new Date().toISOString());
  return { ok: true, teamId: scope.teamId, cyberRangeId, feedbackId: Number(result.lastInsertRowid) };
}

export function deleteFeedback(entryId: number, cyberRangeId: number, feedbackId: number): Result {
  const scope = entryScope(entryId, cyberRangeId);
  const deleted = scope
    ? db.prepare('DELETE FROM documentation_feedback WHERE id = ? AND documentation_entry_id = ?').run(feedbackId, entryId)
    : undefined;
  if (!scope || Number(deleted!.changes) === 0) return { ok: false, status: 404, error: 'feedback not found' };
  return { ok: true, teamId: scope.teamId, cyberRangeId };
}
