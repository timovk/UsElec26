/** Read-only queries over the elections archive (all numbers come from sealed archive records). */
import { daysToCivil, easternDay, formatDay, isoDay } from '../core/time';
import { fullName, PARTY_D, PARTY_R, optionPerson } from '../institutions/model';
import { NONE16, cdCode } from '../geo/pack';
import { isUnit, unitNames, unitStates } from '../geo/reportingUnits';
import { MODE_NAMES } from '../electorate/kernel';
import { auditElection, decodeContestBlob, readRollup, type StateRollup } from '../archive/results';
import { liveContest, liveGeo, liveTallies, playbackFor, type LiveContest } from './nightQueries';
import { decodeIntColumns } from '../core/codec';
import type { Universe } from './universe';
import { baselineContest, rjTotals, turnoutByBu } from './baselines';
import type { ArchiveQuery, CandidateDto, ContestDetail, CountyHistoryDto, DistrictHistoryDto, ElectionListItem, HistoryRow, MeasureListDto, ResultsMapDto, StateHistoryDto, TownHistoryDto, YearSummary } from './protocol';
import { MEASURE_KIND_LABEL, thresholdText, type MeasureKind, type Threshold } from '../rules/measures2016';
import { leanMargin } from './world';

interface CRow { contest_id: number; election_id: number; office_id: number | null; kind: string; party_id: number | null; state_idx: number | null; district_idx: number | null; method: string; label: string; status: string; winner_candidacy: number | null; parent_contest: number | null; next_contest: number | null; ev: number | null; year: number; seats?: number }

export async function runArchiveQuery(u: Universe, q: ArchiveQuery): Promise<unknown> {
  switch (q.kind) {
    // Years with at least one held election (a year's calendar is planned on January 1, long before any results).
    case 'electionYears': return u.db.all<{ year: number }>("SELECT DISTINCT year FROM election WHERE status <> 'scheduled' ORDER BY year DESC").map((r) => r.year);
    case 'elections': return elections(u, q.year, q.county);
    case 'contest': return contest(u, q.id);
    case 'countyHistory': return countyHistory(u, q.county);
    case 'townHistory': return townHistory(u, q.rj);
    case 'districtHistory': return districtHistory(u, q.code);
    case 'measures': return measureList(u, q.year, q.state);
    case 'stateHistory': return stateHistory(u, q.state);
    case 'resultsMap': return resultsMap(u, q.year, q.office, q.layer);
    case 'yearSummary': return yearSummary(u, q.year);
    case 'audit': return audit(u, q.year);
  }
}

/**
 * The revision a view may show: the latest official one, or 'live' while the contest is being counted (its only
 * revision is the sealed cast, which the count reveals over time).
 */
function viewRev(u: Universe, contestId: number): number | 'live' {
  const r = u.db.get<{ rev: number; kind: string }>('SELECT rev, kind FROM result_revision WHERE contest_id = ? ORDER BY rev DESC LIMIT 1', [contestId]);
  return !r ? 0 : r.kind === 'cast' ? 'live' : r.rev;
}

function candidates(u: Universe, contestId: number, live?: LiveContest | null): CandidateDto[] {
  const rev = viewRev(u, contestId);
  const rows = u.db.all<{ candidacy_id: number; person_id: number; party_id: number; incumbent: number; status: string; running_mate: number | null; votes: number | null; share: number | null }>(
    `SELECT k.candidacy_id, k.person_id, k.party_id, k.incumbent, k.status, k.running_mate, t.votes, t.share FROM candidacy k
     LEFT JOIN contest_total t ON t.candidacy_id = k.candidacy_id AND t.rev = ? WHERE k.contest_id = ? ORDER BY COALESCE(t.votes, -1) DESC, k.ballot_order, k.candidacy_id`, [rev === 'live' ? -1 : rev, contestId]);
  if (live) {
    const valid = [...live.votes.values()].reduce((a, b) => a + b, 0);
    for (const r of rows) { r.votes = live.votes.get(r.candidacy_id) ?? 0; r.share = valid ? r.votes / valid : 0; }
    rows.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || a.candidacy_id - b.candidacy_id);
  }
  return rows.map((r) => {
    const p = u.world.persons.get(r.person_id) ?? optionPerson(r.person_id); const m = r.running_mate !== null ? u.world.persons.get(r.running_mate) : undefined;
    return { candidacyId: r.candidacy_id, personId: r.person_id, name: p ? fullName(p) : `#${r.person_id}`, party: r.party_id, incumbent: !!r.incumbent, status: r.status, runningMate: m ? fullName(m) : null, votes: r.votes, share: r.share };
  });
}

const officeKindOf = (u: Universe, c: { office_id: number | null }) => (c.office_id !== null ? u.world.officeById.get(c.office_id)!.kind : 'president');

/**
 * A year's contests for the Results Explorer: the federal and state contests, or (`county`, Phase 7.6) the county
 * offices' contests, listed apart (tens of thousands a year with every county's offices). Everything is read in a few
 * batched statements; races being counted come from the night (the broadcast's races, or its local races).
 */
