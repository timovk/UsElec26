/** Read-only queries over the elections archive (all numbers come from sealed archive records). */
import { formatDay, isoDay } from '../core/time';
import { fullName, PARTY_D, PARTY_R } from '../institutions/model';
import { NONE16 } from '../geo/pack';
import { MODE_NAMES } from '../electorate/kernel';
import { auditElection, decodeContestBlob, readRollup, type StateRollup } from '../archive/results';
import { liveContest, liveGeo, liveTallies, type LiveContest } from './nightQueries';
import { decodeIntColumns } from '../core/codec';
import type { Universe } from './universe';
import type { ArchiveQuery, CandidateDto, ContestDetail, CountyHistoryDto, ElectionListItem, ResultsMapDto, YearSummary } from './protocol';

interface CRow { contest_id: number; election_id: number; office_id: number | null; kind: string; party_id: number | null; state_idx: number | null; district_idx: number | null; method: string; label: string; status: string; winner_candidacy: number | null; parent_contest: number | null; next_contest: number | null; ev: number | null; year: number }

export async function runArchiveQuery(u: Universe, q: ArchiveQuery): Promise<unknown> {
  switch (q.kind) {
    // Years with at least one held election (a year's calendar is planned on January 1, long before any results).
    case 'electionYears': return u.db.all<{ year: number }>("SELECT DISTINCT year FROM election WHERE status <> 'scheduled' ORDER BY year DESC").map((r) => r.year);
    case 'elections': return elections(u, q.year);
    case 'contest': return contest(u, q.id);
    case 'countyHistory': return countyHistory(u, q.county);
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
    const p = u.world.persons.get(r.person_id); const m = r.running_mate !== null ? u.world.persons.get(r.running_mate) : undefined;
    return { candidacyId: r.candidacy_id, personId: r.person_id, name: p ? fullName(p) : `#${r.person_id}`, party: r.party_id, incumbent: !!r.incumbent, status: r.status, runningMate: m ? fullName(m) : null, votes: r.votes, share: r.share };
  });
}

const officeKindOf = (u: Universe, c: { office_id: number | null }) => (c.office_id !== null ? u.world.officeById.get(c.office_id)!.kind : 'president');

async function elections(u: Universe, year?: number): Promise<ElectionListItem[]> {
  const y = year ?? Number(u.db.value('SELECT MAX(year) FROM election') ?? 0);
  const els = u.db.all<{ election_id: number; day: number; kind: string; label: string; status: string; state_idx: number | null; year: number }>('SELECT * FROM election WHERE year = ? ORDER BY day, state_idx, election_id', [y]);
  const contests = u.db.all<CRow>('SELECT * FROM contest WHERE year = ? ORDER BY contest_id', [y]);
  const tops = new Map<number, { cid: number; votes: number; share: number }[]>();
  for (const t of u.db.all<{ contest_id: number; candidacy_id: number; votes: number; share: number; rank: number }>(`SELECT t.contest_id, t.candidacy_id, t.votes, t.share, t.rank FROM contest_total t JOIN contest c ON c.contest_id = t.contest_id
     WHERE c.year = ? AND c.status <> 'counting' AND t.rank <= 2 AND t.rev = (SELECT MAX(rev) FROM result_revision r WHERE r.contest_id = t.contest_id) ORDER BY t.contest_id, t.rank`, [y])) {
    const a = tops.get(t.contest_id) ?? []; a.push({ cid: t.candidacy_id, votes: t.votes, share: t.share }); tops.set(t.contest_id, a);
  }
  // Contests being counted: the count so far, and the desk's projection.
  const projected = new Map<number, number | null>();
  for (const c of contests.filter((x) => x.status === 'counting')) {
    const lv = await liveContest(u, c.contest_id, false); if (!lv) continue;
    const valid = [...lv.votes.values()].reduce((a, b) => a + b, 0);
    tops.set(c.contest_id, [...lv.votes].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([cid, v]) => ({ cid, votes: v, share: valid ? v / valid : 0 })));
    projected.set(c.contest_id, lv.called);
  }
  const nightOf = new Map(u.db.all<{ election_id: number; night_id: number }>('SELECT ne.election_id, ne.night_id FROM night_election ne JOIN election e ON e.election_id = ne.election_id WHERE e.year = ?', [y]).map((r) => [r.election_id, r.night_id]));
  return els.map((e) => ({
    id: e.election_id, day: e.day, date: isoDay(e.day), kind: e.kind, label: e.label, status: e.status, stateUsps: e.state_idx !== null ? u.world.pack.states[e.state_idx]!.usps : null, year: e.year,
    nightId: nightOf.get(e.election_id) ?? null,
    contests: contests.filter((c) => c.election_id === e.election_id).map((c) => {
      const t = tops.get(c.contest_id);
      const winId = c.status === 'counting' ? projected.get(c.contest_id) ?? null : c.winner_candidacy;
      const win = winId !== null ? candidates(u, c.contest_id).find((x) => x.candidacyId === winId) ?? null : null;
      const status = c.status === 'counting' ? (winId !== null ? 'projected' : 'counting') : c.status;
      return { id: c.contest_id, label: c.label, kind: c.kind, office: officeKindOf(u, c), status, winner: win, margin: t && t.length > 1 ? 100 * (t[0]!.share - t[1]!.share) : t ? 100 : null };
    }),
  }));
}

