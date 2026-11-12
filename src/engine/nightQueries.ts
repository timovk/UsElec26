/** Election-night queries: the list of nights, their metadata, and the sealed record for playback. */
import { fullName, optionPerson } from '../institutions/model';
import { isoDay } from '../core/time';
import { Playback } from '../broadcast/playback';
import { raceShort } from './nightStory';
import type { BaselineCountiesDto, BaselineDto, NightCallDto, NightContextDto, NightListItem, NightMetaDto, NightQuery, SurveyDto } from './protocol';
import { ST_CALLED, ST_RUNOFF, ST_WITHDRAWN } from '../counting/types';
import { readRollup } from '../archive/results';
import { baselineContest, eligibleOf, rjTotals } from './baselines';
import type { Universe } from './universe';
import { isUnit, unitNames, unitStates } from '../geo/reportingUnits';

export async function runNightQuery(u: Universe, q: NightQuery): Promise<unknown> {
  switch (q.kind) {
    case 'nights': return nights(u);
    case 'nightMeta': return nightMeta(u, q.id);
    case 'nightContext': return nightContext(u, q.id);
    case 'nightBaseline': return nightBaseline(u, q.id, q.race);
    case 'nightSurvey': return nightSurvey(u, q.id, q.race);
    case 'nightCalls': return nightCalls(u, q.id);
    case 'nightPayload': {
      const row = u.db.get<{ payload: Uint8Array }>('SELECT payload FROM night WHERE night_id = ?', [q.id]);
      return row ? { bytes: row.payload.slice() } : null;
    }
  }
}

function nights(u: Universe): NightListItem[] {
  return u.db.all<{ night_id: number; label: string; kind: string; day: number; lock_time: number; coverage_start: number; night_end: number; feed_end: number }>('SELECT * FROM night ORDER BY day DESC, night_id DESC')
    .map((n) => ({ id: n.night_id, label: n.label, kind: n.kind, day: n.day, date: isoDay(n.day), lockTime: n.lock_time, coverageStart: n.coverage_start, nightEnd: n.night_end, feedEnd: n.feed_end }));
}

async function nightMeta(u: Universe, id: number): Promise<NightMetaDto | null> {
  const row = u.db.get<{ label: string }>('SELECT label FROM night WHERE night_id = ?', [id]);
  const rec = await u.elections.nightRecord(id);
  if (!row || !rec) return null;
  const pack = u.world.pack;
  const cand = (cid: number, party: number) => {
    const k = u.db.get<{ person_id: number; incumbent: number }>('SELECT person_id, incumbent FROM candidacy WHERE candidacy_id = ?', [cid]);
    const p = k ? u.world.persons.get(k.person_id) ?? optionPerson(k.person_id) : undefined;
    return { candidacyId: cid, personId: k?.person_id ?? -1, name: p ? fullName(p) : `#${cid}`, party, incumbent: !!k?.incumbent };
  };
  return {
    id, label: row.label, lockTime: rec.lockTime, coverageStart: rec.coverageStart, nightEnd: rec.nightEnd, feedEnd: rec.feedEnd, network: 'MNN',
    races: rec.races.map((r, i) => {
      const st = pack.states[r.stateIdx]!;
      const short = raceShort(u.db, u.world, r);
      return { i, contestId: r.contestId, label: r.label.replace(/^\d{4} /, ''), short, office: r.office, state: st.usps, stateIdx: r.stateIdx, cd: r.cd, ev: r.ev, k: r.k,
        candidates: r.candidacyIds.map((c, j) => cand(c, r.parties[j]!)), precincts: r.precincts, close: r.close, ...(r.rcv ? { rcv: true } : {}),
        district: r.office === 'us_representative' ? u.db.value<number>('SELECT district_idx FROM contest WHERE contest_id = ?', [r.contestId]) ?? null : null };
    }),
    states: rec.states.map((s) => ({ idx: s.stateIdx, usps: pack.states[s.stateIdx]!.usps, name: pack.states[s.stateIdx]!.name, closeFirst: s.closeFirst, closeLast: s.closeLast, certify: s.certify })),
    chambers: rec.chambers,
    rjs: Object.fromEntries([...new Set(rec.parts.rj)].map((rj) => [rj, unitNames(pack)[rj] ?? `#${rj}`])),
    rjCounty: Object.fromEntries([...new Set(rec.parts.rj)].flatMap((rj) => { const c = pack.rj[rj]?.countyIdx; return c === null || c === undefined ? [] : [[rj, c]]; })),
    story: rec.story ?? { version: 1, alerts: [], lines: [], speakers: [] },
  };
}

