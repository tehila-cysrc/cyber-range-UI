import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { emitDocumentationNew, emitDocumentationUpdated } from '../sockets/emitters.js';
import { OTHER_CATEGORY_SORT_ORDER } from '../db/seed.js';
import { activeCyberRangeIdForTeam, teamHasProgressOn } from '../services/cyberRangeProgress.service.js';
import { isValidTechniqueId } from '../services/mitreCatalog.js';
import { budgetFor, checkBudget, inTransaction, MAX_TTPS_PER_ENTRY, setEntryTtps, tagsByEntry } from '../services/ttpScoring.service.js';
import { reconcileAndAnnounce } from '../services/ttpAnnounce.js';

// Optional ATT&CK tags on an entry: a list of catalog technique ids and nothing else — correctness,
// points and timestamps are always decided server-side (ttpScoring.service.ts).
function parseTechniqueIds(raw: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'techniqueIds must be an array of ATT&CK technique ids' };
  const ids = [...new Set(raw)];
  if (ids.length > MAX_TTPS_PER_ENTRY) return { ok: false, error: `at most ${MAX_TTPS_PER_ENTRY} ATT&CK techniques per entry` };
  const invalid = ids.find((id) => !isValidTechniqueId(id));
  if (invalid !== undefined) return { ok: false, error: `unknown ATT&CK technique: ${String(invalid)}` };
  return { ok: true, ids: ids as string[] };
}

const ENTRY_COLUMNS = `
  e.id AS id,
  e.body AS body,
  e.image_data_url AS imageDataUrl,
  e.is_important_finding AS isImportantFinding,
  e.created_at AS createdAt,
  u.id AS authorUserId,
  u.display_name AS authorName,
  c.key AS categoryKey,
  c.label AS categoryLabel`;

const router = Router();

router.use(requireAuth);

router.get('/documentation-categories', (_req, res) => {
  const categories = db
    .prepare(
      'SELECT id, key, label FROM documentation_categories WHERE active = 1 ORDER BY sort_order',
    )
    .all();
  res.json({ categories });
});

function resolveTeamId(req: import('express').Request, res: import('express').Response): number | null {
  if (req.user!.role === 'instructor') {
    const teamId = Number(req.query.teamId);
    if (!teamId) {
      res.status(400).json({ error: 'instructor must pass ?teamId=' });
      return null;
    }
    return teamId;
  }
  if (!req.user!.teamId) {
    res.status(409).json({ error: 'user has no team assigned' });
    return null;
  }
  return req.user!.teamId;
}

router.get('/cyber-ranges/:cyberRangeId/documentation', (req, res) => {
  const teamId = resolveTeamId(req, res);
  if (teamId === null) return;

  const cyberRangeId = Number(req.params.cyberRangeId);
  // Same rule as student topology reads: only scenarios the team has actually been assigned (the
  // response carries the ATT&CK budget, which says something about a scenario's answer key).
  if (req.user!.role === 'student' && !teamHasProgressOn(teamId, cyberRangeId)) {
    res.status(403).json({ error: "your team hasn't been assigned this Cyber Range" });
    return;
  }
  const rows = db
    .prepare(
      `SELECT ${ENTRY_COLUMNS}
       FROM documentation_entries e
       JOIN users u ON u.id = e.author_user_id
       LEFT JOIN documentation_categories c ON c.id = e.category_id
       WHERE e.team_id = ? AND e.cyber_range_id = ?
       ORDER BY e.created_at ASC`,
    )
    .all(teamId, cyberRangeId) as { id: number }[];

  const tags = tagsByEntry(teamId, cyberRangeId);
  const entries = rows.map((row) => ({ ...row, ttps: tags.get(row.id) ?? [] }));
  // ttpBudget is the team's own technique budget (tiered, so it doesn't reveal the exact expected
  // count). Never the expected list or the points on offer — see CLAUDE/invariants.md.
  res.json({ entries, ttpBudget: budgetFor(teamId, cyberRangeId) });
});

function entryDTO(entryId: number, teamId: number, cyberRangeId: number) {
  const entry = db
    .prepare(
      `SELECT ${ENTRY_COLUMNS}
       FROM documentation_entries e
       JOIN users u ON u.id = e.author_user_id
       LEFT JOIN documentation_categories c ON c.id = e.category_id
       WHERE e.id = ?`,
    )
    .get(entryId) as Record<string, unknown>;
  return { ...entry, ttps: tagsByEntry(teamId, cyberRangeId).get(entryId) ?? [] };
}

// Free-text categories (e.g. a student typing "IOC" or something not in the seeded list) are
// find-or-created here rather than requiring an instructor to pre-configure every category —
// documentation_categories is CONFIG data, so it survives an event reset and benefits future runs.
const MAX_IMAGE_DATA_URL_LENGTH = 6_000_000; // ~4.5MB raw image, generous for a screenshot

function slugifyCategoryKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function findOrCreateCategoryId(label: string): number | null {
  const key = slugifyCategoryKey(label);
  if (!key) return null;

  const existing = db.prepare('SELECT id FROM documentation_categories WHERE key = ?').get(key) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;

  // Excludes 'other' from the max so a free-typed category always sorts before it, never after —
  // see OTHER_CATEGORY_SORT_ORDER's comment in db/seed.ts.
  const nextSort = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM documentation_categories WHERE key != 'other'")
    .get() as { n: number };
  const clampedSort = Math.min(nextSort.n, OTHER_CATEGORY_SORT_ORDER - 1);

  const result = db
    .prepare('INSERT INTO documentation_categories (key, label, sort_order, active) VALUES (?, ?, ?, 1)')
    .run(key, label.trim(), clampedSort);

  return Number(result.lastInsertRowid);
}

router.post('/cyber-ranges/:cyberRangeId/documentation', (req, res) => {
  // Students only document their own team's investigation; instructors don't author entries.
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.status(403).json({ error: 'only a student on a team can add documentation' });
    return;
  }

  const { body, categoryId, newCategoryLabel, isImportantFinding, imageDataUrl, techniqueIds } = req.body ?? {};
  if (typeof body !== 'string' || body.trim().length === 0) {
    res.status(400).json({ error: 'body is required' });
    return;
  }
  const parsedTtps = parseTechniqueIds(techniqueIds);
  if (!parsedTtps.ok) {
    res.status(400).json({ error: parsedTtps.error });
    return;
  }

  if (imageDataUrl != null) {
    if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
      res.status(400).json({ error: 'imageDataUrl must be a data:image/... URL' });
      return;
    }
    if (imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      res.status(400).json({ error: 'image is too large' });
      return;
    }
  }

  const cyberRangeId = Number(req.params.cyberRangeId);
  if (activeCyberRangeIdForTeam(req.user!.teamId) !== cyberRangeId) {
    res.status(409).json({ error: "this isn't your team's active Cyber Range — refresh the page" });
    return;
  }
  // Checked before anything is written, so a refused tag never leaves a half-saved entry behind.
  const budgetError = checkBudget(req.user!.teamId, cyberRangeId, parsedTtps.ids);
  if (budgetError) {
    res.status(409).json({ error: budgetError });
    return;
  }

  let resolvedCategoryId: number | null = categoryId ?? null;
  if (typeof newCategoryLabel === 'string' && newCategoryLabel.trim().length > 0) {
    resolvedCategoryId = findOrCreateCategoryId(newCategoryLabel);
  } else if (resolvedCategoryId != null) {
    const exists = db
      .prepare('SELECT 1 FROM documentation_categories WHERE id = ? AND active = 1')
      .get(Number(resolvedCategoryId));
    if (!exists) {
      res.status(400).json({ error: 'unknown category' });
      return;
    }
  }

  const createdAt = new Date().toISOString();
  const teamId = req.user!.teamId;
  // Entry + its tags are one atomic write: a tag refusal never leaves an untagged entry behind.
  const entryId = inTransaction(() => {
    const result = db
      .prepare(
        `INSERT INTO documentation_entries
           (team_id, cyber_range_id, author_user_id, category_id, body, image_data_url, is_important_finding, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(teamId, cyberRangeId, req.user!.id, resolvedCategoryId, body.trim(), imageDataUrl ?? null, isImportantFinding ? 1 : 0, createdAt);
    const id = Number(result.lastInsertRowid);
    if (parsedTtps.ids.length > 0) {
      const tagged = setEntryTtps(id, teamId, cyberRangeId, req.user!.id, parsedTtps.ids);
      if (!tagged.ok) throw new Error(tagged.error); // budget was pre-checked; rolls back if it still fails
    }
    return id;
  });
  if (parsedTtps.ids.length > 0) reconcileAndAnnounce(teamId, cyberRangeId);

  const entry = entryDTO(entryId, teamId, cyberRangeId);
  emitDocumentationNew(teamId, entry);

  res.status(201).json({ entry });
});

// Add/change/remove an entry's ATT&CK tags. Entries themselves stay append-only; only the optional
// tag association is editable. Any teammate may tag any of the team's entries, but only while the
// scenario is the team's active one (same write gate as creating entries).
router.put('/cyber-ranges/:cyberRangeId/documentation/:entryId/ttps', (req, res) => {
  if (req.user!.role !== 'student' || !req.user!.teamId) {
    res.status(403).json({ error: 'only a student on a team can tag documentation' });
    return;
  }
  const teamId = req.user!.teamId;
  const cyberRangeId = Number(req.params.cyberRangeId);
  const entryId = Number(req.params.entryId);

  const parsed = parseTechniqueIds(req.body?.techniqueIds);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  if (activeCyberRangeIdForTeam(teamId) !== cyberRangeId) {
    res.status(409).json({ error: "this isn't your team's active Cyber Range — refresh the page" });
    return;
  }
  if (!db.prepare('SELECT 1 FROM documentation_entries WHERE id = ? AND team_id = ? AND cyber_range_id = ?').get(entryId, teamId, cyberRangeId)) {
    res.status(404).json({ error: 'entry not found' });
    return;
  }

  const result = setEntryTtps(entryId, teamId, cyberRangeId, req.user!.id, parsed.ids);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  if (result.changed) reconcileAndAnnounce(teamId, cyberRangeId);

  const entry = entryDTO(entryId, teamId, cyberRangeId);
  if (result.changed) emitDocumentationUpdated(teamId, entry);
  res.json({ entry, ttpBudget: budgetFor(teamId, cyberRangeId) });
});

export default router;
