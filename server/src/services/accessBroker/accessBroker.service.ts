import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.js';
import { readCredentialPlaintext } from '../credential.service.js';
import { writeAudit } from '../audit.service.js';
import { buildConnectionConfig, encryptConnectionToken } from './guacamoleToken.service.js';
import { emitAccessSessionEnded, emitAccessSessionStarted } from '../../sockets/emitters.js';

const SESSION_TTL_MINUTES = Number(process.env.ACCESS_SESSION_TTL_MINUTES ?? 15);

export type RequestOutcome =
  | { ok: true; accessSessionId: number; wsUrl: string | null; expiresAt: string }
  | { ok: false; status: number; reason: string; message: string };

interface RequestingUser {
  id: number;
  teamId: number;
  username: string;
}

// The student-facing entry point. Mirrors the existing help_requests pattern (see
// helpRequests.routes.ts): the target's scope is re-derived server-side from the team's currently
// -active cyber range, never trusted from the client — see CLAUDE/invariants.md. A malicious request
// naming another team's node is rejected here, before any credential is ever touched, and the
// rejection itself is audited, not silently dropped.
export function requestAccessSession(user: RequestingUser, topologyNodeId: number, clientIp: string | null): RequestOutcome {
  const activeProgress = db
    .prepare(`SELECT cyber_range_id AS cyberRangeId FROM team_cyber_range_progress WHERE team_id = ? AND status = 'active' LIMIT 1`)
    .get(user.teamId) as { cyberRangeId: number } | undefined;

  if (!activeProgress) {
    writeAudit(user.username, 'access_session.denied', 'topology_node', topologyNodeId, { reason: 'no_active_range', teamId: user.teamId });
    return { ok: false, status: 409, reason: 'no_active_range', message: "your team has no active cyber range" };
  }

  const node = db.prepare('SELECT id, cyber_range_id AS cyberRangeId FROM topology_nodes WHERE id = ?').get(topologyNodeId) as
    | { id: number; cyberRangeId: number }
    | undefined;

  if (!node || node.cyberRangeId !== activeProgress.cyberRangeId) {
    return deny(user, topologyNodeId, activeProgress.cyberRangeId, 'node_not_in_active_range', 403, "this node is not part of your team's active cyber range");
  }

  const target = db
    .prepare('SELECT protocol, host, port, credential_id AS credentialId FROM access_targets WHERE topology_node_id = ?')
    .get(topologyNodeId) as { protocol: 'rdp' | 'ssh'; host: string; port: number; credentialId: number | null } | undefined;

  if (!target) {
    return deny(user, topologyNodeId, activeProgress.cyberRangeId, 'not_connectable', 400, 'this node has no configured access target');
  }

  const credentialId = target.credentialId ?? resolveDefaultCredentialId(topologyNodeId);
  if (!credentialId) {
    return deny(user, topologyNodeId, activeProgress.cyberRangeId, 'no_credential_configured', 400, 'no login credential is configured for this node');
  }

  let username: string;
  let password: string;
  try {
    const credRow = db.prepare('SELECT metadata_json AS metadataJson FROM credentials WHERE id = ?').get(credentialId) as
      | { metadataJson: string | null }
      | undefined;
    const meta = credRow?.metadataJson ? JSON.parse(credRow.metadataJson) : {};
    if (!meta.username) throw new Error('credential has no username in metadata');
    username = meta.username;
    password = readCredentialPlaintext(credentialId);
  } catch {
    return deny(user, topologyNodeId, activeProgress.cyberRangeId, 'credential_error', 500, 'failed to resolve the login credential for this node');
  }

  const config = buildConnectionConfig(target.protocol, target.host, target.port, username, password);
  const token = encryptConnectionToken(config); // never logged, never returned in a wider payload

  const brokerConnectionId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MINUTES * 60_000).toISOString();

  const result = db
    .prepare(
      `INSERT INTO access_sessions
         (team_id, user_id, cyber_range_id, topology_node_id, protocol, broker_connection_id, requested_at, started_at, expires_at, outcome, client_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    )
    .run(user.teamId, user.id, activeProgress.cyberRangeId, topologyNodeId, target.protocol, brokerConnectionId, now.toISOString(), now.toISOString(), expiresAt, clientIp);
  const accessSessionId = result.lastInsertRowid as number;

  writeAudit(user.username, 'access_session.requested', 'access_session', accessSessionId, { teamId: user.teamId, topologyNodeId });
  emitAccessSessionStarted(user.teamId, { id: accessSessionId, topologyNodeId, protocol: target.protocol, expiresAt });

  // No real guacd is deployed for this dev environment yet — GUACD_GATEWAY_WS_URL is unset there, so
  // wsUrl comes back null (token still minted and the session still tracked) rather than failing the
  // whole request. Once a real gateway exists, set the env var and the same token works unmodified.
  const gatewayUrl = process.env.GUACD_GATEWAY_WS_URL;
  const wsUrl = gatewayUrl ? `${gatewayUrl}?token=${encodeURIComponent(token)}` : null;

  return { ok: true, accessSessionId, wsUrl, expiresAt };
}

function deny(
  user: RequestingUser,
  topologyNodeId: number,
  cyberRangeId: number,
  reason: string,
  status: number,
  message: string,
): RequestOutcome {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO access_sessions (team_id, user_id, cyber_range_id, topology_node_id, protocol, requested_at, expires_at, outcome, denial_reason)
     VALUES (?, ?, ?, ?, 'rdp', ?, ?, 'denied', ?)`,
  ).run(user.teamId, user.id, cyberRangeId, topologyNodeId, now, now, reason);
  writeAudit(user.username, 'access_session.denied', 'topology_node', topologyNodeId, { reason, teamId: user.teamId });
  return { ok: false, status, reason, message };
}

