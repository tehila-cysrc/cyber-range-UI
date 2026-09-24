import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError, SIGNED_OUT_NOTE_KEY } from '../../lib/apiClient';
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
  // Self-registration is instructor-controlled: closed unless the instructor opened it and handed out
  // a join code. null = still checking.
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [codeAccepted, setCodeAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  // Read-and-clear once: set by apiClient when a signed-in session got a 401.
  const [signedOutNote] = useState(() => {
    try {
      const had = sessionStorage.getItem(SIGNED_OUT_NOTE_KEY) === '1';
      sessionStorage.removeItem(SIGNED_OUT_NOTE_KEY);
      return had;
    } catch {
      return false;
    }
  });
  const navigate = useNavigate();

  useEffect(() => {
    if (mode !== 'register') return;
    setRegistrationOpen(null);
    apiFetch<{ open: boolean }>('/auth/registration')
      .then((res) => setRegistrationOpen(res.open))
      .catch(() => setRegistrationOpen(false));
  }, [mode]);

  async function handleJoinCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!joinCode.trim()) {
      setError('Enter the join code your instructor gave you');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ teams: Team[] }>('/auth/registration/teams', {
        method: 'POST',
        body: JSON.stringify({ joinCode }),
      });
      setTeams(res.teams);
      setCodeAccepted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check the join code');
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(next: 'signin' | 'register') {
    setMode(next);
    setError(null);
    setCodeAccepted(false);
    setTeams([]);
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
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ teamId, username, password, displayName, joinCode }),
      });
      setAuth(res.token, res.user);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  const showCredentials = mode === 'signin' || codeAccepted;

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
        onSubmit={mode === 'signin' ? handleSignIn : codeAccepted ? handleRegister : handleJoinCode}
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

        {signedOutNote && mode === 'signin' && (
          <div role="status" style={{ fontSize: 14, color: 'var(--signal-tertiary)', lineHeight: 1.5 }}>
            Your session ended — your account may have been removed or the event reset. Sign in again, or
            ask your instructor.
          </div>
        )}

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

        {mode === 'register' && registrationOpen === null && (
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Checking registration…</div>
        )}
        {mode === 'register' && registrationOpen === false && (
          <div role="status" style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Self-registration is closed for this event. Ask your instructor for an account, or for the
            join code once they open registration.
          </div>
        )}
        {mode === 'register' && registrationOpen && !codeAccepted && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Join code (from your instructor)</span>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              style={{ ...inputStyle, letterSpacing: '0.12em' }}
            />
          </label>
        )}

        {mode === 'register' && codeAccepted && (
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

        {showCredentials && (
        <>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus style={inputStyle} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Password{mode === 'register' ? ' (at least 8 characters)' : ''}
          </span>
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

        </>
        )}

        {error && <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 15 }}>{error}</div>}

        {mode === 'register' && registrationOpen && !codeAccepted && (
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Checking…' : 'Continue'}
          </Button>
        )}
        {showCredentials && (
          <Button type="submit" disabled={submitting}>
            {submitting
              ? mode === 'signin'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'signin'
                ? 'Sign in'
                : 'Create account & join'}
          </Button>
        )}
      </form>
    </div>
  );
}
