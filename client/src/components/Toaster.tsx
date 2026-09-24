import { useToastStore } from '../stores/toastStore';

const TONE_BORDER = {
  error: 'var(--signal-alert)',
  info: 'var(--signal-secondary)',
  success: 'var(--signal-primary)',
} as const;

// Mounted once in AppShell. Surfaces failures that would otherwise be silent — see
// lib/queryClient.ts's MutationCache fallback for any mutation without its own onError.
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        left: 16,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            pointerEvents: 'auto',
            maxWidth: 420,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            padding: '10px 14px',
            background: 'var(--surface-2)',
            border: `1px solid ${TONE_BORDER[t.tone]}`,
            borderRadius: 'var(--radius-control)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            color: 'var(--text-primary)',
            fontSize: 14,
          }}
        >
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
