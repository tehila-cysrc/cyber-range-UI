import confetti from 'canvas-confetti';
import { useSocketEvent } from '../../hooks/useSocketEvent';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { playScoreChime } from './playScoreChime';

interface ScoreAwardedPayload {
  isGamified: boolean;
  score: { points: number; note: string | null; studentName: string | null } | null;
}

// Mounted once, globally (AppShell) — fires regardless of which page the student is on, per
// US-008's "gamified effects" AC. Students only ever receive events for their own team's room, so
// no extra filtering is needed here to keep one team's celebration from leaking to another.
// Every award also gets a text toast (points + reason): confetti alone didn't say what was earned,
// and non-gamified awards used to be completely silent until the student opened Progress.
export function GamifiedEffects() {
  const role = useAuthStore((s) => s.user?.role);
  const push = useToastStore((s) => s.push);
  useSocketEvent<ScoreAwardedPayload>('score:awarded', (payload) => {
    if (role !== 'student') return;
    const { score } = payload;
    if (score) {
      const sign = score.points >= 0 ? '+' : '';
      const who = score.studentName ? ` for ${score.studentName}` : ' for the team';
      push(`${sign}${score.points} pts${who}${score.note ? ` — ${score.note}` : ''}`, 'success');
    }
    if (!payload.isGamified) return;
    confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    playScoreChime();
  });
  return null;
}
