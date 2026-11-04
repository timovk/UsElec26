import { describe, expect, it } from 'vitest';
import { STATES_2016 } from '../../../src/rules/states2016';

const states = Object.values(STATES_2016).filter((s) => s.usps !== 'DC');

describe('2016 institutional baseline invariants', () => {
  it('has 50 states plus DC', () => { expect(states.length).toBe(50); expect(STATES_2016.DC).toBeDefined(); });
  it('U.S. Senate: every state has exactly two distinct classes; class sizes 33/33/34', () => {
    const size: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    for (const s of states) { expect(new Set(s.senateClasses).size).toBe(2); for (const c of s.senateClasses) size[c]!++; }
    expect(size).toEqual({ 1: 33, 2: 33, 3: 34 });
  });
  it('state legislatures: 1,972 upper and 5,411 lower seats (7,383 total)', () => {
    expect(states.reduce((a, s) => a + (s.upper?.seats ?? 0), 0)).toBe(1972);
    expect(states.reduce((a, s) => a + (s.lower?.seats ?? 0), 0)).toBe(5411);
    expect(states.filter((s) => !s.lower).map((s) => s.usps)).toEqual(['NE']);
  });
  it('statewide offices: 43 elected AGs; SoS 35 elected / 9 appointed / 3 legislature / 3 none; 5 states without LG', () => {
    expect(states.filter((s) => s.agElected).length).toBe(43);
    const sos = (k: string) => states.filter((s) => s.sos === k).length;
    expect([sos('elected'), sos('appointed'), sos('legislature'), sos('none')]).toEqual([35, 9, 3, 3]);
    expect(states.filter((s) => s.ltGov === 'none').map((s) => s.usps).sort()).toEqual(['AZ', 'ME', 'NH', 'OR', 'WY']);
  });
  it('gubernatorial cycles: 36 in 2018 (incl. NH, VT), 11 in 2016, NJ/VA odd-year, KY/LA/MS 2015', () => {
    const next = (s: (typeof states)[number]) => { let y = s.governor!.lastElection; while (y < 2016) y += s.governor!.termYears; return y; };
    expect(states.filter((s) => next(s) === 2016).length).toBe(11);
    expect(states.filter((s) => { let y = s.governor!.lastElection; while (y < 2018) y += s.governor!.termYears; return y === 2018; }).length).toBe(36);
    expect(states.filter((s) => next(s) === 2017).map((s) => s.usps).sort()).toEqual(['NJ', 'VA']);
    expect(states.filter((s) => next(s) === 2019).map((s) => s.usps).sort()).toEqual(['KY', 'LA', 'MS']);
  });
});
