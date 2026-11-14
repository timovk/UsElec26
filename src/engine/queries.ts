/** Read-only queries over the universe (never mutate). Every number comes from simulation state. */
import { OFFICE_LABEL } from '../institutions/offices';
import { ageOn, easternDay, formatDay, isoDay } from '../core/time';
import { fullName, PARTY_D, PARTY_R, type Office, type Person } from '../institutions/model';
import { NONE16 } from '../geo/pack';
import { N_COHORTS, cohortLabel } from '../population/cohorts';
import { ISSUE_AXES, TARGET_RANGES, cellLookup } from '../electorate/model';
import { isUnit, unitNames, unitStates } from '../geo/reportingUnits';
import { leanMargin } from './world';
import type { Universe } from './universe';
import { runArchiveQuery } from './archiveQueries';
import { runNightQuery } from './nightQueries';
import { runSeasonQuery } from './seasonQueries';
import { runGovernmentQuery } from './governmentQueries';
import type {
  CalendarEntry, ChamberDto, DeskSummary, ElectorateSummary, EntityDetail, GeoMeta, MapLayerDto, NewsDto, OfficeHolderDto, PersonDetail, PersonRef, PersonRow, Query,
} from './protocol';

export function runQuery(u: Universe, q: Query): unknown {
  switch (q.kind) {
    case 'electionYears': case 'elections': case 'contest': case 'countyHistory': case 'townHistory': case 'districtHistory': case 'stateHistory': case 'measures': case 'resultsMap': case 'yearSummary': case 'audit': return runArchiveQuery(u, q);
    case 'nights': case 'nightMeta': case 'nightPayload': case 'nightContext': case 'nightBaseline': case 'nightSurvey': case 'nightCalls': case 'nightLocal': return runNightQuery(u, q);
    case 'seasonYears': case 'seasonOverview': case 'seasonRace': case 'pollList': case 'pollster': case 'forecastRun': case 'forecastCalibration': case 'primaries': return runSeasonQuery(u, q);
    case 'economy': case 'congress': case 'bill': case 'legislatures': case 'census': case 'districtMap': case 'electionLaw': case 'stateOffices': case 'countyGovernment': case 'countyOverview': return runGovernmentQuery(u, q);
    case 'desk': return desk(u);
    case 'geoMeta': return geoMeta(u);
    case 'mapLayer': return mapLayer(u, q.layer, q.metric);
    case 'entity': return entity(u, q.layer, q.idx);
    case 'people': return people(u, q);
    case 'person': return person(u, q.id);
    case 'news': return news(u, q.limit ?? 50, q.beforeId);
    case 'calendar': return calendar(u);
    case 'electorate': return electorate(u);
    default: {
      // Every query kind is routed above: a new kind left out is a compile error here.
      const missing: never = q;
      throw new Error(`Unknown query: ${(missing as { kind: string }).kind}`);
    }
  }
}

const today = (u: Universe) => easternDay(u.world.time);

function ref(u: Universe, p: Person): PersonRef {
  return { id: p.id, name: fullName(p), party: p.partyId, state: u.world.pack.states[p.homeState]?.usps ?? null, age: ageOn(p.birthDay, p.deathDay ?? today(u)), dead: p.deathDay !== null };
}

export function holder(u: Universe, o: Office): OfficeHolderDto {
  const t = u.world.current.get(o.id);
  const v = u.world.vacancies.get(o.id);
  const p = t ? u.world.persons.get(t.personId) : undefined;
  return { officeId: o.id, title: o.title, kind: o.kind, holder: p ? ref(u, p) : null, since: t?.start ?? null, acquired: t?.acquired ?? null,
    vacancy: v ? { since: v.since, reason: v.reason, resolution: v.resolution } : null };
}

