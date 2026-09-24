import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'topology-publication-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const pub = await import('../dist/services/topologyPublication.service.js');

let rangeId;

function addNode(label, visible = 1) {
  return Number(
    db
      .prepare(
        `INSERT INTO topology_nodes (cyber_range_id, external_key, label, node_type, pos_x, pos_y, is_visible_to_students)
         VALUES (?, ?, ?, 'host', 0, 0, ?)`,
      )
      .run(rangeId, `manual:${label}`, label, visible).lastInsertRowid,
  );
}

before(() => {
  seed();
  const dayId = db.prepare("SELECT id FROM days WHERE key = 'azure'").get().id;
  rangeId = Number(
    db.prepare("INSERT INTO cyber_ranges (day_id, name, difficulty, sort_order) VALUES (?, 'Pub Range', 'intermediate', 1)").run(dayId).lastInsertRowid,
  );
});

test('a fresh seed creates no sample scenarios', () => {
  const names = db.prepare("SELECT name FROM cyber_ranges WHERE name != 'Pub Range'").all();
  assert.deepEqual(names, []);
});

test('students see nothing until the instructor publishes', () => {
  addNode('WS01');
  assert.equal(pub.getPublishedTopology(rangeId), null);
  assert.equal(pub.publicationStatus(rangeId).published, false);
});

test('publishing freezes the student view; later draft edits stay hidden until the next publish', () => {
  const ws = db.prepare("SELECT id FROM topology_nodes WHERE label = 'WS01'").get().id;
  pub.publishTopology(rangeId, 'instructor');
  assert.deepEqual(pub.getPublishedTopology(rangeId).nodes.map((n) => n.label), ['WS01']);
  assert.equal(pub.isNodePublished(rangeId, ws), true);

  const dc = addNode('DC01');
  db.prepare("UPDATE topology_nodes SET label = 'WS01-renamed' WHERE id = ?").run(ws);
  assert.deepEqual(pub.getPublishedTopology(rangeId).nodes.map((n) => n.label), ['WS01']);
  assert.equal(pub.isNodePublished(rangeId, dc), false);
  assert.equal(pub.publicationStatus(rangeId).hasUnpublishedChanges, true);

  pub.publishTopology(rangeId, 'instructor');
  assert.deepEqual(pub.getPublishedTopology(rangeId).nodes.map((n) => n.label).sort(), ['DC01', 'WS01-renamed']);
  assert.equal(pub.publicationStatus(rangeId).hasUnpublishedChanges, false);
});

test('hidden nodes are never published, and status is overlaid live', () => {
  const secret = addNode('KALI', 0);
  pub.publishTopology(rangeId, 'instructor');
  assert.equal(pub.isNodePublished(rangeId, secret), false);
  assert.ok(!pub.getPublishedTopology(rangeId).nodes.some((n) => n.label === 'KALI'));

  const dc = db.prepare("SELECT id FROM topology_nodes WHERE label = 'DC01'").get().id;
  db.prepare("UPDATE topology_nodes SET status = 'running' WHERE id = ?").run(dc);
  assert.equal(pub.getPublishedTopology(rangeId).nodes.find((n) => n.id === dc).status, 'running');
});
