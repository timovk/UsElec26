/**
 * Phase 6 queries: the economy and presidential approval (published releases and polls; the simulation's
 * monthly truth is returned separately and labelled as such), Congress (bills and roll calls), the state
 * legislatures, the census and apportionment, and district plans. Read-only.
 */
import { decodeBundle } from '../core/codec';
import { ageOn, daysToCivil, easternDay, formatDay } from '../core/time';
import { NONE16 } from '../geo/pack';
import { fullName, PARTY_D, PARTY_R, type Office } from '../institutions/model';
import type { DistrictKind } from './districts';
import { sldLean } from './legislatures';
import { unitsPerMeter } from './census';
import type { BillDto, BillRowDto, CensusDto, CongressDto, DistrictMapDto, EconomyDto, ElectionLawDto, GovernmentQuery, LegislaturesDto, StateOfficesDto } from './protocol';
import { DOWNBALLOT_2016, bodyName, elected, seatUp, type BodyDef } from '../rules/downballot2016';
import { appointerText, legislatureName, seatBody } from './downballot';
import { describeLaw } from '../rules/electionLaw';
import type { Universe } from './universe';
import { leanMargin } from './world';
import { congressNumber } from './governmentEngine';

export async function runGovernmentQuery(u: Universe, q: GovernmentQuery): Promise<unknown> {
  switch (q.kind) {
    case 'economy': return economy(u);
    case 'congress': return congress(u, q.congress);
    case 'bill': return bill(u, q.id);
    case 'legislatures': return legislatures(u);
    case 'census': return census(u);
    case 'districtMap': return districtMap(u, q.state, q.plan, q.year);
    case 'electionLaw': return electionLaw(u);
    case 'stateOffices': return stateOffices(u, q.state);
  }
}

const today = (u: Universe) => easternDay(u.world.time);
const MONTH0 = (day: number) => { const c = daysToCivil(day); return (c.y - 2016) * 12 + (c.m - 1); };

function economy(u: Universe): EconomyDto {
  const now = u.world.time, day = today(u), w = u.world;
  const releases = u.db.all<{ sim_time: number; kind: string; period: string; value: number }>('SELECT sim_time, kind, period, value FROM economic_release WHERE sim_time <= ? ORDER BY sim_time', [now])
    .map((r) => ({ time: r.sim_time, kind: r.kind, period: r.period, value: r.value }));
  const polls = u.db.all<{ field_end: number; short: string; approve: number; disapprove: number; n: number }>(
    "SELECT a.field_end, p.short, a.approve, a.disapprove, a.n FROM approval_poll a JOIN pollster p ON p.pollster_id = a.pollster_id WHERE a.published <= ? AND a.subject = 'president' ORDER BY a.field_end", [now]);
  // A published average every week: polls of the last 60 days, weighted by recency (two-week decay) and √n.
  const approvalAverage: { day: number; approve: number }[] = [];
  if (polls.length) {
    let j0 = 0;
    for (let d = polls[0]!.field_end + 14; d <= day; d += 7) {
      while (j0 < polls.length && polls[j0]!.field_end < d - 60) j0++;
      let s = 0, wt = 0;
      for (let j = j0; j < polls.length && polls[j]!.field_end <= d; j++) { const p = polls[j]!; const x = Math.exp(-(d - p.field_end) / 14) * Math.sqrt(p.n); s += x * p.approve; wt += x; }
      if (wt > 0) approvalAverage.push({ day: d, approve: Math.round(10 * s / wt) / 10 });
    }
  }
  const presO = w.offices.find((o) => o.kind === 'president')!, t = w.current.get(presO.id), p = t ? w.persons.get(t.personId) : undefined;
  const thisMonth = MONTH0(day);
  const truth = u.db.all<{ month: number; truth_json: string; approval_json: string }>('SELECT month, truth_json, approval_json FROM economy_month WHERE month <= ? ORDER BY month', [thisMonth]).map((r) => {
    const e = JSON.parse(r.truth_json) as { recession: boolean; gdp: number; unemployment: number; inflation: number };
    const a = JSON.parse(r.approval_json) as { approve: number; copartisans: number; opponents: number };
    return { month: r.month, approve: a.approve, copartisans: a.copartisans, opponents: a.opponents, recession: e.recession, unemployment: e.unemployment, gdp: e.gdp, inflation: e.inflation };
  });
  return {
    releases,
    approvalPolls: polls.map((r) => ({ day: r.field_end, pollster: r.short, approve: r.approve, disapprove: r.disapprove, n: r.n })),
    approvalAverage,
    president: p && t ? { name: fullName(p), party: t.partyId ?? p.partyId, since: t.start } : null,
    truth,
  };
}

