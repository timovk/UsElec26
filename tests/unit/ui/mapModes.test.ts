/** Map modes: values and colours from an area's numbers, and the recolour budget. */
import { describe, expect, it } from 'vitest';
import { MODES, areaColor, areaValue, legendOf, type Area } from '../../../src/ui/night/mapModes';

const area = (over: Partial<Area> = {}): Area => ({ votes: [600, 400, 0, 20], parties: [1, 2, 5], expected: 2000, called: -1, closed: true, eligible: 4000, base: { d: 450, r: 550, valid: 1000, ballots: 1500, eligible: 4000 }, ...over });

describe('map modes', () => {
  it('computes each mode from the area numbers', () => {
    const a = area();
    expect(areaValue('margin', a)).toBeCloseTo(20);
    expect(areaValue('swing', a)).toBeCloseTo(20 - -10);
    expect(areaValue('turnout', a)).toBeCloseTo(50);
    expect(areaValue('turnoutChange', a)).toBeCloseTo(50 - 37.5);
    expect(areaValue('reporting', a)).toBeCloseTo(51);
    expect(areaValue('outstanding', a)).toBe(980);
    expect(areaValue('share', a, 1)).toBeCloseTo(60);
    expect(areaValue('share', a, 2)).toBeCloseTo(40);
    expect(areaValue('winner', a)).toBe(0);
  });
  it('handles missing data without inventing values', () => {
    expect(areaValue('swing', area({ base: null }))).toBeNull();
    expect(areaValue('margin', area({ votes: null }))).toBeNull();
    expect(areaValue('turnout', area({ eligible: 0 }))).toBeNull();
    expect(areaColor('margin', area({ closed: false }))).toBe('#232a4d'); // polls open
    expect(areaColor('winner', area({ votes: null }))).toBe('#3a4166'); // no votes yet
  });
  it('colours projected winners solid and leaders pale; a third-party leader in its own colour', () => {
    expect(areaColor('winner', area({ called: 0 }))).toBe('#1F5FD6');
    expect(areaColor('winner', area())).toBe('#7ea3ea');
    expect(areaColor('margin', area({ votes: [100, 200, 500, 0], parties: [1, 2, 3] }))).toBe('#E0A800');
  });
  it('every mode has a legend', () => { for (const m of MODES) expect(legendOf(m.id).length).toBeGreaterThan(1); });
  it('recolours 3,142 counties well within the 50 ms budget (colour computation)', () => {
    const areas = Array.from({ length: 3142 }, (_, i) => area({ votes: [500 + (i % 300), 500 + ((i * 7) % 300), 10, 5] }));
    for (const m of MODES) {
      const t0 = performance.now();
      for (const a of areas) areaColor(m.id, a, 1, 100000);
      expect(performance.now() - t0).toBeLessThan(50);
    }
  });
});
