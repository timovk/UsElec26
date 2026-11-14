/**
 * County government queries (Phase 7.6): one county's elected offices and officeholders (its boards, its row
 * offices, the prosecutors' and public defenders' districts covering it, local news), and every state's summary.
 */
import { ageOn, daysToCivil, easternDay } from '../core/time';
import { fullName, PARTY_D, PARTY_R, type Office } from '../institutions/model';
import { COUNTY_2016, countySeatUp, isCityCounty, isCountyKind } from '../rules/county2016';
import { bodiesOf, circuitName, circuitsOf, countyInScope, countyOf, countyOfficeInScope, districtBoard } from './county';
import type { CountyGovernmentDto, CountyOverviewDto, CountySeatDto, NewsDto, PersonRef } from './protocol';
import type { Universe } from './universe';

/** County offices by county (−1: multi-county districts), cached per office list length. */
let index: { n: number; byCounty: Map<number, Office[]>; byCircuit: Map<string, Office[]> } | null = null;
function officesIndex(u: Universe): NonNullable<typeof index> {
  const w = u.world;
  if (index?.n === w.offices.length) return index;
  const byCounty = new Map<number, Office[]>(), byCircuit = new Map<string, Office[]>();
  for (const o of w.offices) {
    if (!isCountyKind(o.kind) || !o.seat) continue;
    const c = o.seat.county ?? -1;
    if (c >= 0) { const l = byCounty.get(c); if (l) l.push(o); else byCounty.set(c, [o]); }
    else { const k = `${o.stateIdx}|${o.seat.body}|${o.seat.district}`; const l = byCircuit.get(k); if (l) l.push(o); else byCircuit.set(k, [o]); }
  }
  index = { n: w.offices.length, byCounty, byCircuit };
  return index;
}

function seatDto(u: Universe, o: Office): CountySeatDto {
  const w = u.world, t = w.current.get(o.id), p = t ? w.persons.get(t.personId) : undefined;
  const today = easternDay(w.time), year = daysToCivil(today).y;
  let next: number | null = null;
  if (o.seat && countyOfficeInScope(w, o)) for (let y = year; y < year + 12; y++) if (countySeatUp(o.seat.cycle, o.seat.termYears, y)) { next = y; break; }
  const holder: PersonRef | null = p ? { id: p.id, name: fullName(p), party: t!.partyId ?? p.partyId, state: w.pack.states[p.homeState]?.usps ?? null, age: ageOn(p.birthDay, p.deathDay ?? today), dead: p.deathDay !== null } : null;
  return { officeId: o.id, title: o.title, kind: o.kind, district: o.seat?.district ?? 0, holder, since: t?.start ?? null, acquired: t?.acquired ?? null, nextElection: next, vacant: !t };
}

