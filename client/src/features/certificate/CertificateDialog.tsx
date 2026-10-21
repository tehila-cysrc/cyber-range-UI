import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/Button';
import { apiFetch } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { Certificate, type CertificateTemplate } from './Certificate';

// Students download their completion certificates from the header button — the only entry point for
// them. One certificate per scenario completed (or granted); each prints its scenario's certificate
// template. They pick the certificate (when there are several), type the name to print and pick the
// date, see a live preview, and get a PDF or PNG.
// Rendered entirely in the browser — the server has no record of issued certificates.

/** One certificate the dialog can issue; `label` names it in the picker (usually the scenario). */
export interface CertificateChoice {
  key: string;
  label: string;
  template: CertificateTemplate;
}

interface StudentCertificate {
  cyberRangeId: number | null;
  scenarioName: string | null;
  template: CertificateTemplate;
}

export function choicesFromCertificates(certs: StudentCertificate[]): CertificateChoice[] {
  return certs.map((c) => ({ key: String(c.cyberRangeId ?? 'general'), label: c.scenarioName ?? c.template.name, template: c.template }));
}

const PREVIEW_SCALE = 0.56; // 1123px-wide certificate → ~630px preview
const CERT_PX = { width: 1123, height: 794 }; // 297x210mm at 96 dpi

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function fileBase(name: string): string {
  const safe = name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return `CySource-Certificate${safe ? `-${safe}` : ''}`;
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--surface-floor)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  colorScheme: 'dark',
};

// Students' header button — shown on every page once they're eligible (GET /teams/me/certificate:
// a completed scenario, or an instructor grant), so it can't be missed. Shares the AppShell query, so
// it's refetched on progress/certificate changes; opening the dialog refetches it too (a template may
// have been edited since).
export function HeaderCertificateButton() {
  const [open, setOpen] = useState(false);
  const { data, refetch } = useQuery({
    queryKey: ['certificate'],
    queryFn: () => apiFetch<{ eligible: boolean; certificates: StudentCertificate[] }>('/teams/me/certificate'),
  });
  const choices = choicesFromCertificates(data?.certificates ?? []);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void refetch();
          setOpen(true);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--signal-primary)',
          color: 'var(--surface-floor)',
          border: '1px solid var(--signal-primary)',
          borderRadius: 'var(--radius-control)',
          padding: '3px 12px',
          fontFamily: 'inherit',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="9" r="6" />
          <path d="M8.5 14 7 22l5-3 5 3-1.5-8" />
        </svg>
        Certificate
      </button>
      {open && choices.length > 0 && <CertificateDialog choices={choices} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Opens the dialog for `choices` (at least one; a picker appears when there are several).
 * `initialName` pre-fills the name (an instructor issuing it for a student); `initialKey` preselects a choice.
 */
export function CertificateDialog({
  onClose,
  initialName,
  choices,
  initialKey,
}: {
  onClose: () => void;
  initialName?: string;
  choices: CertificateChoice[];
  initialKey?: string;
}) {
  const displayName = useAuthStore((s) => s.user?.displayName ?? '');
  const [name, setName] = useState(initialName ?? displayName);
  const [choiceKey, setChoiceKey] = useState(initialKey ?? choices[0]?.key);
  const choice = choices.find((c) => c.key === choiceKey) ?? choices[0];
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState<'pdf' | 'png' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const certRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const printedName = name.trim();
  const printedDate = formatDate(date);
  const ready = printedName.length > 0 && printedDate.length > 0 && !busy;

  async function download(kind: 'pdf' | 'png') {
    const node = certRef.current;
    if (!node) return;
    setBusy(kind);
    setError(null);
    try {
      // Every weight the certificate uses must be loaded, or the export falls back to a system font.
      await Promise.all(
        ['300', '400', 'italic 400', '600', '800'].map((w) => document.fonts.load(`${w} 16px "PP Mori"`)),
      );
      const { toCanvas } = await import('html-to-image');
      const canvas = await toCanvas(node, { ...CERT_PX, pixelRatio: 3, cacheBust: true });
      const base = fileBase(printedName);
      if (kind === 'png') {
        triggerDownload(canvas.toDataURL('image/png'), `${base}.png`);
      } else {
        const { jsPDF } = await import('jspdf');
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 297, 210);
        pdf.save(`${base}.pdf`);
      }
    } catch {
      setError('Couldn’t create the certificate — try again.');
    } finally {
      setBusy(null);
    }
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
        overflowY: 'auto',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="certificate-dialog-title"
        style={{
          width: `min(${Math.round(CERT_PX.width * PREVIEW_SCALE) + 48}px, 100%)`,
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
        <h2 id="certificate-dialog-title" style={{ margin: 0, fontSize: 17, color: 'var(--text-primary)' }}>
          {initialName !== undefined ? 'Download certificate' : 'Download your certificate'}
        </h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          {choices.length > 1 && (
            <label style={{ flex: '1 1 100%', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
              Certificate
              <select value={choice.key} onChange={(e) => setChoiceKey(e.target.value)} style={{ ...fieldStyle, background: 'var(--surface-1)' }}>
                {choices.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={{ flex: '2 1 240px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            Name on the certificate
            <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Full name" style={fieldStyle} />
          </label>
          <label style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} />
          </label>
        </div>

        {/* Live preview; the unscaled certificate inside is what gets exported. */}
        <div
          style={{
            width: '100%',
            aspectRatio: `${CERT_PX.width} / ${CERT_PX.height}`,
            maxWidth: CERT_PX.width * PREVIEW_SCALE,
            overflow: 'hidden',
            border: '1px solid var(--surface-border)',
            borderRadius: 'var(--radius-control)',
          }}
        >
          <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left', width: CERT_PX.width, height: CERT_PX.height }}>
            <Certificate ref={certRef} name={printedName || 'Your Name'} date={printedDate} template={choice.template} />
          </div>
        </div>

        {error && (
          <div role="alert" style={{ fontSize: 14, color: 'var(--signal-alert)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="ghost" disabled={!ready} onClick={() => download('png')} style={!ready ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
            {busy === 'png' ? 'Preparing…' : 'Download PNG'}
          </Button>
          <Button type="button" disabled={!ready} onClick={() => download('pdf')} style={!ready ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
            {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
          </Button>
        </div>
      </div>
    </div>
  );
}
