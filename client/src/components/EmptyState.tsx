export function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 'var(--space-xl)',
        color: 'var(--text-muted)',
        border: '1px dashed var(--surface-border)',
        borderRadius: 'var(--radius-container)',
        textAlign: 'center',
      }}
    >
      {message}
    </div>
  );
}
