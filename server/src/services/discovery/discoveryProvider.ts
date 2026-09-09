// Provider-neutral discovery contract — the DB schema, discovery.service.ts orchestration, and the
// API/UI never reference "Azure" directly; only azureDiscoveryProvider.ts does. Adding AWS later is
// writing an AwsDiscoveryProvider against this same shape and registering it in discovery.service.ts's
// provider map — no schema, API, or client change.

export interface DiscoveredResource {
  externalKey: string; // globally unique, stable across re-runs (Azure: full ARM resource id)
  label: string;
  nodeType: string; // normalized: 'vm' | 'nic' | 'vnet' | 'subnet' | 'nsg' | 'public_ip' | 'load_balancer' | 'storage_account' | 'key_vault'
  metadata: Record<string, unknown>;
}

export interface DiscoveredRelationship {
  fromExternalKey: string;
  toExternalKey: string;
  relationType: string;
}

export interface DiscoveryWarning {
  resourceType?: string;
  message: string;
}

export interface DiscoveryResult {
  resources: DiscoveredResource[];
  relationships: DiscoveredRelationship[];
  warnings: DiscoveryWarning[];
}

export interface ResolvedCloudCredential {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  externalAccountId: string; // Azure subscriptionId
  externalScope: string | null; // Azure resource group name
}

export interface DiscoveryProvider {
  readonly providerKey: 'azure' | 'aws';
  discover(credential: ResolvedCloudCredential): Promise<DiscoveryResult>;
}
