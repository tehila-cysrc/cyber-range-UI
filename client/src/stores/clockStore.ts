import { create } from 'zustand';

interface ClockState {
  remainingSeconds: number | null;
  stageLabel: string | null;
  stageVisualStyle: string | null;
  timeUp: boolean;
  setTick: (seconds: number) => void;
  setStage: (label: string, visualStyle: string) => void;
  setTimeUp: () => void;
  reset: () => void;
}

export const useClockStore = create<ClockState>((set) => ({
  remainingSeconds: null,
  stageLabel: null,
  stageVisualStyle: null,
  timeUp: false,
  setTick: (seconds) => set({ remainingSeconds: seconds, timeUp: seconds === 0 }),
  setStage: (label, visualStyle) => set({ stageLabel: label, stageVisualStyle: visualStyle }),
  setTimeUp: () => set({ timeUp: true }),
  // Called when the instructor assigns/switches/completes the team's scenario — the previous
  // scenario's "Time's up" / pressure stage must not bleed into the new one.
  reset: () => set({ remainingSeconds: null, stageLabel: null, stageVisualStyle: null, timeUp: false }),
}));
