import { createHash } from 'node:crypto';
import { ClientSecretCredential } from '@azure/identity';
import { ComputeManagementClient } from '@azure/arm-compute';
import { db } from '../db/index.js';
import { writeAudit } from './audit.service.js';
import { classifyAzureError } from './azureErrors.js';
import { getResolvedCredential } from './environments.service.js';
import { recordScriptOccurrencesAndAnnounce } from './ttpAnnounce.js';
import type { ResolvedCloudCredential } from './discovery/discoveryProvider.js';

export type ScriptType = 'powershell' | 'bash';

export interface ScriptSummary {
  id: number;
  name: string;
  description: string | null;
  scriptType: ScriptType;
  category: string | null;
  createdAt: string;
  createdByUsername: string | null;
  updatedAt: string | null;
}

export interface Script extends ScriptSummary {
  content: string;
}

interface ScriptRow {
  id: number;
  name: string;
  description: string | null;
  content: string;
  scriptType: ScriptType;
  category: string | null;
  createdAt: string;
  createdByUsername: string | null;
  updatedAt: string | null;
}

const SELECT_SCRIPT = `
  SELECT id, name, description, content, script_type AS scriptType, category,
         created_at AS createdAt, created_by_username AS createdByUsername, updated_at AS updatedAt
  FROM scripts
`;

function toSummary(row: ScriptRow): ScriptSummary {
  const { content: _content, ...summary } = row;
  return summary;
}

// The instructor-authored reusable library — see config.sql's `scripts` table comment for why this is
// CONFIG and deliberately not cyber-range-scoped.
export function listScripts(filter: { category?: string; search?: string } = {}): ScriptSummary[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.category) {
    clauses.push('category = ?');
    params.push(filter.category);
  }
  if (filter.search) {
    clauses.push('(name LIKE ? OR description LIKE ?)');
    params.push(`%${filter.search}%`, `%${filter.search}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`${SELECT_SCRIPT} ${where} ORDER BY category, name`).all(...params) as unknown as ScriptRow[];
  return rows.map(toSummary);
}

export function getScript(id: number): Script | null {
  const row = db.prepare(`${SELECT_SCRIPT} WHERE id = ?`).get(id) as ScriptRow | undefined;
  return row ?? null;
}

export interface ScriptInput {
  name: string;
  description: string | null;
  content: string;
  scriptType: ScriptType;
  category: string | null;
}

export function createScript(input: ScriptInput, actorUsername: string): Script {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO scripts (name, description, content, script_type, category, created_at, created_by_username)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.name, input.description, input.content, input.scriptType, input.category, now, actorUsername);
  const id = result.lastInsertRowid as number;
  writeAudit(actorUsername, 'script.created', 'script', id, { name: input.name, scriptType: input.scriptType });
  return getScript(id)!;
}

export function updateScript(id: number, input: Partial<ScriptInput>, actorUsername: string): Script | null {
  const existing = getScript(id);
  if (!existing) return null;

  db.prepare(
    `UPDATE scripts SET
       name = COALESCE(?, name),
       description = ?,
       content = COALESCE(?, content),
       script_type = COALESCE(?, script_type),
       category = ?,
       updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name ?? null,
    input.description !== undefined ? input.description : existing.description,
    input.content ?? null,
    input.scriptType ?? null,
    input.category !== undefined ? input.category : existing.category,
    new Date().toISOString(),
    id,
  );

  writeAudit(actorUsername, 'script.updated', 'script', id, { name: input.name ?? existing.name });
  return getScript(id);
}

