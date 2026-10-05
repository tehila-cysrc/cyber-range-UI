import { ClientSecretCredential } from '@azure/identity';
import { ComputeManagementClient } from '@azure/arm-compute';
import { db } from '../db/index.js';
import { writeAudit } from './audit.service.js';
import { classifyAzureError } from './azureErrors.js';
import { getResolvedCredential } from './environments.service.js';

// Start / deallocate for discovered Azure VMs. "Stop" deallocates (Azure portal Stop): the VM shuts
// down and compute is released. These calls are long-running, so the HTTP handler records the
// operation and returns immediately — the same fire-and-track shape as discovery and Run Script.

export type VmPowerAction = 'start' | 'stop';

export interface VmPowerOperation {
  action: VmPowerAction;
  status: 'running' | 'succeeded' | 'failed';
  vmCount: number;
  succeeded: number;
  failed: number;
  message: string | null;
  failures: Array<{ label: string; message: string }>;
  startedAt: string;
  finishedAt: string | null;
}

export type VmPowerOutcome =
  | { ok: true; operation: VmPowerOperation }
  | { ok: false; status: number; message: string };

interface VmTarget {
  nodeIds: number[];
  label: string;
  resourceGroupName: string;
  vmName: string;
}

const byEnvironment = new Map<number, VmPowerOperation>();
const byNode = new Map<number, VmPowerOperation>();
const locks = new Set<string>();

const CONCURRENCY = 4;

export function getEnvironmentPower(environmentId: number): VmPowerOperation | null {
  return byEnvironment.get(environmentId) ?? null;
}

export function getNodePower(nodeId: number): VmPowerOperation | null {
  return byNode.get(nodeId) ?? null;
}

export function requestEnvironmentPower(environmentId: number, action: VmPowerAction, actorUsername: string): VmPowerOutcome {
  const env = db
    .prepare('SELECT id, provider FROM cloud_environments WHERE id = ?')
    .get(environmentId) as { id: number; provider: string } | undefined;
  if (!env) return { ok: false, status: 404, message: 'environment not found' };
  if (env.provider !== 'azure') {
    return { ok: false, status: 400, message: 'start and stop are only available for Azure environments' };
  }

  const rows = db
    .prepare(
      `SELECT id, label, external_key AS externalKey
       FROM topology_nodes WHERE environment_id = ? AND node_type = 'vm'`,
    )
    .all(environmentId) as Array<{ id: number; label: string; externalKey: string }>;

  if (rows.length === 0) {
    return {
      ok: false,
      status: 400,
      message: 'no virtual machines discovered in this environment — run Discover now first',
    };
  }
  const targets = groupVmTargets(rows);
  if (targets.length === 0) {
    return { ok: false, status: 500, message: "could not parse the discovered VMs' Azure resource ids" };
  }

  const nodeIds = targets.flatMap((t) => t.nodeIds);
  if (locks.has(`env:${environmentId}`) || nodeIds.some((id) => locks.has(`node:${id}`))) {
    return { ok: false, status: 409, message: 'a start or stop is already in progress for this environment' };
  }

  const credential = getResolvedCredential(environmentId);
  if (!credential) {
    return { ok: false, status: 500, message: 'could not resolve the environment credential' };
  }

  const operation = beginOperation(action, targets.length);
  byEnvironment.set(environmentId, operation);
  for (const id of nodeIds) byNode.set(id, operation);
  lockTargets(environmentId, nodeIds);
  setNodeStatus(nodeIds, action === 'start' ? 'starting' : 'stopping');

  writeAudit(actorUsername, 'environment.power_requested', 'cloud_environment', environmentId, {
    action,
    vmCount: targets.length,
  });

  void runPower(operation, targets, action, credential, actorUsername, {
    environmentId,
    nodeIds,
    auditAction: 'environment.power_finished',
    entityType: 'cloud_environment',
    entityId: environmentId,
  });

  return { ok: true, operation };
}

export function requestNodePower(nodeId: number, action: VmPowerAction, actorUsername: string): VmPowerOutcome {
  const row = db
    .prepare(
      `SELECT tn.id AS id, tn.label AS label, tn.external_key AS externalKey, tn.node_type AS nodeType,
              tn.environment_id AS environmentId, ce.provider AS provider
       FROM topology_nodes tn
       LEFT JOIN cloud_environments ce ON ce.id = tn.environment_id
       WHERE tn.id = ?`,
    )
    .get(nodeId) as
    | { id: number; label: string; externalKey: string; nodeType: string; environmentId: number | null; provider: string | null }
    | undefined;

  if (!row) return { ok: false, status: 404, message: 'node not found' };
  if (row.nodeType !== 'vm' || !row.environmentId || row.provider !== 'azure') {
    return { ok: false, status: 400, message: 'only a discovered Azure virtual machine can be started or stopped' };
  }

  const siblings = db
    .prepare(
      `SELECT id FROM topology_nodes WHERE environment_id = ? AND external_key = ? AND node_type = 'vm'`,
    )
    .all(row.environmentId, row.externalKey) as Array<{ id: number }>;
  const nodeIds = siblings.map((s) => s.id);
  const targets = groupVmTargets([{ id: row.id, label: row.label, externalKey: row.externalKey }]);
  // Keep every copy of this VM (same ARM id, linked ranges) on the same status.
  if (targets[0]) targets[0].nodeIds = nodeIds;

  if (!targets[0]) {
    return { ok: false, status: 500, message: "could not parse this VM's Azure resource id" };
  }
  if (locks.has(`env:${row.environmentId}`) || nodeIds.some((id) => locks.has(`node:${id}`))) {
    return { ok: false, status: 409, message: 'a start or stop is already in progress for this virtual machine' };
  }

  const credential = getResolvedCredential(row.environmentId);
  if (!credential) {
    return { ok: false, status: 500, message: 'could not resolve the environment credential' };
  }

  const operation = beginOperation(action, 1);
  byNode.set(nodeId, operation);
  for (const id of nodeIds) byNode.set(id, operation);
  for (const id of nodeIds) locks.add(`node:${id}`);
  setNodeStatus(nodeIds, action === 'start' ? 'starting' : 'stopping');

  writeAudit(actorUsername, 'topology.vm_power_requested', 'topology_node', nodeId, { action, label: row.label });

  void runPower(operation, targets, action, credential, actorUsername, {
    environmentId: null,
    nodeIds,
    auditAction: 'topology.vm_power_finished',
    entityType: 'topology_node',
    entityId: nodeId,
  });

  return { ok: true, operation };
}

