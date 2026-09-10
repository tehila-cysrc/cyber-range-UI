import { ClientSecretCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import type {
  DiscoveredRelationship,
  DiscoveredResource,
  DiscoveredZone,
  DiscoveryProvider,
  DiscoveryResult,
  DiscoveryWarning,
  ResolvedCloudCredential,
} from './discoveryProvider.js';

// One Resource Graph query covers everything the platform discovers today — no per-resource-type
// SDK (arm-compute/arm-network/...) needed, and no extra calls needed for edges: every relationship
// below is derived from `properties` already present in this single query's result.
const RESOURCE_GRAPH_QUERY = `
  resources
  | where type in~ (
      'microsoft.compute/virtualmachines',
      'microsoft.network/networkinterfaces',
      'microsoft.network/virtualnetworks',
      'microsoft.network/networksecuritygroups',
      'microsoft.network/publicipaddresses',
      'microsoft.network/loadbalancers',
      'microsoft.storage/storageaccounts',
      'microsoft.keyvault/vaults'
    )
  | project id, name, type, resourceGroup, location, properties
`;

interface AzureGraphResource {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  location: string;
  properties?: Record<string, unknown>;
}

// Note: microsoft.network/virtualnetworks is intentionally absent here — a vnet is never its own
// topology node; its subnets become zones (see mapAzureResourcesToDiscovery), handled as a special
// case before this map is consulted.
const NODE_TYPE_BY_AZURE_TYPE: Record<string, string> = {
  'microsoft.compute/virtualmachines': 'vm',
  'microsoft.network/networkinterfaces': 'nic',
  'microsoft.network/networksecuritygroups': 'nsg',
  'microsoft.network/publicipaddresses': 'public_ip',
  'microsoft.network/loadbalancers': 'load_balancer',
  'microsoft.storage/storageaccounts': 'storage_account',
  'microsoft.keyvault/vaults': 'key_vault',
};

// The "keep the canvas clean" rule (design doc §3/§9.1): only exercise-meaningful hosts are visible
// by default. Azure implementation resources stay discovered (for admin diagnostics / future
// exercise-relevance promotion) but hidden from both canvases until an instructor opts a specific
// node in — see topology_nodes.is_visible_to_students.
const DEFAULT_VISIBLE_NODE_TYPES = new Set(['vm']);

// Heuristic only — there is no tag-based role convention today, so this infers a cyber-exercise role
// from the resource's name/OS. Deliberately approximate: the instructor can always correct it, and
// this only ever runs once per node (write-once-then-preserved across re-discovery, matching pos_x/
// pos_y — see discovery.service.ts).
function inferRole(label: string, osType: string | null | undefined): string {
  const l = label.toLowerCase();
  if (/(?:^|[^a-z])dc\d*(?:[^a-z]|$)|domain.?controller/.test(l)) return 'domain_controller';
  if (/kali|attacker/.test(l)) return 'kali_attacker';
  if (/siem|qradar/.test(l)) return 'siem';
  if (/(?:^|[^a-z])fw(?:[^a-z]|$)|firewall/.test(l)) return 'firewall';
  if (/web|iis|apache|nginx/.test(l)) return 'web_server';
  if (/mail|smtp|exchange/.test(l)) return 'mail_server';
  if (/\bdb\b|sql|database/.test(l)) return 'database_server';
  if (osType === 'Windows') return 'workstation';
  if (osType === 'Linux') return 'linux_server';
  return 'generic_server';
}

function humanizeName(raw: string): string {
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function get(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function subnetVnetExternalKey(subnetId: string): string | null {
  const idx = subnetId.toLowerCase().lastIndexOf('/subnets/');
  return idx === -1 ? null : subnetId.slice(0, idx);
}

function backendPoolIpConfigToNicId(ipConfigId: string): string | null {
  const idx = ipConfigId.toLowerCase().indexOf('/ipconfigurations/');
  return idx === -1 ? null : ipConfigId.slice(0, idx);
}

// Pure and exported for testing — maps a raw Resource Graph result into the provider-neutral
// DiscoveredZone/DiscoveredResource/DiscoveredRelationship shape, with no Azure SDK calls of its own.
export function mapAzureResourcesToDiscovery(resources: AzureGraphResource[]): DiscoveryResult {
  const zones: DiscoveredZone[] = [];
  const discovered: DiscoveredResource[] = [];
  const relationships: DiscoveredRelationship[] = [];
  const warnings: DiscoveryWarning[] = [];

  // nic -> subnet/private-IP, resolved while walking nic resources; used in the second pass below to
  // derive each vm's zone and IP (vm -> nic -> subnet/IP) without exposing nic plumbing as canvas edges.
  const nicToSubnet = new Map<string, string>();
  const nicToPrivateIp = new Map<string, string>();
  const vmToNicIds = new Map<string, string[]>();

  for (const resource of resources) {
    try {
      const azureType = resource.type.toLowerCase();

      if (azureType === 'microsoft.network/virtualnetworks') {
        const subnets = (get(resource, ['properties', 'subnets']) as Array<Record<string, unknown>>) ?? [];
        for (const subnet of subnets) {
          const subnetId = subnet.id as string | undefined;
          if (!subnetId) continue;
          zones.push({
            externalKey: subnetId,
            name: humanizeName((subnet.name as string) ?? subnetId),
            cidr: (get(subnet, ['properties', 'addressPrefix']) as string | undefined) ?? null,
          });
        }
        continue; // the vnet itself is never a topology node — its subnets are zones instead
      }

      const nodeType = NODE_TYPE_BY_AZURE_TYPE[azureType];
      if (!nodeType) continue;

      const osType =
        nodeType === 'vm' ? (get(resource, ['properties', 'storageProfile', 'osDisk', 'osType']) as string | undefined) : undefined;

      discovered.push({
        externalKey: resource.id,
        label: resource.name,
        nodeType,
        metadata: curateMetadata(nodeType, resource),
        zoneExternalKey: null, // resolved in the second pass, once nic->subnet is fully known
        role: nodeType === 'vm' ? inferRole(resource.name, osType) : null,
        isVisibleToStudents: DEFAULT_VISIBLE_NODE_TYPES.has(nodeType),
      });

      if (nodeType === 'vm') {
        const nics = (get(resource, ['properties', 'networkProfile', 'networkInterfaces']) as Array<{ id?: string }>) ?? [];
        vmToNicIds.set(
          resource.id,
          nics.map((n) => n.id).filter((id): id is string => !!id),
        );
        for (const nic of nics) {
          if (nic.id) relationships.push({ fromExternalKey: resource.id, toExternalKey: nic.id, relationType: 'attached_to' });
        }
      }

      if (nodeType === 'nic') {
        const ipConfigs = (get(resource, ['properties', 'ipConfigurations']) as Array<Record<string, unknown>>) ?? [];
        for (const ipConfig of ipConfigs) {
          // Note: no 'in_subnet' relationship pushed here — a subnet is a zone now, not a discovered
          // node, so that edge would always be dropped as dangling by the filter below and spuriously
          // mark every run 'partial_failure'. nicToSubnet captures the same information for zone
          // resolution above without going through the relationships/edges pipeline.
          const subnetId = get(ipConfig, ['properties', 'subnet', 'id']) as string | undefined;
          if (subnetId && !nicToSubnet.has(resource.id)) nicToSubnet.set(resource.id, subnetId);
          const privateIp = get(ipConfig, ['properties', 'privateIPAddress']) as string | undefined;
          if (privateIp && !nicToPrivateIp.has(resource.id)) nicToPrivateIp.set(resource.id, privateIp);

          const publicIpId = get(ipConfig, ['properties', 'publicIPAddress', 'id']) as string | undefined;
          if (publicIpId) relationships.push({ fromExternalKey: resource.id, toExternalKey: publicIpId, relationType: 'has_public_ip' });
        }

        const nicNsgId = get(resource, ['properties', 'networkSecurityGroup', 'id']) as string | undefined;
        if (nicNsgId) relationships.push({ fromExternalKey: resource.id, toExternalKey: nicNsgId, relationType: 'protected_by' });
      }

      if (nodeType === 'load_balancer') {
        const pools = (get(resource, ['properties', 'backendAddressPools']) as Array<Record<string, unknown>>) ?? [];
        for (const pool of pools) {
          const backendConfigs = (get(pool, ['properties', 'backendIPConfigurations']) as Array<{ id?: string }>) ?? [];
          for (const cfg of backendConfigs) {
            const nicId = cfg.id ? backendPoolIpConfigToNicId(cfg.id) : null;
            if (nicId) relationships.push({ fromExternalKey: resource.id, toExternalKey: nicId, relationType: 'load_balances' });
          }
        }
      }
    } catch (err) {
      warnings.push({ resourceType: resource.type, message: `failed to map resource ${resource.id}: ${(err as Error).message}` });
    }
  }

  // Second pass: resolve zoneExternalKey now that nic->subnet is fully known. A nic's zone is its own
  // subnet; a vm's zone is the subnet of its first nic that resolved to one (a vm with multiple nics
  // in different subnets just gets its first nic's zone — an edge case, not worth a multi-zone model).
  const zoneKeys = new Set(zones.map((z) => z.externalKey));
  for (const node of discovered) {
    if (node.nodeType === 'nic') {
      const subnetId = nicToSubnet.get(node.externalKey);
      if (subnetId && zoneKeys.has(subnetId)) node.zoneExternalKey = subnetId;
    } else if (node.nodeType === 'vm') {
      for (const nicId of vmToNicIds.get(node.externalKey) ?? []) {
        const subnetId = nicToSubnet.get(nicId);
        if (subnetId && zoneKeys.has(subnetId) && !node.zoneExternalKey) node.zoneExternalKey = subnetId;
        const privateIp = nicToPrivateIp.get(nicId);
        if (privateIp && !('privateIpAddress' in node.metadata)) (node.metadata as Record<string, unknown>).privateIpAddress = privateIp;
        if (node.zoneExternalKey && 'privateIpAddress' in node.metadata) break;
      }
    }
  }

  // Drop relationships pointing at a resource type we didn't discover (e.g. a subnet outside the
  // registered scope) rather than leaving a dangling reference for discovery.service.ts to trip on.
  const knownKeys = new Set(discovered.map((r) => r.externalKey));
  const validRelationships = relationships.filter((r) => {
    const ok = knownKeys.has(r.fromExternalKey) && knownKeys.has(r.toExternalKey);
    if (!ok) warnings.push({ message: `dropped relationship ${r.relationType} — one endpoint was not discovered (out of scope)` });
    return ok;
  });

  return { zones, resources: discovered, relationships: validRelationships, warnings };
}

function curateMetadata(nodeType: string, resource: AzureGraphResource): Record<string, unknown> {
  const base = { location: resource.location, resourceGroup: resource.resourceGroup, azureType: resource.type };
  const props = resource.properties ?? {};
  switch (nodeType) {
    case 'vm':
      return { ...base, vmSize: get(props, ['hardwareProfile', 'vmSize']), osType: get(props, ['storageProfile', 'osDisk', 'osType']) };
    case 'nsg':
      return { ...base, securityRuleCount: ((props as { securityRules?: unknown[] }).securityRules ?? []).length };
    case 'public_ip':
      return { ...base, ipAddress: (props as { ipAddress?: string }).ipAddress, allocationMethod: (props as { publicIPAllocationMethod?: string }).publicIPAllocationMethod };
    case 'storage_account':
      return { ...base, sku: get(resource, ['properties']) && (resource as unknown as { sku?: unknown }).sku };
    case 'key_vault':
      return { ...base, vaultUri: (props as { vaultUri?: string }).vaultUri };
    default:
      return base;
  }
}

export class AzureDiscoveryProvider implements DiscoveryProvider {
  readonly providerKey = 'azure' as const;

  async discover(credential: ResolvedCloudCredential): Promise<DiscoveryResult> {
    const azureCredential = new ClientSecretCredential(credential.tenantId, credential.clientId, credential.clientSecret);
    const client = new ResourceGraphClient(azureCredential);

    const query = credential.externalScope
      ? `${RESOURCE_GRAPH_QUERY} | where resourceGroup =~ '${credential.externalScope.replace(/'/g, "''")}'`
      : RESOURCE_GRAPH_QUERY;

    const response = await client.resources({ subscriptions: [credential.externalAccountId], query });
    const resources = (response.data as AzureGraphResource[]) ?? [];
    return mapAzureResourcesToDiscovery(resources);
  }
}