async function elections(u: Universe, year?: number, county = false): Promise<ElectionListItem[]> {
  const y = year ?? Number(u.db.value('SELECT MAX(year) FROM election') ?? 0);
  const w = u.world, t = w.time, LOCAL = county ? 1 : 0;
  const contests = u.db.all<CRow>('SELECT c.* FROM contest c WHERE c.year = ? AND c.local = ? ORDER BY c.contest_id', [y, LOCAL]);
  const els = county
    ? u.db.all<ERow>('SELECT * FROM election WHERE election_id IN (SELECT DISTINCT c.election_id FROM contest c WHERE c.year = ? AND c.local = 1) ORDER BY day, state_idx, election_id', [y])
    : u.db.all<ERow>('SELECT * FROM election WHERE year = ? ORDER BY day, state_idx, election_id', [y]);
  if (county && !contests.length) return [];
  const cands = new Map<number, CandidateDto[]>();
  for (const k of u.db.all<{ candidacy_id: number; contest_id: number; person_id: number; party_id: number; incumbent: number; status: string }>(
    'SELECT k.candidacy_id, k.contest_id, k.person_id, k.party_id, k.incumbent, k.status FROM candidacy k JOIN contest c ON c.contest_id = k.contest_id WHERE c.year = ? AND c.local = ? ORDER BY k.contest_id, k.ballot_order, k.candidacy_id', [y, LOCAL])) {
    const p = w.persons.get(k.person_id) ?? optionPerson(k.person_id);
    const l = cands.get(k.contest_id) ?? []; l.push({ candidacyId: k.candidacy_id, personId: k.person_id, name: p ? fullName(p) : `#${k.person_id}`, party: k.party_id, incumbent: !!k.incumbent, status: k.status, runningMate: null, votes: null, share: null });
    cands.set(k.contest_id, l);
  }
  const tops = new Map<number, { cid: number; votes: number; share: number }[]>();
  for (const r of u.db.all<{ contest_id: number; candidacy_id: number; votes: number; share: number }>(`SELECT t.contest_id, t.candidacy_id, t.votes, t.share FROM contest_total t JOIN contest c ON c.contest_id = t.contest_id
     WHERE c.year = ? AND c.local = ? AND c.status <> 'counting' AND t.rank <= 2 AND t.rev = (SELECT MAX(rev) FROM result_revision r WHERE r.contest_id = t.contest_id) ORDER BY t.contest_id, t.rank`, [y, LOCAL])) {
    const a = tops.get(r.contest_id) ?? []; a.push({ cid: r.candidacy_id, votes: r.votes, share: r.share }); tops.set(r.contest_id, a);
  }
  // Contests being counted: the count so far, and the desk's projection.
  const nightOf = new Map(u.db.all<{ election_id: number; night_id: number }>('SELECT ne.election_id, ne.night_id FROM night_election ne JOIN election e ON e.election_id = ne.election_id WHERE e.year = ?', [y]).map((r) => [r.election_id, r.night_id]));
  const projected = new Map<number, number | null>();
  for (const c of contests) {
    if (c.status !== 'counting') continue;
    if (county) {
      const nid = nightOf.get(c.election_id); if (nid === undefined) continue;
      const pb = await playbackFor(u, nid); const li = pb ? pb.localOf(c.contest_id) : -1; if (!pb || li < 0) continue;
      const race = pb.rec.local!.races[li]!, st = pb.localState(li, t);
      let valid = 0; for (let j = 0; j < race.k - 1; j++) valid += st.votes[j]!;
      tops.set(c.contest_id, race.candidacyIds.map((cid, j) => ({ cid, votes: st.votes[j]!, share: valid ? st.votes[j]! / valid : 0 })).sort((a, b) => b.votes - a.votes).slice(0, 2));
      projected.set(c.contest_id, st.status === 3 && st.option >= 0 ? race.candidacyIds[st.option]! : null);
    } else {
      const lv = await liveContest(u, c.contest_id, false); if (!lv) continue;
      const valid = [...lv.votes.values()].reduce((a, b) => a + b, 0);
      tops.set(c.contest_id, [...lv.votes].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([cid, v]) => ({ cid, votes: v, share: valid ? v / valid : 0 })));
      projected.set(c.contest_id, lv.called);
    }
  }
  // The party holding each seat when the election was held.
  const held = new Map<number, number>();
  for (const e of els) {
    if (e.held_time === null) continue;
    for (const r of u.db.all<{ office_id: number; party_id: number }>('SELECT t.office_id, t.party_id FROM office_term t WHERE t.office_id IN (SELECT office_id FROM contest WHERE election_id = ?) AND t.start_time <= ? AND (t.end_time IS NULL OR t.end_time > ?) ORDER BY t.start_time',
      [e.election_id, e.held_time, e.held_time])) held.set(r.office_id, r.party_id);
  }
  const byElection = new Map<number, CRow[]>();
  for (const c of contests) { const l = byElection.get(c.election_id); if (l) l.push(c); else byElection.set(c.election_id, [c]); }
  return els.map((e) => ({
    id: e.election_id, day: e.day, date: isoDay(e.day), kind: e.kind, label: e.label, status: e.status, stateUsps: e.state_idx !== null ? w.pack.states[e.state_idx]!.usps : null, year: e.year,
    nightId: nightOf.get(e.election_id) ?? null,
    contests: (byElection.get(e.election_id) ?? []).map((c) => {
      const cs = cands.get(c.contest_id) ?? [], tp = tops.get(c.contest_id);
      const winId = c.status === 'counting' ? projected.get(c.contest_id) ?? null : c.winner_candidacy;
      let win = winId !== null ? cs.find((x) => x.candidacyId === winId) ?? null : null;
      if (win) { const v = tp?.find((x) => x.cid === win!.candidacyId); win = { ...win, votes: v?.votes ?? null, share: v?.share ?? null }; }
      // A retention vote: the outcome, named for the judge (Phase 7.2); a ballot measure: passed or failed (Phase 7.3).
      if (win && c.kind === 'retention') win = win.party === 0 ? { ...win, name: `${win.name}: not retained` } : { ...win, name: `${win.name}: retained` };
      if (win && c.kind === 'measure') win = { ...win, name: win.name === 'Yes' ? 'Passed' : 'Failed' };
      // A "vote for N" race (Phase 7.4): every winner, under the party most of them belong to.
      const multi = (c.seats ?? 1) > 1 && c.status !== 'counting';
      if (win && multi) {
        const ws = cs.filter((x) => x.status === 'won'), parties = new Map<number, number>();
        for (const x of ws) parties.set(x.party, (parties.get(x.party) ?? 0) + 1);
        win = { ...win, name: ws.map((x) => x.name).join(', '), party: [...parties].sort((a, b) => b[1] - a[1])[0]?.[0] ?? win.party };
      }
      const h = c.office_id !== null ? held.get(c.office_id) ?? null : null;
      return {
        id: c.contest_id, label: c.label, kind: c.kind, office: officeKindOf(u, c), status: c.status === 'counting' ? (winId !== null ? 'projected' : 'counting') : c.status, winner: win,
        margin: multi ? null : tp && tp.length > 1 ? 100 * (tp[0]!.share - tp[1]!.share) : tp ? 100 : null,
        state: c.state_idx !== null ? w.pack.states[c.state_idx]!.usps : null,
        // Facets: did the seat change party, and did an incumbent running lose?
        flip: !multi && win && h !== null && h !== 0 && ['general', 'special'].includes(c.kind) ? win.party !== h : null,
        incumbentLost: multi ? cs.some((x) => x.incumbent && x.status === 'lost') : win !== null && cs.some((x) => x.incumbent) && !win.incumbent,
      };
    }),
  }));
}
interface ERow { election_id: number; day: number; kind: string; label: string; status: string; state_idx: number | null; year: number; held_time: number | null }

