/**
 * Map modes for the night and the archive: winner, margin, swing, turnout, turnout change, reporting,
 * outstanding vote and candidate share. Pure functions from an area's numbers to a value and a colour, so
 * maps recolour without layout work and the scales are testable.
 */
import { MARGIN_STOPS, marginColor } from '../map/renderer';

export type MapMode = 'winner' | 'margin' | 'swing' | 'turnout' | 'turnoutChange' | 'reporting' | 'outstanding' | 'share';

export const MODES: { id: MapMode; label: string; needs?: 'baseline' | 'eligible' | 'expected' }[] = [
  { id: 'winner', label: 'Winner' }, { id: 'margin', label: 'Margin' }, { id: 'swing', label: 'Swing', needs: 'baseline' },
  { id: 'turnout', label: 'Turnout', needs: 'eligible' }, { id: 'turnoutChange', label: 'Turnout change', needs: 'baseline' },
  { id: 'reporting', label: 'Reporting', needs: 'expected' }, { id: 'outstanding', label: 'Outstanding', needs: 'expected' }, { id: 'share', label: 'Candidate share' },
];

export interface Baseline { d: number; r: number; valid: number; ballots: number; eligible: number }
export interface Area {
  /** Counted votes in ballot order (undervotes last), or null before any count. */
  votes: ArrayLike<number> | null;
  parties: readonly number[];
  /** Expected ballots (wire), 0 if unknown. */
  expected: number;
  /** Called option, −1 if none (state level only). */
  called: number;
  /** Polls have closed. */
  closed: boolean;
  eligible: number;
  base: Baseline | null;
}

export const PALE: Record<number, string> = { 1: '#7ea3ea', 2: '#ec8a96', 3: '#e9c867', 4: '#7cc59a', 5: '#b3b7c2' };
export const SOLID: Record<number, string> = { 0: '#3a4166', 1: '#1F5FD6', 2: '#D7263D', 3: '#E0A800', 4: '#2E9E5B', 5: '#8A8F9E' };
const NOT_CLOSED = '#232a4d', NO_VOTES = '#3a4166';
// Sequential: one hue (amber), dim to bright on the dark map surface.
const SEQ = ['#2a2618', '#4a3e1c', '#76601f', '#a5811f', '#d4a221', '#ffc53d'];
const UP = ['#d8f3e4', '#9fe0bd', '#55c48f', '#26a06a'], DOWN = ['#eadff7', '#c8aee9', '#9c74d4', '#7448b8'];

const sums = (a: Area) => {
  const v = a.votes; if (!v) return null;
  const K = a.parties.length;
  let valid = 0, ballots = 0, best = -1, bv = 0;
  for (let j = 0; j < v.length; j++) { ballots += v[j]!; if (j < K) { valid += v[j]!; if (v[j]! > bv) { bv = v[j]!; best = j; } } }
  const di = a.parties.indexOf(1), ri = a.parties.indexOf(2);
  return { valid, ballots, best, d: di >= 0 ? v[di]! : 0, r: ri >= 0 ? v[ri]! : 0 };
};

/** The mode's value for an area (points, shares or votes), null when it cannot be computed. */
export function areaValue(mode: MapMode, a: Area, shareParty = 1): number | null {
  const s = sums(a);
  switch (mode) {
    case 'winner': return s && s.best >= 0 ? s.best : null;
    case 'margin': return s && s.valid > 0 ? (100 * (s.d - s.r)) / s.valid : null;
    case 'swing': return s && s.valid > 0 && a.base && a.base.valid > 0 ? (100 * (s.d - s.r)) / s.valid - (100 * (a.base.d - a.base.r)) / a.base.valid : null;
    case 'turnout': return a.eligible > 0 && a.expected > 0 ? (100 * a.expected) / a.eligible : null;
    case 'turnoutChange': return a.eligible > 0 && a.expected > 0 && a.base && a.base.eligible > 0 ? (100 * a.expected) / a.eligible - (100 * a.base.ballots) / a.base.eligible : null;
    case 'reporting': return a.expected > 0 ? Math.min(100, (100 * (s?.ballots ?? 0)) / a.expected) : null;
    case 'outstanding': return a.expected > 0 ? Math.max(0, a.expected - (s?.ballots ?? 0)) : null;
    case 'share': { const j = a.parties.indexOf(shareParty); return s && s.valid > 0 && j >= 0 ? (100 * a.votes![j]!) / s.valid : null; }
  }
}

const bin = (x: number, stops: number[]) => { let i = 0; while (i < stops.length && x >= stops[i]!) i++; return i; };
const OUT_STOPS = [1000, 5000, 20000, 60000, 150000];

