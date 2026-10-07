import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-feedback-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const { insertCyberRange } = await import('../dist/services/cyberRangeCatalog.service.js');
const { addFeedback, deleteFeedback, feedbackByEntry } = await import('../dist/services/documentationFeedback.service.js');

let rangeId, teamId, instructorId, entryId;

before(() => {
  seed();
  const dayId = db.prepare("SELECT id FROM days WHERE key = 'azure'").get().id;
  rangeId = insertCyberRange({ dayId, name: 'feedback', difficulty: 'intermediate' });
  const alice = db.prepare("SELECT id, team_id AS teamId FROM users WHERE username = 'alice'").get();
  teamId = alice.teamId;
  instructorId = db.prepare("SELECT id FROM users WHERE username = 'instructor'").get().id;
  entryId = Number(
    db
      .prepare('INSERT INTO documentation_entries (team_id, cyber_range_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(teamId, rangeId, alice.id, 'saw a login', new Date().toISOString()).lastInsertRowid,
  );
});

test('an off-track mark needs no text and is listed under its entry', () => {
  const result = addFeedback(entryId, rangeId, instructorId, { verdict: 'off_track' });
  assert.equal(result.ok, true);
  assert.equal(result.teamId, teamId);
  const [fb] = feedbackByEntry(teamId, rangeId).get(entryId);
  assert.equal(fb.verdict, 'off_track');
  assert.equal(fb.body, null);
  assert.equal(fb.authorName, db.prepare('SELECT display_name AS n FROM users WHERE id = ?').get(instructorId).n);
});

test('a plain comment needs text; unknown verdicts and long text are refused', () => {
  assert.equal(addFeedback(entryId, rangeId, instructorId, { verdict: 'comment', body: '  ' }).status, 400);
  assert.equal(addFeedback(entryId, rangeId, instructorId, { verdict: 'great' }).status, 400);
  assert.equal(addFeedback(entryId, rangeId, instructorId, { verdict: 'comment', body: 'x'.repeat(1001) }).status, 400);
  assert.equal(addFeedback(entryId, rangeId, instructorId, { body: 'check the source IP' }).ok, true);
});

test('feedback is scoped to the entry\'s own scenario', () => {
  assert.equal(addFeedback(entryId, rangeId + 999, instructorId, { verdict: 'on_track' }).status, 404);
  const [first] = feedbackByEntry(teamId, rangeId).get(entryId);
  assert.equal(deleteFeedback(entryId, rangeId + 999, first.id).status, 404);
  assert.equal(deleteFeedback(entryId, rangeId, first.id).ok, true);
  assert.equal(deleteFeedback(entryId, rangeId, first.id).status, 404);
  assert.equal(feedbackByEntry(teamId, rangeId).get(entryId).length, 1);
});

test('deleting the team removes its feedback', () => {
  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documentation_feedback').get().n, 0);
});
