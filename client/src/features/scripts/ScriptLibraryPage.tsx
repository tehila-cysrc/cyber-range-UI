import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Button } from '../../components/Button';

export interface ScriptSummary {
  id: number;
  name: string;
  description: string | null;
  scriptType: 'powershell' | 'bash';
  category: string | null;
  createdAt: string;
  createdByUsername: string | null;
  updatedAt: string | null;
}

export interface Script extends ScriptSummary {
  content: string;
}

// Suggestions only — the category column is free text, not a fixed enum, per the design doc.
export const SUGGESTED_CATEGORIES = [
  'Normal Activity',
  'Suspicious Activity',
  'Investigation',
  'AI Agent Activity',
  'Azure Activity',
  'AWS Activity',
  'Cleanup',
];

const fieldStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 'var(--radius-control)',
  padding: 8,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 13,
};

type Draft = { id: number | null; name: string; description: string; content: string; scriptType: 'powershell' | 'bash'; category: string };

const EMPTY_DRAFT: Draft = { id: null, name: '', description: '', content: '', scriptType: 'powershell', category: '' };

export function ScriptLibraryPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  const { data } = useQuery({
    queryKey: ['scripts', search, category],
    queryFn: () =>
      apiFetch<{ scripts: ScriptSummary[] }>(
        `/admin/scripts?${new URLSearchParams({ ...(search ? { search } : {}), ...(category ? { category } : {}) })}`,
      ),
  });

  const scripts = data?.scripts ?? [];
  const categories = Array.from(new Set(scripts.map((s) => s.category).filter((c): c is string => !!c))).sort();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['scripts'] });
  }

  const saveMutation = useMutation({
    mutationFn: (d: Draft) =>
      d.id
        ? apiFetch(`/admin/scripts/${d.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: d.name, description: d.description, content: d.content, scriptType: d.scriptType, category: d.category || null }),
          })
        : apiFetch('/admin/scripts', {
            method: 'POST',
            body: JSON.stringify({ name: d.name, description: d.description, content: d.content, scriptType: d.scriptType, category: d.category || null }),
          }),
    onSuccess: () => {
      setDraft(null);
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/scripts/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  async function openForEdit(id: number) {
    const { script } = await apiFetch<{ script: Script }>(`/admin/scripts/${id}`);
    setDraft({ id: script.id, name: script.name, description: script.description ?? '', content: script.content, scriptType: script.scriptType, category: script.category ?? '' });
  }

  return (
    <div className="page" style={{ padding: 'var(--space-xl)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: 0 }}>Script Library</h1>
        <Button variant="primary" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          + New script
        </Button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name/description…" aria-label="Search scripts" style={{ ...fieldStyle, flex: '1 1 220px', minWidth: 0 }} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" style={{ ...fieldStyle, maxWidth: '100%' }}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className={draft ? 'split-main-side' : undefined} style={draft ? undefined : { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {scripts.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No scripts yet — create one to get started.</p>}
          {scripts.map((s) => (
            <div
              key={s.id}
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-container)',
                padding: 'var(--space-md)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 'var(--space-md)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 14 }}>{s.name}</span>
                  <TypeBadge type={s.scriptType} />
                  {s.category && (
                    <span style={{ fontSize: 11, color: 'var(--text-telemetry)', border: '1px solid var(--surface-border)', borderRadius: 999, padding: '1px 8px' }}>
                      {s.category}
                    </span>
                  )}
                </div>
                {s.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.description}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <Button variant="ghost" onClick={() => openForEdit(s.id)}>
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => window.confirm(`Delete script "${s.name}"?`) && deleteMutation.mutate(s.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>

        {draft && (
          <ScriptEditor
            draft={draft}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={() => saveMutation.mutate(draft)}
            saving={saveMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}

export function TypeBadge({ type }: { type: 'powershell' | 'bash' }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: type === 'powershell' ? 'var(--signal-secondary)' : 'var(--signal-primary)',
        border: '1px solid var(--surface-border)',
        borderRadius: 4,
        padding: '1px 6px',
      }}
    >
      {type === 'powershell' ? 'PowerShell' : 'Bash'}
    </span>
  );
}

function ScriptEditor({
  draft,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const valid = draft.name.trim() && draft.content.trim();
  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-container)', padding: 'var(--space-md)', height: 'fit-content' }}>
      <h3 style={{ fontSize: 14, color: 'var(--text-primary)', margin: '0 0 10px' }}>{draft.id ? 'Edit script' : 'New script'}</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="Name (e.g. Normal AI Agent Activity)" style={fieldStyle} />
        <input value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} placeholder="Description" style={fieldStyle} />
        <input
          value={draft.category}
          onChange={(e) => onChange({ ...draft, category: e.target.value })}
          placeholder="Category (optional)"
          list="script-category-suggestions"
          style={fieldStyle}
        />
        <datalist id="script-category-suggestions">
          {SUGGESTED_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <select value={draft.scriptType} onChange={(e) => onChange({ ...draft, scriptType: e.target.value as 'powershell' | 'bash' })} style={fieldStyle}>
          <option value="powershell">PowerShell (Windows)</option>
          <option value="bash">Bash (Linux)</option>
        </select>
        <textarea
          value={draft.content}
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
          placeholder="Script content…"
          rows={14}
          style={{ ...fieldStyle, fontFamily: 'var(--font-mono)', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" disabled={!valid || saving} onClick={onSave}>
            Save
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
