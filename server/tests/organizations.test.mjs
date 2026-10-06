import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';

// Throwaway DB — db/index.js opens DB_PATH at import time.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-orgs-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed } = await import('../dist/db/seed.js');
const orgs = await import('../dist/services/organizations.service.js');

let alpha;
let bravo;
const teamOrg = (id) => db.prepare('SELECT organization_id AS o FROM teams WHERE id = ?').get(id).o;

before(() => {
  seed();
  alpha = db.prepare("SELECT id FROM teams WHERE name = 'Team Alpha'").get().id;
  bravo = db.prepare("SELECT id FROM teams WHERE name = 'Team Bravo'").get().id;
});

test('create validates the name and rejects case-insensitive duplicates', () => {
  assert.equal(orgs.createOrganization('  ').status, 400);
  const r = orgs.createOrganization(' Acme ');
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'Acme');
  assert.equal(orgs.createOrganization('ACME').status, 409);
});

test('rename checks existence and uniqueness', () => {
  const globex = orgs.createOrganization('Globex').value;
  assert.equal(orgs.renameOrganization(99999, 'X').status, 404);
  assert.equal(orgs.renameOrganization(globex.id, 'acme').status, 409);
  assert.equal(orgs.renameOrganization(globex.id, 'Globex Corp').ok, true);
  assert.equal(orgs.renameOrganization(globex.id, 'globex corp').ok, true); // own name, new casing
});

test('teams can be assigned, counted and cleared', () => {
  const acme = orgs.listOrganizations().find((o) => o.name === 'Acme');
  assert.equal(orgs.setTeamOrganization(alpha, 99999).status, 400);
  assert.equal(orgs.setTeamOrganization(99999, acme.id).status, 404);
  assert.equal(orgs.setTeamOrganization(alpha, acme.id).ok, true);
  assert.equal(orgs.setTeamOrganization(bravo, String(acme.id)).ok, true);
  assert.equal(orgs.listOrganizations().find((o) => o.id === acme.id).teamCount, 2);
  assert.equal(orgs.setTeamOrganization(bravo, null).ok, true);
  assert.equal(teamOrg(bravo), null);
});

test('deleting an organization un-assigns its teams without deleting them', () => {
  const acme = orgs.listOrganizations().find((o) => o.name === 'Acme');
  const r = orgs.deleteOrganization(acme.id);
  assert.deepEqual(r, { ok: true, value: { unassignedTeams: 1 } });
  assert.equal(teamOrg(alpha), null);
  assert.ok(db.prepare('SELECT 1 FROM teams WHERE id = ?').get(alpha));
  assert.equal(orgs.deleteOrganization(acme.id).status, 404);
});
