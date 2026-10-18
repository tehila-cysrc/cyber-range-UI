// Read-only facts about a SQLite database file, shared by backup.mjs and migration-check.mjs.
// Opens the file READ-ONLY; never writes.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export const REAL_DEV_DB = (repo) => resolve(repo, 'server', 'data', 'cyber-range.db');

// True when `path` is the real development database — compared after resolving links/junctions, and
// case-insensitively on Windows, so another spelling of the same file is refused too.
export function isRealDevDb(path, repo) {
  const norm = (p) => {
    let r = resolve(p);
    try {
      if (existsSync(r)) r = realpathSync.native(r);
    } catch {
      /* keep the resolved path */
    }
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(path) === norm(REAL_DEV_DB(repo));
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function dbStats(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);
    const rows = {};
    for (const t of tables) rows[t] = Number(db.prepare(`SELECT COUNT(*) AS c FROM "${t.replace(/"/g, '""')}"`).get().c);
    const has = (t) => tables.includes(t);
    const one = (sql) => {
      try {
        return db.prepare(sql).get();
      } catch {
        return null;
      }
    };
    return {
      file: path,
      sizeBytes: statSync(path).size,
      integrity: db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]).join('; '),
      foreignKeyViolations: db.prepare('PRAGMA foreign_key_check').all().length,
      tables,
      rows,
      scoresTotal: has('scores') ? Number(one('SELECT COALESCE(SUM(points), 0) AS s FROM scores')?.s ?? 0) : null,
      generation: {
        rbac: has('accounts') && has('instructor_assignments'),
        aiAssessment: has('scenario_ai_documents') && has('ai_assessments'),
        adminAccounts: has('accounts') ? Number(one("SELECT COUNT(*) AS c FROM accounts WHERE role = 'admin'")?.c ?? 0) : 0,
        activeEventRuns: has('event_runs') ? Number(one('SELECT COUNT(*) AS c FROM event_runs WHERE is_active = 1')?.c ?? 0) : 0,
      },
    };
  } finally {
    db.close();
  }
}