function chamberDto(u: Universe, kind: 'us_senate' | 'us_house'): ChamberDto {
  const c = u.world.chambers.find((x) => x.kind === kind)!;
  const comp = [...c.composition].map(([party, seats]) => ({ party, seats })).sort((a, b) => a.party - b.party);
  const d = c.composition.get(PARTY_D) ?? 0, r = c.composition.get(PARTY_R) ?? 0;
  let majority: number | null = d > r ? PARTY_D : r > d ? PARTY_R : null;
  if (kind === 'us_senate' && majority === null) {
    const vp = u.world.offices.find((o) => o.kind === 'vice_president')!;
    majority = u.world.current.get(vp.id)?.partyId ?? null; // VP breaks ties
  }
  return { id: c.id, name: c.name, kind, stateUsps: null, seats: c.seats, composition: comp, majority, provenance: c.compositionProvenance, asOf: c.compositionAsOf };
}

function desk(u: Universe): DeskSummary {
  const w = u.world;
  const byKind = (k: string) => w.offices.filter((o) => o.kind === k).sort((a, b) => a.rank - b.rank);
  const gov = { D: 0, R: 0, other: 0, vacant: 0 };
  for (const o of byKind('governor')) { const t = w.current.get(o.id); if (!t) gov.vacant++; else if (t.partyId === PARTY_D) gov.D++; else if (t.partyId === PARTY_R) gov.R++; else gov.other++; }
  const leg = { dControlled: 0, rControlled: 0, split: 0, total: 0, dSeats: 0, rSeats: 0, otherSeats: 0 };
  w.pack.states.forEach((_, s) => {
    const chambers = w.chambers.filter((c) => c.stateIdx === s && c.kind.startsWith('state'));
    if (!chambers.length) return;
    leg.total++;
    const ctl = chambers.map((c) => { const d = c.composition.get(PARTY_D) ?? 0, r = c.composition.get(PARTY_R) ?? 0; leg.dSeats += d; leg.rSeats += r; leg.otherSeats += c.seats - d - r; return d > r ? 'D' : r > d ? 'R' : 'T'; });
    if (ctl.every((x) => x === 'D')) leg.dControlled++; else if (ctl.every((x) => x === 'R')) leg.rControlled++; else leg.split++;
  });
  return {
    universe: { id: u.id, name: w.name, seed: w.seed, time: w.time, startTime: w.startTime },
    parties: w.parties.map((p) => ({ id: p.id, name: p.name, short: p.short, abbrev: p.abbrev, color: p.color })),
    executive: [...byKind('president'), ...byKind('vice_president'), ...byKind('cabinet')].map((o) => holder(u, o)),
    congressLeaders: byKind('congress_leader').map((o) => holder(u, o)),
    senate: chamberDto(u, 'us_senate'), house: chamberDto(u, 'us_house'),
    governors: gov, legislatures: leg,
    vacancies: [...w.vacancies.keys()].map((id) => holder(u, w.officeById.get(id)!)).sort((a, b) => a.title.localeCompare(b.title)),
    presidentTermNumber: w.history.presidentTermNumber,
    nationalLean: leanMargin({ dVotes: Float64Array.of(w.lean.national.d), votes: Float64Array.of(w.lean.national.t) }, 0),
    electorateNote: 'Underlying partisan lean of the electorate under neutral conditions (simulation truth, not a poll or result).',
  };
}

function geoMeta(u: Universe): GeoMeta {
  const p = u.world.pack;
  return {
    packVersion: p.version,
    states: p.states.map((s) => ({ idx: s.idx, usps: s.usps, name: s.name, fips: s.fips })),
    counties: p.counties.map((c) => ({ idx: c.idx, geoid: c.geoid, name: c.fullName, stateIdx: c.stateIdx, legalType: c.legalType })),
    cds: p.cds.map((c) => ({ idx: c.idx, geoid: c.geoid, stateIdx: c.stateIdx, label: `${p.states[c.stateIdx]!.usps}-${c.district === 0 ? 'AL' : String(c.district).padStart(2, '0')}` })),
    units: p.rj.filter(isUnit).map((r) => ({ idx: r.idx, name: unitNames(p)[r.idx]!, kind: r.kind as 'town' | 'ak_house_district', stateIdx: r.stateIdx, countyIdx: r.countyIdx, pop: r.pop2010 })),
    unitOffset: p.counties.length,
    unitStates: [...unitStates(p)].sort((a, b) => a - b),
  };
}

const partyCode = (party: number | null | undefined): number | null => (party === PARTY_D ? 1 : party === PARTY_R ? -1 : party ? 0 : null);

