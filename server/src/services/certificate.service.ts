import { db } from '../db/index.js';
import { getActiveEventRunId } from '../db/seed.js';

export type CertificateSource = 'completed' | 'granted';

// A student may download the completion certificate once their team has completed any scenario, or
// when an instructor granted it to them directly (the fallback when completion wasn't recorded).
export function certificateStatus(userId: number, teamId: number): { eligible: boolean; source: CertificateSource | null } {
  const completed = db
    .prepare("SELECT 1 FROM team_cyber_range_progress WHERE team_id = ? AND status = 'completed' LIMIT 1")
    .get(teamId);
  if (completed) return { eligible: true, source: 'completed' };
  const granted = db.prepare('SELECT 1 FROM certificate_grants WHERE user_id = ?').get(userId);
  if (granted) return { eligible: true, source: 'granted' };
  return { eligible: false, source: null };
}

export function listCertificateGrants(): Array<{ userId: number; grantedAt: string }> {
  return db
    .prepare(
      `SELECT g.user_id AS userId, g.granted_at AS grantedAt FROM certificate_grants g
       JOIN users u ON u.id = g.user_id WHERE u.event_run_id = ?`,
    )
    .all(getActiveEventRunId()) as Array<{ userId: number; grantedAt: string }>;
}

// Teams of the active run with a completed scenario — their students already have the certificate.
export function listCompletedTeamIds(): number[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT p.team_id AS teamId FROM team_cyber_range_progress p
         JOIN teams t ON t.id = p.team_id WHERE p.status = 'completed' AND t.event_run_id = ?`,
      )
      .all(getActiveEventRunId()) as Array<{ teamId: number }>
  ).map((r) => r.teamId);
}

type GrantTarget = { ok: true; teamId: number; username: string } | { ok: false; status: 404; error: string };

function findStudent(userId: number): GrantTarget {
  const row = db
    .prepare("SELECT team_id AS teamId, username FROM users WHERE id = ? AND role = 'student' AND event_run_id = ?")
    .get(userId, getActiveEventRunId()) as { teamId: number | null; username: string } | undefined;
  if (!row || row.teamId === null) return { ok: false, status: 404, error: 'student not found' };
  return { ok: true, teamId: row.teamId, username: row.username };
}

/** Idempotent: granting twice keeps the first grant. */
export function grantCertificate(userId: number, grantedByUserId: number): GrantTarget {
  const target = findStudent(userId);
  if (!target.ok) return target;
  db.prepare('INSERT OR IGNORE INTO certificate_grants (user_id, granted_by_user_id, granted_at) VALUES (?, ?, ?)').run(
    userId,
    grantedByUserId,
    new Date().toISOString(),
  );
  return target;
}

export function revokeCertificate(userId: number): GrantTarget {
  const target = findStudent(userId);
  if (!target.ok) return target;
  db.prepare('DELETE FROM certificate_grants WHERE user_id = ?').run(userId);
  return target;
}
