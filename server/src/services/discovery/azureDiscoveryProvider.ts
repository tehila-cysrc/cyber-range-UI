import { ClientSecretCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import type {
  DiscoveredRelationship,
  DiscoveredResource,
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

const NODE_TYPE_BY_AZURE_TYPE: Record<string, string> = {
  'microsoft.compute/virtualmachines': 'vm',
  'microsoft.network/networkinterfaces': 'nic',
  'microsoft.network/virtualnetworks': 'vnet',
  'microsoft.network/networksecuritygroups': 'nsg',
  'microsoft.network/publicipaddresses': 'public_ip',
  'microsoft.network/loadbalancers': 'load_balancer',
  'microsoft.storage/storageaccounts': 'storage_account',
  'microsoft.keyvault/vaults': 'key_vault',
};

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
// DiscoveredResource/DiscoveredRelationship shape, with no Azure SDK calls of its own.
export function mapAzureResourcesToDiscovery(resources: AzureGraphResource[]): DiscoveryResult {
  const discovered: DiscoveredResource[] = [];
  const relationships: DiscoveredRelationship[] = [];
  const warnings: DiscoveryWarning[] = [];

  for (const resource of resources) {
    try {
      const nodeType = NODE_TYPE_BY_AZURE_TYPE[resource.type.toLowerCase()];
      if (!nodeType) continue;

      discovered.push({
        externalKey: resource.id,
        label: resource.name,
        nodeType,
        metadata: curateMetadata(nodeType, resource),
      });

      if (nodeType === 'vnet') {
        const subnets = (get(resource, ['properties', 'subnets']) as Array<Record<string, unknown>>) ?? [];
        for (const subnet of subnets) {
          const subnetId = subnet.id as string | undefined;
          if (!subnetId) continue;
          discovered.push({
            externalKey: subnetId,
            label: (subnet.name as string) ?? subnetId,
            nodeType: 'subnet',
            metadata: {
              addressPrefix: get(subnet, ['properties', 'addressPrefix']),
            },
          });
          relationships.push({ fromExternalKey: subnetId, toExternalKey: resource.id, relationType: 'subnet_of' });

          const subnetNsgId = get(subnet, ['properties', 'networkSecurityGroup', 'id']) as string | undefined;
          if (subnetNsgId) {
            relationships.push({ fromExternalKey: subnetId, toExternalKey: subnetNsgId, relationType: 'protected_by' });
          }
        }
      }

      if (nodeType === 'vm') {
        const nics = (get(resource, ['properties', 'networkProfile', 'networkInterfaces']) as Array<{ id?: string }>) ?? [];
        for (const nic of nics) {
          if (nic.id) relationships.push({ fromExternalKey: resource.id, toExternalKey: nic.id, relationType: 'attached_to' });
        }
      }

      if (nodeType === 'nic') {
        const ipConfigs = (get(resource, ['properties', 'ipConfigurations']) as Array<Record<string, unknown>>) ?? [];
        for (const ipConfig of ipConfigs) {
          const subnetId = get(ipConfig, ['properties', 'subnet', 'id']) as string | undefined;
          if (subnetId) relationships.push({ fromExternalKey: resource.id, toExternalKey: subnetId, relationType: 'in_subnet' });

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

  // Drop relationships pointing at a resource type we didn't discover (e.g. a subnet outside the
  // registered scope) rather than leaving a dangling reference for discovery.service.ts to trip on.
  const knownKeys = new Set(discovered.map((r) => r.externalKey));
  const validRelationships = relationships.filter((r) => {
    const ok = knownKeys.has(r.fromExternalKey) && knownKeys.has(r.toExternalKey);
    if (!ok) warnings.push({ message: `dropped relationship ${r.relationType} — one endpoint was not discovered (out of scope)` });
    return ok;
  });

  return { resources: discovered, relationships: validRelationships, warnings };
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
