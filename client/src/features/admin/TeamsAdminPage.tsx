import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
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
    <div className="page roster-layout" style={{ padding: 'var(--space-xl)' }}>
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

function sameSelection(a: Selection, b: Selection) {
  return a.kind === b.kind && (a.kind !== 'org' || (b.kind === 'org' && a.id === b.id));
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
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const create = useRosterMutation(
    () => postJson('/admin/organizations', { name }) as Promise<{ organization: Organization }>,
    'Could not create the organization',
  );

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(undefined, {
      onSuccess: (res) => {
        setName('');
        setCreating(false);
        onSelect({ kind: 'org', id: (res as { organization: Organization }).organization.id });
      },
    });
  }

  const students = (orgId: number | null) =>
    teams.filter((t) => t.organizationId === orgId).reduce((n, t) => n + t.members.length, 0);
  const unassignedTeams = teams.filter((t) => t.organizationId === null).length;

  const entries: { key: string; sel: Selection; label: string; teams: number; students: number; codeOpen: boolean }[] = [
    ...organizations.map((o) => ({
      key: `org-${o.id}`,
      sel: { kind: 'org', id: o.id } as Selection,
      label: o.name,
      teams: o.teamCount,
      students: students(o.id),
      codeOpen: !!o.joinCode,
    })),
    // Always offered when there are no organizations (it's then simply "Teams"); otherwise only when
    // some team is actually unassigned.
    ...(organizations.length === 0 || unassignedTeams > 0
      ? [{
          key: 'none',
          sel: { kind: 'none' } as Selection,
          label: organizations.length > 0 ? 'No organization' : 'Teams',
          teams: unassignedTeams,
          students: students(null),
          codeOpen: false,
        }]
      : []),
  ];

  return (
    <>
      {/* Narrow screens: the list collapses into a single picker. */}
      <select
        className="roster-picker"
        aria-label="Organization"
        value={selection.kind === 'org' ? `org-${selection.id}` : selection.kind}
        onChange={(e) => {
          const v = e.target.value;
          onSelect(v === 'none' ? { kind: 'none' } : v === 'instructors' ? { kind: 'instructors' } : { kind: 'org', id: Number(v.slice(4)) });
        }}
        style={{ ...inputStyle, width: '100%' }}
      >
        {entries.map((e) => (
          <option key={e.key} value={e.key}>
            {e.label} ({e.teams})
          </option>
        ))}
        <option value="instructors">Instructors</option>
      </select>

      <nav aria-label="Organizations" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-telemetry)' }}>
            Organizations
          </span>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            aria-label="New organization"
            title="New organization"
            style={{ background: 'none', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-control)', color: 'var(--text-primary)', cursor: 'pointer', width: 26, height: 26, fontSize: 16, lineHeight: 1 }}
          >
            +
          </button>
        </div>
        {creating && (
          <form onSubmit={handleCreate} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
              placeholder="Organization name"
              aria-label="Organization name"
              style={{ ...inputStyle, flex: 1, padding: 6 }}
            />
            <button type="submit" disabled={create.isPending} style={{ ...inputStyle, cursor: 'pointer', padding: '6px 10px' }}>Add</button>
          </form>
        )}
        {/* The header and "+" stay visible on narrow screens; only the list gives way to the picker. */}
        <div className="roster-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {organizations.length === 0 && !creating && (
          <div style={{ fontSize: 13, color: 'var(--text-telemetry)', padding: '2px 0 6px' }}>No organizations yet.</div>
        )}
        {entries.map((e) => (
          <SidebarItem
            key={e.key}
            active={sameSelection(selection, e.sel)}
            onClick={() => onSelect(e.sel)}
            label={e.label}
            muted={e.key === 'none' && organizations.length > 0}
            meta={`${e.teams} · ${e.students}`}
            metaTitle={`${e.teams} teams · ${e.students} students`}
            codeOpen={e.codeOpen}
          />
        ))}
        <div style={{ borderTop: '1px solid var(--surface-border)', margin: '8px 0' }} />
        <SidebarItem active={selection.kind === 'instructors'} onClick={() => onSelect({ kind: 'instructors' })} label="Instructors" />
        </div>
      </nav>
    </>
  );
}

function SidebarItem({
  active,
  onClick,
  label,
  meta,
  metaTitle,
  codeOpen = false,
  muted = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  meta?: string;
  metaTitle?: string;
  codeOpen?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'start',
        padding: '7px 10px',
        borderRadius: 'var(--radius-control)',
        border: 'none',
        borderInlineStart: `2px solid ${active ? 'var(--signal-primary)' : 'transparent'}`,
        background: active ? 'var(--surface-2)' : 'transparent',
        color: muted ? 'var(--text-muted)' : 'var(--text-primary)',
        fontStyle: muted ? 'italic' : 'normal',
        cursor: 'pointer',
        fontSize: 14,
      }}
    >
      <span
        aria-label={codeOpen ? 'registration open' : undefined}
        title={codeOpen ? 'Join code open' : undefined}
        style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: codeOpen ? 'var(--signal-primary)' : 'transparent' }}
      />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <bdi>{label}</bdi>
      </span>
      {meta && (
        <span className="tabular" title={metaTitle} style={{ fontSize: 12, color: 'var(--text-telemetry)', flexShrink: 0 }}>
          {meta}
        </span>
      )}
    </button>
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