async function contest(u: Universe, id: number): Promise<ContestDetail | null> {
  const c = u.db.get<CRow>('SELECT * FROM contest WHERE contest_id = ?', [id]);
  if (!c) return null;
  const w = u.world;
  const e = u.db.get<{ day: number; label: string }>('SELECT day, label FROM election WHERE election_id = ?', [c.election_id])!;
  const vr = viewRev(u, id);
  const live = vr === 'live' ? await liveContest(u, id) : null;
  const rv = vr === 'live' ? 0 : vr;
  const cands = candidates(u, id, live);
  // A retention vote (Phase 7.2): the two options are "yes" (keep the judge) and "no".
  if (c.kind === 'retention' && cands.length === 2) {
    const judge = cands.find((x) => x.party !== 0) ?? cands[0]!;
    for (const x of cands) { if (x === judge) x.name = `Yes: retain ${judge.name}`; else { x.name = 'No'; x.party = 0; } }
  }
  const order = u.db.all<{ candidacy_id: number }>('SELECT candidacy_id FROM candidacy WHERE contest_id = ? ORDER BY ballot_order, candidacy_id', [id]).map((r) => r.candidacy_id);
  const turnout = live ? { ballots: live.ballots, undervotes: live.undervotes, eligible: u.db.value<number>('SELECT eligible FROM contest_turnout WHERE contest_id = ? AND rev = 0', [id]) ?? 0 }
    : u.db.get<{ ballots: number; undervotes: number; eligible: number }>('SELECT ballots, undervotes, eligible FROM contest_turnout WHERE contest_id = ? AND rev = ?', [id, rv]);
  const rev = u.db.get<{ sha256: string; kind: string }>('SELECT sha256, kind FROM result_revision WHERE contest_id = ? AND rev = ?', [id, live ? -1 : rv]);
  const blob = live ? undefined : u.db.get<{ grain: string; payload: Uint8Array }>("SELECT grain, payload FROM result_blob WHERE contest_id = ? AND rev = 0 AND grain IN ('bu','cpart')", [id]);
  const counties: ContestDetail['counties'] = [];
  const k = order.length + 1;
  const idxOf = cands.map((x) => order.indexOf(x.candidacyId));
  const countyRows = (acc: Map<number, number[]>) => {
    for (const [county, v] of [...acc].sort((a, b) => a[0] - b[0])) {
      const cv = idxOf.map((j) => v[j]!);
      counties.push({ county, name: `${w.pack.counties[county]!.fullName}${c.state_idx === null ? `, ${w.pack.states[w.pack.counties[county]!.stateIdx]!.usps}` : ''}`, votes: cv, total: cv.reduce((a, b) => a + b, 0) });
    }
  };
  if (live) countyRows(live.byCounty);
  else if (rv > 0 && c.state_idx !== null) {
    // Certified: the county rollup of the certified revision.
    const roll = await readRollup(u.db, c.election_id, c.state_idx, rv);
    const entry = roll?.contests.find((x) => x.id === id);
    if (entry) countyRows(new Map(entry.counties));
  } else if (blob) {
    const { units, votes } = await decodeContestBlob(blob.payload, k);
    const acc = new Map<number, number[]>();
    for (let i = 0; i < units.length; i++) {
      const county = blob.grain === 'bu' ? w.pack.bu.county[units[i]!]! : Math.floor(units[i]! / 65536);
      const a = acc.get(county) ?? new Array<number>(k).fill(0);
      for (let j = 0; j < k; j++) a[j]! += votes[j]![i]!;
      acc.set(county, a);
    }
    countyRows(acc);
  }
  const modes: ContestDetail['modes'] = [];
  const mb = live ? undefined : u.db.get<{ payload: Uint8Array }>("SELECT payload FROM result_blob WHERE contest_id = ? AND rev = ? AND grain = 'rjmode'", [id, rv]);
  if (live) live.byMode.forEach((v, m) => { if (v.some((x) => x > 0)) modes.push({ mode: MODE_NAMES[m]!, votes: idxOf.map((j) => v[j]!) }); });
  if (mb) {
    const cols = await decodeIntColumns(mb.payload);
    const idx = cands.map((x) => order.indexOf(x.candidacyId));
    for (let m = 0; m < MODE_NAMES.length; m++) {
      const v = new Array<number>(cands.length).fill(0); let any = false;
      for (let i = 0; i < cols[0]!.length; i++) if (cols[1]![i] === m) { any = true; idx.forEach((j, q) => { v[q]! += cols[2 + j]![i]!; }); }
      if (any) modes.push({ mode: MODE_NAMES[m]!, votes: v });
    }
  }
  const office = c.office_id !== null ? w.officeById.get(c.office_id)! : null;
  const cd = c.district_idx !== null ? w.districts.cds[c.district_idx] : undefined;
  return {
    id, label: c.label, kind: c.kind, method: c.method, status: c.status, office: office?.title ?? null, officeKind: office?.kind ?? null,
    stateUsps: c.state_idx !== null ? w.pack.states[c.state_idx]!.usps : null, stateIdx: c.state_idx,
    districtLabel: cd ? `${w.pack.states[cd.stateIdx]!.usps}-${cd.number === 0 ? 'AL' : String(cd.number).padStart(2, '0')}` : null,
    measure: c.kind === 'measure' ? measureInfo(u, id) : null,
    seats: c.seats ?? 1,
    retention: c.kind === 'retention' ? { threshold: Number(c.method.slice('retention_'.length)) || 0.5, retained: c.winner_candidacy === null ? null : c.winner_candidacy === cands.find((x) => x.party !== 0)?.candidacyId } : null,
    date: formatDay(e.day, true), electionLabel: e.label, candidates: cands, ballots: turnout?.ballots ?? null, undervotes: turnout?.undervotes ?? null, eligible: turnout?.eligible ?? null,
    ev: c.ev, seal: rev?.sha256 ?? null, revisionKind: live ? 'counting' : rev?.kind ?? null, parent: c.parent_contest, next: c.next_contest, grain: blob?.grain ?? (live ? 'live' : rv > 0 ? 'bu' : null),
    counties, modes,
    nightId: u.db.value<number>('SELECT night_id FROM night_election WHERE election_id = ?', [c.election_id]) ?? null,
    counting: live ? { expected: live.expected, precincts: live.precincts, totalPrecincts: live.totalPrecincts, status: live.status, called: live.called, calledAt: live.calledAt, prob: live.prob, nightId: live.nightId } : null,
    revisions: live ? [] : u.db.all<{ rev: number; kind: string; created_time: number }>('SELECT rev, kind, created_time FROM result_revision WHERE contest_id = ? ORDER BY rev', [id]).map((x) => ({ rev: x.rev, kind: x.kind, time: x.created_time })),
    nonpartisan: (c as { nonpartisan?: number }).nonpartisan === 1,
    rcv: c.method === 'rcv' && (c.status === 'decided' || c.status === 'certified') ? rcvRounds(u, id, cands) : null,
    note: live ? 'Unofficial: the count so far, as reported to the wire. Ballots are revealed by the count; the certified result follows the canvass.'
      : blob?.grain === 'cpart' ? 'Primary results are archived by county and congressional district.'
      : rv > 0 ? 'Certified result. Every revision is sealed; county figures are exact sums of Census block-group units.' : 'General-election results are archived for every Census block-group unit; county figures are exact sums.',
  };
}

async function rollupsFor(u: Universe, electionIds: { election_id: number; state_idx: number }[]): Promise<Map<string, StateRollup>> {
  const out = new Map<string, StateRollup>();
  for (const e of electionIds) { const r = await readRollup(u.db, e.election_id, e.state_idx); if (r) out.set(`${e.election_id}:${e.state_idx}`, r); }
  return out;
}

