import { useEffect, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../../lib/apiClient';
import { Button } from '../../components/Button';
import { confirmAction } from '../../components/ConfirmDialog';
import { useToastStore } from '../../stores/toastStore';
import { Certificate, type CertificateTemplate } from './Certificate';

// Admin "Certificates" (route /admin/certificates): the certificate library. Each entry is the printed
// text of a completion certificate on the one approved design; a scenario picks which entry it awards
// (Scenarios page → Certificate), so with several scenarios each one hands out its own certificate.
// Exactly one entry is the default (scenarios that didn't pick one). Deleting an entry moves its
// scenarios back to the default; the default itself can't be deleted.

type Template = CertificateTemplate & { scenarios: Array<{ id: number; name: string }> };
type Draft = Omit<CertificateTemplate, 'id' | 'isDefault' | 'skills'> & { skills: string };

const PREVIEW_SCALE = 0.5;
const CERT_PX = { width: 1123, height: 794 };

// Explicit fields only — the API row also carries id/isDefault/scenarios/updatedAt.
function toDraft(t: CertificateTemplate): Draft {
  return {
    name: t.name,
    label: t.label,
    title: t.title,
    body: t.body,
    skills: t.skills.join('\n'),
    program: t.program,
    programHighlight: t.programHighlight,
    signerName: t.signerName,
    signerTitle: t.signerTitle,
    statusText: t.statusText,
  };
}

function toBody(d: Draft) {
  return { ...d, skills: d.skills.split('\n').map((s) => s.trim()).filter(Boolean) };
}

const field: CSSProperties = {
  background: 'var(--surface-floor)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  minWidth: 0,
};
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-muted)' };
const hint: CSSProperties = { fontSize: 12, color: 'var(--text-telemetry)' };

const FIELDS: Array<{ key: keyof Draft; label: string; max: number; hint?: string; rows?: number; span?: boolean }> = [
  { key: 'name', label: 'Name in the library', max: 80, hint: 'Only staff see this — it’s how scenarios pick the certificate.', span: true },
  { key: 'label', label: 'Heading', max: 40 },
  { key: 'statusText', label: 'Status stamp', max: 30 },
  { key: 'title', label: 'Title', max: 70, rows: 2, hint: 'Up to two lines.', span: true },
  { key: 'body', label: 'Description', max: 260, rows: 3, span: true },
  { key: 'skills', label: 'Skills', max: 6 * 33, rows: 6, hint: 'One per line, up to 6 (32 characters each).', span: true },
  { key: 'program', label: 'Program (top right)', max: 40 },
  { key: 'programHighlight', label: 'Program highlight', max: 30 },
  { key: 'signerName', label: 'Signed by', max: 40 },
  { key: 'signerTitle', label: 'Signer’s title', max: 40 },
];

