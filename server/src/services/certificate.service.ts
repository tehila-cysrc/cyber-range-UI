import { db } from '../db/index.js';
import { getActiveEventRunId } from '../db/seed.js';
import { certificateTemplateForScenario, type CertificateTemplate } from './certificateTemplates.service.js';

export type CertificateSource = 'completed' | 'granted';

export interface StudentCertificate {
  /** null = a grant made before certificates were per scenario (prints the default certificate). */
  cyberRangeId: number | null;
  scenarioName: string | null;
  source: CertificateSource;
  template: CertificateTemplate;
}

// A student gets one certificate per scenario their team completed, plus one per scenario an
// instructor granted them directly (the fallback when completion wasn't recorded). Each prints the
// scenario's certificate template (certificateTemplates.service.ts).
export function studentCertificates(userId: number, teamId: number): StudentCertificate[] {
  const rows = db
    .prepare(
      `SELECT p.cyber_range_id AS cyberRangeId, cr.name AS scenarioName, 'completed' AS source
         FROM team_cyber_range_progress p JOIN cyber_ranges cr ON cr.id = p.cyber_range_id
        WHERE p.team_id = ? AND p.status = 'completed'
       UNION ALL
       SELECT g.cyber_range_id, cr.name, 'granted'
         FROM certificate_grants g LEFT JOIN cyber_ranges cr ON cr.id = g.cyber_range_id
        WHERE g.user_id = ?`,
    )
    .all(teamId, userId) as Array<{ cyberRangeId: number | null; scenarioName: string | null; source: CertificateSource }>;

  // A scenario both completed and granted is listed once, as completed.
  const byScenario = new Map<number | null, (typeof rows)[number]>();
  for (const r of rows) if (!byScenario.has(r.cyberRangeId) || r.source === 'completed') byScenario.set(r.cyberRangeId, r);
  return [...byScenario.values()]
    .sort((a, b) => (a.scenarioName ?? '').localeCompare(b.scenarioName ?? ''))
    .map((r) => ({ ...r, template: certificateTemplateForScenario(r.cyberRangeId) }));
}

export function certificateStatus(userId: number, teamId: number): { eligible: boolean; certificates: StudentCertificate[] } {
  const certificates = studentCertificates(userId, teamId);
  return { eligible: certificates.length > 0, certificates };
}

export function listCertificateGrants(): Array<{ userId: number; cyberRangeId: number | null; grantedAt: string }> {
  return db
    .prepare(
      `SELECT g.user_id AS userId, g.cyber_range_id AS cyberRangeId, g.granted_at AS grantedAt FROM certificate_grants g
       JOIN users u ON u.id = g.user_id WHERE u.event_run_id = ?`,
    )
    .all(getActiveEventRunId()) as Array<{ userId: number; cyberRangeId: number | null; grantedAt: string }>;
}

// (team, scenario) pairs of the active run that were completed — those students already have that certificate.
export function listCompletedTeamScenarios(): Array<{ teamId: number; cyberRangeId: number }> {
  return db
    .prepare(
      `SELECT p.team_id AS teamId, p.cyber_range_id AS cyberRangeId FROM team_cyber_range_progress p
       JOIN teams t ON t.id = p.team_id WHERE p.status = 'completed' AND t.event_run_id = ?`,
    )
    .all(getActiveEventRunId()) as Array<{ teamId: number; cyberRangeId: number }>;
}

type StudentTarget = { ok: true; teamId: number; username: string; displayName: string } | { ok: false; status: 404; error: string };

export function findStudent(userId: number): StudentTarget {
  const row = db
    .prepare(
      `SELECT team_id AS teamId, username, display_name AS displayName FROM users
       WHERE id = ? AND role = 'student' AND event_run_id = ? AND deactivated_at IS NULL`,
    )
    .get(userId, getActiveEventRunId()) as { teamId: number | null; username: string; displayName: string } | undefined;
  if (!row || row.teamId === null) return { ok: false, status: 404, error: 'student not found' };
  return { ok: true, teamId: row.teamId, username: row.username, displayName: row.displayName };
}

export interface StudentCertificateOption {
  cyberRangeId: number | null;
  scenarioName: string | null;
  /** The team's progress status on the scenario; null for a legacy (scenario-less) grant. */
  status: string | null;
  earned: boolean;
  granted: boolean;
  template: CertificateTemplate;
}

// Roster → Students: every scenario the student's team was assigned, with whether its certificate is
// earned (completed) or granted — plus a legacy scenario-less grant if one exists. The caller filters
// scenarios to its scope.
export function studentCertificateOptions(userId: number, teamId: number): StudentCertificateOption[] {
  const scenarios = db
    .prepare(
      `SELECT p.cyber_range_id AS cyberRangeId, cr.name AS scenarioName, p.status AS status,
              EXISTS (SELECT 1 FROM certificate_grants g WHERE g.user_id = ? AND g.cyber_range_id = p.cyber_range_id) AS granted
       FROM team_cyber_range_progress p JOIN cyber_ranges cr ON cr.id = p.cyber_range_id
       WHERE p.team_id = ? ORDER BY cr.name`,
    )
    .all(userId, teamId) as Array<{ cyberRangeId: number; scenarioName: string; status: string; granted: number }>;
  const options: StudentCertificateOption[] = scenarios.map((s) => ({
    ...s,
    earned: s.status === 'completed',
    granted: s.granted === 1,
    template: certificateTemplateForScenario(s.cyberRangeId),
  }));
  if (db.prepare('SELECT 1 FROM certificate_grants WHERE user_id = ? AND cyber_range_id IS NULL').get(userId)) {
    options.push({ cyberRangeId: null, scenarioName: null, status: null, earned: false, granted: true, template: certificateTemplateForScenario(null) });
  }
  return options;
}

type GrantResult = { ok: true; teamId: number; username: string } | { ok: false; status: 404 | 409; error: string };

/** Idempotent: granting twice keeps the first grant. Only for a scenario the student's team was assigned. */
export function grantCertificate(userId: number, cyberRangeId: number, grantedByUserId: number): GrantResult {
  const target = findStudent(userId);
  if (!target.ok) return target;
  if (!db.prepare('SELECT 1 FROM team_cyber_range_progress WHERE team_id = ? AND cyber_range_id = ?').get(target.teamId, cyberRangeId)) {
    return { ok: false, status: 409, error: 'the student’s team was never assigned this scenario' };
  }
  db.prepare(
    'INSERT OR IGNORE INTO certificate_grants (user_id, cyber_range_id, granted_by_user_id, granted_at) VALUES (?, ?, ?, ?)',
  ).run(userId, cyberRangeId, grantedByUserId, new Date().toISOString());
  return { ok: true, teamId: target.teamId, username: target.username };
}

/** `cyberRangeId` null revokes a legacy scenario-less grant. */
export function revokeCertificate(userId: number, cyberRangeId: number | null): GrantResult {
  const target = findStudent(userId);
  if (!target.ok) return target;
  db.prepare('DELETE FROM certificate_grants WHERE user_id = ? AND cyber_range_id IS ?').run(userId, cyberRangeId);
  return { ok: true, teamId: target.teamId, username: target.username };
}
