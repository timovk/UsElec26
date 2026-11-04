/** Delegate math: apportionment, thresholds and each party's 2016 allocation rules. */
import { describe, expect, it } from 'vitest';
import { allocateDemocratic, allocateRepublican, hamilton, needed, proportional } from '../../../src/primaries/delegates';
import { NOMINATING_2016 } from '../../../src/rules/primaries2016';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('delegate math', () => {
  it('largest remainder gives every seat and respects quotas', () => {
    expect(hamilton(10, [50, 30, 20])).toEqual([5, 3, 2]);
    expect(hamilton(7, [45, 35, 20])).toEqual([3, 3, 1]);
    expect(sum(hamilton(23, [33.4, 33.3, 33.3]))).toBe(23);
    expect(hamilton(5, [0, 0])).toEqual([0, 0]);
  });
  it('thresholds exclude small candidates; nobody above means everyone shares', () => {
    expect(proportional(10, [60, 30, 10], 0.15)).toEqual([7, 3, 0]);
    expect(proportional(4, [14, 13, 12, 11], 0.15)).toEqual([1, 1, 1, 1]);
  });
  it('Democratic: districts and statewide, 15% everywhere, all delegates assigned', () => {
    const res = { statewide: [52, 40, 8], byDistrict: [[60, 35, 5], [45, 45, 10], [50, 40, 10]] };
    const a = allocateDemocratic(44, res);
    expect(sum(a.pledged)).toBe(44); expect(a.pledged[2]).toBe(0); expect(a.pledged[0]).toBeGreaterThan(a.pledged[1]!);
  });
  it('Republican: winner-take-all, triggers, district rules, unbound', () => {
    expect(allocateRepublican(99, { rule: 'wta', threshold: 0 }, { statewide: [40, 45, 15], byDistrict: [] }).pledged).toEqual([0, 99, 0]);
    const trig = allocateRepublican(40, { rule: 'prop', threshold: 0.15, wtaAbove: 0.5 }, { statewide: [55, 30, 15], byDistrict: [] });
    expect(trig.pledged).toEqual([40, 0, 0]);
    const cd = allocateRepublican(50, { rule: 'wta_cd', threshold: 0 }, { statewide: [40, 35, 25], byDistrict: [[50, 40, 10], [30, 45, 25], [20, 30, 50]] });
    expect(cd.pledged).toEqual([41 + 3, 3, 3]); expect(sum(cd.pledged)).toBe(50);
    const tx = allocateRepublican(155, { rule: 'prop', threshold: 0.2, wtaAbove: 0.5, byDistrict: true }, { statewide: [44, 27, 18, 11], byDistrict: Array.from({ length: 36 }, (_, i) => (i % 3 ? [55, 25, 15, 5] : [35, 40, 15, 10])) });
    expect(sum(tx.pledged)).toBe(155); expect(tx.pledged[3]).toBe(0);
    const pa = allocateRepublican(71, { rule: 'wta', threshold: 0, unbound: 54 }, { statewide: [50, 30, 20], byDistrict: [] });
    expect(pa).toEqual({ pledged: [17, 0, 0], unbound: 54 });
    expect(allocateRepublican(37, { rule: 'unbound', threshold: 0 }, { statewide: [1, 1], byDistrict: [] })).toEqual({ pledged: [0, 0], unbound: 37 });
  });
  it('the 2016 calendar covers every state for both parties, with plausible totals', () => {
    const states = Object.keys(NOMINATING_2016);
    expect(states.length).toBe(51);
    const D = sum(states.map((s) => NOMINATING_2016[s]!.D.delegates)), R = sum(states.map((s) => NOMINATING_2016[s]!.R.delegates));
    expect(D).toBeGreaterThan(3900); expect(D).toBeLessThan(4100);
    expect(R).toBeGreaterThan(2350); expect(R).toBeLessThan(2450);
    expect(needed(R)).toBe(Math.floor(R / 2) + 1);
  });
});
