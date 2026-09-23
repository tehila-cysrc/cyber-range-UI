import crypto from 'node:crypto';
import { db } from '../db/index.js';

// Student self-registration is instructor-controlled: closed by default, opened by the instructor with
// a random per-event join code that they hand out in the room. The code lives on the event_runs row
// (RUN-scoped), so an event reset always starts with registration closed again. Stored in plain text
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
