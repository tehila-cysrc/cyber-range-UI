import { useState, type FormEvent } from 'react';
import { AddCard, SectionHeader, SectionView } from './RosterSection';
import { inputStyle, postJson, useRosterMutation, type Organization, type Selection, type Team } from './rosterData';

// Every team of the run in one list, grouped by organization. Clicking a team opens its organization
// with that team expanded (members, move/delete live there).
export function TeamsView({
  teams,
  organizations,
  adding,
  onCloseAdd,
  onSelect,
}: {
  teams: Team[];
  organizations: Organization[];
  adding: boolean;
  onCloseAdd: () => void;
  onSelect: (s: Selection, teamId?: number) => void;
}) {
  const groups = [
    ...organizations.map((o) => ({ key: `o${o.id}`, label: o.name, teams: teams.filter((t) => t.organizationId === o.id) })),
    { key: 'none', label: 'No organization', teams: teams.filter((t) => t.organizationId === null) },
  ].filter((g) => g.teams.length > 0);

  return (
    <SectionView>
      <SectionHeader
        title="Teams"
        subtitle={`${teams.length} team${teams.length === 1 ? '' : 's'} across ${organizations.length} organization${organizations.length === 1 ? '' : 's'}`}
      />

      {adding && <NewTeamCard organizations={organizations} onClose={onCloseAdd} onCreated={(s, id) => onSelect(s, id)} />}

      {groups.length === 0 ? (
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No teams yet.</div>
      ) : (
        groups.map((g) => (
          <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-telemetry)' }}><bdi>{g.label}</bdi></div>
            <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)', background: 'var(--surface-1)', padding: '6px 12px' }}>
              {g.teams.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect(t.organizationId === null ? { kind: 'none' } : { kind: 'org', id: t.organizationId }, t.id)}
                  title={`Open ${t.name}`}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', textAlign: 'start', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '6px 0' }}
                >
                  <bdi style={{ color: 'var(--text-primary)' }}>{t.name}</bdi>
                  <span className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)', flexShrink: 0 }}>
                    {t.members.length} student{t.members.length === 1 ? '' : 's'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </SectionView>
  );
}

function NewTeamCard({
  organizations,
  onClose,
  onCreated,
}: {
  organizations: Organization[];
  onClose: () => void;
  onCreated: (s: Selection, teamId: number) => void;
}) {
  const [name, setName] = useState('');
  const [orgId, setOrgId] = useState(organizations.length === 1 ? String(organizations[0].id) : '');
  const [formError, setFormError] = useState<string | null>(null);
  const create = useRosterMutation(
    () => postJson('/admin/teams', { name, organizationId: orgId ? Number(orgId) : null }) as Promise<{ team: { id: number } }>,
    'Could not create the team',
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setFormError('Name is required');
    create.mutate(undefined, {
      // Open the new team where students get added to it.
      onSuccess: (res) => onCreated(orgId ? { kind: 'org', id: Number(orgId) } : { kind: 'none' }, (res as { team: { id: number } }).team.id),
    });
  }

  return (
    <AddCard title="New team" submitLabel="Create team" pending={create.isPending} error={formError} onSubmit={handleSubmit} onClose={onClose}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name" aria-label="Team name" style={inputStyle} />
      {organizations.length > 0 && (
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="Organization" style={inputStyle}>
          <option value="">No organization</option>
          {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
    </AddCard>
  );
}
