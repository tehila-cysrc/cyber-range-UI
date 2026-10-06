import { useRef, useState, type FormEvent } from 'react';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { confirmAction } from '../../../components/ConfirmDialog';
import { MoreMenu } from './MoreMenu';
import {
  inputStyle,
  linkButtonStyle,
  postJson,
  useRosterMutation,
  type Member,
  type Organization,
  type Team,
} from './rosterData';

interface Props {
  team: Team;
  allTeams: Team[];
  organizations: Organization[];
  expanded: boolean;
  onToggle: () => void;
}

export function TeamRow({ team, allTeams, organizations, expanded, onToggle }: Props) {
  const [changingOrg, setChangingOrg] = useState(false);
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  const setOrg = useRosterMutation(
    (organizationId: number | null) => postJson(`/admin/teams/${team.id}`, { organizationId }, 'PATCH'),
    'Could not change the organization',
    () => setChangingOrg(false),
  );
  const deleteTeam = useRosterMutation(() => postJson(`/admin/teams/${team.id}`, {}, 'DELETE'), 'Could not delete the team');
  // Self-registered students pick their own team; a wrong pick used to be unfixable (UX-10).
  const moveUser = useRosterMutation(
    ({ userId, teamId }: { userId: number; teamId: number }) => postJson(`/admin/users/${userId}`, { teamId }, 'PATCH'),
    'Could not move the student',
  );
  const deleteUser = useRosterMutation((id: number) => postJson(`/admin/users/${id}`, {}, 'DELETE'), 'Could not delete the account');
  const addStudent = useRosterMutation(
    () => postJson('/admin/users', { username, password, displayName, role: 'student', teamId: team.id }),
    'Could not create the account',
    () => {
      setUsername('');
      setPassword('');
      setDisplayName('');
      setFormError(null);
      usernameRef.current?.focus(); // ready for the next student
    },
  );

  // Deleting a team cascades to its accounts, timeline, canvas, scores and help requests.
  async function handleDeleteTeam() {
    const ok = await confirmAction({
      title: `Delete "${team.name}" permanently?`,
      message: `This removes its ${team.members.length} account(s) and ALL of its timeline entries, canvas, scores and help requests. This cannot be undone.`,
      requireText: team.name,
      confirmLabel: 'Delete team',
      danger: true,
    });
    if (ok) deleteTeam.mutate(undefined);
  }

  async function handleMove(m: Member, toTeamId: number) {
    const to = allTeams.find((t) => t.id === toTeamId);
    if (!to) return;
    const ok = await confirmAction({
      title: `Move ${m.displayName} to ${to.name}?`,
      message: `Their past timeline entries and scores stay with ${team.name}. They are signed out and join ${to.name} when they sign in again.`,
      confirmLabel: 'Move student',
    });
    if (ok) moveUser.mutate({ userId: m.id, teamId: toTeamId });
  }

  async function handleRemoveMember(m: Member) {
    const ok = await confirmAction({
      title: `Delete the account ${m.displayName} (@${m.username})?`,
      message: `They are removed from ${team.name} and can no longer sign in. An account that already recorded timeline entries or scores can't be deleted — move it to another team instead.`,
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (ok) deleteUser.mutate(m.id);
  }

  function handleAddStudent(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) return setFormError('Username is required');
    if (password.length < 8) return setFormError('Password must be at least 8 characters');
    addStudent.mutate(undefined);
  }

  // "Move to…" options grouped by organization, so a long team list stays scannable.
  const otherTeams = allTeams.filter((t) => t.id !== team.id);
  const moveGroups = [
    ...organizations.map((o) => ({ label: o.name, teams: otherTeams.filter((t) => t.organizationId === o.id) })),
    { label: 'No organization', teams: otherTeams.filter((t) => t.organizationId === null) },
  ].filter((g) => g.teams.length > 0);

  const menuItems = [
    ...(organizations.length > 0 ? [{ label: 'Change organization…', onSelect: () => setChangingOrg(true) }] : []),
    { label: 'Delete team', onSelect: handleDeleteTeam, danger: true },
  ];

  return (
    <div
      style={{
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-container)',
        background: 'var(--surface-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'start',
            color: 'var(--text-primary)',
            padding: 0,
          }}
        >
          <span aria-hidden style={{ color: 'var(--text-telemetry)', width: 12 }}>{expanded ? '▾' : '▸'}</span>
          <strong style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <bdi>{team.name}</bdi>
          </strong>
          <span className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)', whiteSpace: 'nowrap' }}>
            {team.members.length} student{team.members.length === 1 ? '' : 's'}
          </span>
        </button>
        <MoreMenu label={`Actions for ${team.name}`} items={menuItems} />
      </div>

      {changingOrg && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 12px 10px' }}>
          <select
            autoFocus
            defaultValue={team.organizationId ?? ''}
            aria-label={`Organization of ${team.name}`}
            disabled={setOrg.isPending}
            onChange={(e) => setOrg.mutate(e.target.value ? Number(e.target.value) : null)}
            style={{ ...inputStyle, flex: 1 }}
          >
            <option value="">No organization</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => setChangingOrg(false)} style={linkButtonStyle}>cancel</button>
        </div>
      )}

      {expanded && (
        <div style={{ borderTop: '1px solid var(--surface-border)', padding: '6px 12px 12px' }}>
          {team.members.length === 0 && (
            <div style={{ fontSize: 14, color: 'var(--text-telemetry)', padding: '6px 0' }}>No students yet.</div>
          )}
          {team.members.map((m) => (
            <div
              key={m.id}
              style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-muted)', padding: '5px 0' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Avatar name={m.displayName} size={22} />
                <bdi>{m.displayName}</bdi> <span className="tabular" style={{ color: 'var(--text-telemetry)' }}>@{m.username}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {moveGroups.length > 0 && (
                  <select
                    value=""
                    aria-label={`Move ${m.displayName} to another team`}
                    disabled={moveUser.isPending}
                    onChange={(e) => {
                      const toTeamId = Number(e.target.value);
                      if (toTeamId) void handleMove(m, toTeamId);
                    }}
                    style={{ ...inputStyle, padding: '2px 4px', color: 'var(--text-muted)', fontSize: 13 }}
                  >
                    <option value="">move to…</option>
                    {moveGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.teams.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => handleRemoveMember(m)}
                  aria-label={`Delete account ${m.displayName}`}
                  disabled={deleteUser.isPending}
                  style={{ ...linkButtonStyle, color: 'var(--signal-alert)' }}
                >
                  delete
                </button>
              </span>
            </div>
          ))}

          {adding ? (
            <form onSubmit={handleAddStudent} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <input ref={usernameRef} autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" aria-label="Username" autoComplete="off" style={{ ...inputStyle, flex: '1 1 120px' }} />
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min. 8)" aria-label="Password" autoComplete="new-password" style={{ ...inputStyle, flex: '1 1 120px' }} />
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (optional)" aria-label="Display name" style={{ ...inputStyle, flex: '1 1 140px' }} />
              <Button type="submit" variant="ghost" disabled={addStudent.isPending}>Add</Button>
              <button type="button" onClick={() => { setAdding(false); setFormError(null); }} style={linkButtonStyle}>cancel</button>
              {formError && <div style={{ flexBasis: '100%', color: 'var(--signal-alert)', fontSize: 13 }}>{formError}</div>}
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)} style={{ ...linkButtonStyle, color: 'var(--signal-primary)', marginTop: 8 }}>
              + Add student
            </button>
          )}
        </div>
      )}
    </div>
  );
}
