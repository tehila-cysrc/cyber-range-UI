// Shared RBAC fixture (RBAC design review §6): one admin; organizations A and B; scenarios S1 and S2;
// instructor iA on (A,S1); instructor iAB on (A,S1) and (B,S2); a team in each organization plus one
// without an organization. iAB must never see A's work on S2 — the cross-product leak.
export function buildRbacFixture(db, runId) {
  const now = '2026-01-01T00:00:00.000Z';
  const org = (name) => Number(db.prepare('INSERT INTO organizations (name, created_at) VALUES (?, ?)').run(name, now).lastInsertRowid);
  const orgA = org('Org A');
  const orgB = org('Org B');

  const day = db.prepare('SELECT id FROM days LIMIT 1').get().id;
  const range = (name) =>
    Number(
      db.prepare("INSERT INTO cyber_ranges (day_id, name, difficulty, sort_order) VALUES (?, ?, 'intermediate', 50)").run(day, name)
        .lastInsertRowid,
    );
  const s1 = range('S1');
  const s2 = range('S2');

  const team = (name, orgId) =>
    Number(
      db.prepare('INSERT INTO teams (event_run_id, name, sort_order, organization_id) VALUES (?, ?, 90, ?)').run(runId, name, orgId)
        .lastInsertRowid,
    );
  const teamA = team('Team A', orgA);
  const teamB = team('Team B', orgB);
  const teamNoOrg = team('Team NoOrg', null);

  const instructorAccount = (username) =>
    Number(
      db.prepare(
        "INSERT INTO accounts (username, password, role, display_name, created_at) VALUES (?, 'pass12345', 'instructor', ?, ?)",
      ).run(username, username, now).lastInsertRowid,
    );
  const assign = (accountId, orgId, rangeId) =>
    db.prepare('INSERT INTO instructor_assignments (account_id, organization_id, cyber_range_id, created_at) VALUES (?, ?, ?, ?)').run(
      accountId,
      orgId,
      rangeId,
      now,
    );
  const accounts = { iA: instructorAccount('iA'), iAB: instructorAccount('iAB') };
  assign(accounts.iA, orgA, s1);
  assign(accounts.iAB, orgA, s1);
  assign(accounts.iAB, orgB, s2);

  const admin = db.prepare("SELECT id FROM accounts WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  return {
    orgA,
    orgB,
    s1,
    s2,
    teamA,
    teamB,
    teamNoOrg,
    accounts,
    admin: { id: -1, accountId: admin.id, role: 'admin', teamId: null, username: 'admin' },
    principal: (name) => ({ id: -1, accountId: accounts[name], role: 'instructor', teamId: null, username: name }),
    student: (teamId) => ({ id: -1, accountId: null, role: 'student', teamId, username: 'student' }),
  };
}
