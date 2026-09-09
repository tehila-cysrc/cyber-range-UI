import { create } from 'zustand';

// Keeps an in-progress documentation entry alive across navigation (e.g. student pops over to the
// Topology view mid-write and comes back) — US-004's "don't lose your work state" requirement.
interface DraftState {
  draftsByCyberRange: Record<number, string>;
  setDraft: (cyberRangeId: number, body: string) => void;
  clearDraft: (cyberRangeId: number) => void;
}

export const useDraftStore = create<DraftState>((set) => ({
  draftsByCyberRange: {},
  setDraft: (cyberRangeId, body) =>
    set((state) => ({ draftsByCyberRange: { ...state.draftsByCyberRange, [cyberRangeId]: body } })),
  clearDraft: (cyberRangeId) =>
    set((state) => {
      const next = { ...state.draftsByCyberRange };
      delete next[cyberRangeId];
      return { draftsByCyberRange: next };
    }),
}));
