import { create } from 'zustand';

interface ClockState {
  remainingSeconds: number | null;
  stageLabel: string | null;
  stageVisualStyle: string | null;
  timeUp: boolean;
  setTick: (seconds: number) => void;
  setStage: (label: string, visualStyle: string) => void;
  setTimeUp: () => void;
}

export const useClockStore = create<ClockState>((set) => ({
  remainingSeconds: null,
  stageLabel: null,
  stageVisualStyle: null,
  timeUp: false,
  setTick: (seconds) => set({ remainingSeconds: seconds, timeUp: seconds === 0 }),
  setStage: (label, visualStyle) => set({ stageLabel: label, stageVisualStyle: visualStyle }),
  setTimeUp: () => set({ timeUp: true }),
}));
