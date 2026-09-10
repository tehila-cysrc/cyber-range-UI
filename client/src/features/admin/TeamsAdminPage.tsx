import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Button } from '../../components/Button';
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

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin-teams'] });
  }

  const createTeam = useMutation({
    mutationFn: () => apiFetch('/admin/teams', { method: 'POST', body: JSON.stringify({ name: teamName }) }),
    onSuccess: () => {
      setTeamName('');
      refresh();
    },
  });

  const deleteTeam = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/teams/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

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
    if (role === 'student' && !teamId) {
      setError('Pick a team for a student account');
      return;
    }
    createUser.mutate();
  }

  const inputStyle = {
    background: 'transparent',
    border: '1px solid var(--surface-border)',
    borderRadius: 'var(--radius-control)',
    padding: 8,
    color: 'var(--text-primary)',
  };

  return (
    <div style={{ padding: 'var(--space-xl)', display: 'grid', gridTemplateColumns: '60% 40%', gap: 'var(--space-xl)' }}>
      <div>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '0 0 var(--space-md)' }}>Teams & Accounts</h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {data?.teams.map((team) => (
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
                <Button variant="destructive" onClick={() => deleteTeam.mutate(team.id)}>
                  Delete team
                </Button>
              </div>
              {team.members.map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, color: 'var(--text-muted)', padding: '4px 0' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={m.displayName} size={22} />
                    {m.displayName} <span className="tabular" style={{ color: 'var(--text-telemetry)' }}>@{m.username}</span>
                  </span>
                  <button
                    onClick={() => deleteUser.mutate(m.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--signal-alert)', cursor: 'pointer', fontSize: 13 }}
                  >
                    remove
                  </button>
                </div>
              ))}
              {team.members.length === 0 && (
                <div style={{ fontSize: 14, color: 'var(--text-telemetry)' }}>No members yet.</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
        <form onSubmit={handleCreateTeam} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>New team</h2>
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" style={inputStyle} />
          <Button type="submit" variant="ghost">Create team</Button>
        </form>

        <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>New account</h2>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" style={inputStyle} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" style={inputStyle} />
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (optional)" style={inputStyle} />
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