/**
 * Sum a per-BU quantity over each reporting unit shown in place of counties (Phase 7.5), into `out` at the
 * unit's map area (`counties.length + rj`).
 */
function forUnitBus(u: Universe, f: (bu: number, area: number) => void): void {
  const w = u.world, units = unitStates(w.pack), off = w.pack.counties.length;
  for (const c of w.pack.counties) {
    if (!units.has(c.stateIdx)) continue;
    for (let b = c.buStart; b < c.buStart + c.buCount; b++) { const rj = w.pack.bu.rj[b]!; if (rj !== NONE16 && w.pack.rj[rj]?.kind !== 'county') f(b, off + rj); }
  }
}

function mapLayer(u: Universe, layer: MapDtoLayer, metric: MapLayerDto['metric']): MapLayerDto {
  const w = u.world;
  // The county layer also carries New England's towns and Alaska's districts, after the counties (Phase 7.5).
  const n = layer === 'state' ? w.pack.states.length : layer === 'county' ? w.pack.counties.length + w.pack.rj.length : w.pack.cds.length;
  const values: (number | null)[] = new Array(n).fill(null);
  if (metric === 'lean') {
    const l = layer === 'state' ? w.lean.state : layer === 'county' ? w.lean.county : w.lean.cd;
    const nl = layer === 'county' ? w.pack.counties.length : n;
    for (let i = 0; i < nl; i++) values[i] = l.votes[i]! > 0 ? Math.round(leanMargin(l, i) * 10) / 10 : null;
    if (layer === 'county') {
      const d = new Float64Array(n), t = new Float64Array(n);
      forUnitBus(u, (b, a) => { d[a]! += w.lean.bu.dVotes[b]!; t[a]! += w.lean.bu.votes[b]!; });
      for (let a = nl; a < n; a++) if (t[a]! > 0) values[a] = Math.round(1000 * (2 * d[a]! / t[a]! - 1)) / 10;
    }
    return { layer, metric, values, legend: `Underlying two-party lean (D+ / R+ points)${newPlanNote(u, layer)}`, provenance: 'simulationTruth' };
  }
  const off = w.pack.counties.length;
  const stateOf = (i: number) => (layer === 'state' ? i : layer === 'county' ? (i < off ? w.pack.counties[i]!.stateIdx : w.pack.rj[i - off]!.stateIdx) : w.pack.cds[i]!.stateIdx);
  if (metric === 'governor') {
    const byState = new Map(w.offices.filter((o) => o.kind === 'governor').map((o) => [o.stateIdx!, partyCode(w.current.get(o.id)?.partyId)]));
    for (let i = 0; i < n; i++) values[i] = byState.get(stateOf(i)) ?? null;
    return { layer, metric, values, legend: "Governor's party", provenance: 'publicRecord' };
  }
  if (metric === 'senate') {
    const sum = new Map<number, number>();
    for (const o of w.offices) if (o.kind === 'us_senator') sum.set(o.stateIdx!, (sum.get(o.stateIdx!) ?? 0) + (partyCode(w.current.get(o.id)?.partyId) ?? 0));
    for (let i = 0; i < n; i++) values[i] = sum.has(stateOf(i)) ? sum.get(stateOf(i))! / 2 : null;
    return { layer, metric, values, legend: 'U.S. Senate delegation (both D, split, both R)', provenance: 'publicRecord' };
  }
  // house: by CD directly; counties take the party of the CD holding most of their electorate
  const cdParty = w.pack.cds.map((cd) => { const o = w.offices.find((x) => x.kind === 'us_representative' && x.districtIdx === cd.idx); return o ? partyCode(w.current.get(o.id)?.partyId) : null; });
  if (layer === 'cd') { for (let i = 0; i < n; i++) values[i] = cdParty[i] ?? null; }
  else if (layer === 'county') {
    for (const c of w.pack.counties) {
      let sumP = 0, sumW = 0;
      for (let b = c.buStart; b < c.buStart + c.buCount; b++) { const k = w.pack.bu.cd[b]!; if (k === NONE16) continue; const pc = cdParty[k]; if (pc === null || pc === undefined) continue; sumP += pc * w.pop.vep[b]!; sumW += w.pop.vep[b]!; }
      values[c.idx] = sumW > 0 ? sumP / sumW : null;
    }
    const sp = new Float64Array(n), sw = new Float64Array(n);
    forUnitBus(u, (b, a) => { const k = w.pack.bu.cd[b]!; if (k === NONE16) return; const pc = cdParty[k]; if (pc === null || pc === undefined) return; sp[a]! += pc * w.pop.vep[b]!; sw[a]! += w.pop.vep[b]!; });
    for (let a = off; a < n; a++) if (sw[a]! > 0) values[a] = sp[a]! / sw[a]!;
  } else {
    w.pack.states.forEach((s) => { const ps = w.pack.cds.filter((c) => c.stateIdx === s.idx).map((c) => cdParty[c.idx] ?? 0); values[s.idx] = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null; });
  }
  return { layer, metric, values, legend: `U.S. House: share of the electorate represented by each party${newPlanNote(u, layer)}`, provenance: 'publicRecord' };
}
type MapDtoLayer = MapLayerDto['layer'];