function resolveDefaultCredentialId(topologyNodeId: number): number | null {
  const row = db
    .prepare(
      `SELECT ce.default_vm_credential_id AS credentialId
       FROM topology_nodes tn JOIN cloud_environments ce ON ce.id = tn.environment_id
       WHERE tn.id = ?`,
    )
    .get(topologyNodeId) as { credentialId: number | null } | undefined;
  return row?.credentialId ?? null;
}

export function endOwnSession(accessSessionId: number, teamId: number, username: string): boolean {
  const row = db.prepare(`SELECT team_id AS teamId, outcome FROM access_sessions WHERE id = ?`).get(accessSessionId) as
    | { teamId: number; outcome: string }
    | undefined;
  if (!row || row.teamId !== teamId || row.outcome !== 'active') return false;

  finishSession(accessSessionId, teamId, 'completed');
  writeAudit(username, 'access_session.ended', 'access_session', accessSessionId, { outcome: 'completed' });
  return true;
}

export function forceCloseSession(accessSessionId: number, actorUsername: string): boolean {
  const row = db.prepare(`SELECT team_id AS teamId, outcome FROM access_sessions WHERE id = ?`).get(accessSessionId) as
    | { teamId: number; outcome: string }
    | undefined;
  if (!row || row.outcome !== 'active') return false;

  finishSession(accessSessionId, row.teamId, 'force_closed');
  writeAudit(actorUsername, 'access_session.ended', 'access_session', accessSessionId, { outcome: 'force_closed' });
  return true;
}

// Called by accessSessionExpiry.service.ts's ticker for sessions that ran past expires_at without an
// explicit end — same "server-authoritative timing" precedent as clock.service.ts.
export function expireSession(accessSessionId: number, teamId: number): void {
  finishSession(accessSessionId, teamId, 'expired');
  writeAudit(null, 'access_session.ended', 'access_session', accessSessionId, { outcome: 'expired' });
}

function finishSession(accessSessionId: number, teamId: number, outcome: 'completed' | 'force_closed' | 'expired') {
  db.prepare(`UPDATE access_sessions SET outcome = ?, ended_at = ? WHERE id = ?`).run(outcome, new Date().toISOString(), accessSessionId);
  emitAccessSessionEnded(teamId, accessSessionId, outcome);
}

export interface ActiveSessionSummary {
  id: number;
  teamId: number;
  teamName: string;
  username: string;
  topologyNodeId: number;
  nodeLabel: string;
  protocol: string;
  startedAt: string | null;
  expiresAt: string;
}

export function listActiveSessions(): ActiveSessionSummary[] {
  return db
    .prepare(
      `SELECT s.id AS id, s.team_id AS teamId, t.name AS teamName, u.username AS username,
              s.topology_node_id AS topologyNodeId, tn.label AS nodeLabel, s.protocol AS protocol,
              s.started_at AS startedAt, s.expires_at AS expiresAt
       FROM access_sessions s
       JOIN teams t ON t.id = s.team_id
       JOIN users u ON u.id = s.user_id
       JOIN topology_nodes tn ON tn.id = s.topology_node_id
       WHERE s.outcome = 'active'
       ORDER BY s.started_at DESC`,
    )
    .all() as unknown as ActiveSessionSummary[];
}
