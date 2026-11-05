/**
 * Huntington–Hill apportionment against known answers: the 2010 census resident populations in the geography
 * pack reproduce the 2012–2020 House apportionment (each state's seats = its number of 2016 districts).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { huntingtonHill } from '../../../src/engine/districts';

describe('Huntington–Hill apportionment', () => {
  it('gives every state at least one seat and assigns exactly the House size', () => {
    const pops = [1e6, 2e6, 50e3, 30e6, 8e6];
    const r = huntingtonHill(pops, 20);
    expect(r.seats.reduce((a, b) => a + b, 0)).toBe(20);
    expect(Math.min(...r.seats)).toBeGreaterThanOrEqual(1);
    // House monotonicity: one more seat never takes a seat away.
    const r2 = huntingtonHill(pops, 21);
    r.seats.forEach((s, i) => expect(r2.seats[i]!).toBeGreaterThanOrEqual(s));
  });
  it('a textbook case: populations proportional to seats give exactly those seats', () => {
    expect(huntingtonHill([100, 200, 300, 400], 10).seats).toEqual([1, 2, 3, 4]);
  });
  const DIR = 'public/geo-packs/2016.1/';
  it.skipIf(!existsSync(`${DIR}states.json`))('2010 census → the 2012 apportionment, all 50 states', () => {
    const states = JSON.parse(readFileSync(`${DIR}states.json`, 'utf8')) as { idx: number; usps: string; pop2010: number }[];
    const cds = JSON.parse(readFileSync(`${DIR}cd115.json`, 'utf8')) as { stateIdx: number }[];
    const r = huntingtonHill(states.map((s) => s.pop2010), 435, (i) => states[i]!.usps !== 'DC');
    for (const s of states) if (s.usps !== 'DC') expect([s.usps, r.seats[s.idx]]).toEqual([s.usps, cds.filter((c) => c.stateIdx === s.idx).length]);
    expect(r.seats[states.find((s) => s.usps === 'DC')!.idx]).toBe(0);
  });
});