interface BillRow { bill_id: number; congress: number; title: string; topic: string; introduced: number; sponsor_party: number; status: string; enacted_time: number | null; salience: number; reconciliation: number }
const tally = (rolls: { chamber: string; yea: number; nay: number; question: string }[], chamber: string) => {
  const r = rolls.filter((x) => x.chamber === chamber && !x.question.startsWith('On overriding')).pop();
  return r ? `${r.yea}–${r.nay}` : null;
};
const billRow = (b: BillRow, rolls: { chamber: string; yea: number; nay: number; question: string }[]): BillRowDto => ({
  id: b.bill_id, congress: b.congress, title: b.title, topic: b.topic, introduced: b.introduced, sponsorParty: b.sponsor_party, status: b.status, enacted: b.enacted_time,
  house: tally(rolls, 'house'), senate: tally(rolls, 'senate'),
});

function congress(u: Universe, which?: number): CongressDto {
  // A Congress convenes on January 3 of odd years: before that, the previous one is still sitting.
  const w = u.world, c0 = daysToCivil(today(u)), current = congressNumber(c0.y % 2 === 1 && c0.m === 1 && c0.d < 3 ? c0.y - 1 : c0.y);
  const congresses = [...new Set([current, ...u.db.all<{ congress: number }>('SELECT DISTINCT congress FROM bill').map((r) => r.congress), ...u.db.all<{ congress: number }>('SELECT DISTINCT congress FROM congress_year').map((r) => r.congress)])].sort((a, b) => b - a);
  const c = which ?? current;
  const rows = u.db.all<BillRow>('SELECT bill_id, congress, title, topic, introduced, sponsor_party, status, enacted_time, salience, reconciliation FROM bill WHERE congress = ? AND introduced <= ? ORDER BY introduced', [c, w.time]);
  const rolls = new Map<number, { chamber: string; yea: number; nay: number; question: string }[]>();
  for (const r of u.db.all<{ bill_id: number; chamber: string; yea: number; nay: number; question: string }>('SELECT r.bill_id, r.chamber, r.yea, r.nay, r.question FROM roll_call r JOIN bill b ON b.bill_id = r.bill_id WHERE b.congress = ? AND r.sim_time <= ? ORDER BY r.sim_time', [c, w.time])) {
    const l = rolls.get(r.bill_id) ?? []; l.push(r); rolls.set(r.bill_id, l);
  }
  const years = u.db.all<{ year: number; congress: number; minor_laws: number; major_laws: number; vetoes: number; overrides: number; summary_json: string }>('SELECT * FROM congress_year ORDER BY year').map((r) => {
    const s = JSON.parse(r.summary_json) as { unified: boolean; houseMajority: number; senateMajority: number };
    return { year: r.year, congress: r.congress, minor: r.minor_laws, major: r.major_laws, vetoes: r.vetoes, overrides: r.overrides, unified: s.unified, houseMajority: s.houseMajority, senateMajority: s.senateMajority };
  });
  const chambers = w.chambers.filter((x) => x.kind === 'us_house' || x.kind === 'us_senate').map((x) => ({ name: x.name, seats: x.seats, composition: [...x.composition].map(([party, seats]) => ({ party, seats })).sort((a, b) => a.party - b.party) }));
  return { congress: c, congresses, bills: rows.map((b) => billRow(b, rolls.get(b.bill_id) ?? [])).reverse(), years, chambers };
}

