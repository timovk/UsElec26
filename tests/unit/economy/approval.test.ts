/** Presidential approval measured from the electorate: polarized by partisanship, moved by the economy and events. */
import { describe, expect, it } from 'vitest';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { buildPopulation } from '../../../src/population/population';
import { generateElectorate } from '../../../src/electorate/model';
import { approvalShare } from '../../../src/electorate/measure';

describe('presidential approval', () => {
  const pack = makeFixturePack(); const pop = buildPopulation(pack); const e = generateElectorate('APP', pack, pop);
  const base = { econ: 0, standing: 0, honeymoon: 0 };
  it('is polarized: co-partisans approve, opponents mostly disapprove; overall in a normal range', () => {
    const a = approvalShare(e, pop, 1, base);
    expect(a.copartisans).toBeGreaterThan(0.7); expect(a.opponents).toBeLessThan(0.25);
    expect(a.approve).toBeGreaterThan(0.3); expect(a.approve).toBeLessThan(0.65);
  });
  it('rises with a good economy, a honeymoon and good standing; falls in a recession and after a scandal', () => {
    const a = approvalShare(e, pop, -1, base).approve;
    expect(approvalShare(e, pop, -1, { ...base, econ: 1.5 }).approve).toBeGreaterThan(a + 0.03);
    expect(approvalShare(e, pop, -1, { ...base, econ: -2.5 }).approve).toBeLessThan(a - 0.05);
    expect(approvalShare(e, pop, -1, { ...base, honeymoon: 0.45 }).approve).toBeGreaterThan(a + 0.04);
    expect(approvalShare(e, pop, -1, { ...base, standing: -0.4 }).approve).toBeLessThan(a - 0.04);
  });
});
