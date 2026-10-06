import crypto from 'node:crypto';
import { db } from '../db/index.js';

// Student self-registration is instructor-controlled: closed by default, opened by the instructor with
// a random per-event join code that they hand out in the room. The code lives on the event_runs row
// (RUN-scoped), so an event reset always starts with registration closed again. Each organization can
// also get its own code (organization_registrations), which only unlocks that organization's teams. Stored in plain text
// like the rest of this tool's training-grade secrets (see CLAUDE/invariants.md) — it's a short-lived
// door key, not a credential.

// No 0/O/1/I/L so a code read off a projector can't be mistyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateJoinCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizeJoinCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\s-]/g, '').toUpperCase() : '';
}

export function getActiveRunRegistration(): { runId: number; code: string | null } | null {
  const row = db.prepare('SELECT id, registration_code AS code FROM event_runs WHERE is_active = 1').get() as
    | { id: number; code: string | null }
    | undefined;
  return row ? { runId: row.id, code: row.code } : null;
}

export function setRegistrationCode(runId: number, code: string | null) {
  db.prepare('UPDATE event_runs SET registration_code = ? WHERE id = ?').run(code, runId);
}

// All codes live for the run — the general one plus one per organization — so a fresh code never
// collides with another open one (vanishingly rare at 31^8, but a collision would be ambiguous).
function codeInUse(runId: number, code: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM event_runs WHERE id = ? AND registration_code = ?
       UNION ALL SELECT 1 FROM organization_registrations WHERE event_run_id = ? AND code = ?`,
    )
    .get(runId, code, runId, code);
}

export function generateUniqueJoinCode(runId: number): string {
  let code = generateJoinCode();
  while (codeInUse(runId, code)) code = generateJoinCode();
  return code;
}

export function getOrganizationCodes(runId: number): Map<number, string> {
  const rows = db
    .prepare('SELECT organization_id AS orgId, code FROM organization_registrations WHERE event_run_id = ?')
    .all(runId) as { orgId: number; code: string }[];
  return new Map(rows.map((r) => [r.orgId, r.code]));
}

export function setOrganizationCode(runId: number, organizationId: number, code: string | null) {
  if (code) {
    db.prepare(
      `INSERT INTO organization_registrations (event_run_id, organization_id, code) VALUES (?, ?, ?)
       ON CONFLICT (event_run_id, organization_id) DO UPDATE SET code = excluded.code`,
    ).run(runId, organizationId, code);
  } else {
    db.prepare('DELETE FROM organization_registrations WHERE event_run_id = ? AND organization_id = ?').run(
      runId,
      organizationId,
    );
  }
}

// Registration is open while the general code or any organization's code is set.
export function isRegistrationOpen(): boolean {
  const reg = getActiveRunRegistration();
  if (!reg) return false;
  return !!reg.code || getOrganizationCodes(reg.runId).size > 0;
}

// What a join code unlocks: the general code -> teams with no organization; an organization's code ->
// only that organization's teams. null = no match. Every candidate is compared (constant-time each).
export type JoinScope = { organizationId: number | null; organizationName: string | null };

export function resolveJoinCode(runId: number, generalCode: string | null, provided: string): JoinScope | null {
  let match: JoinScope | null = null;
  if (joinCodeMatches(generalCode, provided)) match = { organizationId: null, organizationName: null };
  const rows = db
    .prepare(
      `SELECT r.organization_id AS orgId, r.code, o.name FROM organization_registrations r
       JOIN organizations o ON o.id = r.organization_id WHERE r.event_run_id = ?`,
    )
    .all(runId) as { orgId: number; code: string; name: string }[];
  for (const r of rows) {
    if (joinCodeMatches(r.code, provided)) match = { organizationId: r.orgId, organizationName: r.name };
  }
  return match;
}

export function teamsForScope(runId: number, scope: JoinScope): { id: number; name: string }[] {
  return db
    .prepare(
      `SELECT id, name FROM teams WHERE event_run_id = ? AND organization_id IS ? ORDER BY sort_order`,
    )
    .all(runId, scope.organizationId) as { id: number; name: string }[];
}

// Constant-time compare, so response timing doesn't leak how much of a guess was right.
export function joinCodeMatches(expected: string | null, provided: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Simple in-memory limiter for failed code attempts, per client IP: a guessable-by-brute-force door
// is only a door if guessing is slow. 10 failures per 10 minutes, then 429 until the window passes.
const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; windowStart: number }>();

export function isRateLimited(ip: string): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.windowStart > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

export function recordFailure(ip: string) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.windowStart > WINDOW_MS) {
    failures.set(ip, { count: 1, windowStart: Date.now() });
  } else {
    f.count++;
  }
}
