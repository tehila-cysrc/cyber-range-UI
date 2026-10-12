import crypto from 'node:crypto';

// Bearer tokens for the RBAC fixture's principals (tests/fixtures/rbac.mjs): the admin, instructors iA
// and iAB, a student in team A and one in team B. Staff get their run membership row the same way a
// sign-in creates it.
export function issueTokens(db, f) {
  const runId = db.prepare('SELECT id FROM event_runs WHERE is_active = 1').get().id;
  const expires = new Date(Date.now() + 3600_000).toISOString();
  const token = (userId) => {
    const t = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO auth_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(t, userId, new Date().toISOString(), expires);
    return t;
  };
  const member = (accountId) => {
    const existing = db.prepare('SELECT id FROM users WHERE event_run_id = ? AND account_id = ?').get(runId, accountId);
    if (existing) return existing.id;
    const a = db.prepare('SELECT username, display_name AS d FROM accounts WHERE id = ?').get(accountId);
    return Number(
      db.prepare(
        "INSERT INTO users (event_run_id, username, password, role, team_id, display_name, account_id) VALUES (?, ?, '', 'instructor', NULL, ?, ?)",
      ).run(runId, a.username, a.d, accountId).lastInsertRowid,
    );
  };
  const student = (username, teamId) =>
    Number(
      db.prepare("INSERT INTO users (event_run_id, username, password, role, team_id, display_name) VALUES (?, ?, 'student123', 'student', ?, ?)").run(
        runId,
        username,
        teamId,
        username,
      ).lastInsertRowid,
    );
  const ids = {
    admin: member(f.admin.accountId),
    iA: member(f.accounts.iA),
    iAB: member(f.accounts.iAB),
    studentA: student('stu-a', f.teamA),
    studentB: student('stu-b', f.teamB),
  };
  return {
    ids,
    admin: token(ids.admin),
    iA: token(ids.iA),
    iAB: token(ids.iAB),
    studentA: token(ids.studentA),
    studentB: token(ids.studentB),
  };
}
