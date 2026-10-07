import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { SideNav, type SideNavItem } from '../../components/SideNav';
import { OrgDetail } from './roster/OrgDetail';
import { InstructorsView } from './roster/InstructorsView';
import { StudentsView } from './roster/StudentsView';
import { TeamsView } from './roster/TeamsView';
import { OrganizationsView } from './roster/OrganizationsView';
import {
  inputStyle,
  linkButtonStyle,
  noOrgLabel,
  useRosterData,
  type Member,
  type Organization,
  type Selection,
  type Team,
} from './roster/rosterData';

// Roster: a side panel with four rows (Organizations / Teams / Students / Instructors), each opening a list
// in the main area and with its own "+" that opens that list's "New …" card. An organization opens from
// the Organizations list (with a breadcrumb back). Scales to many organizations/teams — only one
// organization's teams are ever on screen, and a single search box finds any organization,
// team or student. Selection lives in the URL (?org=<id>|none|orgs|teams|students|instructors, &team=<id>,
// &add=1) so a refresh or a shared link reopens the same place.
export function TeamsAdminPage() {
  const { teams, organizations, loaded } = useRosterData();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');

  const selection = resolveSelection(params.get('org'), organizations, loaded);
  const focusTeamId = params.get('team') ? Number(params.get('team')) : null;
  const adding = params.get('add') === '1';

  function select(next: Selection, teamId?: number, add = false) {
    const p: Record<string, string> = { org: selectionParam(next) };
    if (teamId) p.team = String(teamId);
    if (add) p.add = '1';
    setParams(p, { replace: true });
    setSearch('');
  }

  const selectedOrg = selection.kind === 'org' ? organizations.find((o) => o.id === selection.id) ?? null : null;

  return (
    <div className="page side-layout" style={{ padding: 'var(--space-xl)' }}>
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search organizations, teams, students…"
          aria-label="Search organizations, teams and students"
          style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
        />
        <Sidebar organizations={organizations} teams={teams} selection={selection} onSelect={select} />
      </aside>

      <main style={{ minWidth: 0 }}>
        {search.trim() ? (
          <SearchResults query={search.trim()} organizations={organizations} teams={teams} onSelect={select} />
        ) : !loaded ? null : selection.kind === 'orgs' ? (
          <OrganizationsView organizations={organizations} teams={teams} adding={adding} onCloseAdd={() => select(selection)} onSelect={select} />
        ) : selection.kind === 'teams' ? (
          <TeamsView teams={teams} organizations={organizations} adding={adding} onCloseAdd={() => select(selection)} onSelect={select} />
        ) : selection.kind === 'instructors' ? (
          <InstructorsView adding={adding} onCloseAdd={() => select(selection)} />
        ) : selection.kind === 'students' ? (
          <StudentsView teams={teams} organizations={organizations} adding={adding} onCloseAdd={() => select(selection)} onSelect={select} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
            <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: 'var(--text-telemetry)' }}>
              <button type="button" onClick={() => select({ kind: 'orgs' })} style={{ ...linkButtonStyle, color: 'var(--signal-primary)' }}>
                Organizations
              </button>
              {' › '}
              <bdi>{selectedOrg?.name ?? noOrgLabel(organizations)}</bdi>
            </nav>
            <OrgDetail
              org={selectedOrg}
              teams={teams}
              organizations={organizations}
              focusTeamId={focusTeamId}
              onDeleted={() => select({ kind: 'orgs' })}
            />
          </div>
        )}
      </main>
    </div>
  );
}

// Default: the Organizations list. A stale ?org= (e.g. the organization was deleted in another tab)
// falls back the same way.
function resolveSelection(raw: string | null, organizations: Organization[], loaded: boolean): Selection {
  if (raw === 'orgs' || raw === 'teams' || raw === 'students' || raw === 'instructors') return { kind: raw };
  if (raw === 'none') return { kind: 'none' };
  const id = Number(raw);
  if (raw && (!loaded || organizations.some((o) => o.id === id))) return { kind: 'org', id };
  return { kind: 'orgs' };
}

// The ?org= value.
function selectionParam(s: Selection) {
  return s.kind === 'org' ? String(s.id) : s.kind;
}

type ListKey = 'orgs' | 'teams' | 'students' | 'instructors';