export function countyGovernment(u: Universe, county: number): CountyGovernmentDto {
  const w = u.world, pack = w.pack, c = pack.counties[county]!, st = pack.states[c.stateIdx]!;
  const cs = COUNTY_2016[st.usps];
  const idx = officesIndex(u);
  const mine = (idx.byCounty.get(county) ?? []).slice().sort((a, b) => a.rank - b.rank);
  const bodies: CountyGovernmentDto['bodies'] = [];
  for (const b of bodiesOf(pack, county)) {
    if (b.kind !== 'county_board' || b.seats <= 1) continue;
    const seats = mine.filter((o) => o.seat!.body === b.key).sort((a, b2) => a.seat!.number - b2.seat!.number).map((o) => seatDto(u, o));
    const byParty = new Map<number, number>(); for (const s of seats) if (s.holder) byParty.set(s.holder.party, (byParty.get(s.holder.party) ?? 0) + 1);
    // A county too small to split into the board's districts elects them countywide (as residency districts).
    const by = b.by === 'district' && districtBoard(pack, county)?.key !== b.key ? 'residency' : b.by;
    bodies.push({ key: b.key, name: b.name, by, term: b.term, seats, byParty: [...byParty].map(([party, n]) => ({ party, seats: n })).sort((a, b2) => b2.seats - a.seats) });
  }
  const inBody = new Set(bodies.flatMap((b) => b.seats.map((s) => s.officeId)));
  const offices = mine.filter((o) => !inBody.has(o.id)).map((o) => seatDto(u, o));
  const districtOffices: CountyGovernmentDto['districtOffices'] = [];
  for (const ci of circuitsOf(pack, c.stateIdx)) {
    const d = ci.plan.of.get(county); if (d === undefined) continue;
    for (const o of idx.byCircuit.get(`${c.stateIdx}|pros:${ci.key}|${d + 1}`) ?? []) districtOffices.push({ ...seatDto(u, o), district: d + 1, districtName: circuitName(ci, d) });
  }
  const note = cs?.none ?? (isCityCounty(st.usps, c) ? `${c.fullName} is a consolidated city-county or independent city: its governing body and chief executive are city government; its county offices are elected here.` : !bodies.length && !offices.length && !districtOffices.length ? `${c.fullName} has no county government of its own.` : null);
  const news = u.db.all<{ news_id: number; sim_time: number; kind: string; headline: string; body: string; refs_json: string }>(
    "SELECT * FROM news WHERE local = 1 AND json_extract(refs_json, '$.county') = ? ORDER BY news_id DESC LIMIT 15", [county])
    .map((r): NewsDto => ({ id: r.news_id, time: r.sim_time, kind: r.kind, headline: r.headline, body: r.body, personId: (JSON.parse(r.refs_json || '{}') as { personId?: number }).personId }));
  return { county, name: c.fullName, state: st.name, stateIdx: st.idx, scope: countyOf(w).scope, inScope: countyInScope(w, county), note, bodies, offices, districtOffices, news };
}

export function countyOverview(u: Universe): CountyOverviewDto {
  const w = u.world, pack = w.pack, idx = officesIndex(u);
  const tally = () => ({ d: 0, r: 0, other: 0 });
  const add = (t: { d: number; r: number; other: number }, party: number | null | undefined) => { if (party === PARTY_D) t.d++; else if (party === PARTY_R) t.r++; else if (party !== null && party !== undefined) t.other++; };
  const states: CountyOverviewDto['states'] = pack.states.map((s) => ({ stateIdx: s.idx, usps: s.usps, name: s.name, counties: 0, seats: 0, boards: { d: 0, r: 0, split: 0 }, executives: tally(), sheriffs: tally(), prosecutors: tally() }));
  for (const [county, offices] of idx.byCounty) {
    const st = states[pack.counties[county]!.stateIdx]!;
    const held = offices.filter((o) => countyOfficeInScope(w, o));
    if (!held.length) continue;
    st.counties++; st.seats += held.length;
    const board = held.filter((o) => o.kind === 'county_board' && (o.seat!.body === 'board' || o.seat!.body === 'council'));
    if (board.length) {
      let d = 0, r = 0; for (const o of board) { const p = w.current.get(o.id)?.partyId; if (p === PARTY_D) d++; else if (p === PARTY_R) r++; }
      if (2 * d > board.length) st.boards.d++; else if (2 * r > board.length) st.boards.r++; else st.boards.split++;
    }
    for (const o of held) {
      const p = w.current.get(o.id)?.partyId;
      if (o.kind === 'county_executive') add(st.executives, p); else if (o.kind === 'sheriff') add(st.sheriffs, p); else if (o.kind === 'prosecutor') add(st.prosecutors, p);
    }
  }
  for (const offices of idx.byCircuit.values()) for (const o of offices) {
    if (!countyOfficeInScope(w, o) || o.kind !== 'prosecutor') continue;
    const st = states[o.stateIdx!]!; st.seats++; add(st.prosecutors, w.current.get(o.id)?.partyId);
  }
  return { scope: countyOf(w).scope, states: states.filter((s) => s.seats > 0) };
}
