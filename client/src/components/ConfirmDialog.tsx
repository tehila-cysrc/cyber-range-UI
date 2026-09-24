import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Button } from './Button';

// One in-app confirmation pattern for the whole app. Native confirm()/prompt()/alert() blocked the
// page, looked different from everything else, and couldn't explain consequences properly (UX-21).

interface DialogRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  // Type-to-confirm: the confirm button stays disabled until this exact text is typed.
  requireText?: string;
  // Optional free-text field (e.g. a reason); its value is returned on confirm.
  input?: { label: string; placeholder?: string };
}

interface DialogState {
  request: (DialogRequest & { resolve: (result: { value: string } | null) => void }) | null;
  open: (req: DialogRequest) => Promise<{ value: string } | null>;
  close: (result: { value: string } | null) => void;
}

const useDialogStore = create<DialogState>((set, get) => ({
  request: null,
  open: (req) =>
    new Promise((resolve) => {
      get().request?.resolve(null);
      set({ request: { ...req, resolve } });
    }),
  close: (result) => {
    get().request?.resolve(result);
    set({ request: null });
  },
}));

/** Resolves true when the user confirms. */
export async function confirmAction(req: Omit<DialogRequest, 'input'>): Promise<boolean> {
  return (await useDialogStore.getState().open(req)) !== null;
}

/** Resolves the typed text (possibly empty) on confirm, or null when cancelled. */
export async function promptAction(req: DialogRequest & { input: NonNullable<DialogRequest['input']> }): Promise<string | null> {
  const result = await useDialogStore.getState().open(req);
  return result ? result.value : null;
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--surface-floor)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
};

// Mounted once in AppShell.
export function ConfirmDialogHost() {
  const request = useDialogStore((s) => s.request);
  const close = useDialogStore((s) => s.close);
  const [typed, setTyped] = useState('');
  const [value, setValue] = useState('');
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setTyped('');
    setValue('');
    if (!request) return;
    // Focus the field that needs input, else the confirm button — Enter confirms, Escape cancels.
    setTimeout(() => (firstFieldRef.current ?? confirmRef.current)?.focus(), 0);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [request, close]);

  if (!request) return null;
  const blocked = request.requireText != null && typed.trim() !== request.requireText;

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(null);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 2000,
      }}
    >
      <form
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) close({ value: value.trim() });
        }}
        style={{
          width: 'min(460px, 100%)',
          background: 'var(--surface-1)',
          border: `1px solid ${request.danger ? 'var(--signal-alert)' : 'var(--surface-border-strong)'}`,
          borderRadius: 'var(--radius-container)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
          padding: 'var(--space-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
        }}
      >
        <h2 id="confirm-dialog-title" style={{ margin: 0, fontSize: 17, color: 'var(--text-primary)' }}>
          {request.title}
        </h2>
        {request.message && (
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)', whiteSpace: 'pre-line' }}>{request.message}</p>
        )}
        {request.requireText != null && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            <span>
              Type <strong style={{ color: 'var(--text-primary)' }}>{request.requireText}</strong> to confirm
            </span>
            <input ref={firstFieldRef} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" style={fieldStyle} />
          </label>
        )}
        {request.input && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            {request.input.label}
            <input
              ref={request.requireText == null ? firstFieldRef : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={request.input.placeholder}
              maxLength={500}
              style={fieldStyle}
            />
          </label>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="ghost" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button ref={confirmRef} type="submit" variant={request.danger ? 'destructive' : 'primary'} disabled={blocked} style={blocked ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
            {request.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </form>
    </div>
  );
}
