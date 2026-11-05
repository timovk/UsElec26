/**
 * District plans and apportionment (Phase 6).
 *
 * - **Districts** of every plan live in one table per kind (congressional, state senate, state house): the
 *   2016 districts keep the geography pack's indices, and districts of later plans are appended. A contest's
 *   `district_idx` therefore always names the district it was held in, so old maps stay intact.
 * - **Plans** assign each BU of a state to a district, effective for elections from a first year. The
 *   assignment for any year is assembled from each state's plan in effect.
 * - **Apportionment:** House seats per state from the latest census in effect (a census counted in year C
 *   applies to House elections from C + 2 and to the Electoral College from the next presidential election).
 */
import { decodeBundle, encodeBundle } from '../core/codec';
import type { DistrictRec, GeoPack } from '../geo/pack';
import { NONE16 } from '../geo/pack';
import type { Db } from '../persistence/db';

export type DistrictKind = 'cd' | 'sldu' | 'sldl';
export const DISTRICT_KINDS: readonly DistrictKind[] = ['cd', 'sldu', 'sldl'];

export interface DistrictInfo extends DistrictRec { planId: number; number: number; seats: number }
interface Plan { id: number; kind: DistrictKind; stateIdx: number; censusYear: number; firstYear: number; assignment: Uint16Array }

/** The plan in effect for regular elections of `year`; specials held before the new Congress use the old plan. */
const inEffect = (p: Plan, year: number, special: boolean) => p.firstYear < year || (p.firstYear === year && !special);

export class Districts {
  private tables: Record<DistrictKind, DistrictInfo[]>;
  private plans: Record<DistrictKind, Plan[][]>;          // per state, sorted by first year
  private apportion: { censusYear: number; seats: number[] }[] = [];
  private cache = new Map<string, Uint16Array>();
  /** Offices eliminated by reapportionment: office → the last election year for the seat. */
  private abolished = new Map<number, number>();

  constructor(private readonly pack: GeoPack) {
    const base = (kind: DistrictKind, recs: DistrictRec[]): DistrictInfo[] => recs.map((d) => ({ ...d, planId: 0, number: kind === 'cd' ? d.district ?? 0 : Number(d.code ?? d.name ?? d.idx) || 0, seats: 1 }));
    this.tables = { cd: base('cd', pack.cds), sldu: base('sldu', pack.sldu), sldl: base('sldl', pack.sldl) };
    this.plans = { cd: pack.states.map(() => []), sldu: pack.states.map(() => []), sldl: pack.states.map(() => []) };
  }

  /** Restore plans, appended districts and apportionments from the universe database. */
  static async load(db: Db, pack: GeoPack): Promise<Districts> {
    const d = new Districts(pack);
    for (const r of db.all<{ kind: DistrictKind; idx: number; plan_id: number; state_idx: number; number: number; seats: number; population: number }>('SELECT * FROM district ORDER BY kind, idx')) d.addDistrict(r.kind, r.idx, r.plan_id, r.state_idx, r.number, r.seats, r.population);
    for (const r of db.all<{ plan_id: number; kind: DistrictKind; state_idx: number; census_year: number; first_year: number; assignment: Uint8Array }>('SELECT plan_id, kind, state_idx, census_year, first_year, assignment FROM district_plan ORDER BY plan_id')) {
      const { arrays } = await decodeBundle(r.assignment);
      d.plans[r.kind][r.state_idx]!.push({ id: r.plan_id, kind: r.kind, stateIdx: r.state_idx, censusYear: r.census_year, firstYear: r.first_year, assignment: arrays.a as Uint16Array });
    }
    for (const r of db.all<{ office_id: number; last_year: number }>('SELECT office_id, last_year FROM office_abolished')) d.abolished.set(r.office_id, r.last_year);
    const years = db.all<{ census_year: number }>('SELECT DISTINCT census_year FROM census WHERE seats IS NOT NULL ORDER BY census_year').map((r) => r.census_year);
    for (const y of years) {
      const seats = pack.states.map(() => 0);
      for (const r of db.all<{ state_idx: number; seats: number }>('SELECT state_idx, seats FROM census WHERE census_year = ? AND seats IS NOT NULL', [y])) seats[r.state_idx] = r.seats;
      d.apportion.push({ censusYear: y, seats });
    }
    return d;
  }

