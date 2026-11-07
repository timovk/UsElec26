/**
 * Engine-side preparation of a state's election night: poll-closing times of every Base Unit (state law in
 * local time, through each county's time zone), local business hours of each reporting jurisdiction,
 * precinct targets from 2010 voting-district counts, the races to track and the desks' information errors.
 */
import { Rng } from '../core/rng';
import { daysToCivil, offsetAt, resolveZone, zonedToUtc, type DayNumber, type SimTime, type ZoneId } from '../core/time';
import type { GeoPack } from '../geo/pack';
import { COUNTING_RULES_2016, MAIL_REJECT, PROVISIONAL_REJECT, SPLIT_COUNTY_ZONES } from '../rules/counting2016';
import { FLAGSHIP_DESK, type NightInput, type NightRace } from '../counting/types';
import type { StateRange } from '../electorate/shards';

const PEOPLE_PER_PRECINCT = 1800; // national 2010 ratio, used where a state has no voting-district codes (KY, RI)

/** Time zone of every Base Unit (county zone; split counties by an approximate coordinate rule). */
export function unitZones(pack: GeoPack, rg: StateRange): ZoneId[] {
  const out: ZoneId[] = [];
  for (let b = rg.buStart; b < rg.buEnd; b++) {
    const c = pack.counties[pack.bu.county[b]!]!;
    let z = resolveZone(c.tz);
    const split = c.tzSplit ? SPLIT_COUNTY_ZONES[c.geoid] : undefined;
    if (split) {
      const v = split.coord === 'lon' ? pack.bu.lon[b]! : pack.bu.lat[b]!;
      if (split.below ? v < split.at : v >= split.at) z = split.zone;
    }
    out.push(z);
  }
  return out;
}

export function pollCloseTimes(pack: GeoPack, rg: StateRange, day: DayNumber): { close: Int32Array; rjOffset: Int16Array } {
  const usps = pack.states[pack.counties[pack.bu.county[rg.buStart]!]!.stateIdx]!.usps;
  const rules = COUNTING_RULES_2016[usps]!;
  const c = daysToCivil(day);
  const zones = unitZones(pack, rg);
  const close = new Int32Array(zones.length);
  const cache = new Map<ZoneId, number>();
  zones.forEach((z, i) => {
    let t = cache.get(z);
    if (t === undefined) { const [h, m] = rules.closeByZone?.[z] ?? rules.close; t = zonedToUtc(c.y, c.m, c.d, h, m, z); cache.set(z, t); }
    close[i] = t;
  });
  const rjOffset = new Int16Array(rg.rjCount);
  for (let i = 0; i < zones.length; i++) {
    const r = pack.bu.rj[rg.buStart + i]! - rg.rjFirst;
    if (rjOffset[r] === 0) rjOffset[r] = offsetAt(close[i]!, zones[i]!).offset;
  }
  return { close, rjOffset };
}

/** Target precinct count per reporting jurisdiction of a state (2010 voting districts, shared by population). */
export function precinctTargets(pack: GeoPack, rg: StateRange): Float32Array {
  const out = new Float32Array(rg.rjCount);
  const st = pack.states[pack.counties[pack.bu.county[rg.buStart]!]!.stateIdx]!;
  const counties = pack.counties.filter((c) => c.stateIdx === st.idx);
  const stateVtd = counties.reduce((a, c) => a + c.vtdCount2010, 0);
  for (let r = 0; r < rg.rjCount; r++) {
    const rj = pack.rj[rg.rjFirst + r]!;
    if (stateVtd === 0) { out[r] = Math.max(1, rj.pop2010 / PEOPLE_PER_PRECINCT); continue; }
    if (rj.countyIdx === null) { out[r] = Math.max(1, stateVtd * rj.pop2010 / Math.max(1, st.pop2010)); continue; }
    const c = pack.counties[rj.countyIdx]!;
    const vtd = c.vtdCount2010 || Math.max(1, c.pop2010 / PEOPLE_PER_PRECINCT);
    out[r] = Math.max(1, vtd * rj.pop2010 / Math.max(1, c.pop2010));
  }
  return out;
}

export interface NightRaceSource { contestIndex: number; office: string; method: string; parties: number[]; districtEv: boolean; /** Ballot measures (Phase 7.3): the call rule over (yes, no, blank), when not a simple majority. */ pass?: number[] }

/** The races of a state's night: each contest, plus Maine/Nebraska presidential congressional districts. */
export function nightRaces(pack: GeoPack, stateIdx: number, contests: NightRaceSource[], stateCds?: number[]): NightRace[] {
  const usps = pack.states[stateIdx]!.usps, rules = COUNTING_RULES_2016[usps]!;
  const out: NightRace[] = [];
  for (const c of contests) {
    const n = c.parties.length;
    const axis = new Array<number>(n).fill(0);
    const d = c.parties.indexOf(1), r = c.parties.indexOf(2);
    if (d >= 0 && r >= 0) { axis[d] = 1; axis[r] = -1; } else if (n >= 2) { axis[0] = 1; axis[1] = -1; }
    const race: NightRace = {
      contest: c.contestIndex, cd: -1, office: c.office, axis, recount: rules.recountAuto,
      surveyed: ['president', 'us_senator', 'governor'].includes(c.office), majority: c.method === 'majority' || c.method === 'jungle' || c.method === 'rcv',
      ...(c.pass ? { pass: c.pass } : {}),
    };
    out.push(race);
    if (c.districtEv) for (const cd of stateCds ?? pack.cds.filter((x) => x.stateIdx === stateIdx).map((x) => x.idx)) out.push({ ...race, cd, surveyed: false });
  }
  return out;
}

/** National component of the desks' pre-election information error for one night (shared by all states). */
export function nationalPriorError(seed: string, key: string): number { return Rng.stream(seed, 'night-prior', key).normal(0, 0.025); }

export function buildNightInput(opts: {
  seed: string; key: string; pack: GeoPack; rg: StateRange; stateIdx: number; day: DayNumber; year: number; coverageStart: SimTime;
  races: NightRace[]; national: number; expectedBallots: number;
}): NightInput {
  const { pack, rg, stateIdx } = opts;
  const usps = pack.states[stateIdx]!.usps;
  const r = Rng.stream(opts.seed, 'night-prior', opts.key, stateIdx);
  const { close, rjOffset } = pollCloseTimes(pack, rg, opts.day);
  const state = opts.national + r.normal(0, 0.03);
  return {
    key: `${opts.key}|${stateIdx}`, seed: opts.seed, year: opts.year, close, rjOffset, rjPrecincts: precinctTargets(pack, rg),
    rules: COUNTING_RULES_2016[usps]!, mailReject: MAIL_REJECT, provReject: PROVISIONAL_REJECT,
    races: opts.races, desk: FLAGSHIP_DESK,
    priorError: { state, mode: [0, r.normal(0, 0.02), r.normal(0, 0.025), r.normal(0, 0.03)], race: opts.races.map((x) => r.normal(0, x.surveyed ? 0.015 : 0.04)) },
    surveyBias: 0.5 * opts.national + r.normal(0, 0.02),
    surveyN: Math.max(2000, Math.min(15000, Math.round(2000 + opts.expectedBallots / 1000))),
    coverageStart: opts.coverageStart,
  };
}