async function bill(u: Universe, id: number): Promise<BillDto | null> {
  const b = u.db.get<BillRow>('SELECT bill_id, congress, title, topic, introduced, sponsor_party, status, enacted_time, salience, reconciliation FROM bill WHERE bill_id = ? AND introduced <= ?', [id, u.world.time]);
  if (!b) return null;
  const rolls = u.db.all<{ chamber: string; sim_time: number; question: string; yea: number; nay: number; passed: number; votes: Uint8Array }>('SELECT chamber, sim_time, question, yea, nay, passed, votes FROM roll_call WHERE bill_id = ? AND sim_time <= ? ORDER BY sim_time', [id, u.world.time]);
  const out: BillDto['rollCalls'] = [];
  for (const r of rolls) {
    // Each member's party at the time of the vote (their term in the chamber then).
    const kind = r.chamber === 'house' ? 'us_representative' : 'us_senator';
    const party = new Map(u.db.all<{ person_id: number; party_id: number | null }>('SELECT t.person_id, t.party_id FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE o.kind = ? AND t.start_time <= ? AND (t.end_time IS NULL OR t.end_time >= ?)', [kind, r.sim_time, r.sim_time]).map((x) => [x.person_id, x.party_id ?? 0]));
    const { arrays } = await decodeBundle(r.votes);
    const by = new Map<number, { yea: number; nay: number }>();
    const add = (ids: ArrayLike<number>, yea: boolean) => { for (let i = 0; i < ids.length; i++) { const p = party.get(ids[i]!) ?? u.world.persons.get(ids[i]!)?.partyId ?? 0; const e = by.get(p) ?? { yea: 0, nay: 0 }; if (yea) e.yea++; else e.nay++; by.set(p, e); } };
    add(arrays.yea ?? [], true); add(arrays.nay ?? [], false);
    out.push({ chamber: r.chamber, time: r.sim_time, question: r.question, yea: r.yea, nay: r.nay, passed: !!r.passed, byParty: [...by].map(([p, v]) => ({ party: p, ...v })).sort((a, c) => a.party - c.party) });
  }
  return { ...billRow(b, out), salience: b.salience, reconciliation: !!b.reconciliation, rollCalls: out };
}

function legislatures(u: Universe): LegislaturesDto {
  const w = u.world;
  const sessions = new Map<number, { year: number; laws: number; vetoes: number; budgetLate: boolean }>();
  for (const r of u.db.all<{ year: number; state_idx: number; laws: number; vetoes: number; budget_late: number }>('SELECT year, state_idx, laws, vetoes, budget_late FROM state_session WHERE year = (SELECT MAX(year) FROM state_session)')) sessions.set(r.state_idx, { year: r.year, laws: r.laws, vetoes: r.vetoes, budgetLate: !!r.budget_late });
  const totals = { dChambers: 0, rChambers: 0, split: 0, dTrifectas: 0, rTrifectas: 0, dLegislators: 0, rLegislators: 0, others: 0 };
  // The District of Columbia has a council, not a legislature: only states with chambers are listed.
  const withChambers = new Set(w.chambers.filter((c) => c.kind === 'state_upper' || c.kind === 'state_lower').map((c) => c.stateIdx));
  const states = w.pack.states.filter((st) => withChambers.has(st.idx)).map((st) => {
    const gov = w.offices.find((o) => o.kind === 'governor' && o.stateIdx === st.idx);
    const governorParty = gov ? w.current.get(gov.id)?.partyId ?? null : null;
    const chambers = w.chambers.filter((c) => (c.kind === 'state_upper' || c.kind === 'state_lower') && c.stateIdx === st.idx).sort((a, b) => (a.kind === 'state_upper' ? 0 : 1) - (b.kind === 'state_upper' ? 0 : 1)).map((c) => {
      const comp = [...c.composition].map(([party, seats]) => ({ party, seats })).filter((x) => x.seats > 0).sort((a, b) => a.party - b.party);
      const d = c.composition.get(PARTY_D) ?? 0, r = c.composition.get(PARTY_R) ?? 0;
      // Nebraska's unicameral legislature is officially nonpartisan; its members still carry a party here.
      const majority = 2 * d > c.seats ? PARTY_D : 2 * r > c.seats ? PARTY_R : null;
      if (majority === PARTY_D) totals.dChambers++; else if (majority === PARTY_R) totals.rChambers++; else totals.split++;
      totals.dLegislators += d; totals.rLegislators += r; totals.others += c.seats - d - r;
      return { name: c.name, kind: c.kind, seats: c.seats, composition: comp, majority };
    });
    const trifecta = governorParty !== null && chambers.length > 0 && chambers.every((c) => c.majority === governorParty) ? governorParty : null;
    if (trifecta === PARTY_D) totals.dTrifectas++; else if (trifecta === PARTY_R) totals.rTrifectas++;
    return { stateIdx: st.idx, usps: st.usps, name: st.name, governorParty, chambers, trifecta, session: sessions.get(st.idx) ?? null };
  });
  return { states, totals };
}

