let audioCtx: AudioContext | null = null;

// Synthesized two-note chime via WebAudio — no external sound asset to source/license, matching
// the design system's "restrained" ethos (see docs/DESIGN.md) rather than a canned sound effect.
export function playScoreChime() {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();

    const now = audioCtx.currentTime;
    [523.25, 783.99].forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {
    // WebAudio unsupported or blocked before any user interaction — confetti alone is enough.
  }
}
