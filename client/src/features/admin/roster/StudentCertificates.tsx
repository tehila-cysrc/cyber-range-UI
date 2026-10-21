import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/apiClient';
import { useToastStore } from '../../../stores/toastStore';
import { Button } from '../../../components/Button';
import type { CertificateTemplate } from '../../certificate/Certificate';
import { CertificateDialog, type CertificateChoice } from '../../certificate/CertificateDialog';
import { linkButtonStyle, type Member } from './rosterData';

// Roster → Students: a student gets one certificate per scenario — earned when their team completes
// it, or granted here as the fallback (completion wasn't recorded). Each scenario prints its own
// certificate from the library (Scenarios page → Certificate). "Download" issues it right here,
// pre-filled with the student's name.

interface CertificateOption {
  cyberRangeId: number | null;
  scenarioName: string | null;
  status: string | null;
  earned: boolean;
  granted: boolean;
  template: CertificateTemplate;
}

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started',
  active: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
};

/** The row's entry point: how many certificates the student holds, opening the per-scenario dialog. */
export function CertificateControls({ member, count }: { member: Member; count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ flexShrink: 0, fontSize: 13 }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Certificates per scenario: earned, grant, download"
        style={{ ...linkButtonStyle, color: count > 0 ? 'var(--signal-primary)' : 'var(--signal-secondary)' }}
      >
        {count > 0 ? `✓ ${count} certificate${count === 1 ? '' : 's'}` : 'Certificates'}
      </button>
      {open && <StudentCertificatesDialog member={member} onClose={() => setOpen(false)} />}
    </span>
  );
}

function StudentCertificatesDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  const [issuing, setIssuing] = useState<CertificateChoice[] | null>(null);
  const [issuingKey, setIssuingKey] = useState<string | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['student-certificates', member.id],
    queryFn: () => apiFetch<{ certificates: CertificateOption[] }>(`/admin/users/${member.id}/certificates`),
  });
  const { data: library } = useQuery({
    queryKey: ['certificate-templates'],
    queryFn: () => apiFetch<{ templates: CertificateTemplate[] }>('/admin/certificate-templates'),
  });

  const toggle = useMutation({
    mutationFn: (o: CertificateOption) =>
      apiFetch(`/admin/users/${member.id}/certificate-grants/${o.cyberRangeId ?? 'general'}`, { method: o.granted ? 'DELETE' : 'PUT' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-certificates', member.id] });
      queryClient.invalidateQueries({ queryKey: ['certificate-grants'] });
    },
    onError: (err) => pushToast(err instanceof Error ? err.message : 'Couldn’t update the certificate'),
  });

  useEffect(() => {
    if (issuing) return; // the certificate dialog on top handles Escape
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, issuing]);

  const options = data?.certificates ?? [];
  const keyOf = (o: CertificateOption) => String(o.cyberRangeId ?? 'general');
  const scenarioChoices: CertificateChoice[] = options.map((o) => ({
    key: keyOf(o),
    label: `${o.scenarioName ?? 'Granted before per-scenario certificates'} — ${o.template.name}`,
    template: o.template,
  }));
  // Without an assigned scenario the instructor can still issue any certificate from the library.
  const libraryChoices: CertificateChoice[] = (library?.templates ?? []).map((t) => ({ key: `t${t.id}`, label: t.name, template: t }));

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: 'fixed', inset: 0, background: 'var(--overlay-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1900 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-certificates-title"
        style={{
          width: 'min(620px, 100%)',
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
        <h2 id="student-certificates-title" style={{ margin: 0, fontSize: 17, color: 'var(--text-primary)' }}>
          Certificates — <bdi>{member.displayName}</bdi>
        </h2>

        {isLoading ? (
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Loading…</div>
        ) : options.length === 0 ? (
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Their team hasn’t been assigned a scenario yet, so there’s nothing to earn or grant.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-control)' }}>
            {options.map((o, i) => (
              <div
                key={keyOf(o)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderTop: i ? '1px solid var(--surface-border)' : undefined, fontSize: 14 }}
              >
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <bdi style={{ color: 'var(--text-primary)' }}>{o.scenarioName ?? 'Granted before per-scenario certificates'}</bdi>
                  <span style={{ fontSize: 12, color: 'var(--text-telemetry)' }}>
                    {o.status ? `${STATUS_LABEL[o.status] ?? o.status} · ` : ''}Certificate: <bdi>{o.template.name}</bdi>
                  </span>
                </div>
                {o.earned ? (
                  <span title="Their team completed this scenario — the certificate is already in their header" style={{ color: 'var(--signal-primary)', fontSize: 13 }}>
                    ✓ Earned
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggle.mutate(o)}
                    disabled={toggle.isPending}
                    title={o.granted ? 'Click to take the certificate back' : 'Let this student download this scenario’s certificate without completing it'}
                    style={{ ...linkButtonStyle, fontSize: 13, color: o.granted ? 'var(--signal-primary)' : 'var(--signal-secondary)' }}
                  >
                    {o.granted ? '✓ Granted' : 'Grant'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIssuingKey(keyOf(o));
                    setIssuing(scenarioChoices);
                  }}
                  aria-label={`Download the ${o.scenarioName ?? 'general'} certificate for ${member.displayName}`}
                  style={{ ...linkButtonStyle, fontSize: 13 }}
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={libraryChoices.length === 0}
            onClick={() => {
              setIssuingKey(undefined);
              setIssuing(libraryChoices);
            }}
            title="Issue any certificate from the library, whatever the scenario"
            style={{ ...linkButtonStyle, fontSize: 13 }}
          >
            Download another certificate…
          </button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {issuing && <CertificateDialog initialName={member.displayName} choices={issuing} initialKey={issuingKey} onClose={() => setIssuing(null)} />}
    </div>
  );
}