function census(u: Universe): CensusDto {
  const w = u.world, pack = w.pack;
  const rows = u.db.all<{ census_year: number; state_idx: number; population: number; seats: number | null; priority_json: string | null }>('SELECT census_year, state_idx, population, seats, priority_json FROM census ORDER BY census_year, state_idx');
  const years = [...new Set(rows.map((r) => r.census_year))];
  // Seats before the first simulated census: the 2010 apportionment (the 2016 pack's districts).
  let prevSeats = pack.states.map((s) => pack.cds.filter((c) => c.stateIdx === s.idx).length);
  const censuses = years.map((y) => {
    const rs = rows.filter((r) => r.census_year === y);
    let last: { state: number; seat: number; value: number } | null = null, next: { state: number; seat: number; value: number } | null = null;
    for (const r of rs) for (const p of (r.priority_json ? JSON.parse(r.priority_json) : []) as { seat: number; value: number }[]) {
      if (p.value > 0 && (!last || p.value < last.value)) last = { state: r.state_idx, ...p };
      if (p.value < 0 && (!next || -p.value > -next.value)) next = { state: r.state_idx, ...p };
    }
    const states = rs.map((r) => ({ stateIdx: r.state_idx, usps: pack.states[r.state_idx]!.usps, name: pack.states[r.state_idx]!.name, population: r.population, seats: r.seats, change: r.seats === null ? null : r.seats - prevSeats[r.state_idx]! }));
    if (rs.every((r) => r.seats !== null)) prevSeats = pack.states.map((s) => rs.find((r) => r.state_idx === s.idx)?.seats ?? prevSeats[s.idx]!);
    const name = (x: { state: number; seat: number } | null) => (x ? `${pack.states[x.state]!.usps} (seat ${x.seat})` : null);
    return { year: y, total: rs.reduce((a, r) => a + r.population, 0), states, lastSeat: name(last), nextInLine: name(next) };
  }).reverse();
  const demography = u.db.all<{ year: number; summary_json: string }>('SELECT year, summary_json FROM demography_year ORDER BY year').map((r) => {
    const s = JSON.parse(r.summary_json) as { adults: number; total: number; age: number[]; race: number[]; college: number };
    return { year: r.year, adults: Math.round(s.adults), total: Math.round(s.total), age65: s.age[3] ?? 0, white: s.race[0] ?? 0, hispanic: s.race[2] ?? 0, college: s.college };
  });
  const plans = u.db.all<{ plan_id: number; kind: string; state_idx: number; first_year: number; stats_json: string }>('SELECT plan_id, kind, state_idx, first_year, stats_json FROM district_plan ORDER BY first_year DESC, kind, state_idx').map((r) => {
    const s = JSON.parse(r.stats_json) as { populations?: number[]; maxDeviation: number; countiesSplit: number; contiguous: boolean };
    return { planId: r.plan_id, kind: r.kind, stateIdx: r.state_idx, usps: pack.states[r.state_idx]!.usps, firstYear: r.first_year, districts: s.populations?.length ?? 0, maxDeviation: s.maxDeviation, countiesSplit: s.countiesSplit, contiguous: s.contiguous };
  });
  return { censuses, demography, plans };
}

const MEMBER: Record<DistrictKind, Office['kind']> = { cd: 'us_representative', sldu: 'state_senator', sldl: 'state_representative' };

