import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/apiClient';
import { Button } from '../../../components/Button';
import { confirmAction } from '../../../components/ConfirmDialog';
import { useToastStore } from '../../../stores/toastStore';

interface PublicationStatus {
  published: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  hasUnpublishedChanges: boolean;
}

// Students see only the topology the instructor last published (UX-38). This bar says what students
// currently see and whether the draft has changed since.
export function PublicationBar({ cyberRangeId, draftVersion, visibleNodeCount }: { cyberRangeId: number; draftVersion: number; visibleNodeCount: number }) {
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const key = ['topology-publication', cyberRangeId, draftVersion];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<PublicationStatus>(`/admin/cyber-ranges/${cyberRangeId}/topology/publication`),
  });

  const publish = useMutation({
    mutationFn: () => apiFetch<{ nodeCount: number }>(`/admin/cyber-ranges/${cyberRangeId}/topology/publish`, { method: 'POST' }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['topology-publication', cyberRangeId] });
      push(`Published to students — ${res.nodeCount} machine${res.nodeCount === 1 ? '' : 's'} visible.`, 'success');
    },
  });

  async function handlePublish() {
    const ok = await confirmAction({
      title: 'Publish this topology to students?',
      message: `Students on this scenario will see the current layout with ${visibleNodeCount} machine${visibleNodeCount === 1 ? '' : 's'} (nodes marked "Visible to students"). Later edits stay private until you publish again.`,
      confirmLabel: 'Publish to students',
    });
    if (ok) publish.mutate();
  }

  if (!data) return null;
  const when = data.publishedAt ? new Date(data.publishedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const needsAttention = !data.published || data.hasUnpublishedChanges;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-sm)',
        marginBottom: 'var(--space-md)',
        padding: 'var(--space-sm) var(--space-md)',
        border: `1px solid ${needsAttention ? 'var(--signal-tertiary)' : 'var(--surface-border)'}`,
        borderRadius: 'var(--radius-control)',
        background: 'var(--surface-1)',
        fontSize: 14,
        color: 'var(--text-primary)',
      }}
    >
      <span>
        {!data.published
          ? "Not published yet — students can't see this topology."
          : data.hasUnpublishedChanges
            ? `Unpublished changes — students still see the version published ${when}.`
            : `Students see this version (published ${when}${data.publishedBy ? ` by ${data.publishedBy}` : ''}).`}
      </span>
      {needsAttention && (
        <Button onClick={handlePublish} disabled={publish.isPending} style={{ padding: '6px 14px', fontSize: 14 }}>
          {publish.isPending ? 'Publishing…' : 'Publish to students'}
        </Button>
      )}
    </div>
  );
}
