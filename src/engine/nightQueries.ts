/** Election-night queries: the list of nights, their metadata, and the sealed record for playback. */
import { fullName } from '../institutions/model';
import { isoDay } from '../core/time';
import { Playback } from '../broadcast/playback';
import type { NightListItem, NightMetaDto, NightQuery } from './protocol';
import type { Universe } from './universe';

export async function runNightQuery(u: Universe, q: NightQuery): Promise<unknown> {
  switch (q.kind) {
    case 'nights': return nights(u);
    case 'nightMeta': return nightMeta(u, q.id);
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
    const p = k ? u.world.persons.get(k.person_id) : undefined;
    return { candidacyId: cid, personId: k?.person_id ?? -1, name: p ? fullName(p) : `#${cid}`, party, incumbent: !!k?.incumbent };
  };
  const OFF: Record<string, string> = { president: 'President', us_senator: 'Senate', us_representative: 'House', governor: 'Governor', lt_governor: 'Lt. Governor', attorney_general: 'Attorney General', secretary_of_state: 'Secretary of State' };
  return {
    id, label: row.label, lockTime: rec.lockTime, coverageStart: rec.coverageStart, nightEnd: rec.nightEnd, feedEnd: rec.feedEnd, network: 'MNN',
    races: rec.races.map((r, i) => {
      const st = pack.states[r.stateIdx]!;
      const cd = r.cd >= 0 ? pack.cds[r.cd] : undefined;
      const houseCd = r.office === 'us_representative' ? pack.cds[u.db.value<number>('SELECT district_idx FROM contest WHERE contest_id = ?', [r.contestId]) ?? -1] : undefined;
      const short = r.office === 'us_representative' ? `${houseCd?.code ?? st.usps}` : `${st.usps} ${OFF[r.office] ?? r.office}${cd ? ` · ${cd.code ?? `CD ${r.cd}`}` : ''}`;
      return { i, contestId: r.contestId, label: r.label.replace(/^\d{4} /, ''), short, office: r.office, state: st.usps, stateIdx: r.stateIdx, cd: r.cd, ev: r.ev, k: r.k,
        candidates: r.candidacyIds.map((c, j) => cand(c, r.parties[j]!)), precincts: r.precincts, close: r.close };
    }),
    states: rec.states.map((s) => ({ idx: s.stateIdx, usps: pack.states[s.stateIdx]!.usps, name: pack.states[s.stateIdx]!.name, closeFirst: s.closeFirst, closeLast: s.closeLast, certify: s.certify })),
    chambers: rec.chambers,
    rjs: Object.fromEntries([...new Set(rec.parts.rj)].map((rj) => [rj, pack.rj[rj]?.name ?? `#${rj}`])),
  };
}

/** Engine-side playback for results views while a count is in progress (one cached night). */
let pbCache: { id: number; pb: Playback } | null = null;
export async function playbackFor(u: Universe, nightId: number): Promise<Playback | null> {
  if (pbCache?.id === nightId) return pbCache.pb;
  const rec = await u.elections.nightRecord(nightId);
  if (!rec) return null;
  pbCache = { id: nightId, pb: new Playback(rec) };
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

let snapCache: { key: string; snap: ReturnType<Playback['at']> } | null = null;

/** What the count shows for a contest at the current universe time (null when the contest is not being counted). */
export async function liveContest(u: Universe, contestId: number, detail = true): Promise<LiveContest | null> {
  const nightId = u.db.value<number>('SELECT n.night_id FROM night_election n JOIN contest c ON c.election_id = n.election_id WHERE c.contest_id = ?', [contestId]);
  if (nightId === undefined) return null;
  const pb = await playbackFor(u, nightId); if (!pb) return null;
  const ri = pb.rec.races.findIndex((r) => r.contestId === contestId && r.cd < 0);
  if (ri < 0) return null;
  const t = u.world.time, key = `${nightId}:${t}`;
  if (snapCache?.key !== key) snapCache = { key, snap: pb.at(t) };
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
  if (snapCache?.key !== key) snapCache = { key, snap: pb.at(t) };
  return { president: snapCache.snap.president.called, nightId };
}

/** Counted votes of a contest by county and by congressional district at the current universe time. */
export async function liveGeo(u: Universe, contestId: number): Promise<{ counties: Map<number, number[]>; cds: Map<number, number[]> } | null> {
  const nightId = u.db.value<number>('SELECT n.night_id FROM night_election n JOIN contest c ON c.election_id = n.election_id WHERE c.contest_id = ?', [contestId]);
  if (nightId === undefined) return null;
  const pb = await playbackFor(u, nightId); if (!pb) return null;
  const ri = pb.rec.races.findIndex((r) => r.contestId === contestId && r.cd < 0);
  if (ri < 0) return null;
  const k = pb.rec.races[ri]!.k, counties = new Map<number, number[]>(), cds = new Map<number, number[]>();
  const add = (m: Map<number, number[]>, key: number, v: Float64Array) => { const a = m.get(key) ?? new Array<number>(k).fill(0); for (let j = 0; j < k; j++) a[j]! += v[j]!; m.set(key, a); };
  for (const [part, v] of pb.raceByPart(ri, u.world.time)) {
    const rj = pb.rec.parts.rj[part]!, county = u.world.pack.rj[rj]?.countyIdx;
    if (county !== null && county !== undefined) add(counties, county, v);
    add(cds, pb.rec.parts.cd[part]!, v);
  }
  return { counties, cds };
}