export function CertificatesPage() {
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const { data, isLoading } = useQuery({
    queryKey: ['certificate-templates'],
    queryFn: () => apiFetch<{ templates: Template[] }>('/admin/certificate-templates'),
  });
  const templates = data?.templates ?? [];
  const [selected, setSelected] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = typeof selected === 'number' ? templates.find((t) => t.id === selected) : undefined;
  const defaultTemplate = templates.find((t) => t.isDefault);

  // Select the default on first load; reload the draft whenever the selection changes.
  useEffect(() => {
    if (selected === null && defaultTemplate) setSelected(defaultTemplate.id);
  }, [selected, defaultTemplate]);
  useEffect(() => {
    setError(null);
    if (selected === 'new') {
      if (defaultTemplate) setDraft({ ...toDraft(defaultTemplate), name: '' });
    } else if (current) {
      setDraft(toDraft(current));
    }
  }, [selected, current?.id]); // not on every refetch — that would wipe unsaved edits

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['certificate-templates'] });
    queryClient.invalidateQueries({ queryKey: ['scenario-details'] });
  };
  const onError = (err: unknown) => setError(err instanceof ApiError ? err.message : 'Couldn’t save the certificate');

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      if (selected === 'new') {
        const res = await apiFetch<{ template: Template }>('/admin/certificate-templates', { method: 'POST', body: JSON.stringify(toBody(d)) });
        return res.template;
      }
      const res = await apiFetch<{ template: Template }>(`/admin/certificate-templates/${selected}`, { method: 'PATCH', body: JSON.stringify(toBody(d)) });
      return res.template;
    },
    onSuccess: (t) => {
      push(selected === 'new' ? `Certificate "${t.name}" created.` : 'Certificate saved.', 'success');
      refresh();
      setSelected(t.id);
      setDraft(toDraft(t));
    },
    onError,
  });

  const makeDefault = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/certificate-templates/${id}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) }),
    onSuccess: () => {
      push('Default certificate changed.', 'success');
      refresh();
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/certificate-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      push('Certificate deleted.', 'success');
      setSelected(null);
      refresh();
    },
    onError,
  });

  async function confirmDelete(t: Template) {
    const n = t.scenarios.length;
    const ok = await confirmAction({
      title: `Delete "${t.name}"?`,
      message:
        n > 0
          ? `${n} scenario${n === 1 ? '' : 's'} (${t.scenarios.map((s) => s.name).join(', ')}) will award the default certificate instead.`
          : 'No scenario uses it.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) remove.mutate(t.id);
  }

  const dirty = draft && (selected === 'new' || (current && JSON.stringify(toDraft(current)) !== JSON.stringify(draft)));
  const previewTemplate: CertificateTemplate | null = draft
    ? { ...toBody(draft), id: 0, isDefault: false }
    : null;

  return (
    <div style={{ padding: 'var(--space-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', maxWidth: 1400 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, color: 'var(--text-primary)' }}>Certificates</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-muted)', maxWidth: 760 }}>
          The completion certificates students download. Each scenario awards one of them — pick it on the Scenarios page. Scenarios that
          don’t pick one award the default.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Library */}
        <div style={{ flex: '0 1 280px', minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isLoading && <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Loading…</div>}
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t.id)}
              style={{
                textAlign: 'start',
                background: selected === t.id ? 'var(--surface-2, var(--surface-1))' : 'var(--surface-1)',
                border: `1px solid ${selected === t.id ? 'var(--signal-primary)' : 'var(--surface-border)'}`,
                borderRadius: 'var(--radius-control)',
                padding: '10px 12px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontFamily: 'inherit',
              }}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14, color: 'var(--text-primary)' }}>
                <bdi>{t.name}</bdi>
                {t.isDefault && <span style={{ fontSize: 11, color: 'var(--signal-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>Default</span>}
              </span>
              <span style={hint}>
                {t.scenarios.length > 0
                  ? `Used by ${t.scenarios.map((s) => s.name).join(', ')}`
                  : t.isDefault
                    ? 'Used by every scenario without its own certificate'
                    : 'Not used by any scenario'}
              </span>
            </button>
          ))}
          <Button type="button" variant="ghost" onClick={() => setSelected('new')} disabled={!defaultTemplate}>
            + New certificate
          </Button>
        </div>

        {/* Editor + preview */}
        {draft && previewTemplate && (
          <div style={{ flex: '1 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div
              style={{
                width: '100%',
                maxWidth: CERT_PX.width * PREVIEW_SCALE,
                aspectRatio: `${CERT_PX.width} / ${CERT_PX.height}`,
                overflow: 'hidden',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-control)',
              }}
            >
              <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left', width: CERT_PX.width, height: CERT_PX.height }}>
                <Certificate name="Student Name" date="October 21, 2026" template={previewTemplate} />
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(draft);
              }}
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-container)',
                padding: 'var(--space-lg)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-md)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: 15, color: 'var(--text-muted)' }}>{selected === 'new' ? 'New certificate' : 'Edit certificate'}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-md)' }}>
                {FIELDS.map((f) => (
                  <label key={f.key} style={{ ...labelStyle, gridColumn: f.span ? '1 / -1' : undefined }}>
                    {f.label}
                    {f.hint && <span style={hint}>{f.hint}</span>}
                    {f.rows ? (
                      <textarea
                        value={draft[f.key]}
                        rows={f.rows}
                        maxLength={f.max}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                        style={{ ...field, resize: 'vertical' }}
                      />
                    ) : (
                      <input value={draft[f.key]} maxLength={f.max} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} style={field} />
                    )}
                  </label>
                ))}
              </div>
              {error && (
                <div role="alert" style={{ color: 'var(--signal-alert)', fontSize: 14 }}>
                  {error}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button type="submit" disabled={save.isPending || !dirty}>
                  {save.isPending ? 'Saving…' : selected === 'new' ? 'Create certificate' : 'Save changes'}
                </Button>
                {selected === 'new' ? (
                  <Button type="button" variant="ghost" onClick={() => setSelected(defaultTemplate?.id ?? null)}>
                    Cancel
                  </Button>
                ) : (
                  current && (
                    <>
                      {dirty && (
                        <Button type="button" variant="ghost" onClick={() => setDraft(toDraft(current))}>
                          Discard changes
                        </Button>
                      )}
                      {!current.isDefault && (
                        <Button type="button" variant="ghost" onClick={() => makeDefault.mutate(current.id)} disabled={makeDefault.isPending}>
                          Make default
                        </Button>
                      )}
                      {!current.isDefault && (
                        <Button type="button" variant="destructive" onClick={() => confirmDelete(current)} disabled={remove.isPending}>
                          Delete
                        </Button>
                      )}
                    </>
                  )
                )}
              </div>
              {current && current.scenarios.length > 0 && (
                <div style={hint}>Changes apply to every student who downloads this certificate from now on — no certificate is stored.</div>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
