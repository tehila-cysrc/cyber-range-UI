import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { useToastStore } from '../../stores/toastStore';
import { OWN_HELP_REQUEST_KEY } from './HelpRequestButton';

interface IncomingHelpRequest {
  teamName: string;
  requestedByName: string;
  message: string | null;
}

export const OPEN_HELP_REQUESTS_KEY = ['help-requests', 'open'];

// Instructor, every page: help requests used to exist only on the Dashboard — an instructor working
// in Scoring or Topology Admin saw nothing. Now: a toast on arrival, a count on the nav, and the tab
// title, so a waiting team is visible from anywhere (and from another browser tab).
export function useOpenHelpRequestCount(enabled: boolean) {
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const { data } = useQuery({
    queryKey: OPEN_HELP_REQUESTS_KEY,
    queryFn: () => apiFetch<{ helpRequests: unknown[] }>('/admin/help-requests?status=open'),
    enabled,
  });

  useSocketEvent<{ helpRequest: IncomingHelpRequest }>('help_request:new', ({ helpRequest }) => {
    if (!enabled) return;
    queryClient.invalidateQueries({ queryKey: OPEN_HELP_REQUESTS_KEY });
    queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
    const note = helpRequest.message ? ` — “${helpRequest.message}”` : '';
    push(`Help requested · ${helpRequest.teamName}: ${helpRequest.requestedByName}${note}`, 'error');
  });
  useSocketEvent('help_request:resolved', () => {
    if (!enabled) return;
    queryClient.invalidateQueries({ queryKey: OPEN_HELP_REQUESTS_KEY });
    queryClient.invalidateQueries({ queryKey: ['instructor-dashboard'] });
  });

  const count = enabled ? (data?.helpRequests.length ?? 0) : 0;
  useEffect(() => {
    if (!enabled) return;
    document.title = count > 0 ? `(${count}) Help requested · Cyber Range` : 'Cyber Range';
    return () => {
      document.title = 'Cyber Range';
    };
  }, [count, enabled]);
  return count;
}

// Student, every page: the team learns its request was handled (or closed because the scenario
// ended) instead of the "Sent" line just disappearing.
export function useOwnHelpRequestSync(enabled: boolean) {
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);

  useSocketEvent('help_request:new', () => {
    if (enabled) queryClient.invalidateQueries({ queryKey: OWN_HELP_REQUEST_KEY });
  });
  useSocketEvent<{ reason?: 'instructor' | 'scenario_ended' }>('help_request:resolved', ({ reason }) => {
    if (!enabled) return;
    queryClient.invalidateQueries({ queryKey: OWN_HELP_REQUEST_KEY });
    push(
      reason === 'scenario_ended'
        ? 'Your help request was closed because the scenario ended.'
        : 'The instructor marked your help request as handled.',
      'success',
    );
  });
}
