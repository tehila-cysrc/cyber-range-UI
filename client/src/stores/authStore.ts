import { create } from 'zustand';

export interface AuthUser {
  id: number;
  username: string;
  role: 'student' | 'instructor' | 'admin';
  teamId: number | null;
  accountId?: number | null; // staff only (admin/instructor); absent on sessions stored before accounts
  displayName: string;
  avatar?: string | null; // preset key (lib/avatars.ts); absent on sessions stored before avatars existed
}

// What the signed-in user may work on (GET /auth/me) — for showing/hiding UI only. The server checks
// every request on its own; nothing here is a security boundary.
export interface ScopeSummary {
  all: boolean;
  organizations: { id: number; name: string }[];
  cyberRanges: { id: number; name: string }[];
  pairs: { organizationId: number; cyberRangeId: number }[];
}

export interface AccessInfo {
  permissions: string[];
  scope: ScopeSummary | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  permissions: string[] | null; // null until the server told us (old stored session, still loading)
  scope: ScopeSummary | null;
  setAuth: (token: string, user: AuthUser, access?: AccessInfo) => void;
  setAccess: (access: AccessInfo) => void;
  clear: () => void;
}

const STORAGE_KEY = 'cyber-range-auth';

type Stored = { token: string | null; user: AuthUser | null; permissions: string[] | null; scope: ScopeSummary | null };

function loadInitial(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, user: null, permissions: null, scope: null };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return { token: parsed.token ?? null, user: parsed.user ?? null, permissions: parsed.permissions ?? null, scope: parsed.scope ?? null };
  } catch {
    return { token: null, user: null, permissions: null, scope: null };
  }
}

function persist(state: Stored) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...loadInitial(),
  setAuth: (token, user, access) => {
    const next: Stored = {
      token,
      user,
      permissions: access ? access.permissions : get().permissions,
      scope: access ? access.scope : get().scope,
    };
    persist(next);
    set(next);
  },
  setAccess: (access) => {
    const { token, user } = get();
    const next: Stored = { token, user, permissions: access.permissions, scope: access.scope };
    persist(next);
    set(next);
  },
  clear: () => {
    // The query cache is wiped on every identity change (lib/queryClient.ts subscribes to this store).
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null, permissions: null, scope: null });
  },
}));
