import confetti from 'canvas-confetti';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { useAuthStore } from '../../stores/authStore';

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

    try {
      const audio = new Audio('/sounds/score.mp3');
      audio.volume = 0.5;
      void audio.play().catch(() => {
        // Autoplay can be blocked before the user has interacted with the page — non-fatal,
        // confetti still shows.
      });
    } catch {
      // No audio asset / unsupported — confetti alone is enough, never let this throw.
    }
  });

  return null;
}
