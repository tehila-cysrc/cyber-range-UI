import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/apiClient';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { confirmAction } from '../../../components/ConfirmDialog';
import { useAuthStore } from '../../../stores/authStore';
import { inputStyle, linkButtonStyle, postJson, useRosterMutation, type Member } from './rosterData';

export function InstructorsView() {
  const me = useAuthStore((s) => s.user);
  const { data } = useQuery({
    queryKey: ['admin-instructors'],
    queryFn: () => apiFetch<{ instructors: Member[] }>('/admin/instructors'),
  });
  const instructors = data?.instructors ?? [];

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const create = useRosterMutation(
    () => postJson('/admin/users', { username, password, displayName, role: 'instructor' }),
    'Could not create the account',
    () => {
      setUsername('');
      setPassword('');
      setDisplayName('');
      setFormError(null);
    },
  );
  const remove = useRosterMutation((id: number) => postJson(`/admin/users/${id}`, {}, 'DELETE'), 'Could not delete the account');

  async function handleRemove(m: Member) {
    const ok = await confirmAction({
      title: `Delete the instructor account ${m.displayName} (@${m.username})?`,
      message: 'They can no longer sign in. An account that already awarded scores or answered help requests cannot be deleted.',
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (ok) remove.mutate(m.id);
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) return setFormError('Username is required');
    if (password.length < 8) return setFormError('Password must be at least 8 characters');
    create.mutate(undefined);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
      <div>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>Instructors</h1>
        <div className="tabular" style={{ fontSize: 13, color: 'var(--text-telemetry)', marginTop: 4 }}>
          {instructors.length} account{instructors.length === 1 ? '' : 's'}
        </div>
      </div>

      <div style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)', background: 'var(--surface-1)', padding: '6px 12px' }}>
        {instructors.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-muted)', padding: '6px 0' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Avatar name={m.displayName} size={22} />
              <bdi>{m.displayName}</bdi> <span className="tabular" style={{ color: 'var(--text-telemetry)' }}>@{m.username}</span>
              {m.id === me?.id && <span style={{ fontSize: 12, color: 'var(--signal-primary)' }}>you</span>}
            </span>
            {m.id !== me?.id && (
              <button type="button" onClick={() => handleRemove(m)} disabled={remove.isPending} aria-label={`Delete account ${m.displayName}`} style={{ ...linkButtonStyle, color: 'var(--signal-alert)' }}>
                delete
              </button>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', maxWidth: 420 }}>
        <h2 style={{ fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>New instructor account</h2>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" aria-label="Username" autoComplete="off" style={inputStyle} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min. 8 characters)" aria-label="Password" autoComplete="new-password" style={inputStyle} />
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name (optional)" aria-label="Display name" style={inputStyle} />
        {formError && <div style={{ color: 'var(--signal-alert)', fontSize: 14 }}>{formError}</div>}
        <Button type="submit" variant="ghost" disabled={create.isPending}>Create instructor</Button>
      </form>
    </div>
  );
}
