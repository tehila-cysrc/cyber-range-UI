import { useSocketEvent } from '../../hooks/useSocketEvent';
import { useToastStore } from '../../stores/toastStore';

// Student, every page: the team hears about new instructor feedback even when the Timeline isn't
// open (the entry itself updates in place via documentation:updated).
export function useEntryFeedbackToast(enabled: boolean) {
  const push = useToastStore((s) => s.push);
  useSocketEvent('documentation:feedback', () => {
    if (enabled) push('The instructor left feedback on one of your Timeline entries.', 'info');
  });
}
