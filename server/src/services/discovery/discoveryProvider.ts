// Provider-neutral discovery contract — the DB schema, discovery.service.ts orchestration, and the
// API/UI never reference "Azure" directly; only azureDiscoveryProvider.ts does. Adding AWS later is
// writing an AwsDiscoveryProvider against this same shape and registering it in discovery.service.ts's
// provider map — no schema, API, or client change.

// A logical network zone (DMZ, Internal, ...) — Azure vnets/subnets are never their own topology
// node; a subnet becomes a zone instead (see azureDiscoveryProvider.ts). externalKey is the subnet's
// ARM id, used as the zone's upsert key so a re-discovery updates cidr in place and an instructor's
// rename is preserved (discovery.service.ts never overwrites `name` on conflict).
export interface DiscoveredZone {
  externalKey: string;
  name: string;
  cidr: string | null;
}

export interface DiscoveredResource {
  externalKey: string; // globally unique, stable across re-runs (Azure: full ARM resource id)
  label: string;
  nodeType: string; // normalized: 'vm' | 'nic' | 'nsg' | 'public_ip' | 'load_balancer' | 'storage_account' | 'key_vault'
  metadata: Record<string, unknown>;
  zoneExternalKey: string | null; // resolved subnet ARM id this node lives in, if derivable
  role: string | null; // cyber-exercise role for a 'vm' (e.g. domain_controller, kali_attacker, siem) — heuristically inferred, instructor-editable
  isVisibleToStudents: boolean; // default visibility computed per node_type; instructor can override
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
  zones: DiscoveredZone[];
  resources: DiscoveredResource[];
  relationships: DiscoveredRelationship[];
  warnings: DiscoveryWarning[];
  // Environment-level infrastructure facts (Phase 2) — not topology nodes themselves, just captured
  // for cloud_environments so the Bastion Connect / Key Vault credential flow knows where to point.
  // Null when nothing of that type was found in the queried scope.
  bastionHostId: string | null;
  keyVaultUri: string | null;
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
