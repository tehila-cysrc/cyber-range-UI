import confetti from 'canvas-confetti';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { useAuthStore } from '../../stores/authStore';
import { playScoreChime } from './playScoreChime';

interface ScoreAwardedPayload {
  isGamified: boolean;
}

// Mounted once, globally (AppShell) — fires regardless of which page the student is on, per
// US-008's "gamified effects" AC. Students only ever receive events for their own team's room, so
// no extra filtering is needed here to keep one team's celebration from leaking to another.
export function GamifiedEffects() {
  const role = useAuthStore((s) => s.user?.role);

  useSocketEvent<ScoreAwardedPayload>('score:awarded', (payload) => {
    if (role !== 'student' || !payload.isGamified) return;

    confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    playScoreChime();
  });

  return null;
}
