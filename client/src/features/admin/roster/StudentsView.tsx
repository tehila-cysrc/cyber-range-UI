import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/apiClient';
import { useToastStore } from '../../../stores/toastStore';
import { CertificateDialog } from '../../certificate/DownloadCertificateButton';
import { Avatar } from '../../../components/Avatar';
import { AvatarPicker } from '../../../components/AvatarPicker';
import { AddCard, SectionHeader, SectionView } from './RosterSection';
import { inputStyle, linkButtonStyle, postJson, useRosterMutation, type Member, type Organization, type Selection, type Team } from './rosterData';

// Every student of the run in one list, sorted by name. Each row says which team and organization
// they're in; clicking it opens that organization with the team expanded (where moving/deleting lives).
export function StudentsView({
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
  const students = teams
    .flatMap((t) => t.members.map((m) => ({ m, t })))
    .sort((a, b) => a.m.displayName.localeCompare(b.m.displayName));
  const { data: grants } = useQuery({
    queryKey: ['certificate-grants'],
    queryFn: () => apiFetch<{ grants: Array<{ userId: number }>; completedTeamIds: number[] }>('/admin/certificate-grants'),
  });
  const grantedIds = new Set(grants?.grants.map((g) => g.userId));
  const completedTeams = new Set(grants?.completedTeamIds);

  return (
    <SectionView>
      <SectionHeader
        title="Students"
        subtitle={`${students.length} account${students.length === 1 ? '' : 's'} across ${teams.length} team${teams.length === 1 ? '' : 's'}`}
      />

      {adding && <NewStudentCard teams={teams} organizations={organizations} onClose={onCloseAdd} />}

      {students.length === 0 ? (
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No students yet.</div>
      ) : (
        <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)', background: 'var(--surface-1)', padding: '6px 12px' }}>
          {students.map(({ m, t }) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                onClick={() => onSelect(t.organizationId === null ? { kind: 'none' } : { kind: 'org', id: t.organizationId }, t.id)}
                title={`Open ${t.name}`}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, textAlign: 'start', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)', padding: '6px 0' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Avatar name={m.displayName} avatar={m.avatar} size={22} />
                  <bdi style={{ color: 'var(--text-primary)' }}>{m.displayName}</bdi>
                  <span className="tabular" style={{ color: 'var(--text-telemetry)' }}>@{m.username}</span>
                </span>
                <bdi style={{ fontSize: 13, color: 'var(--text-telemetry)', flexShrink: 0 }}>
                  {t.name} · {t.organizationName ?? 'No organization'}
                </bdi>
              </button>
              <CertificateControls member={m} granted={grantedIds.has(m.id)} earned={completedTeams.has(t.id)} />
            </div>
          ))}
        </div>
      )}
    </SectionView>
  );
}

// Certificate fallback when completion wasn't recorded or the student's download fails: "Grant" lets the
// student download it themselves (header button); "Download" issues it here, pre-filled with their name.
function CertificateControls({ member, granted, earned }: { member: Member; granted: boolean; earned: boolean }) {
  const [issuing, setIssuing] = useState(false);
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  const toggle = useMutation({
    mutationFn: () => apiFetch(`/admin/users/${member.id}/certificate-grant`, { method: granted ? 'DELETE' : 'PUT' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['certificate-grants'] }),
    onError: (err) => pushToast(err instanceof Error ? err.message : 'Couldn’t update the certificate'),
  });
  return (
    <span style={{ display: 'flex', gap: 12, flexShrink: 0, fontSize: 13 }}>
      {earned && !granted ? (
        <span title="Their team completed a scenario — the Certificate button is already in their header" style={{ color: 'var(--signal-primary)' }}>
          ✓ Earned
        </span>
      ) : (
        <button
          type="button"
          onClick={() => toggle.mutate()}
          disabled={toggle.isPending}
          title={granted ? 'Click to take the certificate back' : 'Let this student download the certificate even without a completed scenario'}
          style={{ ...linkButtonStyle, color: granted ? 'var(--signal-primary)' : 'var(--signal-secondary)' }}
        >
          {granted ? '✓ Certificate granted' : 'Grant certificate'}
        </button>
      )}
      <button type="button" onClick={() => setIssuing(true)} aria-label={`Download a certificate for ${member.displayName}`} style={linkButtonStyle}>
        Download
      </button>
      {issuing && <CertificateDialog initialName={member.displayName} onClose={() => setIssuing(false)} />}
    </span>
  );
}

// A student always belongs to a team, so the card asks for one (grouped by organization). Stays open
// after a create, ready for the next student — same as "+ Add student" inside a team.
function NewStudentCard({ teams, organizations, onClose }: { teams: Team[]; organizations: Organization[]; onClose: () => void }) {
  const [teamId, setTeamId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  const create = useRosterMutation(
    () => postJson('/admin/users', { username, password, displayName, avatar, role: 'student', teamId: Number(teamId) }),
    'Could not create the account',
    () => {
      setUsername('');
      setPassword('');
      setDisplayName('');
      setAvatar(null);
      setFormError(null);
      usernameRef.current?.focus();
    },
  );

  const teamGroups = [
    ...organizations.map((o) => ({ label: o.name, teams: teams.filter((t) => t.organizationId === o.id) })),
    { label: 'No organization', teams: teams.filter((t) => t.organizationId === null) },
  ].filter((g) => g.teams.length > 0);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!teamId) return setFormError('Pick a team');
    if (!username.trim()) return setFormError('Username is required');
    if (password.length < 8) return setFormError('Password must be at least 8 characters');
    create.mutate(undefined);
  }

  return (
    <AddCard title="New student" submitLabel="Create student" pending={create.isPending} error={formError} onSubmit={handleSubmit} onClose={onClose}>
      {teams.length === 0 ? (
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>There are no teams yet — add a team in an organization first.</div>
      ) : (
        <>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team" style={inputStyle}>
            <option value="">Team…</option>
            {teamGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            ))}
          </select>
          <input ref={usernameRef} autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" aria-label="Username" autoComplete="off" style={inputStyle} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min. 8 characters)" aria-label="Password" autoComplete="new-password" style={inputStyle} />
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (optional)" aria-label="Display name" style={inputStyle} />
          <AvatarPicker name={displayName || username} value={avatar} onChange={setAvatar} collapsible />
        </>
      )}
    </AddCard>
  );
}