function entity(u: Universe, layer: MapDtoLayer, idx: number): EntityDetail {
  const w = u.world;
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  const lean = (l: { dVotes: Float64Array; votes: Float64Array }, i: number) => { const m = leanMargin(l, i); return `${m >= 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(1)}`; };
  const officialsOf = (stateIdx: number, cds: number[]): OfficeHolderDto[] => w.offices
    .filter((o) => (o.stateIdx === stateIdx && ['us_senator', 'governor', 'lt_governor', 'attorney_general', 'secretary_of_state', 'treasurer', 'auditor', 'superintendent', 'insurance_commissioner', 'agriculture_commissioner', 'labor_commissioner', 'land_commissioner', 'other_statewide'].includes(o.kind)) || (o.kind === 'us_representative' && cds.includes(o.districtIdx!)))
    .sort((a, b) => a.rank - b.rank).map((o) => holder(u, o));
  if (layer === 'state') {
    const s = w.pack.states[idx]!;
    const cds = w.pack.cds.filter((c) => c.stateIdx === idx).map((c) => c.idx);
    const chambers = w.chambers.filter((c) => c.stateIdx === idx);
    return {
      layer, idx, title: s.name, subtitle: `${s.usps} · ${cds.length} congressional district${cds.length === 1 ? '' : 's'} (115th Congress)`,
      stats: [
        { label: 'Population (2016 est.)', value: fmt(s.pop2016) }, { label: 'Voting-eligible population', value: fmt(w.pop.stateVep[idx]!) },
        { label: 'Underlying lean', value: lean(w.lean.state, idx), provenance: 'simulation truth' },
        ...chambers.map((c) => ({ label: c.name, value: [...c.composition].sort((a, b) => a[0] - b[0]).map(([p, n]) => `${w.parties.find((x) => x.id === p)?.abbrev ?? 'Vacant'} ${n}`).join(' · ') })),
      ],
      officials: officialsOf(idx, cds),
    };
  }
  if (layer === 'county' && idx >= w.pack.counties.length) {
    // A New England town or an Alaska State House district (Phase 7.5): its area index follows the counties'.
    const rj = idx - w.pack.counties.length, r = w.pack.rj[rj]!;
    const cdSet = new Set<number>(); let vep = 0, d = 0, t = 0;
    forUnitBus(u, (b, a) => { if (a !== idx) return; vep += w.pop.vep[b]!; d += w.lean.bu.dVotes[b]!; t += w.lean.bu.votes[b]!; if (w.pack.bu.cd[b]! !== NONE16) cdSet.add(w.pack.bu.cd[b]!); });
    const st = w.pack.states[r.stateIdx]!, county = r.countyIdx !== null ? w.pack.counties[r.countyIdx]! : null;
    const m = t > 0 ? 100 * (2 * d / t - 1) : 0;
    return {
      layer, idx, title: r.kind === 'town' ? `${unitNames(w.pack)[rj]}, ${st.usps}` : `Alaska ${r.name}`,
      subtitle: r.kind === 'town' ? `Town · ${county?.fullName ?? st.name}` : 'State House district as of 2016: Alaska reports its results by these districts',
      stats: [
        { label: 'Population (2010)', value: fmt(r.pop2010) }, { label: 'Voting-eligible population', value: fmt(vep) },
        { label: 'Underlying lean', value: `${m >= 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(1)}`, provenance: 'simulation truth' },
        { label: 'Congressional districts', value: [...cdSet].map((k) => geoMeta(u).cds[k]!.label).join(', ') || '—' },
      ],
      officials: officialsOf(r.stateIdx, [...cdSet]),
    };
  }
  if (layer === 'county') {
    const c = w.pack.counties[idx]!;
    const cdSet = new Set<number>();
    for (let b = c.buStart; b < c.buStart + c.buCount; b++) if (w.pack.bu.cd[b]! !== NONE16) cdSet.add(w.pack.bu.cd[b]!);
    return {
      layer, idx, title: c.fullName, subtitle: `${w.pack.states[c.stateIdx]!.name} · ${c.legalType} · ${c.geoid}`,
      stats: [
        { label: 'Population (2016 est.)', value: fmt(c.pop2016) }, { label: 'Voting-eligible population', value: fmt(w.pop.countyVep[idx]!) },
        { label: 'Underlying lean', value: lean(w.lean.county, idx), provenance: 'simulation truth' },
        { label: 'Census block-group units', value: fmt(c.buCount) }, { label: 'Voting districts (2010)', value: fmt(c.vtdCount2010) },
        { label: 'Congressional districts', value: [...cdSet].map((k) => geoMeta(u).cds[k]!.label).join(', ') || '—' },
      ],
      officials: officialsOf(c.stateIdx, [...cdSet]),
    };
  }
  const cd = w.pack.cds[idx]!;
  const label = geoMeta(u).cds[idx]!.label;
  return {
    layer, idx, title: `${w.pack.states[cd.stateIdx]!.name} ${cd.district === 0 ? 'at-large district' : `District ${cd.district}`}`, subtitle: `${label} · 115th Congress boundaries`,
    stats: [{ label: 'Population (2010)', value: fmt(cd.pop2010) }, { label: 'Underlying lean', value: lean(w.lean.cd, idx), provenance: 'simulation truth' }],
    officials: officialsOf(cd.stateIdx, [idx]).filter((o) => o.kind === 'us_representative' || o.kind === 'us_senator'),
  };
}