function beginOperation(action: VmPowerAction, vmCount: number): VmPowerOperation {
  return {
    action,
    status: 'running',
    vmCount,
    succeeded: 0,
    failed: 0,
    message: null,
    failures: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

function lockTargets(environmentId: number, nodeIds: number[]): void {
  locks.add(`env:${environmentId}`);
  for (const id of nodeIds) locks.add(`node:${id}`);
}

function unlockTargets(environmentId: number | null, nodeIds: number[]): void {
  if (environmentId != null) locks.delete(`env:${environmentId}`);
  for (const id of nodeIds) locks.delete(`node:${id}`);
}

function setNodeStatus(nodeIds: number[], status: string): void {
  if (nodeIds.length === 0) return;
  const placeholders = nodeIds.map(() => '?').join(', ');
  db.prepare(`UPDATE topology_nodes SET status = ? WHERE id IN (${placeholders})`).run(status, ...nodeIds);
}

// One Azure VM can be discovered into more than one linked range. Call ARM once per resource id.
function groupVmTargets(rows: Array<{ id: number; label: string; externalKey: string }>): VmTarget[] {
  const byKey = new Map<string, VmTarget>();
  for (const row of rows) {
    const existing = byKey.get(row.externalKey);
    if (existing) {
      existing.nodeIds.push(row.id);
      continue;
    }
    const parsed = parseVmResourceId(row.externalKey);
    if (!parsed) continue;
    byKey.set(row.externalKey, { nodeIds: [row.id], label: row.label, ...parsed });
  }
  return [...byKey.values()];
}

function parseVmResourceId(armId: string): { resourceGroupName: string; vmName: string } | null {
  const match = armId.match(/\/resourceGroups\/([^/]+)\/providers\/Microsoft\.Compute\/virtualMachines\/([^/]+)/i);
  if (!match) return null;
  return { resourceGroupName: match[1], vmName: match[2] };
}

function powerFailureMessage(err: unknown, action: VmPowerAction): string {
  const classified = classifyAzureError(err);
  if (classified.code === 'AuthorizationFailed' || classified.reason === 'auth') {
    const permission =
      action === 'start'
        ? 'Microsoft.Compute/virtualMachines/start/action'
        : 'Microsoft.Compute/virtualMachines/deallocate/action';
    return `The registered credential cannot ${action} this virtual machine. It needs ${permission}.`;
  }
  return classified.message;
}

async function runPower(
  operation: VmPowerOperation,
  targets: VmTarget[],
  action: VmPowerAction,
  credential: NonNullable<ReturnType<typeof getResolvedCredential>>,
  actorUsername: string,
  scope: {
    environmentId: number | null;
    nodeIds: number[];
    auditAction: string;
    entityType: string;
    entityId: number;
  },
): Promise<void> {
  try {
    const azureCredential = new ClientSecretCredential(credential.tenantId, credential.clientId, credential.clientSecret);
    const client = new ComputeManagementClient(azureCredential, credential.externalAccountId);
    const finalStatus = action === 'start' ? 'running' : 'stopped';

    await mapPool(targets, CONCURRENCY, async (target) => {
      try {
        const poller =
          action === 'start'
            ? await client.virtualMachines.beginStart(target.resourceGroupName, target.vmName)
            : await client.virtualMachines.beginDeallocate(target.resourceGroupName, target.vmName);
        await poller.pollUntilDone();
        setNodeStatus(target.nodeIds, finalStatus);
        operation.succeeded += 1;
      } catch (err) {
        const message = powerFailureMessage(err, action);
        setNodeStatus(target.nodeIds, 'error');
        operation.failed += 1;
        operation.failures.push({ label: target.label, message });
      }
    });

    operation.status = operation.failed === 0 ? 'succeeded' : 'failed';
    operation.message =
      operation.failed === 0
        ? null
        : operation.succeeded === 0
          ? (operation.failures[0]?.message ?? 'start/stop failed')
          : `${operation.failed} of ${operation.vmCount} virtual machines failed`;
    operation.finishedAt = new Date().toISOString();
    writeAudit(actorUsername, scope.auditAction, scope.entityType, scope.entityId, {
      action,
      status: operation.status,
      succeeded: operation.succeeded,
      failed: operation.failed,
    });
  } catch (err) {
    operation.status = 'failed';
    operation.message = powerFailureMessage(err, action);
    operation.finishedAt = new Date().toISOString();
    setNodeStatus(scope.nodeIds, 'error');
    writeAudit(actorUsername, scope.auditAction, scope.entityType, scope.entityId, {
      action,
      status: 'failed',
    });
  } finally {
    unlockTargets(scope.environmentId, scope.nodeIds);
  }
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