function districtMap(u: Universe, state: number, plan: DistrictKind, year: number): DistrictMapDto | null {
  const w = u.world, pack = w.pack, D = w.districts;
  const counties = pack.counties.filter((c) => c.stateIdx === state);
  if (!counties.length) return null;
  const list = D.districtsOf(plan, state, year);
  if (!list.length) return null;
  const local = new Map(list.map((d, i) => [d.idx, i]));
  const asg = D.assignment(plan, year);
  const b0 = counties[0]!.buStart, b1 = counties[counties.length - 1]!.buStart + counties[counties.length - 1]!.buCount;
  // Coordinates are the basemap's projection (y down); unit sizes are converted to the same units.
  const upm = unitsPerMeter(pack, b0, b1);
  const x: number[] = [], y: number[] = [], side: number[] = [], district: number[] = [];
  for (let b = b0; b < b1; b++) {
    const k = asg[b]!; if (k === NONE16) continue;
    const l = local.get(k); if (l === undefined) continue;
    x.push(Math.round(100 * pack.bu.x[b]!) / 100); y.push(Math.round(100 * pack.bu.y[b]!) / 100); side.push(Math.round(1e4 * upm * Math.sqrt(pack.bu.landM2[b]!)) / 1e4); district.push(l);
  }
  // Holders: offices keep their seat numbers across plans.
  const table = D.table(plan), byNumber = new Map<number, number[]>();
  for (const o of w.offices) {
    if (o.kind !== MEMBER[plan] || o.stateIdx !== state || o.districtIdx === null) continue;
    if (D.isAbolished(o.id, year)) continue;
    const t = w.current.get(o.id); const n = table[o.districtIdx]?.number; if (n === undefined) continue;
    const l = byNumber.get(n) ?? []; if (t) l.push(t.partyId ?? 0); byNumber.set(n, l);
  }
  const lean = plan === 'cd' ? null : sldLean(w, plan, asg);
  const first = u.db.get<{ census_year: number; first_year: number }>('SELECT census_year, first_year FROM district_plan WHERE plan_id = ?', [list[0]!.planId]);
  const planLabel = first ? `Drawn after the ${first.census_year} census, in effect from ${first.first_year}` : 'The 2016 plan (drawn after the 2010 census)';
  return {
    state, plan, year, planLabel, x, y, side, district,
    districts: list.map((d, i) => {
      const parties = byNumber.get(d.number) ?? [];
      const dn = parties.filter((p) => p === PARTY_D).length, rn = parties.filter((p) => p === PARTY_R).length;
      return {
        idx: i, label: plan === 'cd' ? d.code ?? String(d.number) : `${d.number}${d.seats > 1 ? ` (${d.seats} seats)` : ''}`, population: d.pop2010,
        holderParty: parties.length ? (dn > rn ? PARTY_D : rn > dn ? PARTY_R : parties[0]!) : null,
        lean: Math.round(10 * (plan === 'cd' ? leanMargin(w.lean.cd, d.idx) : lean![d.idx] ?? 0)) / 10,
      };
    }),
  };
}

/** Election law: what each state's elections follow today, and the dated changes made in this universe. */
function electionLaw(u: Universe): ElectionLawDto {
  const w = u.world, day = today(u);
  const changes = w.law.history();
  return {
    states: w.pack.states.map((s) => ({ stateIdx: s.idx, usps: s.usps, name: s.name, rules: describeLaw(w.law.on(s.idx, day)), changed: changes.some((c) => c.stateIdx === s.idx && c.effective <= day) })),
    changes: [...changes].reverse().map((c) => ({ stateIdx: c.stateIdx, usps: w.pack.states[c.stateIdx]!.usps, name: w.pack.states[c.stateIdx]!.name, enacted: c.enacted,
      effective: formatDay(c.effective, true), source: c.source, summary: c.summary, inForce: c.effective <= day })),
  };
}

/** How a body's members are chosen, in words. */
export function selectionText(b: BodyDef, usps: string): string {
  const leg = legislatureName(usps);
  switch (b.selection) {
    case 'partisan': return b.noPrimary ? 'Partisan elections (nominees chosen by party convention)' : 'Partisan elections';
    case 'party_np': return 'Party nominees on a ballot without party labels';
    case 'nonpartisan': return b.spring ? 'Nonpartisan elections in the spring' : b.np === 'majority' ? 'Nonpartisan elections (a majority on primary day wins outright)' : b.np === 'final' ? 'Nonpartisan elections, decided on primary day' : b.np === 'runoff' ? 'Nonpartisan elections (a runoff without a majority)' : 'Nonpartisan elections';
    case 'retention': return `Appointed by ${appointerText(b, leg)}; then yes/no retention elections${b.retention && b.retention !== 0.5 ? ` (${Math.round(100 * b.retention)}% yes needed)` : ''}`;
    case 'partisan_retention': return `Partisan election to a first term; retention elections after (${Math.round(100 * (b.retention ?? 0.5))}% yes needed)`;
    case 'appointed': return `Appointed by ${appointerText(b, leg)}`;
    case 'legislature': return `Elected by the ${leg}`;
  }
}

