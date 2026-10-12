import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// Scoped WebSocket delivery (RBAC design review §4.5 / §6) with real socket.io clients: admin, iA
// (A,S1), iAB (A,S1)+(B,S2), a student of team A and one of team B. Every event is emitted for
// (A,S1), (A,S2) and (B,S2); each client must receive exactly what its scope allows.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cyber-range-sockets-')), 'test.db');

const { db } = await import('../dist/db/index.js');
const { seed, getActiveEventRunId } = await import('../dist/db/seed.js');
const { createApp } = await import('../dist/app.js');
const { Server: SocketServer } = await import('socket.io');
const { io: connect } = await import('socket.io-client');
const { setIo } = await import('../dist/sockets/io.js');
const { setupSockets, revalidateSockets } = await import('../dist/sockets/index.js');
const E = await import('../dist/sockets/emitters.js');
const { buildRbacFixture } = await import('./fixtures/rbac.mjs');
const { issueTokens } = await import('./fixtures/tokens.mjs');

let server;
let io;
let base;
let f;
let t;
const clients = {};
const NAMES = ['admin', 'iA', 'iAB', 'studentA', 'studentB'];

function connectAs(name) {
  return new Promise((resolve, reject) => {
    const socket = connect(base, { auth: { token: t[name] }, transports: ['websocket'], reconnection: false, forceNew: true });
    socket.received = [];
    socket.onAny((event, payload) => socket.received.push({ event, payload }));
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

const settle = () => new Promise((r) => setTimeout(r, 120));

// Runs `emit`, then returns which clients got `event`.
async function whoGets(event, emit) {
  for (const n of NAMES) if (clients[n]) clients[n].received = [];
  emit();
  await settle();
  return NAMES.filter((n) => clients[n]?.received.some((r) => r.event === event));
}

before(async () => {
  seed();
  f = buildRbacFixture(db, getActiveEventRunId());
  t = issueTokens(db, f);
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  io = new SocketServer(server);
  setIo(io);
  setupSockets(io);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const n of NAMES) clients[n] = await connectAs(n);
});

after(() => {
  for (const c of Object.values(clients)) c.close();
  io?.close();
  server?.closeAllConnections?.();
  server?.close();
});

// [event, emit(teamId, rangeId), audience] — audience 'team+staff' | 'staff' | 'team'.
const TEAM_EVENTS = [
  ['documentation:new', (team, range) => E.emitDocumentationNew(team, range, { id: 1 }), 'team+staff'],
  ['documentation:updated', (team, range) => E.emitDocumentationUpdated(team, range, { id: 1 }), 'team+staff'],
  ['documentation:feedback', (team, range) => E.emitDocumentationFeedback(team, { entryId: 1, cyberRangeId: range }), 'team'],
  ['help_request:new', (team, range) => E.emitHelpRequestNew(team, range, { id: 1 }), 'team+staff'],
  ['help_request:resolved', (team, range) => E.emitHelpRequestResolved(team, range, 1), 'team+staff'],
  ['clock:tick', (team, range) => E.emitClockTick(team, range, 1, 60), 'team+staff'],
  ['clock:pressure_stage', (team, range) => E.emitPressureStage(team, range, 1, 'x', 'amber'), 'team+staff'],
  ['clock:time_up', (team, range) => E.emitTimeUp(team, range, 1), 'team+staff'],
  ['score:awarded', (team, range) => E.emitScoreAwarded(team, range, { score: {}, isGamified: false, teamTotal: 0, studentTotal: null }), 'team+staff'],
  ['progress:changed', (team, range) => E.emitProgressChanged(team, { cyberRangeId: range, status: 'active' }), 'team+staff'],
  ['ttp:changed', (team, range) => E.emitTtpChanged(team, range), 'staff'],
  ['investigation_canvas:node_created', (team, range) => E.emitInvestigationCanvasNodeCreated(team, range, {}), 'team+staff'],
  ['investigation_canvas:node_updated', (team, range) => E.emitInvestigationCanvasNodeUpdated(team, range, {}), 'team+staff'],
  ['investigation_canvas:node_deleted', (team, range) => E.emitInvestigationCanvasNodeDeleted(team, range, 1), 'team+staff'],
  ['investigation_canvas:edge_created', (team, range) => E.emitInvestigationCanvasEdgeCreated(team, range, {}), 'team+staff'],
  ['investigation_canvas:edge_deleted', (team, range) => E.emitInvestigationCanvasEdgeDeleted(team, range, 1), 'team+staff'],
];

function expected(audience, staffInScope, teamStudent) {
  const out = [];
  if (audience !== 'team') out.push('admin', ...staffInScope);
  if (audience !== 'staff') out.push(teamStudent);
  return out.sort();
}

test('every team event reaches its team and exactly the staff whose pair covers it', async () => {
  for (const [event, emit, audience] of TEAM_EVENTS) {
    assert.deepEqual((await whoGets(event, () => emit(f.teamA, f.s1))).sort(), expected(audience, ['iA', 'iAB'], 'studentA'), `${event} A×S1`);
    // A × S2: iAB holds A and S2, but not the pair — the cross product must not leak.
    assert.deepEqual((await whoGets(event, () => emit(f.teamA, f.s2))).sort(), expected(audience, [], 'studentA'), `${event} A×S2`);
    assert.deepEqual((await whoGets(event, () => emit(f.teamB, f.s2))).sort(), expected(audience, ['iAB'], 'studentB'), `${event} B×S2`);
  }
});

test('team-level events use organization scope; certificate stays with the team', async () => {
  const scoreNoRange = () => E.emitScoreAwarded(f.teamB, null, { score: {}, isGamified: false, teamTotal: 0, studentTotal: null });
  assert.deepEqual((await whoGets('score:awarded', scoreNoRange)).sort(), ['admin', 'iAB', 'studentB']);
  assert.deepEqual(await whoGets('certificate:changed', () => E.emitCertificateChanged(f.teamA)), ['studentA']);
});

test('payload-free signals go to everyone; each client re-reads its own scoped view', async () => {
  assert.deepEqual((await whoGets('leaderboard:update', () => E.emitLeaderboardUpdate())).sort(), [...NAMES].sort());
  const lb = clients.studentA.received.find((r) => r.event === 'leaderboard:update');
  assert.deepEqual(lb.payload, {}); // no teams, no totals travel
  assert.deepEqual((await whoGets('topology:published', () => E.emitTopologyPublished(f.s1))).sort(), [...NAMES].sort());
});

test("a staff member's own Connect session reaches only its owner and the admins", async () => {
  const now = new Date().toISOString();
  const node = Number(
    db.prepare("INSERT INTO topology_nodes (cyber_range_id, external_key, label, node_type) VALUES (?, 'n1', 'n1', 'vm')").run(f.s1).lastInsertRowid,
  );
  const session = (teamId, userId) =>
    Number(
      db.prepare(
        "INSERT INTO access_sessions (team_id, user_id, cyber_range_id, topology_node_id, protocol, requested_at, expires_at, outcome) VALUES (?, ?, ?, ?, 'rdp', ?, ?, 'active')",
      ).run(teamId, userId, f.s1, node, now, now).lastInsertRowid,
    );
  const own = session(null, t.ids.iA);
  assert.deepEqual(
    (await whoGets('access_session:started', () => E.emitAccessSessionStarted({ id: own, topologyNodeId: node, protocol: 'rdp', expiresAt: now }))).sort(),
    ['admin', 'iA'],
  );
  const team = session(f.teamA, t.ids.studentA);
  assert.deepEqual((await whoGets('access_session:ended', () => E.emitAccessSessionEnded(team, 'completed'))).sort(), ['admin', 'iA', 'iAB', 'studentA']);
});

test('removing an assignment stops delivery on the very next event', async () => {
  const res = await fetch(`${base}/api/admin/accounts/${f.accounts.iAB}/assignments`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.admin}` },
    body: JSON.stringify({ pairs: [{ organizationId: f.orgA, cyberRangeId: f.s1 }] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await whoGets('documentation:new', () => E.emitDocumentationNew(f.teamB, f.s2, {}))).sort(), ['admin', 'studentB']);
  assert.ok(clients.iAB.connected); // no sign-out needed
});

test('logout, disabling the account and token expiry each cut the socket', async () => {
  const gone = (socket) => new Promise((resolve) => (socket.connected ? socket.once('disconnect', () => resolve(true)) : resolve(true)));

  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t.iA}` } });
  assert.equal(logout.status, 200);
  assert.equal(await gone(clients.iA), true);

  const disable = await fetch(`${base}/api/admin/accounts/${f.accounts.iAB}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.admin}` },
    body: JSON.stringify({ disabled: true }),
  });
  assert.equal(disable.status, 200);
  assert.equal(await gone(clients.iAB), true);

  db.prepare('UPDATE auth_tokens SET expires_at = ? WHERE token = ?').run('2000-01-01T00:00:00.000Z', t.studentB);
  revalidateSockets(io); // what the 15 s timer does
  assert.equal(await gone(clients.studentB), true);
  assert.ok(clients.admin.connected && clients.studentA.connected);
});

test('a client cannot join rooms itself — there are no inbound handlers', async () => {
  clients.studentA.emit('join', 'admin');
  clients.studentA.emit('join', `team:${f.teamB}`);
  await settle();
  assert.deepEqual(await whoGets('documentation:new', () => E.emitDocumentationNew(f.teamB, f.s2, {})), ['admin']);
});
