import { Button } from '../../components/Button';
import { TelemetryBadge } from '../../components/TelemetryBadge';

export interface ActiveAccessSession {
  accessSessionId: number;
  wsUrl: string | null;
  expiresAt: string;
  nodeLabel: string;
}

// A real browser session (guacamole-common-js rendering into a <canvas> against wsUrl) is the next
// step once a real guacd/guacamole-lite gateway is deployed — see server/src/services/accessBroker/.
// This dev environment has no gateway configured (GUACD_GATEWAY_WS_URL unset), so wsUrl always comes
// back null; this panel is honest about that rather than pretending a live session exists.
export function AccessSessionPanel({
  session,
  onDisconnect,
  disconnecting,
}: {
  session: ActiveAccessSession;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
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
        <TelemetryBadge tone={session.wsUrl ? 'primary' : 'secondary'}>{session.wsUrl ? 'Connecting' : 'Active (no gateway)'}</TelemetryBadge>
      </div>
      {session.wsUrl ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Connecting to the access gateway…</div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Session token minted and tracked server-side — no browser-access gateway is deployed in this environment yet, so there's no live
          screen to show. It will auto-expire at the time below if not disconnected first.
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>Expires {new Date(session.expiresAt).toLocaleTimeString()}</div>
      <Button variant="destructive" onClick={onDisconnect} disabled={disconnecting}>
        Disconnect
      </Button>
    </div>
  );
}
