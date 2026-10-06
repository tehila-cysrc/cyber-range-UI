import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SideNav, type SideNavItem } from '../../components/SideNav';
import { OrgDetail } from './roster/OrgDetail';
import { InstructorsView } from './roster/InstructorsView';
import {
  inputStyle,
  postJson,
  useRosterData,
  useRosterMutation,
  type Organization,
  type Selection,
  type Team,
} from './roster/rosterData';

// Roster: organizations on the side, the selected one in the main area (teams collapsed by default).
// Scales to many organizations/teams — only one organization's teams are ever on screen, and a single
// search box finds any organization, team or student. Selection lives in the URL (?org=<id>|none|
// instructors, &team=<id>) so a refresh or a shared link reopens the same place.
export function TeamsAdminPage() {
  const { teams, organizations, loaded } = useRosterData();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');

  const selection = resolveSelection(params.get('org'), organizations, loaded);
  const focusTeamId = params.get('team') ? Number(params.get('team')) : null;

  function select(next: Selection, teamId?: number) {
    const p: Record<string, string> = { org: next.kind === 'org' ? String(next.id) : next.kind };
    if (teamId) p.team = String(teamId);
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
        ) : !loaded ? null : selection.kind === 'instructors' ? (
          <InstructorsView />
        ) : (
          <OrgDetail
            org={selectedOrg}
            teams={teams}
            organizations={organizations}
            focusTeamId={focusTeamId}
            onDeleted={() => select({ kind: 'none' })}
          />
        )}
      </main>
    </div>
  );
}

// Default: the first organization, or the unassigned teams when there are none. A stale ?org= (e.g.
// the organization was deleted in another tab) falls back the same way.
function resolveSelection(raw: string | null, organizations: Organization[], loaded: boolean): Selection {
  if (raw === 'instructors') return { kind: 'instructors' };
  if (raw === 'none') return { kind: 'none' };
  const id = Number(raw);
  if (raw && (!loaded || organizations.some((o) => o.id === id))) return { kind: 'org', id };
  return organizations.length > 0 ? { kind: 'org', id: organizations[0].id } : { kind: 'none' };
}

function selectionKey(s: Selection) {
  return s.kind === 'org' ? `org-${s.id}` : s.kind;
}

function keyToSelection(key: string): Selection {
  if (key === 'none' || key === 'instructors') return { kind: key };
  return { kind: 'org', id: Number(key.slice(4)) };
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
  onSelect: (s: Selection) => void;
}) {
  const students = (orgId: number | null) =>
    teams.filter((t) => t.organizationId === orgId).reduce((n, t) => n + t.members.length, 0);
  const unassignedTeams = teams.filter((t) => t.organizationId === null).length;
  const meta = (teamCount: number, studentCount: number) => ({
    meta: `${teamCount} · ${studentCount}`,
    metaTitle: `${teamCount} teams · ${studentCount} students`,
  });

  const orgItems: SideNavItem[] = [
    ...organizations.map((o) => ({
      key: `org-${o.id}`,
      label: o.name,
      ...meta(o.teamCount, students(o.id)),
      dot: o.joinCode ? { title: 'Join code open' } : undefined,
    })),
    // Always offered when there are no organizations (it's then simply "Teams"); otherwise only when
    // some team is actually unassigned.
    ...(organizations.length === 0 || unassignedTeams > 0
      ? [{
          key: 'none',
          label: organizations.length > 0 ? 'No organization' : 'Teams',
          ...meta(unassignedTeams, students(null)),
          muted: organizations.length > 0,
        }]
      : []),
  ];

  return (
    <SideNav
      title="Organizations"
      groups={[{ items: orgItems }, { items: [{ key: 'instructors', label: 'Instructors' }] }]}
      activeKey={selectionKey(selection)}
      onSelect={(key) => onSelect(keyToSelection(key))}
      addLabel="New organization"
      renderAdd={(close) => <NewOrganizationForm onCreated={(id) => { close(); onSelect({ kind: 'org', id }); }} onCancel={close} />}
      filterThreshold={12}
    />
  );
}

function NewOrganizationForm({ onCreated, onCancel }: { onCreated: (id: number) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const create = useRosterMutation(
    () => postJson('/admin/organizations', { name }) as Promise<{ organization: Organization }>,
    'Could not create the organization',
  );

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(undefined, {
      onSuccess: (res) => onCreated((res as { organization: Organization }).organization.id),
    });
  }

  return (
    <form onSubmit={handleCreate} style={{ display: 'flex', gap: 6 }}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        placeholder="Organization name"
        aria-label="Organization name"
        style={{ ...inputStyle, flex: 1, padding: 6 }}
      />
      <button type="submit" disabled={create.isPending} style={{ ...inputStyle, cursor: 'pointer', padding: '6px 10px' }}>Add</button>
    </form>
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
