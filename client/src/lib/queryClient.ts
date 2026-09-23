import { MutationCache, QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { ApiError } from './apiClient';

export const queryClient = new QueryClient({
  // Safety net: many admin mutations (topology edits, discovery, script saves, ...) had no onError,
  // so a failed click during a live exercise looked like nothing happened. Any mutation that doesn't
  // handle its own error now surfaces the server's message as a toast.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.options.onError) return;
      const message = error instanceof ApiError ? error.message : 'Something went wrong — please try again.';
      useToastStore.getState().push(message);
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Most query keys (['history'], ['team-scores'], ['active-cyber-range'], ...) are implicitly scoped
// to "whoever is signed in", so a cache that survives a sign-out would briefly show the previous
// user's (possibly another team's) data to the next one. Wipe it whenever the identity changes.
useAuthStore.subscribe((state, prev) => {
  if (state.token !== prev.token) queryClient.clear();
});