async function contest(u: Universe, id: number): Promise<ContestDetail | null> {
  const c = u.db.get<CRow>('SELECT * FROM contest WHERE contest_id = ?', [id]);
  if (!c) return null;
  const w = u.world;
  const e = u.db.get<{ day: number; label: string }>('SELECT day, label FROM election WHERE election_id = ?', [c.election_id])!;
  const vr = viewRev(u, id);
  const live = vr === 'live' ? await liveContest(u, id) : null;
  const rv = vr === 'live' ? 0 : vr;
  const cands = candidates(u, id, live);
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
  const cd = c.district_idx !== null ? w.pack.cds[c.district_idx] : undefined;
  return {
    id, label: c.label, kind: c.kind, method: c.method, status: c.status, office: office?.title ?? null, officeKind: office?.kind ?? null,
    stateUsps: c.state_idx !== null ? w.pack.states[c.state_idx]!.usps : null, stateIdx: c.state_idx,
    districtLabel: cd ? `${w.pack.states[cd.stateIdx]!.usps}-${cd.district === 0 ? 'AL' : String(cd.district).padStart(2, '0')}` : null,
    date: formatDay(e.day, true), electionLabel: e.label, candidates: cands, ballots: turnout?.ballots ?? null, undervotes: turnout?.undervotes ?? null, eligible: turnout?.eligible ?? null,
    ev: c.ev, seal: rev?.sha256 ?? null, revisionKind: live ? 'counting' : rev?.kind ?? null, parent: c.parent_contest, next: c.next_contest, grain: blob?.grain ?? (live ? 'live' : rv > 0 ? 'bu' : null),
    counties, modes,
    nightId: u.db.value<number>('SELECT night_id FROM night_election WHERE election_id = ?', [c.election_id]) ?? null,
    counting: live ? { expected: live.expected, precincts: live.precincts, totalPrecincts: live.totalPrecincts, status: live.status, called: live.called, calledAt: live.calledAt, prob: live.prob, nightId: live.nightId } : null,
    revisions: live ? [] : u.db.all<{ rev: number; kind: string; created_time: number }>('SELECT rev, kind, created_time FROM result_revision WHERE contest_id = ? ORDER BY rev', [id]).map((x) => ({ rev: x.rev, kind: x.kind, time: x.created_time })),
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
     WHERE g.county_idx = ? AND c.kind IN ('general','special','pres_state') ORDER BY e.day DESC, c.contest_id`, [county]);
  const rolls = await rollupsFor(u, [...new Set(contests.map((x) => `${x.election_id}:${x.state_idx}`))].map((s) => { const [a, b] = s.split(':'); return { election_id: Number(a), state_idx: Number(b) }; }));
  const rows: CountyHistoryDto['rows'] = [];
  for (const x of contests) {
    const roll = rolls.get(`${x.election_id}:${x.state_idx}`);
    const entry = roll?.contests.find((r) => r.id === x.contest_id);
    const v = entry?.counties.find(([cc]) => cc === county)?.[1];
    if (!v) continue;
    const order = u.db.all<{ candidacy_id: number; person_id: number; party_id: number }>('SELECT candidacy_id, person_id, party_id FROM candidacy WHERE contest_id = ? ORDER BY ballot_order, candidacy_id', [x.contest_id]);
    const valid = v.slice(0, order.length).reduce((a, b) => a + b, 0);
    const cands = order.map((o, j) => ({ name: fullName(w.persons.get(o.person_id)!), party: o.party_id, votes: v[j]!, share: valid ? v[j]! / valid : 0, winner: o.candidacy_id === x.winner_candidacy }))
      .sort((a, b) => b.votes - a.votes);
    const d = cands.find((q) => q.party === PARTY_D)?.votes ?? 0, r = cands.find((q) => q.party === PARTY_R)?.votes ?? 0;
    const office = x.office_id !== null ? w.officeById.get(x.office_id)! : null;
    rows.push({ contestId: x.contest_id, year: x.year, date: isoDay(x.day), office: office?.kind === 'president' || x.kind === 'pres_state' ? 'President' : office?.title ?? x.label, officeKind: office?.kind ?? 'president',
      label: x.label, candidates: cands, total: valid, undervotes: v[order.length]!, dMargin: d + r > 0 ? 100 * (d - r) / (d + r) : null });
  }
  return { county, name: c.fullName, state: w.pack.states[c.stateIdx]!.name, stateIdx: c.stateIdx, rows };
}

/** Two-party margins (D positive, points) for an office and year at state, county or district level. */
async function resultsMap(u: Universe, year: number, office: ResultsMapDto['office'], layer: ResultsMapDto['layer']): Promise<ResultsMapDto> {
  const w = u.world;
  const kindFilter = office === 'president' ? "c.kind = 'pres_state'" : `c.kind IN ('general','special') AND o.kind = '${office}'`;
  const rows = u.db.all<CRow>(`SELECT c.* FROM contest c LEFT JOIN office o ON o.office_id = c.office_id WHERE c.year = ? AND ${kindFilter} AND c.status IN ('decided','certified','counting') ORDER BY c.contest_id`, [year]);
  let counting = false;
  const n = layer === 'state' ? w.pack.states.length : layer === 'county' ? w.pack.counties.length : w.pack.cds.length;
  const D = new Float64Array(n), R = new Float64Array(n), has = new Uint8Array(n);
  const rolls = await rollupsFor(u, [...new Set(rows.map((x) => `${x.election_id}:${x.state_idx}`))].map((s) => { const [a, b] = s.split(':'); return { election_id: Number(a), state_idx: Number(b) }; }));
  const national = new Map<number, number>();
  for (const c of rows) {
    const order = u.db.all<{ party_id: number }>('SELECT party_id FROM candidacy WHERE contest_id = ? ORDER BY ballot_order, candidacy_id', [c.contest_id]).map((r) => r.party_id);
    const di = order.indexOf(PARTY_D), ri = order.indexOf(PARTY_R);
    let entry = rolls.get(`${c.election_id}:${c.state_idx}`)?.contests.find((x) => x.id === c.contest_id);
    if (c.status === 'counting') {
      // The count so far (never the sealed cast ballots).
      const g = await liveGeo(u, c.contest_id); if (!g) continue;
      entry = { id: c.contest_id, k: order.length + 1, counties: [...g.counties], cds: [...g.cds] }; counting = true;
    }
    if (!entry) continue;
    const addTo = (i: number, v: number[]) => { if (i < 0 || i >= n || i === NONE16) return; has[i] = 1; if (di >= 0) D[i]! += v[di]!; if (ri >= 0) R[i]! += v[ri]!; };
    if (layer === 'state') { const t = entry.counties.reduce((a, [, v]) => a.map((x, j) => x + v[j]!), new Array<number>(order.length + 1).fill(0)); addTo(c.state_idx!, t); }
    else if (layer === 'county') for (const [cc, v] of entry.counties) addTo(cc, v);
    else for (const [cd, v] of entry.cds) addTo(cd, v);
    if (office === 'president') for (const [, v] of entry.counties) order.forEach((p, j) => national.set(p, (national.get(p) ?? 0) + v[j]!));
  }
  const values = Array.from({ length: n }, (_, i) => (has[i] && D[i]! + R[i]! > 0 ? Math.round(1000 * (D[i]! - R[i]!) / (D[i]! + R[i]!)) / 10 : has[i] ? 0 : null));
  let ev: ResultsMapDto['ev'] = null;
  if (office === 'president') {
    ev = u.db.all<{ party_id: number; ev: number; person_id: number }>('SELECT v.party_id, v.ev, v.person_id FROM electoral_vote v JOIN election e ON e.election_id = v.election_id WHERE e.year = ? ORDER BY v.ev DESC', [year])
      .map((r) => ({ party: r.party_id, ev: r.ev, name: fullName(w.persons.get(r.person_id)!) }));
  }
  return { year, office, layer, values, legend: counting ? 'Two-party margin (D+ / R+ points) of the votes counted so far (unofficial)' : 'Two-party margin (D+ / R+ points), archived results', national: office === 'president' ? [...national].map(([party, votes]) => ({ party, votes })).sort((a, b) => b.votes - a.votes) : null, ev };
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
    "SELECT c.contest_id, c.office_id, c.label, k.party_id FROM contest c JOIN candidacy k ON k.candidacy_id = c.winner_candidacy WHERE c.year = ? AND c.kind IN ('general','special') AND c.status IN ('decided','certified')", [year]);
  const holderAt = (officeId: number): number | null => held === null ? null : u.db.value<number>('SELECT party_id FROM office_term WHERE office_id = ? AND start_time <= ? AND (end_time IS NULL OR end_time > ?) ORDER BY start_time DESC LIMIT 1', [officeId, held, held]) ?? null;
  const flips: YearSummary['flips'] = [];
  const chambers: YearSummary['chambers'] = [];
  for (const [kind, label] of [['us_senator', 'U.S. Senate'], ['us_representative', 'U.S. House'], ['governor', 'Governors']] as const) {
    const offices = w.offices.filter((o) => o.kind === kind);
    const before = new Map<number, number>(), after = new Map<number, number>();
    for (const o of offices) {
      const b = holderAt(o.id) ?? 0; before.set(b, (before.get(b) ?? 0) + 1);
      const win = winners.find((x) => x.office_id === o.id);
      const a = win ? win.party_id : b; after.set(a, (after.get(a) ?? 0) + 1);
      if (win && win.party_id !== b && b !== 0) flips.push({ label: win.label, from: b, to: win.party_id, contestId: win.contest_id });
    }
    if (winners.some((x) => offices.some((o) => o.id === x.office_id))) chambers.push({ label, before: [...before].map(([party, seats]) => ({ party, seats })).sort((a, b) => a.party - b.party), after: [...after].map(([party, seats]) => ({ party, seats })).sort((a, b) => a.party - b.party) });
  }
  const t = u.db.get<{ b: number; e: number }>("SELECT SUM(t.ballots) b, SUM(t.eligible) e FROM election_turnout t JOIN election x ON x.election_id = t.election_id WHERE x.year = ? AND x.kind = 'general'", [year]);
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
