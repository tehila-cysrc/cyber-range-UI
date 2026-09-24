import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { confirmAction } from '../../components/ConfirmDialog';
import { useToastStore } from '../../stores/toastStore';
import { Avatar } from '../../components/Avatar';

interface Member {
  id: number;
  username: string;
  displayName: string;
}

interface TeamWithMembers {
  id: number;
  name: string;
  members: Member[];
}

// Onboards a new cohort's roster — the counterpart to Phase 9's event reset, which wipes teams/
// accounts but has no in-product way to add new ones back (see BACKLOG.md).
export function TeamsAdminPage() {
  const queryClient = useQueryClient();
  const [teamName, setTeamName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'student' | 'instructor'>('student');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['admin-teams'],
    queryFn: () => apiFetch<{ teams: TeamWithMembers[] }>('/admin/teams'),
  });

  // Student self-registration is closed unless opened here; opening issues a fresh join code.
  const { data: registration } = useQuery({
    queryKey: ['admin-registration'],
    queryFn: () => apiFetch<{ open: boolean; joinCode: string | null }>('/admin/registration'),
  });
  const setRegistration = useMutation({
    mutationFn: (open: boolean) =>
      apiFetch<{ open: boolean; joinCode: string | null }>('/admin/registration', { method: 'PUT', body: JSON.stringify({ open }) }),
    onSuccess: (res) => queryClient.setQueryData(['admin-registration'], res),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
  }

  const [search, setSearch] = useState('');
  const pushToast = useToastStore((s) => s.push);

  // Self-registered students pick their own team; a wrong pick used to be unfixable (UX-10).
  const moveUser = useMutation({
    mutationFn: ({ userId, teamId }: { userId: number; teamId: number }) =>
      apiFetch(`/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ teamId }) }),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
    },
    onError: (err) => pushToast(err instanceof Error ? err.message : 'Could not move the student'),
  });

  async function handleMove(m: Member, from: TeamWithMembers, toTeamId: number) {
    const to = data?.teams.find((t) => t.id === toTeamId);
    if (!to) return;
    const ok = await confirmAction({
      title: `Move ${m.displayName} to ${to.name}?`,
      message: `Their past timeline entries and scores stay with ${from.name}. They are signed out and join ${to.name} when they sign in again.`,
      confirmLabel: 'Move student',
    });
    if (ok) moveUser.mutate({ userId: m.id, teamId: toTeamId });
  }

  const createTeam = useMutation({
    mutationFn: () => apiFetch('/admin/teams', { method: 'POST', body: JSON.stringify({ name: teamName }) }),
    onSuccess: () => {
      setTeamName('');
      refresh();
    },
  });

  // Deleting a team cascades to its accounts, timeline, canvas, scores and help requests — one
  // stray click mid-exercise used to wipe a whole team's investigation with no prompt.
  const deleteTeam = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/teams/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  async function handleDeleteTeam(team: TeamWithMembers) {
    const ok = await confirmAction({
      title: `Delete "${team.name}" permanently?`,
      message: `This removes its ${team.members.length} account(s) and ALL of its timeline entries, canvas, scores and help requests. This cannot be undone.`,
      requireText: team.name,
      confirmLabel: 'Delete team',
      danger: true,
    });
    if (ok) deleteTeam.mutate(team.id);
  }

  async function handleRemoveMember(m: Member, team: TeamWithMembers) {
    const ok = await confirmAction({
      title: `Delete the account ${m.displayName} (@${m.username})?`,
      message: `They are removed from ${team.name} and can no longer sign in. An account that already recorded timeline entries or scores can't be deleted — move it to another team instead.`,
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (ok) deleteUser.mutate(m.id);
  }

  const createUser = useMutation({
    mutationFn: () =>
      apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          role,
          teamId: role === 'student' ? teamId : undefined,
          displayName,
        }),
      }),
    onSuccess: () => {
      setUsername('');
      setPassword('');
      setDisplayName('');
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create user'),
  });

  const deleteUser = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  function handleCreateTeam(e: FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;
    createTeam.mutate();
  }

  function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (role === 'student' && !teamId) {
      setError('Pick a team for a student account');
      return;
    }
    createUser.mutate();
  }

  const inputStyle = {
    background: 'var(--surface-1)',
    border: '1px solid var(--surface-border)',
    borderRadius: 'var(--radius-control)',
    padding: 8,
    color: 'var(--text-primary)',
  };

  // Search matches a team name (show the whole team) or a student's name/username (show just them).
  const q = search.trim().toLowerCase();
  const visibleTeams = (data?.teams ?? [])
    .map((team) => {
      if (!q || team.name.toLowerCase().includes(q)) return { team, members: team.members };
      return {
        team,
        members: team.members.filter((m) => m.displayName.toLowerCase().includes(q) || m.username.toLowerCase().includes(q)),
      };
    })
    .filter(({ team, members }) => !q || members.length > 0 || team.name.toLowerCase().includes(q));

  return (
    <div className="page split-main-side" style={{ padding: 'var(--space-xl)' }}>
      <div>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>Teams & Accounts</h1>
        {data && data.teams.length > 0 && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students or teams…"
            aria-label="Search students or teams"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              marginBottom: 'var(--space-md)',
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 'var(--radius-control)',
              padding: 8,
              color: 'var(--text-primary)',
            }}
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {data && data.teams.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>No teams yet — create one on the right.</div>
          )}
          {visibleTeams.length === 0 && search.trim() && (
            <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>No student or team matches “{search.trim()}”.</div>
          )}
          {visibleTeams.map(({ team, members }) => (
            <div
              key={team.id}
              style={{
                padding: 'var(--space-md)',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-container)',
                background: 'var(--surface-1)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ color: 'var(--text-primary)', fontSize: 16 }}>{team.name}</strong>
                <Button variant="destructive" onClick={() => handleDeleteTeam(team)} disabled={deleteTeam.isPending}>
                  Delete team
                </Button>
              </div>
              {members.map((m) => (
                <div key={m.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-muted)', padding: '4px 0' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={m.displayName} size={22} />
                    {m.displayName} <span className="tabular" style={{ color: 'var(--text-telemetry)' }}>@{m.username}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {(data?.teams.length ?? 0) > 1 && (
                    <select
                      value=""
                      aria-label={`Move ${m.displayName} to another team`}
                      disabled={moveUser.isPending}
                      onChange={(e) => {
                        const toTeamId = Number(e.target.value);
                        if (toTeamId) void handleMove(m, team, toTeamId);
                      }}
                      style={{
                        background: 'var(--surface-1)',
                        border: '1px solid var(--surface-border)',
                        borderRadius: 'var(--radius-control)',
                        padding: '2px 4px',
                        color: 'var(--text-muted)',
                        fontSize: 13,
                      }}
                    >
                      <option value="">move to…</option>
                      {data?.teams
                        .filter((t) => t.id !== team.id)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  )}
                  <button
                    onClick={() => handleRemoveMember(m, team)}
                    aria-label={`Delete account ${m.displayName}`}
                    disabled={deleteUser.isPending}
                    style={{ background: 'none', border: 'none', color: 'var(--signal-alert)', cursor: 'pointer', fontSize: 13 }}
                  >
                    delete account
                  </button>
                  </span>
                </div>
              ))}
              {team.members.length === 0 && !search.trim() && (
                <div style={{ fontSize: 14, color: 'var(--text-telemetry)' }}>No members yet.</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
        <section
          aria-label="Student self-registration"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-sm)',
            padding: 'var(--space-md)',
            border: `1px solid ${registration?.open ? 'var(--signal-primary)' : 'var(--surface-border)'}`,
            borderRadius: 'var(--radius-container)',
            background: 'var(--surface-1)',
          }}
        >
          <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>Student self-registration</h2>
          {registration?.open ? (
            <>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                Open — students can create their own account with this code (Register tab on the login page):
              </div>
              <div
                className="tabular"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 26, letterSpacing: '0.16em', color: 'var(--signal-primary)' }}
              >
                {registration.joinCode}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                <Button
                  variant="ghost"
                  disabled={setRegistration.isPending}
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: 'Issue a new join code?',
                      message: 'The current code stops working immediately. Students who already registered are not affected.',
                      confirmLabel: 'Issue new code',
                    });
                    if (ok) setRegistration.mutate(true);
                  }}
                >
                  New code
                </Button>
                <Button variant="destructive" disabled={setRegistration.isPending} onClick={() => setRegistration.mutate(false)}>
                  Close registration
                </Button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                Closed — only accounts you create below can sign in. Open it to hand out a join code instead.
              </div>
              <Button variant="ghost" disabled={setRegistration.isPending || !registration} onClick={() => setRegistration.mutate(true)}>
                Open registration
              </Button>
            </>
          )}
        </section>

        <form onSubmit={handleCreateTeam} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>New team</h2>
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" aria-label="Team name" style={inputStyle} />
          <Button type="submit" variant="ghost">Create team</Button>
        </form>

        <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>New account</h2>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" aria-label="Username" autoComplete="off" style={inputStyle} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min. 8 characters)" aria-label="Password" minLength={8} autoComplete="new-password" style={inputStyle} />
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (optional)" aria-label="Display name" style={inputStyle} />
          <select value={role} onChange={(e) => setRole(e.target.value as 'student' | 'instructor')} style={{ ...inputStyle, background: 'var(--surface-1)' }}>
            <option value="student">Student</option>
            <option value="instructor">Instructor</option>
          </select>
          {role === 'student' && (
            <select value={teamId} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')} style={{ ...inputStyle, background: 'var(--surface-1)' }}>
              <option value="">Select team…</option>
              {data?.teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {error && <div style={{ color: 'var(--signal-alert)', fontSize: 14 }}>{error}</div>}
          <Button type="submit" variant="ghost" disabled={createUser.isPending}>
            Create account
          </Button>
        </form>
      </div>
    </div>
  );
}
