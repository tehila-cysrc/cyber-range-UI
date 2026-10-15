import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// Route inventory (RBAC design review §6): every Express route must appear below with the permission
// it declares. A new route without a row — or a route whose guard changed — fails the build, so an
// endpoint can't ship without an authorization decision. Then every route is called over real HTTP
// with no token and with each role that lacks its permission: 401 / 403, never the handler.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-inventory-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { createApp } = await import('../dist/app.js');
const { can } = await import('../dist/authz/permissions.js');
const { listRoutes } = await import('./fixtures/routes.mjs');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');
const { issueTokens } = await import('./fixtures/tokens.mjs');

const PUBLIC = 'PUBLIC';
const EXPECTED = {
  'GET /api/health': PUBLIC,
  'POST /api/auth/login': PUBLIC,
  'GET /api/auth/registration': PUBLIC,
  'POST /api/auth/registration/teams': PUBLIC,
  'POST /api/auth/register': PUBLIC,
  'POST /api/auth/logout': 'profile.self',
  'GET /api/auth/me': 'profile.self',
  'PATCH /api/auth/me': 'profile.self',
  'PUT /api/auth/me/avatar': 'profile.self',
  'GET /api/event-reset-jobs/:jobId': PUBLIC,
  'GET /api/teams/me': 'team.self',
  'GET /api/teams/me/certificate': 'team.self',
  'GET /api/teams/me/active-cyber-range': 'team.self',
  'GET /api/teams/me/scores': 'team.self',
  'GET /api/teams/me/cyber-ranges/:cyberRangeId/ttp-summary': 'team.self',
  'GET /api/documentation-categories': 'documentation.read',
  'GET /api/cyber-ranges/:cyberRangeId/documentation': 'documentation.read',
  'POST /api/cyber-ranges/:cyberRangeId/documentation': 'documentation.write',
  'PUT /api/cyber-ranges/:cyberRangeId/documentation/:entryId/ttps': 'documentation.write',
  'POST /api/cyber-ranges/:cyberRangeId/documentation/:entryId/feedback': 'documentation.feedback',
  'DELETE /api/cyber-ranges/:cyberRangeId/documentation/:entryId/feedback/:feedbackId': 'documentation.feedback',
  'GET /api/cyber-ranges/:cyberRangeId/investigation-canvas': 'canvas.read',
  'POST /api/cyber-ranges/:cyberRangeId/investigation-canvas/nodes': 'canvas.write',
  'PATCH /api/cyber-ranges/:cyberRangeId/investigation-canvas/nodes/:nodeId': 'canvas.write',
  'DELETE /api/cyber-ranges/:cyberRangeId/investigation-canvas/nodes/:nodeId': 'canvas.write',
  'POST /api/cyber-ranges/:cyberRangeId/investigation-canvas/edges': 'canvas.write',
  'DELETE /api/cyber-ranges/:cyberRangeId/investigation-canvas/edges/:edgeId': 'canvas.write',
  'GET /api/cyber-ranges': 'scenario.read',
  'GET /api/cyber-ranges/:cyberRangeId/topology': 'scenario.read',
  'GET /api/help-requests/mine': 'help.request',
  'POST /api/help-requests': 'help.request',
  'GET /api/admin/teams': 'team.read',
  'GET /api/admin/registration': 'registration.manage',
  'PUT /api/admin/registration': 'registration.manage',
  'POST /api/admin/teams': 'team.manage',
  'PATCH /api/admin/teams/:id': 'team.manage',
  'DELETE /api/admin/teams/:id': 'team.manage',
  'GET /api/admin/organizations': 'org.read',
  'PUT /api/admin/organizations/:id/registration': 'registration.manage',
  'POST /api/admin/organizations': 'org.manage',
  'PATCH /api/admin/organizations/:id': 'org.manage',
  'DELETE /api/admin/organizations/:id': 'org.manage',
  'POST /api/admin/teams/:teamId/cyber-ranges/:cyberRangeId/start': 'progress.manage',
  'POST /api/admin/teams/:teamId/cyber-ranges/:cyberRangeId/complete': 'progress.manage',
  'GET /api/admin/cyber-ranges/:cyberRangeId/topology/publication': 'scenario.inspect',
  'POST /api/admin/cyber-ranges/:cyberRangeId/topology/publish': 'scenario.author',
  'POST /api/admin/cyber-ranges/:cyberRangeId/topology/nodes': 'scenario.author',
  'PATCH /api/admin/cyber-ranges/:cyberRangeId/topology/nodes/:nodeId': 'scenario.author',
  'DELETE /api/admin/cyber-ranges/:cyberRangeId/topology/nodes/:nodeId': 'scenario.author',
  'POST /api/admin/cyber-ranges/:cyberRangeId/topology/auto-layout': 'scenario.author',
  'PUT /api/admin/topology/nodes/:nodeId/access-target': 'environment.manage',
  'GET /api/admin/topology/nodes/:nodeId/access-target': 'scenario.inspect',
  'PATCH /api/admin/topology/nodes/:nodeId/access-target': 'scenario.author',
  'DELETE /api/admin/topology/nodes/:nodeId/access-target': 'environment.manage',
  'POST /api/admin/topology/nodes/:nodeId/connect': 'environment.operate',
  'POST /api/admin/topology/nodes/:nodeId/power': 'environment.operate',
  'GET /api/admin/topology/nodes/:nodeId/power': 'environment.operate',
  'POST /api/admin/topology/nodes/:nodeId/run-script': 'environment.operate',
  'GET /api/admin/topology/nodes/:nodeId/script-executions': 'environment.operate',
  'GET /api/admin/script-executions/:id': 'environment.operate',
  'POST /api/admin/cyber-ranges/:cyberRangeId/topology/edges': 'scenario.author',
  'DELETE /api/admin/cyber-ranges/:cyberRangeId/topology/edges/:edgeId': 'scenario.author',
  'POST /api/admin/cyber-ranges/:cyberRangeId/topology/zones': 'scenario.author',
  'PATCH /api/admin/cyber-ranges/:cyberRangeId/topology/zones/:zoneId': 'scenario.author',
  'DELETE /api/admin/cyber-ranges/:cyberRangeId/topology/zones/:zoneId': 'scenario.author',
  'GET /api/admin/help-requests': 'help.manage',
  'POST /api/admin/help-requests/:id/resolve': 'help.manage',
  'GET /api/admin/dashboard': 'dashboard.read',
  'GET /api/admin/cyber-ranges/:cyberRangeId/pressure-thresholds': 'scenario.inspect',
  'POST /api/admin/cyber-ranges/:cyberRangeId/pressure-thresholds': 'scenario.author',
  'DELETE /api/admin/pressure-thresholds/:id': 'scenario.author',
  'GET /api/admin/scores': 'score.read',
  'POST /api/admin/scores': 'score.award',
  'GET /api/leaderboard': 'leaderboard.read',
  'GET /api/history': 'history.read',
  'GET /api/history/event-summary': 'history.read',
  'GET /api/history/:cyberRangeId': 'history.read',
  'GET /api/admin/event/export': 'event.export',
  'POST /api/admin/event/reset': 'event.reset',
  'POST /api/admin/remote-access/revoke-all': 'remote_access.revoke_all',
  'POST /api/admin/users': 'student.manage',
  'PATCH /api/admin/users/:id': 'student.manage',
  'DELETE /api/admin/users/:id': 'student.manage',
  'GET /api/admin/accounts': 'account.manage',
  'POST /api/admin/accounts': 'account.manage',
  'PATCH /api/admin/accounts/:id': 'account.manage',
  'DELETE /api/admin/accounts/:id': 'account.manage',
  'GET /api/admin/accounts/:id/assignments': 'assignment.manage',
  'PUT /api/admin/accounts/:id/assignments': 'assignment.manage',
  'GET /api/admin/certificate-grants': 'student.manage',
  'PUT /api/admin/users/:userId/certificate-grant': 'student.manage',
  'DELETE /api/admin/users/:userId/certificate-grant': 'student.manage',
  'GET /api/admin/environments': 'environment.manage',
  'POST /api/admin/environments': 'environment.manage',
  'PATCH /api/admin/environments/:id': 'environment.manage',
  'DELETE /api/admin/environments/:id': 'environment.manage',
  'POST /api/admin/environments/:id/connectivity-check': 'environment.manage',
  'GET /api/admin/environments/:id/linked-cyber-ranges': 'environment.manage',
  'POST /api/admin/environments/:id/discover': 'environment.manage',
  'GET /api/admin/environments/:id/discovery-runs': 'environment.manage',
  'POST /api/admin/environments/:id/power': 'environment.manage',
  'GET /api/admin/environments/:id/power': 'environment.manage',
  'GET /api/admin/environments/:id/discovery-runs/:runId': 'environment.manage',
  'POST /api/admin/cyber-ranges/:cyberRangeId/environments': 'environment.manage',
  'DELETE /api/admin/cyber-ranges/:cyberRangeId/environments/:environmentId': 'environment.manage',
  'POST /api/teams/me/access-sessions': 'access_session.self',
  'GET /api/teams/me/access-sessions/active': 'access_session.self',
  'GET /api/teams/me/access-sessions/:id/credential': 'access_session.self',
  'POST /api/teams/me/access-sessions/:id/end': 'access_session.self',
  'GET /api/admin/access-sessions': 'access_session.manage',
  'GET /api/admin/access-sessions/mine': 'access_session.manage',
  'GET /api/admin/access-sessions/:id/credential': 'access_session.manage',
  'POST /api/admin/access-sessions/:id/force-close': 'access_session.manage',
  'GET /api/admin/audit-log': 'audit.read',
  'GET /api/admin/days': 'scenario.inspect',
  'POST /api/admin/cyber-ranges': 'scenario.create',
  'GET /api/admin/cyber-ranges/:id': 'scenario.inspect',
  'PATCH /api/admin/cyber-ranges/:id': 'scenario.author',
  'DELETE /api/admin/cyber-ranges/:id': 'scenario.delete',
  'GET /api/admin/scripts': 'script.read',
  'POST /api/admin/scripts': 'script.write',
  'GET /api/admin/scripts/:id': 'script.read',
  'PATCH /api/admin/scripts/:id': 'script.write',
  'DELETE /api/admin/scripts/:id': 'script.write',
  'GET /api/mitre/catalog': 'mitre.read',
  'GET /api/admin/cyber-ranges/:cyberRangeId/expected-ttps': 'scenario.inspect',
  'POST /api/admin/cyber-ranges/:cyberRangeId/expected-ttps': 'scenario.author',
  'PATCH /api/admin/expected-ttps/:id': 'scenario.author',
  'DELETE /api/admin/expected-ttps/:id': 'scenario.author',
  'POST /api/admin/expected-ttps/:id/occurrences': 'ttp.occurrence.mark',
  'DELETE /api/admin/ttp-occurrences/:id': 'ttp.occurrence.mark',
  'GET /api/admin/cyber-ranges/:cyberRangeId/ttp-report': 'ttp.manage',
  'POST /api/admin/ttp-detections': 'ttp.manage',
  'POST /api/admin/ttp-detections/:id/void': 'ttp.manage',
  'GET /api/admin/cyber-ranges/:cyberRangeId/ai-documents': 'scenario.inspect',
  'POST /api/admin/cyber-ranges/:cyberRangeId/ai-documents': 'scenario.author',
  'POST /api/admin/cyber-ranges/:cyberRangeId/ai-documents/:documentId/retry': 'scenario.author',
  'PUT /api/admin/cyber-ranges/:cyberRangeId/ai-rubric': 'scenario.author',
  'GET /api/admin/ai/foundry-resources': 'ai_resources.manage',
  'POST /api/admin/ai/foundry-resources/cleanup': 'ai_resources.manage',
};

