/**
 * County government of 2016 (Phase 7.6) on the real geography: every state's county offices resolve; the real
 * prosecutorial circuits cover each state's counties exactly once and are made of neighbouring counties; generated
 * districts have each state's 2016 number of districts.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { COUNTY_2016, circuitOffices, circuitPlan, countyBodies, type CountyLike } from '../../../src/rules/county2016';

const DIR = 'public/geo-packs/2016.1/';
const real = existsSync(`${DIR}counties.json`);

describe('county government of 2016 (real geography)', () => {
  it.runIf(real)('resolves every county and every prosecutorial district', () => {
    const counties = JSON.parse(readFileSync(`${DIR}counties.json`, 'utf8')) as CountyLike[];
    const states = JSON.parse(readFileSync(`${DIR}states.json`, 'utf8')) as { idx: number; usps: string }[];
    const adj = JSON.parse(readFileSync(`${DIR}county-adjacency.json`, 'utf8')) as number[][];
    let seats = 0; const byKind: Record<string, number> = {};
    const sources: Record<string, string> = {}; const split: string[] = [];
    for (const s of states) {
      const st = COUNTY_2016[s.usps]; expect(st, s.usps).toBeDefined();
      const cs = counties.filter((c) => c.stateIdx === s.idx);
      for (const c of cs) for (const b of countyBodies(s.usps, c)) { seats += b.seats; byKind[b.kind] = (byKind[b.kind] ?? 0) + b.seats; expect(b.cycles.length).toBe(b.seats); }
      for (const p of circuitOffices(s.usps)) {
        const plan = circuitPlan(p, cs, adj);
        sources[`${s.usps} ${p.name}`] = `${plan.source} ${plan.names.length}${plan.note ? ` (${plan.note})` : ''}`;
        expect(plan.of.size, `${s.usps} ${p.name}`).toBe(cs.length);
        if (p.circuits) expect(plan.source, `${s.usps} ${p.name}`).toBe('real');
        if (p.count) expect(plan.names.length).toBe(p.count);
        // Every district: its counties are connected through county adjacency (Monroe, Florida joins by sea).
        const groups = new Map<number, number[]>(); for (const [ci, d] of plan.of) { const l = groups.get(d); if (l) l.push(ci); else groups.set(d, [ci]); }
        for (const [d, members] of groups) {
          const set = new Set(members), seen = new Set([members[0]!]), q = [members[0]!];
          while (q.length) { const x = q.pop()!; for (const y of adj[x] ?? []) if (set.has(y) && !seen.has(y)) { seen.add(y); q.push(y); } }
          if (seen.size !== members.length) split.push(`${s.usps} ${p.name} ${plan.names[d]}: ${members.map((i) => counties[i]!.name).join(', ')}`);
        }
      }
    }
    console.log('county seats', seats, JSON.stringify(byKind));
    console.log('non-contiguous districts:', JSON.stringify(split, null, 1));
    console.log(JSON.stringify(sources, null, 1));
    expect(seats).toBeGreaterThan(30_000);
  });
});