function people(u: Universe, q: Extract<Query, { kind: 'people' }>): { total: number; rows: PersonRow[] } {
  const s = q.search?.trim().toLowerCase();
  const rows: PersonRow[] = [];
  const officeKinds = q.office ? new Set(q.office.split(',')) : null;
  const holders = new Map<number, Office>(), matching = new Set<number>();
  for (const t of u.world.current.values()) {
    const o = u.world.officeById.get(t.officeId)!; const prev = holders.get(t.personId); if (!prev || o.rank < prev.rank) holders.set(t.personId, o);
    if (officeKinds?.has(o.kind)) matching.add(t.personId);
  }
  for (const p of u.world.persons.values()) {
    const o = holders.get(p.id) ?? null;
    if (officeKinds && !matching.has(p.id)) continue;
    if (q.party && p.partyId !== q.party) continue;
    if (q.state !== undefined && p.homeState !== q.state) continue;
    const name = fullName(p);
    if (s && !(name.toLowerCase().includes(s) || (o?.title.toLowerCase().includes(s) ?? false))) continue;
    rows.push({ id: p.id, name, party: p.partyId, stateUsps: u.world.pack.states[p.homeState]?.usps ?? null, office: o?.title ?? null, age: ageOn(p.birthDay, p.deathDay ?? today(u)), tier: p.tier, dead: p.deathDay !== null });
  }
  rows.sort((a, b) => (a.office ? 0 : 1) - (b.office ? 0 : 1) || (holders.get(a.id)?.rank ?? 1e9) - (holders.get(b.id)?.rank ?? 1e9) || a.name.localeCompare(b.name));
  const off = q.offset ?? 0, lim = q.limit ?? 200;
  return { total: rows.length, rows: rows.slice(off, off + lim) };
}

