import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';

export interface ActiveAccessSession {
  accessSessionId: number;
  shareableLinkUrl: string;
  expiresAt: string;
  nodeLabel: string;
}

interface RevealedCredential {
  username: string;
  password: string;
}

// The shareable link IS the full browser-based RDP/SSH client (hosted by Azure Bastion itself) — the
// app just links out to it, no canvas/websocket rendering of its own. Credentials are fetched only on
// an explicit "Show" click (design doc §11.5), never bundled into the initial session response.
export function AccessSessionPanel({
  session,
  onDisconnect,
  disconnecting,
}: {
  session: ActiveAccessSession;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  const [revealed, setRevealed] = useState<RevealedCredential | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<'username' | 'password' | null>(null);

  const { refetch: fetchCredential, isFetching } = useQuery({
    queryKey: ['access-session-credential', session.accessSessionId],
    queryFn: () => apiFetch<RevealedCredential>(`/teams/me/access-sessions/${session.accessSessionId}/credential`),
    enabled: false,
  });

  async function handleShow() {
    if (revealed) return;
    const { data } = await fetchCredential();
    if (data) setRevealed(data);
  }

  function handleCopy(field: 'username' | 'password', value: string) {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1500);
  }

  return (
    <div
      style={{
        marginTop: 'var(--space-md)',
        padding: 'var(--space-md)',
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-container)',
        background: 'var(--surface-1)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: 15 }}>Session — {session.nodeLabel}</strong>
        <TelemetryBadge tone="primary">Ready</TelemetryBadge>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--text-telemetry)', width: 70 }}>Username</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{revealed?.username ?? '••••••'}</span>
          {revealed && (
            <button onClick={() => handleCopy('username', revealed.username)} style={linkButtonStyle}>
              {copiedField === 'username' ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--text-telemetry)', width: 70 }}>Password</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {revealed ? (showPassword ? revealed.password : '••••••••') : '••••••••'}
          </span>
          {revealed ? (
            <>
              <button onClick={() => setShowPassword((v) => !v)} style={linkButtonStyle}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
              <button onClick={() => handleCopy('password', revealed.password)} style={linkButtonStyle}>
                {copiedField === 'password' ? 'Copied' : 'Copy'}
              </button>
            </>
          ) : (
            <button onClick={handleShow} disabled={isFetching} style={linkButtonStyle}>
              {isFetching ? 'Loading…' : 'Show'}
            </button>
          )}
        </div>
      </div>

      <a href={session.shareableLinkUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
        <Button variant="primary" style={{ width: '100%' }}>
          Open connection
        </Button>
      </a>

      <div style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>Expires {new Date(session.expiresAt).toLocaleTimeString()}</div>
      <Button variant="destructive" onClick={onDisconnect} disabled={disconnecting}>
        Disconnect
      </Button>
    </div>
  );
}

const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--signal-secondary)',
  cursor: 'pointer',
  fontSize: 12,
  padding: 0,
};