async function countyHistory(u: Universe, county: number): Promise<CountyHistoryDto> {
  const w = u.world; const c = w.pack.counties[county]!;
  const contests = u.db.all<CRow & { day: number }>(
    `SELECT c.*, e.day FROM contest_geo g JOIN contest c ON c.contest_id = g.contest_id JOIN election e ON e.election_id = c.election_id
     WHERE g.county_idx = ? AND c.kind IN ('general','special','pres_state','retention','measure') ORDER BY e.day DESC, c.contest_id`, [county]);
  const rolls = await rollupsFor(u, [...new Set(contests.map((x) => `${x.election_id}:${x.state_idx}`))].map((s) => { const [a, b] = s.split(':'); return { election_id: Number(a), state_idx: Number(b) }; }));
  const rows: CountyHistoryDto['rows'] = [];
  for (const x of contests) {
    const roll = rolls.get(`${x.election_id}:${x.state_idx}`);
    const entry = roll?.contests.find((r) => r.id === x.contest_id);
    const v = entry?.counties.find(([cc]) => cc === county)?.[1];
    if (v) rows.push(historyRow(u, x, v));
  }
  // The county's congressional districts today.
  const year = daysToCivil(easternDay(w.time)).y, cdOf = w.districts.assignment('cd', year), cds = new Set<number>();
  for (let b = c.buStart; b < c.buStart + c.buCount; b++) if (cdOf[b] !== NONE16 && w.pop.vep[b]! > 0) cds.add(cdOf[b]!);
  const districts = [...cds].sort((a, b) => a - b).map((k) => cdCode({ states: w.pack.states, cds: w.districts.cds }, k)).sort();
  const names = unitNames(w.pack);
  const towns = w.pack.rj.filter((r) => r.countyIdx === county && isUnit(r)).map((r) => ({ rj: r.idx, name: names[r.idx]!, pop: r.pop2010 })).sort((a, b) => a.name.localeCompare(b.name));
  return { county, name: c.fullName, state: w.pack.states[c.stateIdx]!.name, stateIdx: c.stateIdx, districts, rows, towns };
}

/**
 * A New England town or an Alaska State House district (Phase 7.5): every contest on its ballots, from the
 * archive's counts by reporting jurisdiction (the contests of its county, or for Alaska of the state).
 */
async function townHistory(u: Universe, rj: number): Promise<TownHistoryDto> {
  const w = u.world, r = w.pack.rj[rj];
  if (!r || !isUnit(r)) return { found: false, rj, name: '', kind: 'town', state: '', stateIdx: -1, county: null, pop2010: 0, districts: [], rows: [] };
  const st = w.pack.states[r.stateIdx]!;
  const contests = r.countyIdx !== null
    ? u.db.all<CRow & { day: number }>(`SELECT c.*, e.day FROM contest_geo g JOIN contest c ON c.contest_id = g.contest_id JOIN election e ON e.election_id = c.election_id
        WHERE g.county_idx = ? AND c.kind IN ('general','special','pres_state','retention','measure') AND c.status IN ('decided','certified') ORDER BY e.day DESC, c.contest_id`, [r.countyIdx])
    : u.db.all<CRow & { day: number }>(`SELECT c.*, e.day FROM contest c JOIN election e ON e.election_id = c.election_id
        WHERE c.state_idx = ? AND c.kind IN ('general','special','pres_state','retention','measure') AND c.status IN ('decided','certified') ORDER BY e.day DESC, c.contest_id`, [r.stateIdx]);
  const rows: HistoryRow[] = [];
  for (const x of contests) {
    const k = Number(u.db.value('SELECT COUNT(*) FROM candidacy WHERE contest_id = ?', [x.contest_id]) ?? 0) + 1;
    const v = (await rjTotals(u, x.contest_id, k)).find(([id]) => id === rj)?.[1];
    if (v && v.some((n) => n > 0)) rows.push(historyRow(u, x, v));
  }
  // Its congressional districts today.
  const year = daysToCivil(easternDay(w.time)).y, cdOf = w.districts.assignment('cd', year), cds = new Set<number>();
  const counties = r.countyIdx !== null ? [w.pack.counties[r.countyIdx]!] : w.pack.counties.filter((c) => c.stateIdx === r.stateIdx);
  for (const c of counties) for (let b = c.buStart; b < c.buStart + c.buCount; b++) if (w.pack.bu.rj[b] === rj && cdOf[b] !== NONE16 && w.pop.vep[b]! > 0) cds.add(cdOf[b]!);
  const districts = [...cds].map((k) => cdCode({ states: w.pack.states, cds: w.districts.cds }, k)).sort();
  const county = r.countyIdx !== null ? { idx: r.countyIdx, name: w.pack.counties[r.countyIdx]!.fullName } : null;
  return { found: true, rj, name: r.kind === 'town' ? unitNames(w.pack)[rj]! : r.name, kind: r.kind as 'town' | 'ak_house_district', state: st.name, stateIdx: r.stateIdx, county, pop2010: r.pop2010, districts, rows };
}

/** A contest's result in one area (votes per candidacy in ballot order, then undervotes). */
function historyRow(u: Universe, x: CRow & { day: number }, v: number[]): HistoryRow {
  const w = u.world;
  const order = u.db.all<{ candidacy_id: number; person_id: number; party_id: number; ballot_order: number; status: string }>('SELECT candidacy_id, person_id, party_id, ballot_order, status FROM candidacy WHERE contest_id = ? ORDER BY ballot_order, candidacy_id', [x.contest_id]);
  const valid = v.slice(0, order.length).reduce((a, b) => a + b, 0);
  const name = (o: (typeof order)[number]) => {
    const n = fullName(w.persons.get(o.person_id) ?? optionPerson(o.person_id)!);
    return x.kind === 'retention' ? (o.ballot_order === 0 ? `Yes: retain ${n}` : 'No') : n;
  };
  const multi = (x.seats ?? 1) > 1;
  const cands = order.map((o, j) => ({ name: name(o), party: o.party_id, votes: v[j]!, share: valid ? v[j]! / valid : 0, winner: multi ? o.status === 'won' : o.candidacy_id === x.winner_candidacy }))
    .sort((a, b) => b.votes - a.votes);
  const d = cands.find((q) => q.party === PARTY_D)?.votes ?? 0, r = cands.find((q) => q.party === PARTY_R)?.votes ?? 0;
  const office = x.office_id !== null ? w.officeById.get(x.office_id)! : null;
  return { contestId: x.contest_id, year: x.year, date: isoDay(x.day), office: office?.kind === 'president' || x.kind === 'pres_state' ? 'President' : office?.title ?? x.label, officeKind: office?.kind ?? 'president',
    label: x.label, candidates: cands, total: valid, undervotes: v[order.length] ?? 0, dMargin: x.kind !== 'retention' && d + r > 0 ? 100 * (d - r) / (d + r) : null };
}

/** Holder of an office today (name, party and since when). */
function holderOf(u: Universe, officeId: number): { personId: number; name: string; party: number; since: number } | null {
  const t = u.world.current.get(officeId); if (!t) return null;
  const p = u.world.persons.get(t.personId); if (!p) return null;
  return { personId: p.id, name: fullName(p), party: t.partyId ?? p.partyId, since: t.start };
}

/**
 * A congressional district by its code: the House elections for the seat, and every federal and statewide
 * contest's result within the district as it was drawn for that election (the county rollups carry district
 * totals). After redistricting, the same number is a different area: each row uses that year's district.
 */