function person(u: Universe, id: number): PersonDetail | null {
  const w = u.world; const p = w.persons.get(id); if (!p) return null;
  const terms = u.db.all<{ title: string; start_time: number; end_time: number | null; acquired: string; end_reason: string | null; provenance: string }>(
    'SELECT o.title, t.start_time, t.end_time, t.acquired, t.end_reason, t.provenance FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE t.person_id = ? ORDER BY t.start_time, t.term_id', [id]);
  const pend = w.pending.terms.filter((t) => t.personId === id).map((t) => ({ title: w.officeById.get(t.officeId)!.title, start_time: t.start, end_time: t.end, acquired: t.acquired, end_reason: t.endReason, provenance: t.provenance }));
  const career = u.db.all<{ year_from: number | null; year_to: number | null; text: string; provenance: string }>('SELECT year_from, year_to, text, provenance FROM career_event WHERE person_id = ? ORDER BY event_id', [id]);
  const county = p.homeCounty !== null ? w.pack.counties[p.homeCounty] : undefined;
  const t = p.traits;
  return {
    id, name: fullName(p), fullName: fullName(p, true), party: p.partyId, sex: p.sex === 'F' ? 'Female' : 'Male', race: p.race, age: ageOn(p.birthDay, p.deathDay ?? today(u)),
    birth: formatDay(p.birthDay, true), death: p.deathDay !== null ? formatDay(p.deathDay, true) : null,
    homeState: w.pack.states[p.homeState]?.name ?? null, homeCounty: county ? county.fullName : null, tier: p.tier, provenance: p.provenance, bio: p.bio,
    traits: [['Charisma', t.charisma], ['Campaign skill', t.campaign], ['Fundraising', t.fundraising], ['Leadership', t.leadership], ['Integrity', t.integrity], ['Ambition', t.ambition], ['Name recognition', t.recognition]].map(([label, value]) => ({ label: label as string, value: value as number })),
    ideology: t.ideology.map((v, i) => ({ axis: ISSUE_AXES[i]!, value: v })),
    terms: [...terms, ...pend.filter((x) => !terms.some((y) => y.start_time === x.start_time && y.title === x.title))].map((x) => ({ title: x.title, start: x.start_time, end: x.end_time, acquired: x.acquired, endReason: x.end_reason, provenance: x.provenance })),
    career: career.map((c) => ({ years: c.year_from && c.year_to ? `${c.year_from}–${c.year_to}` : c.year_from ? `${c.year_from}` : c.year_to ? `–${c.year_to}` : '', text: c.text, provenance: c.provenance })),
    elections: u.db.all<{ contest_id: number; label: string; year: number; status: string; votes: number | null; share: number | null; kind: string }>(
      "SELECT c.contest_id, c.label, c.year, k.status, t.votes, t.share, c.kind FROM candidacy k JOIN contest c ON c.contest_id = k.contest_id LEFT JOIN contest_total t ON t.candidacy_id = k.candidacy_id AND c.status <> 'counting' AND t.rev = (SELECT MAX(rev) FROM result_revision r WHERE r.contest_id = c.contest_id) WHERE k.person_id = ? ORDER BY c.year DESC, c.contest_id DESC", [id])
      .map((r) => ({ contestId: r.contest_id, label: r.label, year: r.year, result: r.status, votes: r.votes, share: r.share, kind: r.kind })),
  };
}

function news(u: Universe, limit: number, beforeId?: number): NewsDto[] {
  const rows = u.db.all<{ news_id: number; sim_time: number; kind: string; headline: string; body: string; refs_json: string }>(
    `SELECT * FROM news WHERE local = 0 ${beforeId ? 'AND news_id < ?' : ''} ORDER BY news_id DESC LIMIT ?`, beforeId ? [beforeId, limit] : [limit]);
  return rows.map((r) => ({ id: r.news_id, time: r.sim_time, kind: r.kind, headline: r.headline, body: r.body, personId: (JSON.parse(r.refs_json || '{}') as { personId?: number }).personId }));
}