/** Engine-side playback for results views while a count is in progress (one cached night). */
let pbCache: { u: Universe; id: number; pb: Playback } | null = null;
export async function playbackFor(u: Universe, nightId: number): Promise<Playback | null> {
  if (pbCache?.u === u && pbCache.id === nightId) return pbCache.pb;
  const rec = await u.elections.nightRecord(nightId);
  if (!rec) return null;
  pbCache = { u, id: nightId, pb: new Playback(rec) };
  return pbCache.pb;
}

export interface LiveContest {
  votes: Map<number, number>;           // candidacy → counted votes
  undervotes: number; ballots: number; expected: number; precincts: number; totalPrecincts: number;
  status: number; called: number | null; calledAt: number | null; prob: number;
  byCounty: Map<number, number[]>;      // county → counted votes in ballot order (+ undervotes)
  byMode: number[][];                   // mode → counted votes in ballot order
  nightId: number;
}

let snapCache: { pb: Playback; key: string; snap: ReturnType<Playback['at']> } | null = null;

/** What the count shows for a contest at the current universe time (null when the contest is not being counted). */
export async function liveContest(u: Universe, contestId: number, detail = true): Promise<LiveContest | null> {
  const nightId = u.db.value<number>('SELECT n.night_id FROM night_election n JOIN contest c ON c.election_id = n.election_id WHERE c.contest_id = ?', [contestId]);
  if (nightId === undefined) return null;
  const pb = await playbackFor(u, nightId); if (!pb) return null;
  const ri = pb.rec.races.findIndex((r) => r.contestId === contestId && r.cd < 0);
  if (ri < 0) return null;
  const t = u.world.time, key = `${nightId}:${t}`;
  if (snapCache?.pb !== pb || snapCache.key !== key) snapCache = { pb, key, snap: pb.at(t) };
  const st = snapCache.snap.races[ri]!, race = pb.rec.races[ri]!;
  const votes = new Map(race.candidacyIds.map((cid, j) => [cid, st.votes[j]!]));
  const byCounty = new Map<number, number[]>();
  if (detail) for (const [rj, v] of pb.raceByRj(ri, t)) {
    const county = u.world.pack.rj[rj]?.countyIdx; if (county === null || county === undefined) continue;
    const a = byCounty.get(county) ?? new Array<number>(race.k).fill(0); for (let j = 0; j < race.k; j++) a[j]! += v[j]!; byCounty.set(county, a);
  }
  const byMode = [0, 1, 2, 3].map(() => new Array<number>(race.k).fill(0));
  const end = detail ? pb.batchesUpTo(t) : 0, rr = pb.rec.raceRows;
  for (let b = 0; b < end; b++) for (let i = pb.rec.batches.rowStart[b]!; i < pb.rec.batches.rowStart[b + 1]!; i++) {
    if (rr.race[i] !== ri) continue; const m = pb.rec.batches.mode[b]!;
    for (let j = 0; j < race.k; j++) byMode[m]![j]! += rr.votes[rr.off[i]! + j]!;
  }
  return {
    votes, undervotes: st.votes[race.k - 1]!, ballots: st.ballots, expected: st.expected, precincts: st.precincts, totalPrecincts: race.precincts,
    status: st.status, called: st.status === 3 && st.option >= 0 ? race.candidacyIds[st.option]! : null, calledAt: st.calledAt >= 0 ? st.calledAt : null, prob: st.prob,
    byCounty, byMode, nightId,
  };
}

/** Projected electoral votes and seats at the current universe time for a counted general (null if none). */
export async function liveTallies(u: Universe, year: number): Promise<{ president: Record<number, number>; nightId: number } | null> {
  const nightId = u.db.value<number>("SELECT n.night_id FROM night n JOIN night_election ne ON ne.night_id = n.night_id JOIN election e ON e.election_id = ne.election_id WHERE e.year = ? AND n.kind = 'general' ORDER BY n.night_id DESC LIMIT 1", [year]);
  if (nightId === undefined) return null;
  const pb = await playbackFor(u, nightId); if (!pb) return null;
  const t = u.world.time, key = `${nightId}:${t}`;
  if (snapCache?.pb !== pb || snapCache.key !== key) snapCache = { pb, key, snap: pb.at(t) };
  return { president: snapCache.snap.president.called, nightId };
}