  private addDistrict(kind: DistrictKind, idx: number, planId: number, stateIdx: number, number: number, seats: number, population: number): DistrictInfo {
    const st = this.pack.states[stateIdx]!;
    const rec: DistrictInfo = { idx, geoid: `${st.fips}-${planId}-${number}`, stateIdx, district: number, code: kind === 'cd' ? `${st.usps}-${number === 0 ? 'AL' : String(number).padStart(2, '0')}` : String(number), name: String(number),
      pop2010: population, vap2010: 0, planId, number, seats };
    const t = this.tables[kind];
    while (t.length < idx) t.push(t[t.length - 1]!); // never happens: indices are dense
    t[idx] = rec;
    return rec;
  }

  /** Every district of a kind, all plans (index = district_idx). */
  table(kind: DistrictKind): DistrictInfo[] { return this.tables[kind]; }
  get cds(): DistrictInfo[] { return this.tables.cd; }

  private planOf(kind: DistrictKind, stateIdx: number, year: number, special = false): Plan | null {
    const ps = this.plans[kind][stateIdx]!;
    let p: Plan | null = null; for (const x of ps) if (inEffect(x, year, special)) p = x;
    return p;
  }

  /** BU → district (global index) for elections of `year` (NONE16 where a BU has no district of that kind). */
  assignment(kind: DistrictKind, year: number, special = false): Uint16Array {
    const ids = this.pack.states.map((_, s) => this.planOf(kind, s, year, special)?.id ?? 0);
    const key = `${kind}|${ids.join(',')}`;
    let a = this.cache.get(key);
    if (a) return a;
    const base = kind === 'cd' ? this.pack.bu.cd : kind === 'sldu' ? this.pack.bu.sldu : this.pack.bu.sldl;
    a = Uint16Array.from(base);
    for (const st of this.pack.states) {
      const p = this.planOf(kind, st.idx, year, special); if (!p) continue;
      const cs = this.pack.counties.filter((c) => c.stateIdx === st.idx);
      const b0 = cs[0]!.buStart;
      a.set(p.assignment, b0);
    }
    this.cache.set(key, a);
    return a;
  }

  /** Districts of a state in effect for `year` (global indices, ordered by number). */
  districtsOf(kind: DistrictKind, stateIdx: number, year: number, special = false): DistrictInfo[] {
    const p = this.planOf(kind, stateIdx, year, special);
    const t = this.tables[kind];
    return t.filter((d) => d.stateIdx === stateIdx && d.planId === (p?.id ?? 0)).sort((a, b) => a.number - b.number);
  }

  /** The district a seat (by number) is elected from in `year`. */
  districtNumbered(kind: DistrictKind, stateIdx: number, number: number, year: number, special = false): DistrictInfo | null {
    return this.districtsOf(kind, stateIdx, year, special).find((d) => d.number === number) ?? null;
  }

  /** House seats of a state for elections of `year` (the latest apportionment in effect; 2010's until 2022). */
  seats(stateIdx: number, year: number): number {
    let a: { seats: number[] } | null = null;
    for (const x of this.apportion) if (x.censusYear + 2 <= year) a = x;
    if (a) return a.seats[stateIdx]!;
    return this.pack.cds.filter((c) => c.stateIdx === stateIdx).length;
  }

  /** Each plan once (the 2016 plan from the pack, then every adopted plan): its state, first BU and assignment. */
  eachPlan(kind: DistrictKind, fn: (stateIdx: number, b0: number, assignment: Uint16Array | null) => void): void {
    for (const st of this.pack.states) {
      const cs = this.pack.counties.filter((c) => c.stateIdx === st.idx);
      if (!cs.length) continue;
      const b0 = cs[0]!.buStart;
      fn(st.idx, b0, null);
      for (const p of this.plans[kind][st.idx]!) fn(st.idx, b0, p.assignment);
    }
  }