async function districtHistory(u: Universe, code: string): Promise<DistrictHistoryDto> {
  const w = u.world;
  const missing: DistrictHistoryDto = { found: false, code, state: '', stateIdx: -1, number: 0, now: null, plans: [], rows: [] };
  const m = /^([A-Za-z]{2})-(AL|\d+)$/i.exec(code.trim()); if (!m) return missing;
  const st = w.pack.states.find((s) => s.usps === m[1]!.toUpperCase()); if (!st) return missing;
  const number = m[2]!.toUpperCase() === 'AL' ? 0 : Number(m[2]);
  const D = w.districts, year = daysToCivil(easternDay(w.time)).y;
  const elections = u.db.all<{ election_id: number; day: number; kind: string; year: number }>(
    "SELECT election_id, day, kind, year FROM election WHERE state_idx = ? AND kind IN ('general','special','general_runoff') AND status <> 'scheduled' ORDER BY day DESC, election_id DESC", [st.idx]);
  const rows: HistoryRow[] = [];
  for (const e of elections) {
    const d = D.districtNumbered('cd', st.idx, number, e.year, e.kind === 'special'); if (!d) continue;
    const roll = await readRollup(u.db, e.election_id, st.idx); if (!roll) continue;
    const contests = u.db.all<CRow & { day: number; okind: string | null; sdist: number | null }>(
      `SELECT c.*, ? AS day, o.kind AS okind, s.district AS sdist FROM contest c LEFT JOIN office o ON o.office_id = c.office_id LEFT JOIN office_seat s ON s.office_id = c.office_id
       WHERE c.election_id = ? AND c.local = 0 AND c.kind IN ('general','special','pres_state','retention','measure') ORDER BY c.contest_id`, [e.day, e.election_id]);
    for (const c of contests) {
      // This district's House race, and the races of the whole state (not other districts' or legislative seats).
      const ok = c.okind === null || (c.okind === 'us_representative' ? c.district_idx === d.idx : c.okind !== 'state_senator' && c.okind !== 'state_representative' && !c.sdist);
      if (!ok) continue;
      const v = roll.contests.find((x) => x.id === c.contest_id)?.cds.find(([cd]) => cd === d.idx)?.[1];
      if (v) rows.push(historyRow(u, c, v));
    }
  }
  const nowD = D.districtNumbered('cd', st.idx, number, year);
  let now: DistrictHistoryDto['now'] = null;
  if (nowD) {
    const cdOf = D.assignment('cd', year), rg = w.pack.counties.filter((c) => c.stateIdx === st.idx);
    const byCounty = new Map<number, number>(); let tot = 0;
    for (const c of rg) for (let b = c.buStart; b < c.buStart + c.buCount; b++) if (cdOf[b] === nowD.idx) { const v = w.pop.vep[b]!; byCounty.set(c.idx, (byCounty.get(c.idx) ?? 0) + v); tot += v; }
    const office = w.offices.find((o) => o.kind === 'us_representative' && o.districtIdx === nowD.idx);
    const plan = nowD.planId ? u.db.get<{ census_year: number; first_year: number }>('SELECT census_year, first_year FROM district_plan WHERE plan_id = ?', [nowD.planId]) : undefined;
    now = {
      lean: Math.round(10 * leanMargin(w.lean.cd, nowD.idx)) / 10, population: nowD.pop2010,
      plan: plan ? `drawn after the ${plan.census_year} census, in effect from ${plan.first_year}` : 'the 2016 plan, drawn after the 2010 census',
      holder: office ? holderOf(u, office.id) : null,
      counties: [...byCounty].map(([idx, v]) => ({ idx, name: w.pack.counties[idx]!.fullName, share: tot > 0 ? v / tot : 0 })).sort((a, b) => b.share - a.share),
    };
  }
  const plans = D.cds.filter((d) => d.stateIdx === st.idx && d.number === number).map((d) => {
    const p = d.planId ? u.db.get<{ census_year: number; first_year: number }>('SELECT census_year, first_year FROM district_plan WHERE plan_id = ?', [d.planId]) : undefined;
    return { firstYear: p?.first_year ?? 2016, label: p ? `Drawn after the ${p.census_year} census (from ${p.first_year})` : 'The 2016 plan (drawn after the 2010 census)' };
  }).sort((a, b) => a.firstYear - b.firstYear);
  if (!now && !rows.length && !plans.length) return missing;
  return { found: true, code: `${st.usps}-${number === 0 ? 'AL' : String(number).padStart(2, '0')}`, state: st.name, stateIdx: st.idx, number, now, plans, rows };
}