// The sidebar row to highlight: a single organization (or the unassigned teams) belongs to Organizations.
function sidebarKey(s: Selection): ListKey {
  return s.kind === 'org' || s.kind === 'none' ? 'orgs' : s.kind;
}

function Sidebar({
  organizations,
  teams,
  selection,
  onSelect,
}: {
  organizations: Organization[];
  teams: Team[];
  selection: Selection;
  onSelect: (s: Selection, teamId?: number, add?: boolean) => void;
}) {
  const { data: instructorData } = useQuery({
    queryKey: ['admin-instructors'],
    queryFn: () => apiFetch<{ instructors: Member[] }>('/admin/instructors'),
  });
  const instructorCount = instructorData?.instructors.length ?? 0;
  const totalStudents = teams.reduce((n, t) => n + t.members.length, 0);

  // A top-level row: opens its list; "+" opens the same list with the "New …" card.
  const row = (key: ListKey, label: string, count: number, noun: string, addLabel: string): SideNavItem => ({
    key,
    label,
    meta: String(count),
    metaTitle: `${count} ${noun}`,
    onAdd: () => onSelect({ kind: key }, undefined, true),
    addLabel,
  });

  return (
    <SideNav
      title="Roster"
      hideTitle
      groups={[
        {
          items: [
            row('orgs', 'Organizations', organizations.length, 'organizations', 'New organization'),
            row('teams', 'Teams', teams.length, 'teams', 'New team'),
            row('students', 'Students', totalStudents, 'students', 'New student'),
            row('instructors', 'Instructors', instructorCount, 'instructors', 'New instructor'),
          ],
        },
      ]}
      activeKey={sidebarKey(selection)}
      onSelect={(key) => onSelect({ kind: key as ListKey })}
    />
  );
}

// One flat result list across every organization — each hit says where it lives, and clicking it
// opens that organization with the team expanded.
function SearchResults({
  query,
  organizations,
  teams,
  onSelect,
}: {
  query: string;
  organizations: Organization[];
  teams: Team[];
  onSelect: (s: Selection, teamId?: number) => void;
}) {
  const q = query.toLowerCase();
  const where = (t: Team): Selection => (t.organizationId === null ? { kind: 'none' } : { kind: 'org', id: t.organizationId });
  const orgLabel = (t: Team) => t.organizationName ?? 'No organization';

  const orgHits = organizations.filter((o) => o.name.toLowerCase().includes(q));
  const teamHits = teams.filter((t) => t.name.toLowerCase().includes(q));
  const studentHits = teams.flatMap((t) =>
    t.members
      .filter((m) => m.displayName.toLowerCase().includes(q) || m.username.toLowerCase().includes(q))
      .map((m) => ({ m, t })),
  );

  const rows: { key: string; kind: string; primary: string; secondary: string; go: () => void }[] = [
    ...orgHits.map((o) => ({ key: `o${o.id}`, kind: 'Organization', primary: o.name, secondary: `${o.teamCount} teams`, go: () => onSelect({ kind: 'org', id: o.id }) })),
    ...teamHits.map((t) => ({ key: `t${t.id}`, kind: 'Team', primary: t.name, secondary: orgLabel(t), go: () => onSelect(where(t), t.id) })),
    ...studentHits.map(({ m, t }) => ({
      key: `s${m.id}`,
      kind: 'Student',
      primary: `${m.displayName} @${m.username}`,
      secondary: `${t.name} · ${orgLabel(t)}`,
      go: () => onSelect(where(t), t.id),
    })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <h1 style={{ fontSize: 18, color: 'var(--text-primary)', margin: 0 }}>
        {rows.length} result{rows.length === 1 ? '' : 's'} for “{query}”
      </h1>
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={r.go}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            textAlign: 'start',
            padding: '10px 12px',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-container)',
            background: 'var(--surface-1)',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-telemetry)', width: 90, flexShrink: 0 }}>
            {r.kind}
          </span>
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <bdi style={{ color: 'var(--text-primary)', fontSize: 14 }}>{r.primary}</bdi>
            <bdi style={{ color: 'var(--text-muted)', fontSize: 13 }}>{r.secondary}</bdi>
          </span>
        </button>
      ))}
    </div>
  );
}
