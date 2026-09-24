import { useState } from 'react';
import { API_ORIGIN } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { Button } from '../../components/Button';

// Instructor-only results download (UX audit UX-05): Reset wipes every timeline, score and debrief,
// and there was no way to keep them. Fetched with the bearer token, then saved as a file.
async function download(format: 'json' | 'csv') {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${API_ORIGIN}/api/admin/event/export${format === 'csv' ? '?format=csv' : ''}`, {
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
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null);
  const push = useToastStore((s) => s.push);

  async function run(format: 'json' | 'csv') {
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
      <Button variant="ghost" disabled={busy !== null} onClick={() => run('csv')} title="One row per team and scenario — opens in Excel">
        {busy === 'csv' ? 'Preparing…' : 'Download results summary (CSV)'}
      </Button>
      <Button variant="ghost" disabled={busy !== null} onClick={() => run('json')} title="Full archive: timelines, canvas and scores for every team">
        {busy === 'json' ? 'Preparing…' : 'Download full archive (JSON)'}
      </Button>
    </div>
  );
}