let server;
let base;
let tokens;
let routes;

before(async () => {
  seed();
  const f = buildRbacFixture(db, getActiveEventRunId());
  tokens = issueTokens(db, f);
  const app = createApp();
  routes = listRoutes(app);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test('every route declares exactly the expected permission (no unlisted routes)', () => {
  const actual = Object.fromEntries(
    routes.map((r) => [`${r.method} ${r.path}`, r.permissions.length === 0 ? PUBLIC : r.permissions.join(',')]),
  );
  assert.deepEqual(actual, EXPECTED);
});

const sample = (path) => path.replace(/:[A-Za-z]+/g, '1');

async function call(method, path, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : '{}',
  });
  return res.status;
}

test('without a token every non-public route answers 401', async () => {
  const wrong = [];
  for (const r of routes) {
    if (EXPECTED[`${r.method} ${r.path}`] === PUBLIC) continue;
    const status = await call(r.method, sample(r.path));
    if (status !== 401) wrong.push(`${r.method} ${r.path} -> ${status}`);
  }
  assert.deepEqual(wrong, []);
});

test('each role is refused (403) on every route whose permission it lacks', async () => {
  const wrong = [];
  for (const [role, token] of [
    ['admin', tokens.admin],
    ['instructor', tokens.iA],
    ['student', tokens.studentA],
  ]) {
    for (const r of routes) {
      const permission = EXPECTED[`${r.method} ${r.path}`];
      if (permission === PUBLIC || can(role, permission)) continue;
      const status = await call(r.method, sample(r.path), token);
      if (status !== 403) wrong.push(`${role}: ${r.method} ${r.path} -> ${status}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('refusals are audited as authz.denied with role and IP — once a minute per actor and route', async () => {
  const rows = () =>
    db
      .prepare("SELECT outcome, client_ip AS ip, actor_role AS role FROM audit_log WHERE action = 'authz.denied' AND metadata_json LIKE '%/api/admin/event/reset%' AND actor_role = 'instructor'")
      .all();
  // The sweep above already refused this exact call once.
  const before = rows();
  assert.equal(before.length, 1);
  assert.equal(before[0].outcome, 'denied');
  assert.ok(before[0].ip);
  // Repeating it right away is still refused, but not written again (no audit flooding).
  assert.equal(await call('POST', '/api/admin/event/reset', tokens.iA), 403);
  assert.equal(await call('POST', '/api/admin/event/reset', tokens.iA), 403);
  assert.equal(rows().length, 1);
});