/** Counted votes of a contest by county and by congressional district at the current universe time. */
export async function liveGeo(u: Universe, contestId: number): Promise<{ counties: Map<number, number[]>; cds: Map<number, number[]>; rjs: Map<number, number[]> } | null> {
  const nightId = u.db.value<number>('SELECT n.night_id FROM night_election n JOIN contest c ON c.election_id = n.election_id WHERE c.contest_id = ?', [contestId]);
  if (nightId === undefined) return null;
  const pb = await playbackFor(u, nightId); if (!pb) return null;
  const ri = pb.rec.races.findIndex((r) => r.contestId === contestId && r.cd < 0);
  if (ri < 0) return null;
  const k = pb.rec.races[ri]!.k, counties = new Map<number, number[]>(), cds = new Map<number, number[]>(), rjs = new Map<number, number[]>();
  const add = (m: Map<number, number[]>, key: number, v: Float64Array) => { const a = m.get(key) ?? new Array<number>(k).fill(0); for (let j = 0; j < k; j++) a[j]! += v[j]!; m.set(key, a); };
  for (const [part, v] of pb.raceByPart(ri, u.world.time)) {
    const rj = pb.rec.parts.rj[part]!, county = u.world.pack.rj[rj]?.countyIdx;
    if (county !== null && county !== undefined) add(counties, county, v);
    add(cds, pb.rec.parts.cd[part]!, v);
    add(rjs, rj, v);
  }
  return { counties, cds, rjs };
}

// ---- Map context: eligible voters and previous comparable results ---------------------------------------

function partyIdx(u: Universe, contestId: number): { d: number; r: number; k: number } {
  const order = u.db.all<{ party_id: number }>('SELECT party_id FROM candidacy WHERE contest_id = ? ORDER BY ballot_order, candidacy_id', [contestId]).map((x) => x.party_id);
  return { d: order.indexOf(1), r: order.indexOf(2), k: order.length };
}

const ctxCaches = new WeakMap<Universe, Map<number, NightContextDto>>();
async function nightContext(u: Universe, id: number): Promise<NightContextDto | null> {
  let ctxCache = ctxCaches.get(u); if (!ctxCache) { ctxCache = new Map(); ctxCaches.set(u, ctxCache); }
  const hit = ctxCache.get(id); if (hit) return hit;
  const rec = await u.elections.nightRecord(id); if (!rec) return null;
  const eligibleCounty: Record<number, number> = {}, eligibleState: Record<number, number> = {};
  for (const s of rec.states) eligibleState[s.stateIdx] = await eligibleOf(u, s.electionId, s.stateIdx, { county: eligibleCounty });
  const baselines: Record<number, BaselineDto> = {};
  const memo = new Map<number, BaselineDto | null>();
  for (let i = 0; i < rec.races.length; i++) {
    const r = rec.races[i]!; if (r.cd >= 0) continue;
    const b = baselineContest(u, r.contestId); if (!b) continue;
    let dto = memo.get(b.contest_id);
    if (dto === undefined) {
      const rev = u.db.value<number>('SELECT MAX(rev) FROM result_revision WHERE contest_id = ?', [b.contest_id]) ?? 0;
      const tot = u.db.all<{ party_id: number; votes: number }>('SELECT k.party_id, t.votes FROM contest_total t JOIN candidacy k ON k.candidacy_id = t.candidacy_id WHERE t.contest_id = ? AND t.rev = ?', [b.contest_id, rev]);
      const to = u.db.get<{ ballots: number; votes: number; eligible: number }>('SELECT ballots, votes, eligible FROM contest_turnout WHERE contest_id = ? AND rev = ?', [b.contest_id, rev]);
      const valid = tot.reduce((a, x) => a + x.votes, 0);
      dto = valid > 0 ? { contestId: b.contest_id, label: b.label, year: b.year, d: tot.filter((x) => x.party_id === 1).reduce((a, x) => a + x.votes, 0), r: tot.filter((x) => x.party_id === 2).reduce((a, x) => a + x.votes, 0), valid, ballots: to?.ballots ?? valid, eligible: to?.eligible ?? 0 } : null;
      memo.set(b.contest_id, dto);
    }
    if (dto) baselines[i] = dto;
  }
  const out = { eligibleCounty, eligibleState, baselines };
  if (ctxCache.size > 3) ctxCache.clear();
  ctxCache.set(id, out);
  return out;
}

