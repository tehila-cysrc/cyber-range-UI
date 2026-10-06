import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../components/Button';
import { apiFetch } from '../../lib/apiClient';
import { useAuthStore, type AuthUser } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';

const MIN_PASSWORD_LENGTH = 8;

const fieldStyle: React.CSSProperties = {
  background: 'var(--surface-floor)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  color: 'var(--text-muted)',
};

// Self-service account edit (PATCH /auth/me): username, display name, password. The current
// password is always required, even for a name change.
export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { token, user, setAuth } = useAuthStore();
  const pushToast = useToastStore((s) => s.push);
  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => firstFieldRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ user: AuthUser; passwordChanged: boolean }>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, username, displayName, newPassword: newPassword || undefined }),
      }),
    onSuccess: ({ user: updated, passwordChanged }) => {
      setAuth(token!, updated);
      pushToast(passwordChanged ? 'Profile saved — other sessions were signed out' : 'Profile saved', 'success');
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the profile'),
  });

  if (!user) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim()) return setError('Username cannot be empty');
    if (!displayName.trim()) return setError('Display name cannot be empty');
    if (newPassword && newPassword.length < MIN_PASSWORD_LENGTH) {
      return setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (newPassword !== confirmPassword) return setError('New passwords do not match');
    if (!currentPassword) return setError('Enter your current password to save changes');
    save.mutate();
  }

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay-backdrop)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 2000,
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
        onSubmit={handleSubmit}
        style={{
          width: 'min(460px, 100%)',
          background: 'var(--surface-1)',
          border: '1px solid var(--surface-border-strong)',
          borderRadius: 'var(--radius-container)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
          padding: 'var(--space-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
        }}
      >
        <h2 id="profile-dialog-title" style={{ margin: 0, fontSize: 17, color: 'var(--text-primary)' }}>
          Edit profile
        </h2>
        <label style={labelStyle}>
          Username
          <input ref={firstFieldRef} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" style={fieldStyle} />
        </label>
        <label style={labelStyle}>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={fieldStyle} />
        </label>
        <label style={labelStyle}>
          New password (leave empty to keep the current one)
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" style={fieldStyle} />
        </label>
        {newPassword && (
          <label style={labelStyle}>
            Confirm new password
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" style={fieldStyle} />
          </label>
        )}
        <label style={{ ...labelStyle, borderTop: '1px solid var(--surface-border)', paddingTop: 'var(--space-md)' }}>
          Current password (required)
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            style={fieldStyle}
          />
        </label>
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--signal-alert)' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}
