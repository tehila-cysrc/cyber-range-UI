import { useState, type FormEvent } from 'react';
import { AddCard, SectionHeader, SectionView } from './RosterSection';
import { inputStyle, postJson, useRosterMutation, type Organization, type Selection, type Team } from './rosterData';

// Every organization in one list (plus the unassigned teams, when there are any). Clicking a row opens
// that organization — its join code and teams live there.
export function OrganizationsView({
  organizations,
  teams,
  adding,
  onCloseAdd,
  onSelect,
}: {
  organizations: Organization[];
  teams: Team[];
  adding: boolean;
  onCloseAdd: () => void;
  onSelect: (s: Selection) => void;
}) {
  const studentsOf = (orgId: number | null) =>
    teams.filter((t) => t.organizationId === orgId).reduce((n, t) => n + t.members.length, 0);
  const unassigned = teams.filter((t) => t.organizationId === null).length;

  const rows = [
    ...organizations.map((o) => ({
      key: `o${o.id}`,
      name: o.name,
      teamCount: o.teamCount,
      studentCount: studentsOf(o.id),
      joinOpen: !!o.joinCode,
      muted: false,
      go: () => onSelect({ kind: 'org', id: o.id }),
    })),
    ...(unassigned > 0
      ? [{ key: 'none', name: 'No organization', teamCount: unassigned, studentCount: studentsOf(null), joinOpen: false, muted: true, go: () => onSelect({ kind: 'none' }) }]
      : []),
  ];

  return (
    <SectionView>
      <SectionHeader
        title="Organizations"
        subtitle={`${organizations.length} organization${organizations.length === 1 ? '' : 's'} · ${teams.length} team${teams.length === 1 ? '' : 's'}`}
      />

      {adding && <NewOrganizationCard onClose={onCloseAdd} onCreated={(id) => onSelect({ kind: 'org', id })} />}

      {rows.length === 0 ? (
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No organizations yet.</div>
      ) : (
        <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)', background: 'var(--surface-1)', padding: '6px 12px' }}>
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={r.go}
              title={`Open ${r.name}`}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', textAlign: 'start', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '6px 0' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <bdi style={{ color: r.muted ? 'var(--text-muted)' : 'var(--text-primary)', fontStyle: r.muted ? 'italic' : 'normal' }}>{r.name}</bdi>
                {r.joinOpen && <span style={{ fontSize: 12, color: 'var(--signal-primary)' }}>join code open</span>}
              </span>
              <span className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)', flexShrink: 0 }}>
                {r.teamCount} team{r.teamCount === 1 ? '' : 's'} · {r.studentCount} student{r.studentCount === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      )}
    </SectionView>
  );
}

function NewOrganizationCard({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const create = useRosterMutation(
    () => postJson('/admin/organizations', { name }) as Promise<{ organization: Organization }>,
    'Could not create the organization',
  );

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setFormError('Name is required');
    create.mutate(undefined, {
      onSuccess: (res) => onCreated((res as { organization: Organization }).organization.id),
    });
  }

  return (
    <AddCard title="New organization" submitLabel="Create organization" pending={create.isPending} error={formError} onSubmit={handleCreate} onClose={onClose}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Organization name" aria-label="Organization name" style={inputStyle} />
    </AddCard>
  );
}