/** A race's previous comparable result by county (statewide races; null when there is none). */
async function nightBaseline(u: Universe, id: number, race: number): Promise<BaselineCountiesDto> {
  const rec = await u.elections.nightRecord(id); const r = rec?.races[race]; if (!r || r.cd >= 0) return null;
  const b = baselineContest(u, r.contestId); if (!b) return null;
  const roll = await readRollup(u.db, b.election_id, b.state_idx); const entry = roll?.contests.find((x) => x.id === b.contest_id); if (!entry) return null;
  const { d, r: ri, k } = partyIdx(u, b.contest_id);
  const el: { county: Record<number, number>; ballots: Record<number, number> } = { county: {}, ballots: {} };
  await eligibleOf(u, b.election_id, b.state_idx, el);
  const out: Record<number, [number, number, number, number, number]> = {};
  for (const [c, v] of entry.counties) {
    const valid = v.slice(0, k).reduce((a, x) => a + x, 0);
    out[c] = [d >= 0 ? v[d]! : 0, ri >= 0 ? v[ri]! : 0, valid, el.ballots[c] ?? valid, el.county[c] ?? 0];
  }
  // Towns and Alaska's districts (Phase 7.5), at their map areas after the counties.
  const pack = u.world.pack, off = pack.counties.length;
  if (unitStates(pack).has(b.state_idx)) for (const [rj, v] of await rjTotals(u, b.contest_id, k + 1)) {
    const rec2 = pack.rj[rj]; if (!rec2 || !isUnit(rec2)) continue;
    const a = off + rj, valid = v.slice(0, k).reduce((x, y) => x + y, 0);
    out[a] = [d >= 0 ? v[d]! : 0, ri >= 0 ? v[ri]! : 0, valid, el.ballots[a] ?? valid, el.county[a] ?? 0];
  }
  return out;
}

/** The voter survey of one race, if it was surveyed. */
async function nightSurvey(u: Universe, id: number, race: number): Promise<SurveyDto | null> {
  const rec = await u.elections.nightRecord(id); if (!rec) return null;
  const s = rec.survey.find((x) => x.race === race); if (!s) return null;
  return { n: s.n, shares: s.shares, crosstabs: s.crosstabs ?? [] };
}

/** Every projection, withdrawal and runoff call of the night, with the share of the expected vote counted. */
async function nightCalls(u: Universe, id: number): Promise<NightCallDto[]> {
  const rec = await u.elections.nightRecord(id); if (!rec) return [];
  const ev = rec.events, B = rec.batches, rr = rec.raceRows;
  const ballots = new Float64Array(rec.races.length), expected = new Float64Array(rec.races.length);
  let b = 0, w = 0;
  const out: NightCallDto[] = [];
  const name = (race: number, opt: number) => { const cid = rec.races[race]!.candidacyIds[opt]; const pid = cid !== undefined ? u.db.value<number>('SELECT person_id FROM candidacy WHERE candidacy_id = ?', [cid]) : undefined; const p = pid !== undefined ? u.world.persons.get(pid) ?? optionPerson(pid) : undefined; return p ? fullName(p) : ''; };
  for (let i = 0; i < ev.time.length; i++) {
    const t = ev.time[i]!, st = ev.status[i]!;
    while (b < B.time.length && B.time[b]! <= t) { for (let j = B.rowStart[b]!; j < B.rowStart[b + 1]!; j++) { const r = rr.race[j]!; for (let q = 0; q < rec.races[r]!.k; q++) ballots[r]! += rr.votes[rr.off[j]! + q]!; } b++; }
    while (w < rec.wire.time.length && rec.wire.time[w]! <= t) { expected[rec.wire.race[w]!] = rec.wire.expected[w]!; w++; }
    if (st !== ST_CALLED && st !== ST_WITHDRAWN && st !== ST_RUNOFF) continue;
    const r = ev.race[i]!, race = rec.races[r]!, opt = ev.option[i]!;
    out.push({ time: t, race: r, contestId: race.contestId, label: race.label.replace(/^\d{4} /, ''), short: raceShort(u.db, u.world, race), office: race.office, status: st,
      party: opt >= 0 ? race.parties[opt] ?? 5 : 0, name: opt >= 0 ? name(r, opt) : '', pct: expected[r]! > 0 ? Math.min(1, ballots[r]! / expected[r]!) : 0, pollClose: (ev.flags[i]! & 1) === 1 });
  }
  return out;
}
