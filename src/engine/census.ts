/**
 * The decennial census, apportionment and redistricting (Phase 6).
 *
 * - **Census Day** (April 1 of a year ending in 0): each state's resident population is counted from the
 *   universe's population.
 * - **Apportionment** (late December): Huntington–Hill over the 50 states' counts gives the House seats for
 *   elections from two years later (and the Electoral College from the next presidential election).
 * - **Redistricting** (September–November of the following year): each state's congressional plan is drawn
 *   by the baseline algorithm (contiguous, compact, equal population, from whole BUs; no partisan data),
 *   effective for elections from the next year. Seats a state gains get new offices; seats it loses are
 *   eliminated when the outgoing Congress ends.
 */
import { civilToDays, daysToCivil, zonedToUtc, type SimTime } from '../core/time';
import { buGraph, drawPlan, type PlanRegion } from '../geo/redistrict';
import { fullName, type Office, type Person } from '../institutions/model';
import type { Db } from '../persistence/db';
import { demographySummary } from '../population/evolution';
import { huntingtonHill, type DistrictKind } from './districts';
import { NONE16 } from '../geo/pack';
import type { Evolution } from './evolution';
import { aggregateLean, type World } from './world';

interface Host {
  world: World; db: Db; evolution: () => Evolution;
  schedule(time: SimTime, kind: string, data: Record<string, unknown>, priority?: number): void;
  news(kind: string, headline: string, body: string, refs: Record<string, unknown>, time?: SimTime): void;
  commit(extra?: () => void): void;
  progress(step: string, fraction: number): void;
  endTerm(officeId: number, reason: string): void;
  officeAbolished(officeId: number, lastYear: number): void;
}

const ET = 'America/New_York';
/** House districts per senate district where 2016 law nests them. */
/**
 * Number a new plan's districts after the old plan: each old number goes to the new district holding most of
 * that old district's people (greedy by shared population, within districts of the same seat count), so a
 * member's seat follows their constituents. Districts left over take the remaining numbers in geographic order.
 * Returns the number of each new district.
 */
export function continuityNumbers(oldNumber: Int32Array, district: Int32Array, pop: Float64Array, numbers: number[], sizes: number[], geoOrder: number[]): number[] {
  const D = numbers.length, overlap = new Map<string, number>();
  for (let i = 0; i < district.length; i++) { const o = oldNumber[i]!; if (o < 0) continue; const k = `${district[i]}|${o}`; overlap.set(k, (overlap.get(k) ?? 0) + pop[i]! + 1e-9); }
  const sizeOf = new Map(numbers.map((x, j) => [x, sizes[j]!]));
  const pairs = [...overlap].map(([k, v]) => { const [d, o] = k.split('|').map(Number) as [number, number]; return { d, o, v }; })
    .filter((p) => sizeOf.has(p.o) && sizeOf.get(p.o) === sizes[p.d]).sort((a, b) => b.v - a.v || a.d - b.d || a.o - b.o);
  const out = new Array<number>(D).fill(-1), used = new Set<number>();
  for (const p of pairs) if (out[p.d] === -1 && !used.has(p.o)) { out[p.d] = p.o; used.add(p.o); }
  for (const d of geoOrder) if (out[d] === -1) { const k = numbers.findIndex((x, j) => !used.has(x) && sizes[j] === sizes[d]); if (k >= 0) { out[d] = numbers[k]!; used.add(numbers[k]!); } }
  return out;
}

