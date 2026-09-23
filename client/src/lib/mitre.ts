import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './apiClient';

// Static MITRE ATT&CK Enterprise catalog served by GET /api/mitre/catalog (server/src/data/mitre).
// Same file for every role and never the scenario's expected list — so it's fetched once and cached
// for the session.
export interface MitreTactic {
  id: string;
  shortname: string;
  name: string;
  order: number;
}

export interface MitreTechnique {
  id: string;
  name: string;
  tacticIds: string[];
  parentId: string | null;
}

export interface MitreCatalog {
  attackVersion: string;
  tactics: MitreTactic[];
  techniques: MitreTechnique[];
}

export interface IndexedCatalog extends MitreCatalog {
  techniqueById: Map<string, MitreTechnique>;
  tacticById: Map<string, MitreTactic>;
}

export function useMitreCatalog() {
  return useQuery({
    queryKey: ['mitre-catalog'],
    queryFn: async (): Promise<IndexedCatalog> => {
      const catalog = await apiFetch<MitreCatalog>('/mitre/catalog');
      return {
        ...catalog,
        techniqueById: new Map(catalog.techniques.map((t) => [t.id, t])),
        tacticById: new Map(catalog.tactics.map((t) => [t.id, t])),
      };
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

// "Account Discovery: Local Account" — a sub-technique's own name is meaningless without its parent.
export function techniqueDisplayName(catalog: IndexedCatalog | undefined, id: string): string {
  const technique = catalog?.techniqueById.get(id);
  if (!technique) return 'Unknown technique';
  const parent = technique.parentId ? catalog?.techniqueById.get(technique.parentId) : undefined;
  return parent ? `${parent.name}: ${technique.name}` : technique.name;
}

export function tacticNames(catalog: IndexedCatalog | undefined, technique: MitreTechnique): string {
  return technique.tacticIds.map((id) => catalog?.tacticById.get(id)?.name ?? id).join(' · ');
}

// Ranked search over id and name: exact id > id prefix > name/parent-name word match.
export function searchTechniques(catalog: IndexedCatalog, query: string, limit = 40): MitreTechnique[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { t: MitreTechnique; score: number }[] = [];
  for (const t of catalog.techniques) {
    const id = t.id.toLowerCase();
    const name = techniqueDisplayName(catalog, t.id).toLowerCase();
    let score = -1;
    if (id === q) score = 0;
    else if (id.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (name.includes(q)) score = 3;
    if (score >= 0) scored.push({ t, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.t.id.localeCompare(b.t.id, 'en', { numeric: true }))
    .slice(0, limit)
    .map((s) => s.t);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60 ? `${seconds % 60}s` : ''}`.trim();
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// Shapes returned by the server's MTTD layer (server/src/services/ttpMatching.ts).
export type MttdResult =
  | { measurable: true; occurredAt: string; mttdSeconds: number }
  | { measurable: false; reason: 'no_occurrence_recorded' | 'detected_before_recorded_occurrence' };

export interface MttdSummary {
  meanSeconds: number | null;
  measuredCount: number;
  detectedCount: number;
}

export function mttdLabel(mttd: MttdResult): string {
  if (mttd.measurable) return formatDuration(mttd.mttdSeconds);
  return mttd.reason === 'no_occurrence_recorded' ? 'N/A — no occurrence recorded' : 'N/A — tagged before recorded occurrence';
}

export function mttdSummaryLabel(summary: MttdSummary): string {
  if (summary.meanSeconds == null) return 'MTTD N/A';
  return `MTTD ${formatDuration(summary.meanSeconds)} (${summary.measuredCount}/${summary.detectedCount} measured)`;
}

// GET /admin/cyber-ranges/:id/ttp-report (instructor) and the revealed student ttp-summary.
export interface TtpDetection {
  id: number;
  detectedAt: string;
  pointsAwarded: number;
  source: 'auto' | 'instructor';
  creditedUserName: string | null;
  taggedTechniqueId: string | null;
  documentationEntryId: number | null;
  entryExcerpt: string | null;
  mttd: MttdResult;
}

export interface TtpExpectedResult {
  expectedTtpId: number;
  techniqueId: string;
  techniqueName: string;
  tacticId: string;
  tacticName: string;
  points: number;
  description?: string | null;
  status: 'detected' | 'missed';
  voided: boolean;
  detection: TtpDetection | null;
}

export interface TeamTtpReport {
  teamId: number;
  teamName: string;
  cyberRangeId: number;
  expected: TtpExpectedResult[];
  incorrect: { techniqueId: string; techniqueName: string; firstTaggedAt: string; stillTagged: boolean }[];
  totals: {
    earnedPoints: number;
    availablePoints: number;
    expectedCount: number;
    detectedCount: number;
    incorrectCount: number;
    distinctTaggedCount: number;
    precision: number | null;
  };
  mttd: MttdSummary;
}

export interface EntryTtp {
  techniqueId: string;
  techniqueName: string;
  credited: boolean;
}

export interface TtpBudget {
  limit: number;
  used: number;
}