/** The colour of an area; `max` scales the outstanding-vote ramp when areas differ in size (counties). */
export function areaColor(mode: MapMode, a: Area, shareParty = 1, max = 0): string | null {
  if (!a.closed && mode !== 'turnout' && mode !== 'turnoutChange') return NOT_CLOSED;
  if (mode === 'winner') {
    if (a.called >= 0) return SOLID[a.parties[a.called] ?? 5]!;
    const s = sums(a); if (!s || s.best < 0) return NO_VOTES;
    return PALE[a.parties[s.best] ?? 5]!;
  }
  const v = areaValue(mode, a, shareParty);
  if (v === null) return NO_VOTES;
  switch (mode) {
    case 'margin': {
      const s = sums(a)!; const lead = a.parties[s.best];
      if (lead !== 1 && lead !== 2 && lead !== undefined) return SOLID[lead]!; // a third party or independent leads
      return marginColor(v);
    }
    case 'swing': return marginColor(v);
    case 'turnout': return SEQ[Math.min(SEQ.length - 1, bin(v, [35, 45, 55, 62, 70]))]!;
    case 'turnoutChange': { const i = Math.min(3, bin(Math.abs(v), [1, 3, 6])); return v >= 0 ? UP[i]! : DOWN[i]!; }
    case 'reporting': return SEQ[Math.min(SEQ.length - 1, bin(v, [1, 25, 50, 75, 95]))]!;
    case 'outstanding': { const stops = max > 0 ? OUT_STOPS.map((x) => x * Math.max(0.05, max / 600000)) : OUT_STOPS; return SEQ[Math.min(SEQ.length - 1, bin(v, stops))]!; }
    case 'share': {
      const base = SOLID[shareParty] ?? SOLID[5]!; const i = bin(v, [20, 35, 45, 55, 65]);
      return mix('#1a2142', base, [0.15, 0.3, 0.48, 0.66, 0.84, 1][i]!);
    }
  }
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Legend swatches for a mode. */
export function legendOf(mode: MapMode, shareParty = 1): { color: string; label: string }[] {
  switch (mode) {
    case 'winner': return [{ color: SOLID[1]!, label: 'D projected' }, { color: PALE[1]!, label: 'D leading' }, { color: PALE[2]!, label: 'R leading' }, { color: SOLID[2]!, label: 'R projected' }, { color: NO_VOTES, label: 'No votes yet' }, { color: NOT_CLOSED, label: 'Polls open' }];
    case 'margin': case 'swing': {
      const l = (m: number) => marginColor(m)!;
      const lbl = mode === 'swing' ? (s: string, n: number) => `${s} +${n}` : (s: string, n: number) => `${s}+${n}`;
      return [...MARGIN_STOPS.slice().reverse().map((m) => ({ color: l(m + 0.01), label: lbl('D', m) })), ...MARGIN_STOPS.map((m) => ({ color: l(-m - 0.01), label: lbl('R', m) }))].filter((_, i) => i % 2 === 0);
    }
    case 'turnout': return [35, 45, 55, 62, 70].map((x, i) => ({ color: SEQ[i + 1]!, label: `${x}%` }));
    case 'turnoutChange': return [{ color: DOWN[3]!, label: '−6 pts' }, { color: DOWN[1]!, label: '−1' }, { color: UP[1]!, label: '+1' }, { color: UP[3]!, label: '+6 pts' }];
    case 'reporting': return [1, 25, 50, 75, 95].map((x, i) => ({ color: SEQ[i + 1]!, label: `${x}%` }));
    case 'outstanding': return [{ color: SEQ[1]!, label: 'Few votes out' }, { color: SEQ[3]!, label: '' }, { color: SEQ[5]!, label: 'Most votes out' }];
    case 'share': return [20, 35, 45, 55, 65].map((x, i) => ({ color: mix('#1a2142', SOLID[shareParty] ?? SOLID[5]!, [0.3, 0.48, 0.66, 0.84, 1][i]!), label: `${x}%` }));
  }
}

/** A one-line description of what a mode shows (for captions). */
export const MODE_CAPTION: Record<MapMode, string> = {
  winner: 'Leader in each area (projected winners solid on election night)',
  margin: 'Two-party margin, D+ / R+ points',
  swing: 'Change in the two-party margin since the previous comparable election',
  turnout: 'Ballots as a share of eligible voters (on election night: the expected vote)',
  turnoutChange: 'Change in turnout since the previous comparable election, points',
  reporting: 'Share of the expected vote counted',
  outstanding: 'Ballots still expected to be counted',
  share: "A party's share of the valid vote",
};