  /** Whether a seat no longer exists for elections of `year` (its last election was before). */
  isAbolished(officeId: number, year: number): boolean { const y = this.abolished.get(officeId); return y !== undefined && year > y; }
  markAbolished(officeId: number, lastYear: number): void { this.abolished.set(officeId, lastYear); }

  latestCensus(): number | null { return this.apportion.length ? this.apportion[this.apportion.length - 1]!.censusYear : null; }

  // ---- Writing -----------------------------------------------------------------------------------------------

  setApportionment(censusYear: number, seats: number[]): void {
    this.apportion = this.apportion.filter((a) => a.censusYear !== censusYear);
    this.apportion.push({ censusYear, seats }); this.apportion.sort((a, b) => a.censusYear - b.censusYear);
  }

  /**
   * Adopt a plan for a state: new districts are appended to the kind's table. Returns the database writes
   * (to run inside a commit) and the new districts.
   */
  async adopt(kind: DistrictKind, stateIdx: number, censusYear: number, firstYear: number, adoptedTime: number, local: Int32Array, numbers: number[], seats: number[], populations: number[], stats: unknown, nextPlanId: number):
    Promise<{ write: (db: Db) => void; districts: DistrictInfo[] }> {
    const t = this.tables[kind];
    const first = t.length;
    const recs = numbers.map((num, i) => this.addDistrict(kind, first + i, nextPlanId, stateIdx, num, seats[i]!, Math.round(populations[i]!)));
    const assignment = Uint16Array.from(local, (d) => (d < 0 ? NONE16 : first + d));
    const plan: Plan = { id: nextPlanId, kind, stateIdx, censusYear, firstYear, assignment };
    this.plans[kind][stateIdx]!.push(plan); this.plans[kind][stateIdx]!.sort((a, b) => a.firstYear - b.firstYear || a.id - b.id);
    this.cache.clear();
    const blob = await encodeBundle({ a: assignment });
    return {
      districts: recs,
      write: (db) => {
        db.run('INSERT INTO district_plan(plan_id, kind, state_idx, census_year, first_year, adopted_time, method, stats_json, assignment) VALUES (?,?,?,?,?,?,?,?,?)', [nextPlanId, kind, stateIdx, censusYear, firstYear, adoptedTime, 'algorithmic', JSON.stringify(stats), blob]);
        for (const r of recs) db.run('INSERT INTO district VALUES (?,?,?,?,?,?,?)', [kind, r.idx, nextPlanId, stateIdx, r.number, r.seats, r.pop2010]);
      },
    };
  }
}

/** Huntington–Hill apportionment (the method in use since 1941): one seat each, then by priority value P/√(n(n+1)). */
export function huntingtonHill(populations: number[], seats: number, eligible: (i: number) => boolean = () => true): { seats: number[]; priority: { state: number; seat: number; value: number }[] } {
  const out: number[] = populations.map((_, i) => (eligible(i) ? 1 : 0));
  const priority: { state: number; seat: number; value: number }[] = [];
  let given = out.reduce((a, b) => a + b, 0);
  // A simple priority queue (51 entries): linear scan is fast enough and exact.
  const value = (i: number) => populations[i]! / Math.sqrt(out[i]! * (out[i]! + 1));
  while (given < seats) {
    let best = -1, bv = -1;
    for (let i = 0; i < populations.length; i++) { if (!eligible(i)) continue; const v = value(i); if (v > bv || (v === bv && i < best)) { bv = v; best = i; } }
    out[best]!++; given++;
    priority.push({ state: best, seat: out[best]!, value: bv });
  }
  // The next five in line (for the record: who just missed a seat).
  const save = [...out];
  for (let k = 0; k < 5; k++) {
    let best = -1, bv = -1;
    for (let i = 0; i < populations.length; i++) { if (!eligible(i)) continue; const v = value(i); if (v > bv) { bv = v; best = i; } }
    priority.push({ state: best, seat: out[best]! + 1, value: -bv }); out[best]!++;
  }
  return { seats: save, priority };
}