export function deleteScript(id: number, actorUsername: string): boolean {
  const result = db.prepare('DELETE FROM scripts WHERE id = ?').run(id);
  if (result.changes === 0) return false;
  writeAudit(actorUsername, 'script.deleted', 'script', id, null);
  return true;
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// Azure requires resourceGroupName + vmName separately from the ARM resource id we store as
// external_key — same "parse it back out of the ARM id" need bastionConnect.service.ts avoided only
// because that API takes the full id directly; Run Command's SDK does not.
function parseVmResourceId(armId: string): { resourceGroupName: string; vmName: string } | null {
  const match = armId.match(/\/resourceGroups\/([^/]+)\/providers\/Microsoft\.Compute\/virtualMachines\/([^/]+)/i);
  if (!match) return null;
  return { resourceGroupName: match[1], vmName: match[2] };
}

interface RunnableNode {
  id: number;
  externalKey: string;
  environmentId: number | null;
  osType: 'Windows' | 'Linux' | null;
}

function loadRunnableNode(nodeId: number): RunnableNode | null {
  const row = db
    .prepare(
      `SELECT id, external_key AS externalKey, node_type AS nodeType, environment_id AS environmentId, metadata_json AS metadataJson
       FROM topology_nodes WHERE id = ?`,
    )
    .get(nodeId) as { id: number; externalKey: string; nodeType: string; environmentId: number | null; metadataJson: string | null } | undefined;
  if (!row || row.nodeType !== 'vm' || !row.environmentId) return null;

  const metadata = row.metadataJson ? JSON.parse(row.metadataJson) : {};
  const osType = metadata.osType === 'Windows' || metadata.osType === 'Linux' ? metadata.osType : null;
  return { id: row.id, externalKey: row.externalKey, environmentId: row.environmentId, osType };
}

function requiredScriptType(osType: 'Windows' | 'Linux'): ScriptType {
  return osType === 'Windows' ? 'powershell' : 'bash';
}

export type RunScriptOutcome =
  | { ok: true; executionId: number }
  | { ok: false; status: number; reason: string; message: string };

export interface RunScriptRequest {
  scriptId?: number;
  content?: string;
  scriptType?: ScriptType;
}

// The instructor-facing entry point (POST .../run-script). Responds fast (202-equivalent) and runs
// the actual Azure call in the background — Run Command can legitimately take minutes for a script
// meant to generate real, observable activity, which is far too long to hold an HTTP request open (the
// same reasoning that made environment discovery async — see discovery.service.ts).
export function runScriptOnNode(nodeId: number, request: RunScriptRequest, actorUsername: string, actorUserId: number): RunScriptOutcome {
  const node = loadRunnableNode(nodeId);
  if (!node) {
    return { ok: false, status: 400, reason: 'not_runnable', message: 'this node is not an Azure-discovered VM' };
  }
  if (!node.osType) {
    return { ok: false, status: 400, reason: 'unknown_os', message: "this VM's OS type is unknown — re-run discovery first" };
  }

  let content: string;
  let scriptType: ScriptType;
  let scriptId: number | null = null;

  if (request.scriptId) {
    const script = getScript(request.scriptId);
    if (!script) return { ok: false, status: 404, reason: 'script_not_found', message: 'script not found in the library' };
    content = script.content;
    scriptType = script.scriptType;
    scriptId = script.id;
  } else {
    if (typeof request.content !== 'string' || !request.content.trim() || !request.scriptType) {
      return { ok: false, status: 400, reason: 'invalid_request', message: 'content and scriptType are required for a manual run' };
    }
    content = request.content;
    scriptType = request.scriptType;
  }

  const required = requiredScriptType(node.osType);
  if (scriptType !== required) {
    return {
      ok: false,
      status: 400,
      reason: 'os_mismatch',
      message: `this VM is ${node.osType} — it needs a ${required === 'powershell' ? 'PowerShell' : 'Bash'} script, not ${scriptType}`,
    };
  }

  const credential = getResolvedCredential(node.environmentId!);
  if (!credential) {
    return { ok: false, status: 500, reason: 'credential_error', message: 'could not resolve the environment credential' };
  }

  const vmRef = parseVmResourceId(node.externalKey);
  if (!vmRef) {
    return { ok: false, status: 500, reason: 'bad_resource_id', message: "could not parse this VM's Azure resource id" };
  }

  const now = new Date().toISOString();
  const hash = sha256Hex(content);

  let executionId: number;
  try {
    const result = db
      .prepare(
        `INSERT INTO script_executions (topology_node_id, script_id, script_type, script_hash, actor_user_id, status, started_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(nodeId, scriptId, scriptType, hash, actorUserId, now);
    executionId = result.lastInsertRowid as number;
  } catch {
    // Trips idx_one_running_script_per_node — mirrors the 409 discovery.service.ts returns for a
    // second concurrent discovery run on the same environment.
    return { ok: false, status: 409, reason: 'already_running', message: 'a script is already running on this machine' };
  }

  writeAudit(actorUsername, 'script.execution_started', 'topology_node', nodeId, { executionId, scriptId, scriptType, scriptHash: hash });

  void executeInBackground(executionId, credential, vmRef, scriptType, content, actorUsername, nodeId);

  return { ok: true, executionId };
}

const OUTPUT_EXCERPT_MAX = 4000;

async function executeInBackground(
  executionId: number,
  credential: ResolvedCloudCredential,
  vmRef: { resourceGroupName: string; vmName: string },
  scriptType: ScriptType,
  content: string,
  actorUsername: string,
  nodeId: number,
): Promise<void> {
  try {
    const azureCredential = new ClientSecretCredential(credential.tenantId, credential.clientId, credential.clientSecret);
    const client = new ComputeManagementClient(azureCredential, credential.externalAccountId);

    const poller = await client.virtualMachines.beginRunCommand(vmRef.resourceGroupName, vmRef.vmName, {
      commandId: scriptType === 'powershell' ? 'RunPowerShellScript' : 'RunShellScript',
      script: content.split(/\r?\n/),
    });
    const result = await poller.pollUntilDone();

    const messages = (result.value ?? []).map((s) => `[${s.level ?? 'info'}] ${s.displayStatus ?? ''}: ${s.message ?? ''}`.trim());
    const hadErrorLevel = (result.value ?? []).some((s) => s.level === 'Error');
    const excerpt = messages.join('\n').slice(0, OUTPUT_EXCERPT_MAX);

    db.prepare(`UPDATE script_executions SET status = ?, finished_at = ?, output_excerpt = ? WHERE id = ?`).run(
      hadErrorLevel ? 'failed' : 'succeeded',
      new Date().toISOString(),
      excerpt,
      executionId,
    );
    writeAudit(actorUsername, 'script.execution_finished', 'topology_node', nodeId, { executionId, status: hadErrorLevel ? 'failed' : 'succeeded' });
    if (!hadErrorLevel) {
      // MITRE TTP feature: a successful trigger-script run stamps when its expected technique occurred
      // (MTTD only). Isolated so an MTTD bookkeeping failure can never mark a good run as failed.
      try {
        recordScriptOccurrencesAndAnnounce(executionId);
      } catch (err) {
        console.error('[ttp] failed to record occurrence for execution', executionId, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    const { message } = classifyAzureError(err);
    db.prepare(`UPDATE script_executions SET status = 'failed', finished_at = ?, error_text = ? WHERE id = ?`).run(
      new Date().toISOString(),
      message.slice(0, OUTPUT_EXCERPT_MAX),
      executionId,
    );
    writeAudit(actorUsername, 'script.execution_finished', 'topology_node', nodeId, { executionId, status: 'failed' });
  }
}

export interface ScriptExecutionSummary {
  id: number;
  topologyNodeId: number;
  scriptId: number | null;
  scriptName: string | null;
  scriptType: ScriptType;
  actorUsername: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  outputExcerpt: string | null;
  errorText: string | null;
}

const SELECT_EXECUTION = `
  SELECT se.id AS id, se.topology_node_id AS topologyNodeId, se.script_id AS scriptId, s.name AS scriptName,
         se.script_type AS scriptType, u.username AS actorUsername, se.status AS status,
         se.started_at AS startedAt, se.finished_at AS finishedAt, se.output_excerpt AS outputExcerpt, se.error_text AS errorText
  FROM script_executions se
  JOIN users u ON u.id = se.actor_user_id
  LEFT JOIN scripts s ON s.id = se.script_id
`;

export function getExecution(id: number): ScriptExecutionSummary | null {
  const row = db.prepare(`${SELECT_EXECUTION} WHERE se.id = ?`).get(id) as ScriptExecutionSummary | undefined;
  return row ?? null;
}

export function listExecutionsForNode(nodeId: number): ScriptExecutionSummary[] {
  return db.prepare(`${SELECT_EXECUTION} WHERE se.topology_node_id = ? ORDER BY se.started_at DESC LIMIT 20`).all(nodeId) as unknown as ScriptExecutionSummary[];
}
