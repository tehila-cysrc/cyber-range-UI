import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-leaderboard-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const orgs = await import('../dist/services/organizations.service.js');
const { leaderboardFor } = await import('../dist/services/scoring.service.js');

let alpha;
let bravo;
let acme;
const student = (teamId) => ({ role: 'student', teamId });
const names = (r) => r.teams.map((t) => t.teamId).sort();

before(() => {
  seed();
  alpha = db.prepare("SELECT id FROM teams WHERE name = 'Team Alpha'").get().id;
  bravo = db.prepare("SELECT id FROM teams WHERE name = 'Team Bravo'").get().id;
  acme = orgs.createOrganization('Acme').value.id;
});

test('instructor always sees every team, no switch needed', () => {
  const r = leaderboardFor({ role: 'instructor', teamId: null });
  assert.equal(r.enabled, true);
  assert.deepEqual(names(r), [alpha, bravo].sort());
});

test('student without an organization gets no board', () => {
  assert.deepEqual(leaderboardFor(student(alpha)), { enabled: false, teams: [] });
});

test('student alone in their organization gets no board', () => {
  orgs.setTeamOrganization(alpha, acme);
  assert.deepEqual(leaderboardFor(student(alpha)), { enabled: false, teams: [] });
});

test('student sees only their own organization', () => {
  orgs.setTeamOrganization(bravo, acme);
  const outsider = Number(
    db.prepare("INSERT INTO teams (event_run_id, name, sort_order) SELECT event_run_id, 'Team Charlie', 99 FROM teams WHERE id = ?").run(alpha).lastInsertRowid,
  );
  const globex = orgs.createOrganization('Globex').value.id;
  orgs.setTeamOrganization(outsider, globex);

  const r = leaderboardFor(student(alpha));
  assert.equal(r.enabled, true);
  assert.deepEqual(names(r), [alpha, bravo].sort());
  assert.deepEqual(leaderboardFor(student(outsider)), { enabled: false, teams: [] });
  assert.equal(leaderboardFor({ role: 'instructor', teamId: null }).teams.length, 3);
});
