/** Legislation: members vote mostly with their party in a polarized chamber; bills move policy toward the sponsor's platform; the President signs what improves on the status quo. */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/rng';
import { draftBill, presidentSigns, rollCall, type Member } from '../../../src/government/congress';

const D = [0.6, 0.3, 0.2], R = [-0.6, -0.3, -0.2], q = [0, 0, 0];
function chamber(nD: number, nR: number, seed = 'C'): Member[] {
  const r = Rng.stream(seed, 'members');
  return [...Array.from({ length: nD }, (_, i) => ({ personId: i, party: 1, ideology: D.map((x) => x * 0.8 + r.normal(0, 0.25)), lean: r.normal(15, 15) })),
    ...Array.from({ length: nR }, (_, i) => ({ personId: 1000 + i, party: 2, ideology: R.map((x) => x * 0.8 + r.normal(0, 0.25)), lean: r.normal(-15, 15) }))];
}
describe('Congress', () => {
  it('party-line voting: the majority passes its bills in the House, the minority mostly opposes', () => {
    const house = chamber(230, 205), r = Rng.stream('V');
    let passed = 0, crossD = 0, crossR = 0, n = 0;
    for (let i = 0; i < 40; i++) {
      const bill = draftBill(r, D, q, 1, 2017, false);
      const rc = rollCall(house, bill, q, D.map((x, k) => x - R[k]!), r);
      if (rc.yea > rc.nay) passed++;
      for (const v of rc.votes) { if (v.personId < 1000 && !v.yea) crossD++; if (v.personId >= 1000 && v.yea) crossR++; }
      n++;
    }
    expect(passed / n).toBeGreaterThan(0.8);
    expect(crossR / (205 * n)).toBeLessThan(0.15);
    expect(crossD / (230 * n)).toBeLessThan(0.15);
  });
  it('a 52-seat Senate majority rarely reaches cloture (60) on partisan bills', () => {
    const senate = chamber(52, 48, 'S'), r = Rng.stream('S2');
    let cloture = 0; for (let i = 0; i < 40; i++) { const bill = draftBill(r, D, q, 1, 2017, false); if (rollCall(senate, bill, q, D.map((x, k) => x - R[k]!), r).yea >= 60) cloture++; }
    expect(cloture / 40).toBeLessThan(0.3);
  });
  it('bills move policy toward the sponsor; the President signs what improves on the status quo for him', () => {
    const bill = draftBill(Rng.stream('B'), D, q, 1, 2017, false);
    const towardD = bill.position.reduce((s, x, i) => s + x * D[i]!, 0);
    expect(towardD).toBeGreaterThan(0);
    expect(presidentSigns(D, bill, q, false)).toBe(true);
    expect(presidentSigns(R, bill, q, false)).toBe(false);
    expect(presidentSigns(R, bill, q, true)).toBe(true);
    expect(draftBill(Rng.stream('B'), D, q, 1, 2017, true).title).toMatch(/Reconciliation/);
  });
});
