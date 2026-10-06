import { useState } from 'react';
import { API_ORIGIN } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { Button } from '../../components/Button';

// Instructor-only results download (UX audit UX-05): Reset wipes every timeline, score and debrief,
// and there was no way to keep them. Fetched with the bearer token, then saved as a file.
async function download(format: 'json' | 'xlsx') {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${API_ORIGIN}/api/admin/event/export${format === 'xlsx' ? '?format=xlsx' : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] ?? `cyber-range-results.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportResultsButtons() {
  const [busy, setBusy] = useState<'json' | 'xlsx' | null>(null);
  const push = useToastStore((s) => s.push);

  async function run(format: 'json' | 'xlsx') {
    setBusy(format);
    try {
      await download(format);
    } catch (err) {
      push(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
      <Button
        variant="ghost"
        disabled={busy !== null}
        onClick={() => run('xlsx')}
        title="Excel workbook: summary plus every timeline entry (with screenshots), score, student, canvas item, help request and ATT&CK credit"
      >
        {busy === 'xlsx' ? 'Preparing…' : 'Download full results (Excel)'}
      </Button>
      <Button variant="ghost" disabled={busy !== null} onClick={() => run('json')} title="Full archive for re-import or tooling: the same data as JSON, screenshots included">
        {busy === 'json' ? 'Preparing…' : 'Download full archive (JSON)'}
      </Button>
    </div>
  );
}