function stateOffices(u: Universe, state?: number): StateOfficesDto {
  const w = u.world, day = today(u), year = daysToCivil(day).y;
  const stateIdx = state ?? w.pack.states.find((s) => s.usps === 'TX')?.idx ?? 0;
  const st = w.pack.states[stateIdx]!;
  const groupOf = (b: BodyDef): 'executive' | 'boards' | 'courts' => (b.kind === 'justice' || b.kind === 'appellate_judge' ? 'courts' : b.seats > 1 || b.kind === 'commissioner' || b.kind === 'education_board' || b.kind === 'regent' ? 'boards' : 'executive');
  const comp = (offs: { party: number | null }[]) => { const m = new Map<number, number>(); for (const x of offs) m.set(x.party ?? 0, (m.get(x.party ?? 0) ?? 0) + 1); return [...m].map(([party, seats]) => ({ party, seats })).sort((a, b) => b.seats - a.seats || a.party - b.party); };
  const nextUp = (o: { seat?: { cycle: number; termYears: number } }, b: BodyDef): string | null => {
    if (!o.seat || o.seat.termYears <= 0) return b.retireAt ? `serves to age ${b.retireAt}` : 'life tenure';
    for (let y = year; y < year + 16; y++) if (seatUp(o.seat.cycle, o.seat.termYears, y)) return elected(b) ? `${y}` : `term ends ${y}`;
    return null;
  };
  const bodies = (DOWNBALLOT_2016[st.usps] ?? []).map((b) => {
    const offs = w.offices.filter((o) => o.stateIdx === stateIdx && o.seat?.body === b.key && seatBody(w, o) === b);
    const members = offs.map((o) => {
      const t = w.current.get(o.id), p = t ? w.persons.get(t.personId) : undefined;
      const seat = b.seats === 1 ? '' : `${b.districts ? (o.seat!.district ? `District ${o.seat!.district}` : 'At large') : `Seat ${o.seat!.number}`}${b.districts && (b.perDistrict?.some((n) => n > 1)) ? `, seat ${o.seat!.number}` : ''}`;
      return { officeId: o.id, title: o.title, seat, personId: p?.id ?? null, name: p ? fullName(p) : null, party: t?.partyId ?? null, since: t?.start ?? null, acquired: t?.acquired ?? null, next: nextUp(o, b), age: p ? ageOn(p.birthDay, day) : null };
    });
    const notes: string[] = [];
    if (b.termYears > 0) notes.push(`${b.termYears}-year terms`);
    if (b.retireAt) notes.push(`mandatory retirement at ${b.retireAt}`);
    if (b.districts) notes.push(`${b.districts} districts${b.atLarge ? ` and ${b.atLarge} at large` : ''} (drawn by the simulation)`);
    if (b.spring) notes.push('elected in April');
    return { key: b.key, name: bodyName(b, st.name), group: groupOf(b), selection: selectionText(b, st.usps), seats: b.seats, termYears: b.termYears, notes, composition: comp(members), members };
  });
  const summary = w.pack.states.map((s) => {
    const defs = DOWNBALLOT_2016[s.usps] ?? [];
    const sc = defs.find((b) => b.key === 'supreme');
    const seats = (pred: (b: BodyDef) => boolean) => comp(w.offices.filter((o) => o.stateIdx === s.idx && o.seat && pred(seatBody(w, o)!)).map((o) => ({ party: w.current.get(o.id)?.partyId ?? null })));
    return { stateIdx: s.idx, usps: s.usps, name: s.name, court: seats((b) => b.kind === 'justice'), courtSelection: sc ? selectionText(sc, s.usps) : '—', executive: seats((b) => groupOf(b) === 'executive') };
  }).filter((x) => x.court.length || x.executive.length);
  return { stateIdx, states: w.pack.states.filter((s) => DOWNBALLOT_2016[s.usps]?.length).map((s) => ({ stateIdx: s.idx, usps: s.usps, name: s.name })), bodies, summary };
}