const NESTED: Record<string, number> = { AK: 2, IL: 2, IA: 2, MN: 2, MT: 2, NV: 2, OR: 2, WY: 2, OH: 3, WI: 3 };
const SPELL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export class CensusEngine {
  constructor(private readonly h: Host) {}
  private get w() { return this.h.world; }

  /** January 1: schedule the decade's events. */
  planYear(year: number): void {
    if (year % 10 === 0 && year > 2016) {
      this.h.schedule(zonedToUtc(year, 4, 1, 12, 0, ET), 'census_day', { year }, 3);
      this.h.schedule(zonedToUtc(year, 12, 28, 12, 0, ET), 'apportionment', { year }, 3);
    }
  }

  /** April 1: count every state's residents. */
  censusDay(year: number): void {
    const w = this.w, ev = this.h.evolution();
    const sum = demographySummary(w.pack, ev.demo);
    this.h.commit(() => {
      for (const s of w.pack.states) this.h.db.run('INSERT OR REPLACE INTO census(census_year, state_idx, population, adults, seats, priority_json) VALUES (?,?,?,?,?,?)', [year, s.idx, Math.round(sum.state[s.idx]!.total), Math.round(sum.state[s.idx]!.adults), null, null]);
    });
    this.h.news('census', `Census Day: the ${year} count begins`, `The United States has an estimated ${(sum.total / 1e6).toFixed(1)} million residents. Apportionment results are due by the end of the year.`, {});
  }

  /** Late December: apportion the House among the states. */
  apportionment(year: number): void {
    const w = this.w, db = this.h.db;
    const rows = db.all<{ state_idx: number; population: number }>('SELECT state_idx, population FROM census WHERE census_year = ? ORDER BY state_idx', [year]);
    if (!rows.length) return;
    const pops = w.pack.states.map((s) => rows.find((r) => r.state_idx === s.idx)?.population ?? 0);
    const { seats, priority } = huntingtonHill(pops, 435, (i) => w.pack.states[i]!.usps !== 'DC');
    const before = w.pack.states.map((s) => w.districts.seats(s.idx, year + 1));
    w.districts.setApportionment(year, seats);
    const changes = w.pack.states.map((s, i) => ({ s, d: seats[i]! - before[i]! })).filter((x) => x.d !== 0).sort((a, b) => b.d - a.d || a.s.idx - b.s.idx);
    this.h.commit(() => {
      for (const s of w.pack.states) db.run('UPDATE census SET seats = ?, priority_json = ? WHERE census_year = ? AND state_idx = ?', [seats[s.idx]!, JSON.stringify(priority.filter((p) => p.state === s.idx).map((p) => ({ seat: p.seat, value: Math.round(p.value) }))), year, s.idx]);
    });
    const gain = changes.filter((x) => x.d > 0), loss = changes.filter((x) => x.d < 0);
    const list = (xs: typeof changes) => xs.map((x) => `${x.s.name} (${x.d > 0 ? '+' : ''}${x.d})`).join(', ');
    this.h.news('apportionment', `${year} apportionment: ${gain.length ? `${gain[0]!.s.name} gains ${SPELL[gain[0]!.d] ?? gain[0]!.d} seat${gain[0]!.d === 1 ? '' : 's'}` : 'no state gains seats'}`,
      `${gain.length ? `Gaining: ${list(gain)}. ` : ''}${loss.length ? `Losing: ${list(loss)}. ` : ''}The new apportionment applies to House elections from ${year + 2} and to the Electoral College from ${year + 4}.`, {});
    // Redistricting through the autumn of next year: every state with more than one seat draws a new plan.
    w.pack.states.forEach((s, i) => {
      if (s.usps === 'DC') return;
      const day = civilToDays(year + 1, 9, 1) + Math.floor((i * 90) / w.pack.states.length);
      const c = daysToCivil(day);
      this.h.schedule(zonedToUtc(c.y, c.m, c.d, 12, 0, ET), 'redistrict', { census: year, state: s.idx }, 4);
    });
    this.h.schedule(zonedToUtc(year + 3, 1, 3, 11, 0, ET), 'new_congress_districts', { census: year, firstYear: year + 2 }, 2);
  }

  /** Estimated census population of each BU of a state (county totals exact; BUs follow their own growth). */
  private buPopulation(stateIdx: number): { b0: number; pop: Float64Array } {
    const w = this.w, ev = this.h.evolution(), pack = w.pack;
    const cs = pack.counties.filter((c) => c.stateIdx === stateIdx);
    const b0 = cs[0]!.buStart, b1 = cs[cs.length - 1]!.buStart + cs[cs.length - 1]!.buCount;
    const pop = new Float64Array(b1 - b0);
    for (const c of cs) {
      let s = 0;
      for (let b = c.buStart; b < c.buStart + c.buCount; b++) { const base = ev.basePop.vep[b]!; const g = base > 0 ? w.pop.vep[b]! / base : 1; pop[b - b0] = pack.bu.pop2010[b]! * g; s += pop[b - b0]!; }
      const total = ev.demo.total[c.idx]!;
      if (s > 0) for (let b = c.buStart; b < c.buStart + c.buCount; b++) pop[b - b0] = (pop[b - b0]! * total) / s;
    }
    return { b0, pop };
  }

  /** Draw and adopt a state's congressional plan for elections from `census + 2`. */
  async redistrict(census: number, stateIdx: number): Promise<void> {
    const w = this.w, pack = w.pack, st = pack.states[stateIdx]!;
    const firstYear = census + 2;
    const seats = w.districts.seats(stateIdx, firstYear);
    const { b0, pop } = this.buPopulation(stateIdx);
    const n = pop.length, b1 = b0 + n;
    const r: PlanRegion = { x: pack.bu.x.slice(b0, b1), y: pack.bu.y.slice(b0, b1), pop, county: pack.bu.county.slice(b0, b1), countyAdj: pack.countyAdjacency, area: pack.bu.landM2.slice(b0, b1), unitsPerMeter: unitsPerMeter(pack, b0, b1) };
    this.h.progress(`Redistricting ${st.name}`, 0);
    const kind: DistrictKind = 'cd';
    const res = seats > 1 ? drawPlan(r, { sizes: new Array<number>(seats).fill(1), tolerance: 0.005 }, buGraph(r)) : { district: new Int32Array(n), stats: { populations: [pop.reduce((a, b) => a + b, 0)], ideal: [pop.reduce((a, b) => a + b, 0)], maxDeviation: 0, contiguous: true, countiesSplit: 0, compactness: [1], moves: 0 } };
    const numbers = seats === 1 ? [0] : Array.from({ length: seats }, (_, i) => i + 1);
    // Number districts north to south, then west to east (the usual convention, roughly): by centroid.
    const cen = numbers.map((_, d) => { let x = 0, y = 0, p = 0; for (let i = 0; i < n; i++) if (res.district[i] === d) { x += r.x[i]! * (pop[i]! + 1); y += r.y[i]! * (pop[i]! + 1); p += pop[i]! + 1; } return { d, x: x / p, y: y / p }; });
    const order = [...cen].sort((a, b) => Math.round(a.y / 25) - Math.round(b.y / 25) || a.x - b.x).map((c) => c.d);
    // Seat numbers follow constituents: the old plan's numbers go to the new districts that continue them.
    const prev = w.districts.assignment('cd', census + 1), table = w.districts.cds;
    const oldNumber = Int32Array.from({ length: n }, (_, i) => { const k = prev[b0 + i]!; return k === NONE16 || !table[k] ? -1 : table[k]!.number; });
    const seatNumber = seats === 1 ? [numbers[0]!] : continuityNumbers(oldNumber, res.district, pop, numbers, new Array<number>(seats).fill(1), order);
    const renum = new Int32Array(seats); seatNumber.forEach((num, d) => { renum[d] = numbers.indexOf(num); });
    const local = Int32Array.from(res.district, (d) => renum[d]!);
    const pops = new Array<number>(seats).fill(0); for (let i = 0; i < n; i++) pops[local[i]!]! += pop[i]!;
    const planId = (this.h.db.value<number>('SELECT MAX(plan_id) FROM district_plan') ?? 0) + 1;
    const stats = { maxDeviation: res.stats.maxDeviation, contiguous: res.stats.contiguous, countiesSplit: res.stats.countiesSplit, compactness: res.stats.compactness.map((c) => Math.round(1000 * c) / 1000), populations: pops.map(Math.round), seats };
    const adopted = await w.districts.adopt(kind, stateIdx, census, firstYear, w.time, local, numbers, new Array<number>(seats).fill(1), pops, stats, planId);
    // Offices: a seat for every district number; seats beyond the new count are eliminated with the outgoing Congress.
    const houseChamber = w.chambers.find((c) => c.kind === 'us_house')!;
    const existing = w.offices.filter((o) => o.kind === 'us_representative' && o.stateIdx === stateIdx);
    const numberOf = (o: Office) => w.districts.cds[o.districtIdx!]!.number;
    const newOffices: Office[] = [];
    for (const d of adopted.districts) {
      if (existing.some((o) => numberOf(o) === d.number || (d.number === 1 && numberOf(o) === 0) || (d.number === 0 && numberOf(o) === 1))) continue;
      const o: Office = { id: Math.max(...w.offices.map((x) => x.id)) + 1 + newOffices.length, kind: 'us_representative', title: `U.S. Representative, ${st.usps}-${d.number === 0 ? 'AL' : String(d.number).padStart(2, '0')}`, stateIdx, districtIdx: d.idx, senateClass: null, chamberId: houseChamber.id, dept: null, rank: 1000 + d.idx };
      newOffices.push(o);
    }
    // At-large ↔ numbered: a state going from one seat to several (or back) keeps its first office as seat 1 (or at-large).
    const gone = existing.filter((o) => { const num = numberOf(o); return seats === 1 ? num > 1 : num > seats; });
    this.h.commit(() => {
      adopted.write(this.h.db);
      for (const o of newOffices) { this.h.db.run('INSERT INTO office VALUES (?,?,?,?,?,?,?,?,?)', [o.id, o.kind, o.title, o.stateIdx, o.districtIdx, o.senateClass, o.chamberId, o.dept, o.rank]); w.offices.push(o); w.officeById.set(o.id, o); }
      for (const o of gone) this.h.officeAbolished(o.id, census);
    });
    // Seats renumbered between at-large and numbered: point the office at its new district number now.
    for (const o of existing) {
      const num = numberOf(o);
      const to = seats === 1 && num === 1 ? adopted.districts[0]!.idx : seats > 1 && num === 0 ? adopted.districts.find((d) => d.number === 1)!.idx : null;
      if (to !== null) { o.districtIdx = to; this.h.db.run('UPDATE office SET district_idx = ? WHERE office_id = ?', [to, o.id]); }
    }
    // The neutral lean now covers the new districts too (candidate emergence and forecasts use it).
    w.lean = { bu: w.lean.bu, ...aggregateLean(w.lean.bu, pack, w.districts) };
    // State legislative plans: the same districts' worth of seats, redrawn; lower houses nest inside senate
    // districts where 2016 law required it (two or three house districts per senate district).
    const legStats = await this.redistrictLegislature(census, stateIdx, r, pop, b0);
    const dev = (100 * res.stats.maxDeviation).toFixed(2);
    this.h.news('redistricting', `${st.name} adopts new congressional and legislative maps`, `${seats} congressional district${seats === 1 ? '' : 's'} for ${firstYear}: largest population deviation ${dev}%, ${res.stats.countiesSplit} counties split${res.stats.contiguous ? '' : ' (some districts are joined across water)'}.${legStats}${gone.length ? ` ${gone.map((o) => { const t = w.current.get(o.id); const p = t ? w.persons.get(t.personId) : null; return `${o.title}${p ? ` (${fullName(p as Person)})` : ''}`; }).join(', ')} will be eliminated.` : ''}`, { state: stateIdx });
  }

  private async redistrictLegislature(census: number, stateIdx: number, r: PlanRegion, pop: Float64Array, b0: number): Promise<string> {
    const w = this.w, st = w.pack.states[stateIdx]!, firstYear = census + 2;
    const n = pop.length;
    let upperLocal: Int32Array | null = null, upperCount = 0, text = '';
    const graph = buGraph(r);
    for (const [chKind, kind, sld] of [['state_upper', 'state_senator', 'sldu'], ['state_lower', 'state_representative', 'sldl']] as const) {
      const ch = w.chambers.find((c) => c.kind === chKind && c.stateIdx === stateIdx); if (!ch) continue;
      // The current districts (in effect this year) and their seats, by number.
      const offices = w.offices.filter((o) => o.kind === kind && o.stateIdx === stateIdx);
      if (!offices.length) continue;
      const table = w.districts.table(sld);
      const byNumber = new Map<number, number>();
      for (const o of offices) { const num = table[o.districtIdx!]!.number; byNumber.set(num, (byNumber.get(num) ?? 0) + 1); }
      const numbers = [...byNumber.keys()].sort((a, b) => a - b), sizes = numbers.map((x) => byNumber.get(x)!);
      if (numbers.length < 2) continue;
      const nest = NESTED[st.usps];
      const nestOk = kind === 'state_representative' && nest && upperLocal && numbers.length === nest * upperCount;
      const res = drawPlan(r, { sizes, tolerance: 0.04, ...(nestOk ? { nest: { within: upperLocal!, parentOf: numbers.map((_, i) => Math.floor(i / nest!)) } } : {}) }, graph);
      // Number north to south, west to east (within each senate district when nested).
      const cen = numbers.map((_, d) => { let x = 0, y = 0, p = 0; for (let i = 0; i < n; i++) if (res.district[i] === d) { x += r.x[i]! * (pop[i]! + 1); y += r.y[i]! * (pop[i]! + 1); p += pop[i]! + 1; } return { d, x: x / p, y: y / p }; });
      // Numbers keep their seat counts and follow constituents (the old district each new one continues);
      // the rest go in geographic order within each size.
      const geo = nestOk ? cen.map((c) => c.d) : [...cen].sort((a, b) => Math.round(a.y / 25) - Math.round(b.y / 25) || a.x - b.x).map((c) => c.d);
      const prev = w.districts.assignment(sld, census + 1);
      const oldNumber = Int32Array.from({ length: n }, (_, i) => { const k = prev[b0 + i]!; return k === NONE16 || !table[k] ? -1 : table[k]!.number; });
      const numberOf = continuityNumbers(oldNumber, res.district, pop, numbers, sizes, geo);
      // Local index j ↔ numbers[j] (and its seats sizes[j]), as the offices expect.
      const toLocal = new Int32Array(numbers.length); for (let d = 0; d < numbers.length; d++) toLocal[d] = numbers.indexOf(numberOf[d]!);
      const local = Int32Array.from(res.district, (d) => toLocal[d]!);
      const pops = new Array<number>(numbers.length).fill(0); for (let i = 0; i < n; i++) pops[local[i]!]! += pop[i]!;
      const planId = (this.h.db.value<number>('SELECT MAX(plan_id) FROM district_plan') ?? 0) + 1;
      const adopted = await w.districts.adopt(sld, stateIdx, census, firstYear, w.time, local, numbers, sizes, pops,
        { maxDeviation: res.stats.maxDeviation, contiguous: res.stats.contiguous, countiesSplit: res.stats.countiesSplit, nested: !!nestOk }, planId);
      this.h.commit(() => adopted.write(this.h.db));
      if (kind === 'state_senator') { upperLocal = local; upperCount = numbers.length; }
      text += ` ${ch.name}: ${numbers.length} districts, largest deviation ${(100 * res.stats.maxDeviation).toFixed(1)}%${nestOk ? ', nested' : ''}.`;
    }
    return text;
  }

  /** January 3 after the first elections on new maps: House offices now represent their new districts; eliminated seats end. */
  newCongressDistricts(census: number, firstYear: number): void {
    const w = this.w;
    for (const o of w.offices) {
      if (o.kind !== 'us_representative') continue;
      if (w.districts.isAbolished(o.id, firstYear)) { if (w.current.has(o.id)) this.h.endTerm(o.id, `seat eliminated by the ${census} apportionment`); continue; }
      const d = w.districts.districtNumbered('cd', o.stateIdx!, w.districts.cds[o.districtIdx!]!.number, firstYear);
      if (d && d.idx !== o.districtIdx) { o.districtIdx = d.idx; this.h.db.run('UPDATE office SET district_idx = ? WHERE office_id = ?', [d.idx, o.id]); }
    }
    this.h.commit();
  }
}

/** Projected units per metre for a state's BUs (from two far-apart BUs). */
export function unitsPerMeter(pack: World['pack'], b0: number, b1: number): number {
  let ib = b0, best = 0;
  for (let i = b0; i < b1; i += Math.max(1, Math.floor((b1 - b0) / 400))) { const d = (pack.bu.x[i]! - pack.bu.x[b0]!) ** 2 + (pack.bu.y[i]! - pack.bu.y[b0]!) ** 2; if (d > best) { best = d; ib = i; } }
  const toR = Math.PI / 180, la1 = pack.bu.lat[b0]! * toR, la2 = pack.bu.lat[ib]! * toR, dl = (pack.bu.lon[ib]! - pack.bu.lon[b0]!) * toR;
  const m = 6371000 * 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dl / 2) ** 2));
  return m > 0 ? Math.sqrt(best) / m : 1e-5;
}
