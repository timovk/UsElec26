/**
 * Broadcast sound cues, synthesized with Web Audio (no audio files): a two-note sting for projections, a
 * rising triple for Key Race Alerts, a chord for the biggest moments and a soft chime for poll closings.
 * The audio context starts on the first user gesture; the mute setting is remembered on this device.
 */
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem('ena.mute') === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m: boolean): void { muted = m; try { localStorage.setItem('ena.mute', m ? '1' : '0'); } catch { /* storage unavailable */ } }

/** Call from a user gesture (play, unmute) so the browser allows sound. */
export function unlockAudio(): void {
  try { if (!ctx) ctx = new AudioContext(); if (ctx.state === 'suspended') void ctx.resume(); } catch { ctx = null; }
}

function tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}

export type Cue = 'projection' | 'key_race' | 'major' | 'polls_closed' | 'withdrawn';
export function playCue(c: Cue): void {
  if (muted || !ctx || ctx.state !== 'running') return;
  switch (c) {
    case 'projection': tone(659, 0, 0.35, 0.12, 'triangle'); tone(988, 0.12, 0.5, 0.1, 'triangle'); break;
    case 'key_race': for (let i = 0; i < 3; i++) tone(740 + 120 * i, 0.11 * i, 0.12, 0.09, 'square'); break;
    case 'major': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.04 * i, 1.4, 0.07, 'triangle')); break;
    case 'polls_closed': tone(880, 0, 0.6, 0.06); tone(1320, 0.05, 0.5, 0.03); break;
    case 'withdrawn': tone(440, 0, 0.3, 0.1, 'sawtooth'); tone(330, 0.18, 0.45, 0.1, 'sawtooth'); break;
  }
}
