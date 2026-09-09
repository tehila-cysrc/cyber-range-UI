import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAuthStore, type AuthUser } from '../../stores/authStore';
import { Button } from '../../components/Button';

interface AuthResponse {
  token: string;
  user: AuthUser;
}

interface Team {
  id: number;
  name: string;
}

const inputStyle = {
  background: 'transparent',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
};

export function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  useEffect(() => {
    if (mode !== 'register') return;
    apiFetch<{ teams: Team[] }>('/auth/teams')
      .then((res) => setTeams(res.teams))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load teams'));
  }, [mode]);

  function switchMode(next: 'signin' | 'register') {
    setMode(next);
    setError(null);
  }

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAuth(res.token, res.user);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!teamId) {
      setError('Pick a team');
      return;
    }
    if (!username.trim() || !password) {
      setError('Username and password are required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ teamId, username, password, displayName }),
      });
      setAuth(res.token, res.user);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <form
        onSubmit={mode === 'signin' ? handleSignIn : handleRegister}
        style={{
          width: 320,
          padding: 'var(--space-xl)',
          background: 'var(--surface-1)',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--radius-container)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-telemetry)',
            }}
          >
            Cyber Range
          </div>
          <h1 style={{ fontSize: 24, margin: '4px 0 0', color: 'var(--text-primary)' }}>
            {mode === 'signin' ? 'Sign in' : 'Join a team'}
          </h1>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-sm)', fontSize: 14 }}>
          <button
            type="button"
            onClick={() => switchMode('signin')}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: mode === 'signin' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: mode === 'signin' ? 600 : 400,
              textDecoration: mode === 'signin' ? 'underline' : 'none',
            }}
          >
            Sign in
          </button>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <button
            type="button"
            onClick={() => switchMode('register')}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: mode === 'register' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: mode === 'register' ? 600 : 400,
              textDecoration: mode === 'register' ? 'underline' : 'none',
            }}
          >
            New student? Register
          </button>
        </div>

        {mode === 'register' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Team</span>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')}
              style={{ ...inputStyle, background: 'var(--surface-1)' }}
            >
              <option value="">Select team…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus style={inputStyle} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>

        {mode === 'register' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Display name (optional)</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
          </label>
        )}

        {error && <div style={{ color: 'var(--signal-alert)', fontSize: 15 }}>{error}</div>}

        <Button type="submit" disabled={submitting}>
          {submitting
            ? mode === 'signin'
              ? 'Signing in…'
              : 'Creating account…'
            : mode === 'signin'
              ? 'Sign in'
              : 'Create account & join'}
        </Button>
      </form>
    </div>
  );
}