/** Upcoming elections from the universe's election calendar (scheduled by office terms and the 2016 legal baseline). */
function calendar(u: Universe): CalendarEntry[] {
  const today = easternDay(u.world.time);
  const rows = u.db.all<{ day: number; kind: string; n: number; states: number }>(
    "SELECT day, kind, COUNT(*) n, COUNT(DISTINCT state_idx) states FROM election WHERE status = 'scheduled' AND day >= ? GROUP BY day, kind ORDER BY day LIMIT 40", [today]);
  const label = (k: string, _n: number) => ({ general: 'General election', primary: 'Primary elections', primary_runoff: 'Primary runoffs', general_runoff: 'Runoff elections', pres_nomination: 'Presidential nominating primaries', special: 'Special election', spring: 'Spring election', spring_primary: 'Spring primary' } as Record<string, string>)[k] ?? k;
  return rows.map((r) => {
    const contests = u.db.all<{ kind: string; n: number }>("SELECT o.kind, COUNT(*) n FROM contest c JOIN election e ON e.election_id = c.election_id LEFT JOIN office o ON o.office_id = c.office_id WHERE e.day = ? AND e.kind = ? GROUP BY o.kind", [r.day, r.kind]);
    const nice: Record<string, string> = { ...OFFICE_LABEL, lt_governor: 'Lieutenant Governor', state_senator: 'State Senate', state_representative: 'State House' };
    return { date: isoDay(r.day), dayNumber: r.day, label: `${label(r.kind, r.n)}${r.kind === 'general' ? ` (${r.states} states)` : r.states > 1 ? ` (${r.states} states)` : ''}`,
      contests: contests.filter((c) => c.kind).map((c) => ({ label: nice[c.kind] ?? c.kind, count: c.n })), status: r.kind === 'general' ? 'Scheduled' : 'Scheduled' };
  });
}

/** The district layer draws the 2016 shapes: once new plans are in effect, the legend says so. */
function newPlanNote(u: Universe, layer: string): string {
  if (layer !== 'cd') return '';
  const n = Number(u.db.value("SELECT COUNT(*) FROM district_plan WHERE kind = 'cd' AND first_year <= ?", [daysToCivilYear(u)]));
  return n ? ` · drawn on the 2016 districts (seats by number); ${n} state${n === 1 ? ' has' : 's have'} new plans — see Government › District maps` : '';
}
const daysToCivilYear = (u: Universe) => Number(isoDay(today(u)).slice(0, 4));

function electorate(u: Universe): ElectorateSummary {
  const e = u.world.electorate; const pop = u.world.pop;
  const cell = new Float64Array(2);
  const nat = new Float64Array(N_COHORTS), d = new Float64Array(N_COHORTS), t = new Float64Array(N_COHORTS);
  for (let c = 0; c < pop.counties; c++) for (let k = 0; k < N_COHORTS; k++) {
    const share = pop.countyJoint[c * N_COHORTS + k]! * pop.countyVep[c]!;
    cellLookup(e.tables, k, e.mu[c * N_COHORTS + k]!, cell);
    nat[k]! += share; d[k]! += share * cell[0]!; t[k]! += share * cell[1]!;
  }
  const total = nat.reduce((a, b) => a + b, 0);
  const cohortLean = Array.from({ length: N_COHORTS }, (_, k) => ({ label: cohortLabel(k), margin: t[k]! > 0 ? 100 * (2 * d[k]! / t[k]! - 1) : 0, share: nat[k]! / total }))
    .sort((a, b) => b.share - a.share);
  const history = u.db.all<{ year: number; platforms_json: string; national_lean: number; summary_json: string }>('SELECT year, platforms_json, national_lean, summary_json FROM electorate_year ORDER BY year').map((r) => {
    const sm = JSON.parse(r.summary_json) as { stateLean?: number[] };
    const sl = sm.stateLean ?? [], mean = sl.reduce((a, b) => a + b, 0) / Math.max(1, sl.length);
    return { year: r.year, platforms: JSON.parse(r.platforms_json) as { D: number[]; R: number[] }, national: r.national_lean, stateSd: Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, sl.length)) };
  });
  return { targets: { ...e.params.targets }, achieved: { ...e.params.achieved }, ranges: { ...TARGET_RANGES }, attempt: e.params.attempt, platforms: e.params.platforms, axes: [...ISSUE_AXES], cohortLean, history };
}