/** A state's statewide contests (President, Senate, Governor and every statewide office and court seat), its districts and its counties. */
async function stateHistory(u: Universe, stateIdx: number): Promise<StateHistoryDto> {
  const w = u.world, st = w.pack.states[stateIdx]!, year = daysToCivil(easternDay(w.time)).y;
  const contests = u.db.all<CRow & { day: number }>(
    `SELECT c.*, e.day FROM contest c JOIN election e ON e.election_id = c.election_id LEFT JOIN office o ON o.office_id = c.office_id LEFT JOIN office_seat s ON s.office_id = c.office_id
     WHERE c.state_idx = ? AND c.local = 0 AND c.kind IN ('general','special','pres_state','retention','measure') AND c.status IN ('decided','certified')
       AND (o.kind IS NULL OR o.kind NOT IN ('us_representative','state_senator','state_representative')) AND (s.district IS NULL OR s.district = 0)
     ORDER BY e.day DESC, c.contest_id`, [stateIdx]);
  const rows = contests.map((c) => {
    const t = u.db.all<{ candidacy_id: number; votes: number }>('SELECT t.candidacy_id, t.votes FROM contest_total t JOIN candidacy k ON k.candidacy_id = t.candidacy_id WHERE t.contest_id = ? AND t.rev = (SELECT MAX(rev) FROM contest_total WHERE contest_id = ?) ORDER BY k.ballot_order, k.candidacy_id', [c.contest_id, c.contest_id]);
    const under = u.db.value<number>('SELECT undervotes FROM contest_turnout WHERE contest_id = ? ORDER BY rev DESC LIMIT 1', [c.contest_id]) ?? 0;
    return historyRow(u, c, [...t.map((x) => x.votes), under]);
  });
  const ref = { states: w.pack.states, cds: w.districts.cds };
  const districts = w.districts.districtsOf('cd', stateIdx, year).map((d) => {
    const office = w.offices.find((o) => o.kind === 'us_representative' && o.districtIdx === d.idx);
    const h = office ? holderOf(u, office.id) : null;
    return { code: cdCode(ref, d.idx), holder: h ? { personId: h.personId, name: h.name, party: h.party } : null, lean: Math.round(10 * leanMargin(w.lean.cd, d.idx)) / 10 };
  });
  const counties = w.pack.counties.filter((c) => c.stateIdx === stateIdx).map((c) => ({ idx: c.idx, name: c.fullName }));
  // New England's towns and Alaska's districts (Phase 7.5), with the last presidential result there.
  const names = unitNames(w.pack), unitList = w.pack.rj.filter((r) => r.stateIdx === stateIdx && isUnit(r));
  const units: StateHistoryDto['units'] = [];
  if (unitList.length) {
    const pres = contests.find((c) => c.kind === 'pres_state');
    const order = pres ? u.db.all<{ party_id: number }>('SELECT party_id FROM candidacy WHERE contest_id = ? ORDER BY ballot_order, candidacy_id', [pres.contest_id]).map((x) => x.party_id) : [];
    const by = new Map(pres ? await rjTotals(u, pres.contest_id, order.length + 1) : []);
    const di = order.indexOf(PARTY_D), ri = order.indexOf(PARTY_R);
    for (const r of unitList) {
      const v = by.get(r.idx), d = v && di >= 0 ? v[di]! : 0, rr = v && ri >= 0 ? v[ri]! : 0;
      units.push({ rj: r.idx, name: names[r.idx]!, kind: r.kind as 'town' | 'ak_house_district', county: r.countyIdx !== null ? w.pack.counties[r.countyIdx]!.fullName : null, pop: r.pop2010,
        year: pres && v ? pres.year : null, dMargin: d + rr > 0 ? Math.round(1000 * (d - rr) / (d + rr)) / 10 : null });
    }
    units.sort((a, b) => (a.county ?? '').localeCompare(b.county ?? '') || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  return { stateIdx, name: st.name, usps: st.usps, rows, districts, counties, units };
}

/** Two-party margins (D positive, points) for an office and year at state, county or district level. */
async function resultsMap(u: Universe, year: number, office: ResultsMapDto['office'], layer: ResultsMapDto['layer']): Promise<ResultsMapDto> {
  const w = u.world;
  const kindFilter = office === 'president' ? "c.kind = 'pres_state'" : `c.kind IN ('general','special') AND o.kind = '${office}'`;
  const rows = u.db.all<CRow>(`SELECT c.* FROM contest c LEFT JOIN office o ON o.office_id = c.office_id WHERE c.year = ? AND ${kindFilter} AND c.status IN ('decided','certified','counting') ORDER BY c.contest_id`, [year]);
  let counting = false;
  // The county layer also carries New England's towns and Alaska's districts, after the counties (Phase 7.5).
  const off = w.pack.counties.length, units = layer === 'county' ? unitStates(w.pack) : new Set<number>();
  const n = layer === 'state' ? w.pack.states.length : layer === 'county' ? off + w.pack.rj.length : w.districts.cds.length;
  const cdOf = w.districts.assignment('cd', year);
  const isUnitRj = (rj: number) => { const r = w.pack.rj[rj]; return !!r && isUnit(r); };
  const D = new Float64Array(n), R = new Float64Array(n), V = new Float64Array(n), Bc = new Float64Array(n), has = new Uint8Array(n);
  const lead = new Map<number, Map<number, number>>(); // area → party → votes (for the leading party)
  const bD = new Float64Array(n), bR = new Float64Array(n), bV = new Float64Array(n), bHas = new Uint8Array(n);
  const baseYears = new Set<number>();
  const rolls = await rollupsFor(u, [...new Set(rows.map((x) => `${x.election_id}:${x.state_idx}`))].map((s) => { const [a, b] = s.split(':'); return { election_id: Number(a), state_idx: Number(b) }; }));
  const national = new Map<number, number>();
  for (const c of rows) {
    const order = u.db.all<{ party_id: number }>('SELECT party_id FROM candidacy WHERE contest_id = ? ORDER BY ballot_order, candidacy_id', [c.contest_id]).map((r) => r.party_id);
    const di = order.indexOf(PARTY_D), ri = order.indexOf(PARTY_R);
    let entry = rolls.get(`${c.election_id}:${c.state_idx}`)?.contests.find((x) => x.id === c.contest_id);
    let byRj: [number, number[]][] = [];
    if (c.status === 'counting') {
      // The count so far (never the sealed cast ballots).
      const g = await liveGeo(u, c.contest_id); if (!g) continue;
      entry = { id: c.contest_id, k: order.length + 1, counties: [...g.counties], cds: [...g.cds] }; counting = true;
      if (units.has(c.state_idx!)) byRj = [...g.rjs].filter(([rj]) => isUnitRj(rj));
    } else if (units.has(c.state_idx!)) byRj = (await rjTotals(u, c.contest_id, order.length + 1)).filter(([rj]) => isUnitRj(rj));
    if (!entry) continue;
    const addTo = (i: number, v: number[]) => {
      if (i < 0 || i >= n || i === NONE16) return; has[i] = 1; if (di >= 0) D[i]! += v[di]!; if (ri >= 0) R[i]! += v[ri]!;
      let m = lead.get(i); if (!m) { m = new Map(); lead.set(i, m); }
      order.forEach((p, j) => { V[i]! += v[j]!; m!.set(p, (m!.get(p) ?? 0) + v[j]!); });
      Bc[i]! += v.reduce((a, x) => a + x, 0);
    };
    const spread = (e: { counties: [number, number[]][]; cds: [number, number[]][] }, k: number, f: (i: number, v: number[]) => void) => {
      if (layer === 'state') { const t = e.counties.reduce((a, [, v]) => a.map((x, j) => x + v[j]!), new Array<number>(k).fill(0)); f(c.state_idx!, t); }
      else if (layer === 'county') for (const [cc, v] of e.counties) f(cc, v);
      else for (const [cd, v] of e.cds) f(cd, v);
    };
    spread(entry, order.length + 1, addTo);
    for (const [rj, v] of byRj) addTo(off + rj, v);
    // The previous comparable result (same office, else the state's last presidential race), for swing maps.
    const b = baselineContest(u, c.contest_id);
    if (b) {
      const be = (await readRollup(u.db, b.election_id, b.state_idx))?.contests.find((x) => x.id === b.contest_id);
      if (be) {
        const bo = u.db.all<{ party_id: number }>('SELECT party_id FROM candidacy WHERE contest_id = ? ORDER BY ballot_order, candidacy_id', [b.contest_id]).map((r) => r.party_id);
        const bdi = bo.indexOf(PARTY_D), bri = bo.indexOf(PARTY_R);
        baseYears.add(b.year);
        const addBase = (i: number, v: number[]) => { if (i < 0 || i >= n || i === NONE16) return; bHas[i] = 1; if (bdi >= 0) bD[i]! += v[bdi]!; if (bri >= 0) bR[i]! += v[bri]!; for (let j = 0; j < bo.length; j++) bV[i]! += v[j]!; };
        spread(be, bo.length + 1, addBase);
        if (units.has(b.state_idx)) for (const [rj, v] of await rjTotals(u, b.contest_id, bo.length + 1)) if (isUnitRj(rj)) addBase(off + rj, v);
      }
    }
    if (office === 'president') for (const [, v] of entry.counties) order.forEach((p, j) => national.set(p, (national.get(p) ?? 0) + v[j]!));
  }
  const values = Array.from({ length: n }, (_, i) => (has[i] && D[i]! + R[i]! > 0 ? Math.round(1000 * (D[i]! - R[i]!) / (D[i]! + R[i]!)) / 10 : has[i] ? 0 : null));
  // Turnout: eligible voters and ballots by area, for this election and the baseline one.
  const area = (bu: number) => (layer === 'state' ? w.pack.counties[w.pack.bu.county[bu]!]!.stateIdx : layer === 'county' ? w.pack.bu.county[bu]! : cdOf[bu]!);
  const turnout = async (pairs: { election_id: number; state_idx: number }[]) => {
    const el = new Float64Array(n), ba = new Float64Array(n); let any = false;
    for (const e of pairs) {
      const t = await turnoutByBu(u, e.election_id, e.state_idx); if (!t) continue; any = true;
      for (let i = 0; i < t.eligible.length; i++) {
        const a = area(t.start + i); if (a === NONE16 || a >= n) continue; el[a]! += t.eligible[i]!; ba[a]! += t.ballots[i]!;
        if (units.has(e.state_idx)) { const rj = w.pack.bu.rj[t.start + i]!; if (rj !== NONE16 && isUnitRj(rj)) { el[off + rj]! += t.eligible[i]!; ba[off + rj]! += t.ballots[i]!; } }
      }
    }
    return any ? { el, ba } : null;
  };
  const uniq = (xs: { election_id: number; state_idx: number | null }[]) => [...new Map(xs.filter((x) => x.state_idx !== null).map((x) => [`${x.election_id}:${x.state_idx}`, { election_id: x.election_id, state_idx: x.state_idx! }])).values()];
  // While counting, ballots are the count so far (the sealed turnout record would reveal the cast ballots).
  const cur = await turnout(uniq(rows));
  if (cur && counting) for (let i = 0; i < n; i++) cur.ba[i] = Bc[i]!;
  const baseEls = rows.map((c) => baselineContest(u, c.contest_id)).filter((x): x is NonNullable<typeof x> => !!x);
  const prev = await turnout(uniq(baseEls));
  const round = (a: Float64Array) => Array.from(a, (x) => Math.round(x));
  const cells: NonNullable<ResultsMapDto['cells']> = {
    d: round(D), r: round(R), valid: round(V), has: Array.from(has),
    lead: Array.from({ length: n }, (_, i) => { const m = lead.get(i); if (!m) return 0; let bp = 0, bv = -1; for (const [p, v] of m) if (v > bv) { bv = v; bp = p; } return bp; }),
    ballots: cur ? round(cur.ba) : null, eligible: cur ? round(cur.el) : null,
    base: bHas.some((x) => x) ? { label: [...baseYears].sort().join('/'), d: round(bD), r: round(bR), valid: round(bV), has: Array.from(bHas), ballots: prev ? round(prev.ba) : null, eligible: prev ? round(prev.el) : null } : null,
  };
  let ev: ResultsMapDto['ev'] = null;
  if (office === 'president') {
    ev = u.db.all<{ party_id: number; ev: number; person_id: number }>('SELECT v.party_id, v.ev, v.person_id FROM electoral_vote v JOIN election e ON e.election_id = v.election_id WHERE e.year = ? ORDER BY v.ev DESC', [year])
      .map((r) => ({ party: r.party_id, ev: r.ev, name: fullName(w.persons.get(r.person_id)!) }));
  }
  return { year, office, layer, values, cells, legend: counting ? 'Two-party margin (D+ / R+ points) of the votes counted so far (unofficial)' : 'Two-party margin (D+ / R+ points), archived results', national: office === 'president' ? [...national].map(([party, votes]) => ({ party, votes })).sort((a, b) => b.votes - a.votes) : null, ev };
}

async function yearSummary(u: Universe, year: number): Promise<YearSummary> {
  const w = u.world;
  let ev = u.db.all<{ person_id: number; party_id: number; ev: number }>('SELECT v.person_id, v.party_id, v.ev FROM electoral_vote v JOIN election e ON e.election_id = v.election_id WHERE e.year = ? ORDER BY v.ev DESC', [year]);
  // Before the electors meet: electoral votes as projected by the desk from the night record.
  let projected = false;
  if (!ev.length && u.db.value<number>("SELECT COUNT(*) FROM contest WHERE year = ? AND kind = 'pres_state'", [year])) {
    const lt = await liveTallies(u, year);
    if (lt) {
      projected = true;
      const nominees = u.db.all<{ person_id: number; party_id: number }>("SELECT DISTINCT k.person_id, k.party_id FROM candidacy k JOIN contest c ON c.contest_id = k.contest_id WHERE c.year = ? AND c.kind = 'pres_state'", [year]);
      ev = Object.entries(lt.president).map(([party, n]) => ({ person_id: nominees.find((x) => x.party_id === Number(party))?.person_id ?? -1, party_id: Number(party), ev: n })).filter((x) => x.person_id >= 0).sort((a, b) => b.ev - a.ev);
    }
  }
  const pv = new Map(u.db.all<{ person_id: number; v: number }>("SELECT k.person_id, SUM(t.votes) v FROM contest c JOIN contest_total t ON t.contest_id = c.contest_id JOIN candidacy k ON k.candidacy_id = t.candidacy_id WHERE c.year = ? AND c.kind = 'pres_state' AND c.status <> 'counting' AND t.rev = (SELECT MAX(rev) FROM result_revision r WHERE r.contest_id = c.contest_id) GROUP BY k.person_id", [year]).map((r) => [r.person_id, r.v]));
  const totalPv = [...pv.values()].reduce((a, b) => a + b, 0);
  const presIds = new Set([...ev.map((e) => e.person_id), ...pv.keys()]);
  const president = [...presIds].map((id) => ({ name: fullName(w.persons.get(id)!), party: w.persons.get(id)!.partyId, ev: ev.find((e) => e.person_id === id)?.ev ?? 0, votes: pv.get(id) ?? 0, share: totalPv ? (pv.get(id) ?? 0) / totalPv : 0 })).sort((a, b) => b.ev - a.ev || b.votes - a.votes);
  const held = u.db.value<number>("SELECT MIN(held_time) FROM election WHERE year = ? AND kind = 'general'", [year]) ?? null;
  const winners = u.db.all<{ contest_id: number; office_id: number; label: string; party_id: number }>(
    "SELECT c.contest_id, c.office_id, c.label, k.party_id FROM contest c JOIN candidacy k ON k.candidacy_id = c.winner_candidacy WHERE c.year = ? AND c.local = 0 AND c.kind IN ('general','special') AND c.status IN ('decided','certified')", [year]);
  const winnerOf = new Map<number, (typeof winners)[number]>(); for (const x of winners) if (!winnerOf.has(x.office_id)) winnerOf.set(x.office_id, x);
  const holderAt = (officeId: number): number | null => held === null ? null : u.db.value<number>('SELECT party_id FROM office_term WHERE office_id = ? AND start_time <= ? AND (end_time IS NULL OR end_time > ?) ORDER BY start_time DESC LIMIT 1', [officeId, held, held]) ?? null;
  const flips: YearSummary['flips'] = [];
  const chambers: YearSummary['chambers'] = [];
  for (const [kind, label] of [['us_senator', 'U.S. Senate'], ['us_representative', 'U.S. House'], ['governor', 'Governors']] as const) {
    const offices = w.offices.filter((o) => o.kind === kind);
    const before = new Map<number, number>(), after = new Map<number, number>();
    for (const o of offices) {
      const b = holderAt(o.id) ?? 0; before.set(b, (before.get(b) ?? 0) + 1);
      const win = winnerOf.get(o.id);
      const a = win ? win.party_id : b; after.set(a, (after.get(a) ?? 0) + 1);
      if (win && win.party_id !== b && b !== 0) flips.push({ label: win.label, from: b, to: win.party_id, contestId: win.contest_id });
    }
    if (offices.some((o) => winnerOf.has(o.id))) chambers.push({ label, before: [...before].map(([party, seats]) => ({ party, seats })).sort((a, b) => a.party - b.party), after: [...after].map(([party, seats]) => ({ party, seats })).sort((a, b) => a.party - b.party) });
  }
  // Turnout from the sealed turnout record only once no general election of the year is still being counted
  // (until then it would reveal the cast ballots).
  const stillCounting = Number(u.db.value("SELECT COUNT(*) FROM election WHERE year = ? AND kind = 'general' AND status = 'counting'", [year]) ?? 0) > 0;
  const t = stillCounting ? undefined : u.db.get<{ b: number; e: number }>("SELECT SUM(t.ballots) b, SUM(t.eligible) e FROM election_turnout t JOIN election x ON x.election_id = t.election_id WHERE x.year = ? AND x.kind = 'general'", [year]);
  return { year, hasPresident: president.length > 0, president, chambers, flips, turnout: t && t.b ? { ballots: t.b, eligible: t.e } : null, projected };
}

async function audit(u: Universe, year: number): Promise<{ election: string; ok: boolean; findings: { check: string; ok: boolean; detail: string }[] }[]> {
  const pack = u.world.pack;
  const starts = pack.states.map((s) => pack.counties.find((c) => c.stateIdx === s.idx)!.buStart);
  const els = u.db.all<{ election_id: number; label: string }>("SELECT election_id, label FROM election WHERE year = ? AND status <> 'scheduled' ORDER BY election_id", [year]);
  const out = [];
  for (const e of els) {
    const f = await auditElection(u.db, e.election_id, (b) => pack.counties[pack.bu.county[b]!]!.stateIdx, (s) => starts[s]!, (b) => pack.bu.county[b]!);
    out.push({ election: e.label, ok: f.every((x) => x.ok), findings: f });
  }
  return out;
}

/** A ranked-choice tabulation as archived (the latest revision), round by round. */
function rcvRounds(u: Universe, id: number, cands: { candidacyId: number; name: string; party: number }[]): ContestDetail['rcv'] {
  const rows = u.db.all<{ round: number; candidacy_id: number | null; votes: number; status: string }>('SELECT round, candidacy_id, votes, status FROM rcv_round WHERE contest_id = ? AND rev = (SELECT MAX(rev) FROM rcv_round WHERE contest_id = ?) ORDER BY round, rowid', [id, id]);
  if (!rows.length) return null;
  const by = new Map<number, NonNullable<ContestDetail['rcv']>[number]>();
  for (const r of rows) {
    let x = by.get(r.round); if (!x) { x = { round: r.round, candidates: [], exhausted: 0 }; by.set(r.round, x); }
    if (r.candidacy_id === null) { x.exhausted = r.votes; continue; }
    const c = cands.find((k) => k.candidacyId === r.candidacy_id);
    x.candidates.push({ candidacyId: r.candidacy_id, name: c?.name ?? '?', party: c?.party ?? 5, votes: r.votes, status: r.status });
  }
  return [...by.values()];
}

/** A ballot measure's facts for its contest page (Phase 7.3). */
function measureInfo(u: Universe, contestId: number): ContestDetail['measure'] {
  const m = u.db.get<{ name: string; title: string; summary: string; kind: string; sponsor: string; threshold_json: string; parties_json: string; polled: number; outcome: string | null; law_id: number | null }>(
    'SELECT name, title, summary, kind, sponsor, threshold_json, parties_json, polled, outcome, law_id FROM ballot_measure WHERE contest_id = ?', [contestId]);
  if (!m) return null;
  const law = m.law_id !== null ? u.db.get<{ summary: string; effective_day: number }>('SELECT summary, effective_day FROM election_law WHERE law_id = ?', [m.law_id]) : undefined;
  const parties = JSON.parse(m.parties_json) as { D: string | null; R: string | null };
  return { name: m.name, title: m.title, summary: m.summary, kind: MEASURE_KIND_LABEL[m.kind as MeasureKind] ?? m.kind, sponsor: m.sponsor, threshold: thresholdText(JSON.parse(m.threshold_json) as Threshold),
    parties, polled: m.polled === 1, outcome: m.outcome, law: law ? { summary: law.summary, effective: formatDay(law.effective_day, true) } : null };
}

/** Every ballot measure of a year (or of a state, every year), with its yes share once counted. */
function measureList(u: Universe, year?: number, state?: number): MeasureListDto {
  const years = u.db.all<{ year: number }>('SELECT DISTINCT year FROM ballot_measure ORDER BY year DESC').map((r) => r.year);
  const y = year ?? (state === undefined ? years[0] ?? null : null);
  const rows = u.db.all<{ contest_id: number; year: number; state_idx: number; name: string; title: string; kind: string; status: string; outcome: string | null; threshold_json: string; effect: string | null; polled: number }>(
    `SELECT m.contest_id, m.year, m.state_idx, m.name, m.title, m.kind, c.status, m.outcome, m.threshold_json, m.effect, m.polled FROM ballot_measure m JOIN contest c ON c.contest_id = m.contest_id
     WHERE (? IS NULL OR m.year = ?) AND (? IS NULL OR m.state_idx = ?) ORDER BY m.year DESC, m.state_idx, m.contest_id`, [y, y, state ?? null, state ?? null]);
  return {
    years, year: y, state: state ?? null,
    rows: rows.map((r) => {
      const t = u.db.all<{ votes: number }>('SELECT t.votes FROM contest_total t JOIN candidacy k ON k.candidacy_id = t.candidacy_id WHERE t.contest_id = ? AND t.rev = (SELECT MAX(rev) FROM contest_total WHERE contest_id = ?) ORDER BY k.ballot_order', [r.contest_id, r.contest_id]);
      const yes = t.length === 2 && t[0]!.votes + t[1]!.votes > 0 ? t[0]!.votes / (t[0]!.votes + t[1]!.votes) : null;
      return { contestId: r.contest_id, year: r.year, state: u.world.pack.states[r.state_idx]!.name, stateIdx: r.state_idx, name: r.name, title: r.title, kind: MEASURE_KIND_LABEL[r.kind as MeasureKind] ?? r.kind,
        status: r.status, outcome: r.outcome, yes, threshold: thresholdText(JSON.parse(r.threshold_json) as Threshold), effect: r.effect !== null, polled: r.polled === 1 };
    }),
  };
}
