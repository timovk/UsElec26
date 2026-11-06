/**
 * The campaign season (Phase 5), run in the daily process at 06:00 ET: the races of the year, campaigns
 * (money, recognition, persuasion, debates, scandals, endorsements), poll fieldwork and publication, polling
 * averages and forecast runs. Observers (polls, averages, forecasts) see only the Public Record; fieldwork
 * goes through the measurement port. Daily output is kept in memory and written with the next commit.
 */
import { Rng } from '../core/rng';
import { daysToCivil, easternDay, formatDay, zonedToUtc, type DayNumber, type SimTime } from '../core/time';
import { gzip, gunzip } from '../core/codec';
import { fullName, PARTY_D, PARTY_R, type Person } from '../institutions/model';
import { debatePerformance, initCampaign, scandalDraw, stepCampaign, valenceOf, voterPower, type CampaignOffice, type CampaignState, type CampaignTraits } from '../campaigns/model';
import { fieldPoll, publishedLean, type PieceTypes, type PollArea, type PollDesign } from '../electorate/measure';
import { N_CLASS, N_TYPES, ZG, type KernelContest } from '../electorate/kernel';
import { TURNOUT_OFFSET } from '../electorate/environment';
import { buildShard } from '../electorate/shards';
import { cycleBias, makePollsters, type Pollster } from '../polling/pollsters';
import { houseEffects, raceAverage, type AverageOut, type PollObs } from '../polling/average';
import { runForecast, type ForecastInput, type ForecastOutput, type ForecastRace } from '../forecasting/model';
import { kernelContest, officeAbstain, officeWeight, type CandidacyRow, type ContestRow } from './electionModel';
import { leanMargin } from './world';
import type { ElectionEngine } from './elections';
import { ELECTION_RULES_2016, electoralVotes } from '../rules/elections2016';

const ET = 'America/New_York' as const;
const at = (day: DayNumber, h: number, m = 0): SimTime => { const c = daysToCivil(day); return zonedToUtc(c.y, c.m, c.d, h, m, ET); };
const PARTY_NAME: Record<number, string> = { 1: 'Democratic', 2: 'Republican', 3: 'Libertarian', 4: 'Green', 5: 'Independent' };
const ABBR: Record<number, string> = { 1: 'D', 2: 'R', 3: 'L', 4: 'G', 5: 'I' };

export interface SeasonState {
  campaigns: Record<string, CampaignState>;
  /** `${year}:${party}` → presumptive presidential nominee (person id). */
  presumptive: Record<string, number>;
  pollsters: boolean;
  lastForecast: number | null;
  nextPollId: number; nextEventId: number;
}
export const emptySeason = (): SeasonState => ({ campaigns: {}, presumptive: {}, pollsters: false, lastForecast: null, nextPollId: 1, nextEventId: 1 });

export interface Opt { key: string; label: string; party: number; personId: number | null }
export type RaceKind = 'pres_national' | 'pres_state' | 'generic' | 'general' | 'primary' | 'nom_national' | 'nom_state';
export interface Race {
  key: string; year: number; kind: RaceKind; label: string; geo: string; stateIdx: number | null; cd: number | null;
  contestId: number | null; office: string; party: number; day: DayNumber; options: Opt[];
  electionId: number | null; ev: number;
  /** Campaign key of the race (presidential general and nominations share one national campaign per candidate). */
  campaign: string;
  /** A general election whose primaries have not all chosen nominees yet: the parties still choosing (0: a top-two primary). Not polled; forecast from fundamentals. */
  awaiting?: number[];
}

interface PollRec {
  id: number; pollster: number; race: string; contestId: number | null; year: number; geo: string; start: number; end: number; published: SimTime;
  population: string; n: number; moe: number; method: string; sponsor: string | null;
  responses: { key: string; label: string; party: number; personId: number | null; pct: number }[];
}

export class Season {
  private pollsters: Pollster[] | null = null;
  private polls: PollRec[] = []; private pollsYear = -1;
  private types = new Map<string, PieceTypes[]>();
  private averages = new Map<string, AverageOut>();
  private forecast: { day: number; out: ForecastOutput } | null = null;
  private pend = { polls: [] as PollRec[], averages: [] as { race: string; asOf: number; out: AverageOut }[], races: new Map<string, Race>(), events: [] as unknown[][], endorsements: [] as unknown[][], debates: [] as unknown[][], finance: [] as unknown[][], forecasts: [] as { year: number; asOf: number; summary: string; payload: Uint8Array }[], pollsters: [] as Pollster[] };
  /** Options recorded for each race so far (a union, so polls naming candidates who later withdrew stay readable). */
  private raceDefs = new Map<string, Opt[]>();
  /** Races with a Democratic and a Republican option (general elections): where partisan house effects and the likely-voter adjustment apply. */
  private partisanRaces = new Map<string, { d: string; r: string; day: number }>();
  private dayRaces: { day: number; races: Race[] } | null = null;

  constructor(private readonly E: ElectionEngine) {}

  get st(): SeasonState { return (this.E.state.season ??= emptySeason()); }
  private get w() { return this.E.w; }
  private get db() { return this.E.db; }

  // ---- Persistence ---------------------------------------------------------------------------------------

  /** Write the day's output (called inside every commit's transaction). */
  flush(): void {
    const db = this.db, p = this.pend;
    for (const x of p.pollsters) db.run('INSERT OR REPLACE INTO pollster VALUES (?,?,?,?,?,?,?,?,?)', [x.id, x.name, x.short, x.method, x.sponsor, x.scope, x.homeState, x.founded, JSON.stringify(x.params)]);
    for (const r of p.races.values()) db.run('INSERT OR REPLACE INTO race_def VALUES (?,?,?,?,?,?,?)', [r.key, r.year, r.kind, r.label, r.geo, r.contestId, JSON.stringify({ options: r.options, stateIdx: r.stateIdx, cd: r.cd, office: r.office, party: r.party, day: r.day, ev: r.ev })]);
    for (const x of p.polls) {
      db.run('INSERT INTO poll VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [x.id, x.pollster, x.race, x.contestId, x.year, x.geo, x.start, x.end, x.published, x.population, x.n, x.moe, x.method, x.sponsor]);
      for (const o of x.responses) db.run('INSERT INTO poll_response VALUES (?,?,?,?,?,?)', [x.id, o.key, o.label, o.party, o.personId, o.pct]);
    }
    for (const a of p.averages) db.run('INSERT OR REPLACE INTO poll_average VALUES (?,?,?,?)', [a.race, a.asOf, 'kalman', JSON.stringify(a.out)]);
    for (const e of p.events) db.run('INSERT INTO campaign_event VALUES (?,?,?,?,?,?,?,?)', e as never);
    for (const e of p.endorsements) db.run('INSERT INTO endorsement(sim_time, endorser_person, endorser_label, person_id, race_key, kind) VALUES (?,?,?,?,?,?)', e as never);
    for (const e of p.debates) db.run('INSERT INTO debate(sim_time, race_key, kind, label, participants_json, result_json) VALUES (?,?,?,?,?,?)', e as never);
    for (const e of p.finance) db.run('INSERT OR REPLACE INTO finance_report VALUES (?,?,?,?,?)', e as never);
    for (const f of p.forecasts) db.run('INSERT INTO forecast_run(year, as_of, model_version, summary_json, payload) VALUES (?,?,?,?,?)', [f.year, f.asOf, 'v1', f.summary, f.payload]);
    this.pend = { polls: [], averages: [], races: new Map(), events: [], endorsements: [], debates: [], finance: [], forecasts: [], pollsters: [] };
  }

  private loadPollsters(): Pollster[] {
    if (this.pollsters) return this.pollsters;
    const rows = this.db.all<{ pollster_id: number; name: string; short: string; method: string; sponsor: string | null; scope: string; home_state: number | null; founded: number; params_json: string }>('SELECT * FROM pollster ORDER BY pollster_id');
    this.pollsters = rows.length ? rows.map((r) => ({ id: r.pollster_id, name: r.name, short: r.short, method: r.method as Pollster['method'], sponsor: r.sponsor, scope: r.scope as Pollster['scope'], homeState: r.home_state, founded: r.founded, params: JSON.parse(r.params_json) }))
      : this.pend.pollsters.length ? this.pend.pollsters : [];
    if (!this.pollsters.length) {
      const year = daysToCivil(easternDay(this.w.time)).y;
      this.pollsters = makePollsters(this.w.seed, this.w.pack.states.map((s) => ({ idx: s.idx, vep: this.w.pop.stateVep[s.idx]! })), year);
      this.pend.pollsters.push(...this.pollsters);
      this.st.pollsters = true;
    }
    return this.pollsters;
  }

  private async loadPolls(year: number): Promise<void> {
    if (this.pollsYear === year) return;
    this.pollsYear = year; this.polls = []; this.averages.clear();
    const rows = this.db.all<{ poll_id: number; pollster_id: number; race_key: string; contest_id: number | null; year: number; geo: string; field_start: number; field_end: number; published: number; population: string; n: number; moe: number; method: string; sponsor: string | null }>('SELECT * FROM poll WHERE year = ? ORDER BY poll_id', [year]);
    const resp = new Map<number, PollRec['responses']>();
    for (const r of this.db.all<{ poll_id: number; option_key: string; label: string; party: number; person_id: number | null; pct: number }>('SELECT r.* FROM poll_response r JOIN poll p ON p.poll_id = r.poll_id WHERE p.year = ?', [year])) {
      const a = resp.get(r.poll_id) ?? []; a.push({ key: r.option_key, label: r.label, party: r.party, personId: r.person_id, pct: r.pct }); resp.set(r.poll_id, a);
    }
    this.polls = rows.map((r) => ({ id: r.poll_id, pollster: r.pollster_id, race: r.race_key, contestId: r.contest_id, year: r.year, geo: r.geo, start: r.field_start, end: r.field_end, published: r.published, population: r.population, n: r.n, moe: r.moe, method: r.method, sponsor: r.sponsor, responses: resp.get(r.poll_id) ?? [] }));
    for (const a of this.db.all<{ race_key: string; payload_json: string; as_of: number }>("SELECT race_key, payload_json, as_of FROM poll_average WHERE method = 'kalman' AND race_key IN (SELECT race_key FROM race_def WHERE year = ?) ORDER BY as_of", [year])) this.averages.set(a.race_key, JSON.parse(a.payload_json));
    for (const k of this.db.all<{ race_key: string; kind: string; options_json: string }>('SELECT race_key, kind, options_json FROM race_def WHERE year = ?', [year])) {
      const def = JSON.parse(k.options_json) as { options: Opt[]; day: number };
      this.raceDefs.set(k.race_key, def.options);
      this.notePartisan(k.race_key, k.kind as RaceKind, def.options, def.day);
    }
    const f = this.db.get<{ as_of: number; payload: Uint8Array }>('SELECT as_of, payload FROM forecast_run WHERE year = ? ORDER BY as_of DESC, run_id DESC LIMIT 1', [year]);
    this.forecast = f ? { day: f.as_of, out: JSON.parse(new TextDecoder().decode(await gunzip(f.payload))).out } : null;
  }

  // ---- Races of the year ------------------------------------------------------------------------------------

  /** Every race with a campaign this year: generals and primaries with candidates, the presidential race and the generic ballot. */
  races(day: DayNumber): Race[] {
    if (this.dayRaces?.day === day) return this.dayRaces.races;
    const year = daysToCivil(day).y;
    if (!this.raceCache || this.raceCache.year !== year) this.raceCache = { year, races: this.buildRaces(year, day) };
    const races = this.raceCache.races.filter((r) => r.day >= day);
    this.dayRaces = { day, races };
    return races;
  }
  private raceCache: { year: number; races: Race[] } | null = null;
  /** Anything that changes contests or candidates goes through a commit: rebuild the race list after one. */
  invalidate(): void { this.contestCache = { day: -1, m: new Map() }; this.raceCache = null; this.dayRaces = null; this.fieldCache.clear(); this.campIndex = null; this.gDayCache.clear(); this.incCache.clear(); }
  private incCache = new Map<number, { party_id: number }[]>();

  private buildRaces(year: number, day: DayNumber): Race[] {
    const w = this.w, out: Race[] = [];
    // State legislative contests are neither polled nor forecast: leave them out in SQL (about 6,000 a year).
    // Only the columns read below (row objects for about 1,000 contests and 3,000 candidacies, every day).
    const rows = this.db.all<Pick<ContestRow, 'contest_id' | 'election_id' | 'office_id' | 'kind' | 'party_id' | 'state_idx' | 'district_idx' | 'label' | 'ev'> & { eday: number }>(`SELECT c.contest_id, c.election_id, c.office_id, c.kind, c.party_id, c.state_idx, c.district_idx, c.label, c.ev, e.day AS eday FROM contest c JOIN election e ON e.election_id = c.election_id LEFT JOIN office o ON o.office_id = c.office_id
      WHERE c.year = ? AND e.day >= ? AND c.status IN ('set','filing') AND c.kind IN ('general','special','pres_state','primary','top_two','pres_primary') AND (o.kind IS NULL OR o.kind NOT IN ('state_senator','state_representative')) ORDER BY c.contest_id`, [year, day]);
    type Cand = Pick<CandidacyRow, 'contest_id' | 'person_id' | 'party_id'>;
    const opt = (cand: Cand, p: Person): Opt => ({ key: `p${p.id}`, label: fullName(p), party: cand.party_id, personId: p.id });
    // A general election is not a race to poll until every primary (and runoff) feeding it has chosen its nominee.
    const awaiting = new Map<number, number[]>();
    for (const f of this.db.all<{ next_contest: number; party_id: number | null }>("SELECT next_contest, party_id FROM contest WHERE year = ? AND kind IN ('primary','top_two') AND status IN ('set','filing') AND next_contest IS NOT NULL", [year])) {
      const a = awaiting.get(f.next_contest) ?? []; a.push(f.party_id ?? 0); awaiting.set(f.next_contest, a);
    }
    // Every candidacy of those contests in one query.
    const byContest = new Map<number, { cand: Cand; person: Person }[]>();
    for (const k of this.db.all<Cand>(`SELECT k.contest_id, k.person_id, k.party_id FROM candidacy k JOIN contest c ON c.contest_id = k.contest_id JOIN election e ON e.election_id = c.election_id LEFT JOIN office o ON o.office_id = c.office_id
      WHERE c.year = ? AND e.day >= ? AND c.status IN ('set','filing') AND k.status NOT IN ('withdrew') AND (o.kind IS NULL OR o.kind NOT IN ('state_senator','state_representative')) ORDER BY k.contest_id, k.ballot_order, k.candidacy_id`, [year, day])) {
      const p = w.persons.get(k.person_id); if (!p) continue;
      const a = byContest.get(k.contest_id) ?? []; a.push({ cand: k, person: p }); byContest.set(k.contest_id, a);
    }
    for (const c of rows) {
      const cands = byContest.get(c.contest_id) ?? [];
      const pending = awaiting.get(c.contest_id);
      if (cands.length < 1 && !pending) continue;
      const office = this.E.officeKindOf(c);
      if (office === 'state_senator' || office === 'state_representative') continue; // not polled or forecast
      const st = c.state_idx !== null ? w.pack.states[c.state_idx]! : null;
      const primary = c.kind === 'primary' || c.kind === 'top_two' || c.kind === 'pres_primary';
      const cd = c.district_idx;
      const geo = cd !== null && office === 'us_representative' ? `${st!.usps}-${w.districts.cds[cd]?.number ?? 0}` : st?.usps ?? 'US';
      if (c.kind === 'pres_state') continue; // presidential state races are keyed by year and state below
      out.push({
        key: `C:${c.contest_id}`, year, kind: primary ? (c.kind === 'pres_primary' ? 'nom_state' : 'primary') : 'general', label: c.label.replace(/^\d{4} /, ''), geo,
        stateIdx: c.state_idx, cd: office === 'us_representative' ? cd : null, contestId: c.contest_id, office, party: c.party_id ?? 0, day: c.eday,
        options: cands.map((x) => opt(x.cand, x.person)), electionId: c.election_id, ev: c.kind === 'pres_primary' ? c.ev ?? 0 : 0,
        campaign: c.kind === 'pres_primary' ? `NOM:${year}:${c.party_id}` : `C:${c.contest_id}`,
        ...(pending && !primary ? { awaiting: pending } : {}),
      });
    }
    // The presidential general: from the presumptive nominees (state contests exist from the conventions).
    const gDay = this.generalDay(year);
    const dN = this.st.presumptive[`${year}:${PARTY_D}`], rN = this.st.presumptive[`${year}:${PARTY_R}`];
    if (year % 4 === 0 && gDay !== null && gDay >= day && dN !== undefined && rN !== undefined) {
      const pd = w.persons.get(dN)!, pr = w.persons.get(rN)!;
      const options: Opt[] = [{ key: `p${pd.id}`, label: fullName(pd), party: PARTY_D, personId: pd.id }, { key: `p${pr.id}`, label: fullName(pr), party: PARTY_R, personId: pr.id }];
      out.push({ key: `PN:${year}`, year, kind: 'pres_national', label: `${year} presidential race (national)`, geo: 'US', stateIdx: null, cd: null, contestId: null, office: 'president', party: 0, day: gDay, options, electionId: null, ev: 538, campaign: `PRES:${year}` });
      for (const s of w.pack.states) {
        const contest = this.db.get<{ contest_id: number }>("SELECT contest_id FROM contest WHERE kind = 'pres_state' AND year = ? AND state_idx = ?", [year, s.idx]);
        out.push({ key: `PS:${year}:${s.usps}`, year, kind: 'pres_state', label: `${year} President — ${s.name}`, geo: s.usps, stateIdx: s.idx, cd: null, contestId: contest?.contest_id ?? null, office: 'president', party: 0, day: gDay, options, electionId: null,
          ev: electoralVotes(s.usps, w.districts.seats(s.idx, year)), campaign: `PRES:${year}` });
      }
    }
    // The generic congressional ballot in even years.
    if (year % 2 === 0 && gDay !== null && gDay >= day) out.push({ key: `GB:${year}`, year, kind: 'generic', label: `${year} generic congressional ballot`, geo: 'US', stateIdx: null, cd: null, contestId: null, office: 'us_representative', party: 0, day: gDay,
      options: [{ key: 'D', label: 'Democratic candidate', party: PARTY_D, personId: null }, { key: 'R', label: 'Republican candidate', party: PARTY_R, personId: null }], electionId: null, ev: 0, campaign: '' });
    // National presidential nomination races while the contest is open.
    for (const party of [PARTY_D, PARTY_R]) {
      if (this.st.presumptive[`${year}:${party}`] !== undefined) continue;
      const field = this.db.all<{ person_id: number }>("SELECT DISTINCT k.person_id FROM candidacy k JOIN contest c ON c.contest_id = k.contest_id WHERE c.kind = 'pres_primary' AND c.year = ? AND c.party_id = ? AND k.status = 'running' ORDER BY k.person_id", [year, party]);
      if (field.length < 2) continue;
      const lastDay = this.db.value<number>("SELECT MAX(e.day) FROM contest c JOIN election e ON e.election_id = c.election_id WHERE c.kind = 'pres_primary' AND c.year = ? AND c.party_id = ?", [year, party]) ?? day;
      out.push({ key: `NN:${year}:${party}`, year, kind: 'nom_national', label: `${year} ${PARTY_NAME[party]} presidential nomination (national)`, geo: 'US', stateIdx: null, cd: null, contestId: null, office: 'president', party, day: lastDay,
        options: field.map((f) => { const p = w.persons.get(f.person_id)!; return { key: `p${p.id}`, label: fullName(p), party, personId: p.id }; }), electionId: null, ev: 0, campaign: `NOM:${year}:${party}` });
    }
    return out;
  }

  private gDayCache = new Map<number, DayNumber | null>();
  private generalDay(year: number): DayNumber | null {
    if (!this.gDayCache.has(year)) this.gDayCache.set(year, this.db.value<number>("SELECT MIN(day) FROM election WHERE year = ? AND kind = 'general'", [year]) ?? null);
    return this.gDayCache.get(year)!;
  }

  // ---- Campaigns ----------------------------------------------------------------------------------------------

  private traits(p: Person, incumbent: boolean, quality: number): CampaignTraits {
    return { fundraising: p.traits.fundraising, campaign: p.traits.campaign, charisma: p.traits.charisma, integrity: p.traits.integrity, quality, incumbent, recognition: p.traits.recognition };
  }

  private campaignOffice(office: string): CampaignOffice { return (['president', 'us_senator', 'governor', 'us_representative'].includes(office) ? office : 'other') as CampaignOffice; }

  /** Campaign effects for the ballot kernel: valence relative to the field and recognition, by candidate and state. */
  private fieldCache = new Map<string, CampaignState[]>();
  campaignFn(row: ContestRow): (cand: CandidacyRow, person: Person, stateIdx: number) => { valence: number; recognition: number } | null {
    const key = row.kind === 'pres_state' ? `PRES:${row.year}` : row.kind === 'pres_primary' ? `NOM:${row.year}:${row.party_id}` : `C:${row.contest_id}`;
    let field = this.fieldCache.get(key);
    if (!field) { field = this.campaignsOf(key); this.fieldCache.set(key, field); }
    if (!field.length) return () => null;
    return (_cand, person, stateIdx) => {
      const c = this.st.campaigns[`${key}|${person.id}`]; if (!c) return null;
      return { valence: valenceOf(c, field, row.kind === 'pres_state' ? stateIdx : undefined), recognition: c.recognition };
    };
  }

  /**
   * Campaigns by race key, in the order of the campaign table (the same order, and so the same sums, as
   * filtering the whole table). Every contest built for the kernel asks, including thousands of state
   * legislative contests that have none: scanning the table each time was most of the day's campaign cost.
   */
  private campIndex: Map<string, CampaignState[]> | null = null;
  private campaignsOf(key: string): CampaignState[] {
    if (!this.campIndex) {
      const m = new Map<string, CampaignState[]>();
      for (const [k, v] of Object.entries(this.st.campaigns)) { const ck = k.slice(0, k.lastIndexOf('|')); const l = m.get(ck); if (l) l.push(v); else m.set(ck, [v]); }
      this.campIndex = m;
    }
    return this.campIndex.get(key) ?? [];
  }

  private campaigns(day: DayNumber, races: Race[]): void {
    const w = this.w, st = this.st;
    const year = daysToCivil(day).y;
    // Register every candidate of every race with a campaign.
    const byKey = new Map<string, Race>();
    for (const r of races) if (r.campaign && !byKey.has(r.campaign)) byKey.set(r.campaign, r);
    for (const [ck, r] of byKey) for (const o of r.options) {
      if (o.personId === null) continue;
      const key = `${ck}|${o.personId}`; if (st.campaigns[key]) continue;
      const p = w.persons.get(o.personId)!;
      const inc = r.contestId !== null ? !!this.db.value<number>('SELECT incumbent FROM candidacy WHERE contest_id = ? AND person_id = ?', [r.contestId, p.id]) : false;
      st.campaigns[key] = initCampaign(p.id, o.party, this.campaignOffice(r.office), r.kind === 'primary' || r.kind.startsWith('nom'), this.traits(p, inc, this.E.quality(p)), ck.startsWith('PRES:') ? w.pack.states.length : 0);
      st.campaigns[key]!.incumbent = inc;
      this.fieldCache.delete(ck); this.campIndex = null;
    }
    // Retire campaigns whose race is over (keeps the state small): their effects already entered the ballot.
    for (const k of Object.keys(st.campaigns)) {
      const ck = k.slice(0, k.lastIndexOf('|'));
      if (!byKey.has(ck) && !(ck.startsWith('PRES:') && Number(ck.slice(5)) === year && day <= (this.generalDay(year) ?? 0))) { delete st.campaigns[k]; this.fieldCache.delete(ck); this.campIndex = null; }
    }
    // Presidential attention by state, from the campaign's view (the public forecast, else the lean index).
    const lean = this.leanIndex(year);
    let weights: number[] | undefined;
    if (byKey.has(`PRES:${year}`)) {
      const ev = w.pack.states.map((s) => electoralVotes(s.usps, w.districts.seats(s.idx, year)));
      const fc = this.forecast?.out.races;
      const margin = w.pack.states.map((s) => fc?.find((x) => x.key === `PS:${year}:${s.usps}`)?.mean ?? lean.state[s.idx]!);
      weights = voterPower(ev, margin, w.pack.states.map(() => 6));
    }
    const ev0 = Rng.stream(w.seed, 'campaign-day', day);
    for (const [k, c] of Object.entries(st.campaigns).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const ck = k.slice(0, k.lastIndexOf('|')), r = byKey.get(ck); if (!r) continue;
      const p = w.persons.get(c.person)!;
      const t = this.traits(p, !!c.incumbent, 0);
      const avg = this.averages.get(r.key);
      const share = avg?.options[`p${p.id}`]?.mean;
      const viability = share !== undefined ? Math.min(1, Math.max(0.05, share / 50)) : r.kind.startsWith('nom') ? 0.3 : 0.5;
      const rr = ev0;
      stepCampaign(c, t, { daysLeft: r.day - day, viability, mood: 0, rng: rr, stateWeights: ck.startsWith('PRES:') ? weights : undefined });
      // Nomination races: strategic voters desert candidates who trail in the national polls.
      if (ck.startsWith('NOM:')) {
        const nat = this.averages.get(`NN:${ck.slice(4)}`);
        const sh = nat?.options[`p${p.id}`]?.mean;
        if (sh !== undefined) { const field = Object.keys(nat!.options).length; c.viability = 0.05 * Math.log(Math.max(1, sh) / (100 / Math.max(2, field))); }
      }
      // Scandals and gaffes (statewide and national candidates make the news; House candidates only for scandals).
      const s = scandalDraw(t, c, rr);
      if (s) {
        c.scandal += s.size;
        if (c.office !== 'us_representative' || s.kind === 'scandal') {
          const head = s.kind === 'scandal' ? `${fullName(p)} faces questions over ${pick(ev0, SCANDALS)}` : `${fullName(p)} draws criticism for ${pick(ev0, GAFFES)}`;
          this.event(at(day, 11 + ev0.int(8)), s.kind, r.key, p.id, s.size, head);
          this.E.host.news('campaign', head, `${r.label}: the ${s.kind === 'scandal' ? 'story' : 'remark'} could cost ${p.sex === 'F' ? 'her' : 'him'} support (${ABBR[c.party] ?? 'I'}).`, { personId: p.id }, at(day, 12));
        }
      }
    }
  }

  private event(time: SimTime, kind: string, race: string | null, person: number | null, magnitude: number, headline: string, data?: unknown): void {
    this.pend.events.push([this.st.nextEventId++, time, kind, race, person, magnitude, headline, data === undefined ? null : JSON.stringify(data)]);
  }

  // ---- Debates --------------------------------------------------------------------------------------------------

  private debates(day: DayNumber, races: Race[]): void {
    const w = this.w, year = daysToCivil(day).y, c = daysToCivil(day);
    const gDay = this.generalDay(year);
    const hold = (r: Race, kind: string, label: string, participants: Opt[], scale: number) => {
      const rr = Rng.stream(w.seed, 'debate', r.key, day);
      const perf = participants.map((o) => { const p = w.persons.get(o.personId!)!; return { o, p, x: debatePerformance(this.traits(p, false, 0), rr) }; });
      const mean = perf.reduce((a, b) => a + b.x, 0) / perf.length;
      for (const q of perf) { const camp = this.st.campaigns[`${r.campaign}|${q.p.id}`]; if (camp) camp.debate += scale * (q.x - mean); }
      const best = [...perf].sort((a, b) => b.x - a.x)[0]!;
      this.pend.debates.push([at(day, 21), r.key, kind, label, JSON.stringify(participants.map((o) => o.personId)), JSON.stringify(perf.map((q) => ({ person: q.p.id, score: Math.round(100 * (q.x - mean)) / 100 })))]);
      this.E.host.news('debate', `${label}: ${fullName(best.p)} seen as the strongest performer`, `${participants.length} candidates took the stage. Viewers' reactions favoured ${fullName(best.p)} (${ABBR[best.o.party] ?? 'I'}).`, { personId: best.p.id }, at(day, 23));
    };
    // Presidential general debates (late September to mid-October) and the vice-presidential debate.
    const pres = races.find((r) => r.kind === 'pres_national');
    if (pres && gDay !== null) {
      const dates = [gDay - 43, gDay - 30, gDay - 20];
      const i = dates.indexOf(day);
      if (i >= 0) hold(pres, 'presidential', `Presidential debate ${i + 1}`, pres.options, 0.025);
    }
    // Nomination debates: every three weeks from January to April while three or more candidates remain.
    for (const r of races.filter((x) => x.kind === 'nom_national')) {
      if (c.m <= 4 && (day - (this.w.pack.states.length + r.party * 3)) % 21 === 0 && r.options.length >= 3) hold(r, 'primary', `${PARTY_NAME[r.party]} presidential debate`, r.options.slice(0, 10), 0.04);
    }
    // Senate and governor debates for contested races in October.
    if (gDay !== null && day === gDay - 26) for (const r of races.filter((x) => x.kind === 'general' && (x.office === 'us_senator' || x.office === 'governor'))) {
      const major = r.options.filter((o) => o.party === PARTY_D || o.party === PARTY_R);
      if (major.length === 2) hold(r, 'statewide', `${r.label} debate`, major, 0.02);
    }
  }

  // ---- Endorsements -----------------------------------------------------------------------------------------------

  private endorsements(day: DayNumber, races: Race[]): void {
    const w = this.w;
    for (const r of races.filter((x) => x.kind === 'nom_national' || (x.kind === 'primary' && (x.office === 'us_senator' || x.office === 'governor')))) {
      const rr = Rng.stream(w.seed, 'endorse', r.key, day);
      if (!rr.bernoulli(r.kind === 'nom_national' ? 0.35 : 0.04)) continue;
      // An officeholder of the party (in the state for a statewide primary) backs a candidate, favouring the leader and the experienced.
      const officeholders = w.offices.filter((o) => ['governor', 'us_senator', 'us_representative', 'lt_governor', 'attorney_general'].includes(o.kind) && (r.kind === 'nom_national' || o.stateIdx === r.stateIdx))
        .map((o) => ({ o, t: w.current.get(o.id) })).filter((x) => x.t && x.t.partyId === r.party && !r.options.some((op) => op.personId === x.t!.personId));
      if (!officeholders.length) continue;
      const who = officeholders[rr.int(officeholders.length)]!;
      const endorser = w.persons.get(who.t!.personId)!;
      if (this.db.value<number>('SELECT 1 FROM endorsement WHERE endorser_person = ? AND race_key = ?', [endorser.id, r.key]) || this.pend.endorsements.some((e) => e[1] === endorser.id && e[4] === r.key)) continue;
      const avg = this.averages.get(r.key);
      const weights = r.options.map((o) => { const p = w.persons.get(o.personId!)!; const share = avg?.options[o.key]?.mean ?? 100 / r.options.length; return Math.exp(share / 12 + 2 * this.E.quality(p) + (p.homeState === endorser.homeState ? 0.8 : 0)); });
      const o = r.options[rr.weighted(weights)]!;
      const camp = this.st.campaigns[`${r.campaign}|${o.personId}`];
      const prominence = who.o.kind === 'governor' || who.o.kind === 'us_senator' ? 0.012 : 0.004;
      if (camp) { camp.endorse += prominence; camp.recognition = Math.min(0.98, camp.recognition + prominence); }
      this.pend.endorsements.push([at(day, 10), endorser.id, `${who.o.title} ${fullName(endorser)}`, o.personId, r.key, 'officeholder']);
      if (prominence > 0.01) this.E.host.news('endorsement', `${fullName(endorser)} endorses ${o.label}`, `${who.o.title} ${fullName(endorser)} backs ${o.label} for the ${r.label.replace(/ \(national\)$/, '')}.`, { personId: o.personId }, at(day, 10));
    }
  }

  // ---- Polls ------------------------------------------------------------------------------------------------------

  /** The electorate's voter types for polls (built once per cycle in the compute workers, from the cycle's level environment). */
  private async typesFor(kind: 'general' | 'primary' | 'allparty', party: number, states: number[], year: number, keyOf: (s: number) => string | null): Promise<Map<number, PieceTypes[]>> {
    const want = states.filter((s) => !this.types.has(`${kind}:${party}:${s}:${keyOf(s)}`) && keyOf(s) !== null);
    if (want.length) {
      const TT = (globalThis as unknown as { __seasonT?: Record<string, number> }).__seasonT; const tb = performance.now();
      try { await this.buildTypes(kind, party, want, year, keyOf); } finally { if (TT) TT.typesBuild = (TT.typesBuild ?? 0) + performance.now() - tb; }
    }
    return new Map(states.map((s) => [s, this.types.get(`${kind}:${party}:${s}:${keyOf(s)}`) ?? []]));
  }

  private async buildTypes(kind: 'general' | 'primary' | 'allparty', party: number, want: number[], year: number, keyOf: (s: number) => string | null): Promise<void> {
    {
      const E = this.E;
      const env0 = E.state.env[String(year)] ? E.environmentFor(year) : null;
      const env = env0 && env0.level ? { ...env0, national: env0.level.national, classSwing: env0.level.classSwing, division: env0.level.division, state: env0.level.state } : env0;
      const offset = kind !== 'general' ? TURNOUT_OFFSET.primary + (year % 4 === 0 ? 0 : -0.2) : year % 4 === 0 ? TURNOUT_OFFSET.presidential : year % 2 === 0 ? TURNOUT_OFFSET.midterm : TURNOUT_OFFSET.offyear;
      const inputs = want.map((s) => {
        const ctx = { seed: this.w.seed, electionKey: keyOf(s)!, pack: this.w.pack, pop: this.w.pop, electorate: this.w.electorate, env, tauE: E.ensureTurnout() + offset, ranges: E.ranges, cdOf: this.w.districts.assignment('cd', year) };
        return { ...buildShard(ctx, s, kind, party, [], 0.45), measure: true };
      });
      const outs = await E.host.runner.run(inputs);
      outs.forEach((o, i) => this.types.set(`${kind}:${party}:${want[i]}:${keyOf(want[i]!)}`, o.types ?? []));
    }
  }

  private primaryCache = new Map<string, PieceTypes[]>();
  /** Likely primary voters of a party (0 = all-party top-two) from the general electorate's types. */
  private primaryTypes(pieces: PieceTypes[], s: number, party: number): PieceTypes[] {
    const key = `${s}:${party}:${pieces.length}`;
    const hit = this.primaryCache.get(key); if (hit && hit.length === pieces.length) return hit;
    const usps = this.w.pack.states[s]!.usps;
    const ptype = ELECTION_RULES_2016[usps]?.primaryType ?? 'open';
    const crossover = ptype === 'closed' ? 0.03 : ptype === 'semi' ? 0.12 : 0.22;
    const w = new Float64Array(ZG), e = new Float64Array(ZG);
    for (let g = 0; g < ZG; g++) {
      const z0 = g - ZG / 2 + 0.5, z = party === PARTY_D ? z0 : -z0;
      const lg = 1 / (1 + Math.exp(-2.2 * (z - 0.4)));
      w[g] = party === 0 ? 1 : lg + crossover * (1 - lg);
      e[g] = 0.25 + 0.12 * Math.abs(z0);                          // primary turnout rises with partisan intensity
    }
    const out = pieces.map((p) => {
      const lv = new Float32Array(N_TYPES), rv = new Float32Array(N_TYPES);
      for (let h = 0; h < N_CLASS; h++) for (let g = 0; g < ZG; g++) { const ty = h * ZG + g; rv[ty] = p.rv[ty]! * w[g]!; lv[ty] = p.rv[ty]! * w[g]! * e[g]!; }
      return { county: p.county, cd: p.cd, lv, rv };
    });
    this.primaryCache.set(key, out);
    return out;
  }

  /** The swing since the poll cache's environment (the cycle level), by class, for a state. */
  private zShift(year: number, s: number): number[] {
    const env = this.E.state.env[String(year)];
    if (!env?.level) return new Array<number>(N_CLASS).fill(0);
    const div = this.w.pack.states[s]!.division;
    const common = env.national - env.level.national + env.division[div]! - env.level.division[div]! + env.state[s]! - env.level.state[s]!;
    return Array.from({ length: N_CLASS }, (_, h) => common + env.classSwing[h]! - env.level!.classSwing[h]!);
  }

  private contestCache: { day: number; m: Map<string, KernelContest | null> } = { day: -1, m: new Map() };
  /** The race's contest as a voter in state `s` would see it today (with today's campaign effects). */
  private contestFor(r: Race, s: number): KernelContest | null {
    const day = easternDay(this.w.time);
    if (this.contestCache.day !== day) this.contestCache = { day, m: new Map() };
    const k = `${r.key}|${s}`;
    if (this.contestCache.m.has(k)) return this.contestCache.m.get(k)!;
    const c = this.contestForUncached(r, s);
    this.contestCache.m.set(k, c);
    return c;
  }
  private contestForUncached(r: Race, s: number): KernelContest | null {
    const E = this.E, w = this.w;
    const kctx = { classCentroids: E.cls.centroids, platforms: w.electorate.params.platforms };
    if (r.kind === 'generic') {
      return { id: -1, cd: -1, weight: officeWeight('us_representative'), abstain: officeAbstain('us_representative'), options: [0.5, -0.5].map((sign) => ({ partySign: sign, base: 0, classFit: new Array<number>(N_CLASS).fill(0), minorAppeal: 0, homeCounty: -1, homeState: false })) };
    }
    let row: ContestRow | undefined;
    if (r.contestId !== null && r.kind !== 'pres_state' && r.kind !== 'pres_national') row = this.db.get<ContestRow>('SELECT * FROM contest WHERE contest_id = ?', [r.contestId]);
    else if (r.kind === 'pres_state' || r.kind === 'pres_national') {
      const real = this.db.get<ContestRow>("SELECT * FROM contest WHERE kind = 'pres_state' AND year = ? AND state_idx = ?", [r.year, s]);
      row = real ?? { contest_id: -1, election_id: -1, office_id: null, kind: 'pres_state', party_id: null, state_idx: s, district_idx: null, method: 'plurality', label: r.label, status: 'set', winner_candidacy: null, runner_up_candidacy: null, term_start: null, parent_contest: null, next_contest: null, ev: r.ev, year: r.year };
    } else if (r.kind === 'nom_national') row = this.db.get<ContestRow>("SELECT * FROM contest WHERE kind = 'pres_primary' AND year = ? AND party_id = ? AND state_idx = ?", [r.year, r.party, s]);
    if (!row) return null;
    let cands = row.contest_id > 0 ? E.cands(row.contest_id) : [];
    // Presidential polls ask the head-to-head question (the two major tickets), before and after the conventions.
    if (!cands.length || r.kind === 'pres_national' || r.kind === 'pres_state') {
      cands = r.options.filter((o) => o.personId !== null).map((o, i) => ({ cand: { candidacy_id: -1 - i, contest_id: row!.contest_id, person_id: o.personId!, party_id: o.party, ballot_order: i, incumbent: w.current.get(w.offices.find((x) => x.kind === 'president')!.id)?.personId === o.personId ? 1 : 0, running_mate: null, status: 'running', quality: E.quality(w.persons.get(o.personId!)!, 0.75) }, person: w.persons.get(o.personId!)! }));
    }
    const primary = row.kind === 'primary' || row.kind === 'pres_primary';
    return kernelContest(w.seed, row, cands, E.officeKindOf(row), s, primary, { ...kctx, campaign: this.campaignFn(row) });
  }

  private async fieldwork(day: DayNumber, races: Race[]): Promise<void> {
    const w = this.w, year = daysToCivil(day).y;
    const pollsters = this.loadPollsters();
    const cyc = cycleBias(w.seed, year);
    const lean = this.leanIndex(year);
    const sal = new Map(races.map((r) => [r.key, this.salience(r, day, lean)])); // the same for every pollster
    for (const pz of pollsters) {
      const rr = Rng.stream(w.seed, 'poll', pz.id, day);
      // Candidate races for this pollster, weighted by salience and the season.
      const cand = races.filter((r) => r.options.length >= 2 && !r.awaiting && (pz.scope === 'national' ? r.geo === 'US' || (r.stateIdx !== null && rr.float() < 0.15) : pz.scope === 'multi-state' ? r.stateIdx !== null : r.stateIdx === pz.homeState));
      if (!cand.length) continue;
      const weights = cand.map((r) => sal.get(r.key)!);
      const total = weights.reduce((a, b) => a + b, 0);
      const rate = (pz.params.perMonth / 30) * Math.min(1.5, total / (pz.scope === 'state' ? 2 : 6));
      if (!rr.bernoulli(Math.min(0.9, rate))) continue;
      const r = cand[rr.weighted(weights)]!;
      await this.fieldOne(pz, r, day, rr, cyc);
    }
  }

  private salience(r: Race, day: number, lean: { state: number[]; cd: number[] }): number {
    const left = r.day - day;
    if (left < 1) return 0;
    const season = r.kind === 'nom_state' ? (left < 30 ? 1.5 : left < 75 ? 0.4 : 0.05) : r.kind === 'primary' ? (left < 45 ? 0.4 : 0.05) : r.kind === 'nom_national' ? 1 : left < 45 ? 1.2 : left < 110 ? 0.7 : left < 220 ? 0.25 : 0.08;
    const avg = this.averages.get(r.key);
    const m = avg?.margin ? Math.abs(avg.margin.mean) : r.stateIdx !== null && r.kind !== 'primary' && r.kind !== 'nom_state' ? Math.abs(r.cd !== null ? lean.cd[r.cd]! : lean.state[r.stateIdx]!) : 8;
    const close = Math.exp(-((m / 11) ** 2));
    const base = r.kind === 'pres_national' ? 6 : r.kind === 'generic' ? 2 : r.kind === 'nom_national' ? 4 : r.kind === 'pres_state' ? 0.3 + r.ev / 6 : r.kind === 'nom_state' ? 0.5 + Math.sqrt(r.ev || 30) / 6
      : r.office === 'us_senator' ? 1.6 : r.office === 'governor' ? 1.2 : r.office === 'us_representative' ? 0.12 : 0.15;
    return base * season * (r.geo === 'US' || r.kind.startsWith('nom') ? 1 : 0.15 + close);
  }

  private async fieldOne(pz: Pollster, r: Race, day: DayNumber, rr: Rng, cyc: { classBias: number[]; partisanNonresponse: number }): Promise<void> {
    const w = this.w, year = r.year;
    const states = r.stateIdx !== null ? [r.stateIdx] : w.pack.states.map((s) => s.idx);
    const primary = r.kind === 'primary' || r.kind === 'nom_state' || r.kind === 'nom_national';
    // Primary polls sample likely primary voters from the general electorate's types (party participation by
    // partisanship and the state's primary rules, intense partisans more likely to turn out); the primaries
    // themselves are realized by the full kernel.
    const gKey = (_s: number) => { const g = this.generalDay(year); return g === null ? null : `general|${year}|${g}`; };
    // The whole country's cache is built at once (in parallel in the compute workers) the first time it is needed.
    await this.typesFor('general', 0, w.pack.states.map((x) => x.idx), year, gKey);
    const general = await this.typesFor('general', 0, states, year, gKey);
    const types = primary ? new Map(states.map((s) => [s, this.primaryTypes(general.get(s) ?? [], s, r.party)])) : general;
    const areas: PollArea[] = [];
    for (const s of states) {
      const pieces = types.get(s) ?? []; if (!pieces.length) continue;
      const contest = this.contestFor(r, s); if (!contest || contest.options.length !== r.options.length) continue;
      areas.push({ contest, pieces: r.cd !== null ? pieces.filter((p) => p.cd === r.cd) : pieces, zShift: this.zShift(year, s), bonuses: { homeStateBonus: 0.1, homeCountyBonus: 0.22 } });
    }
    if (!areas.length || !areas.some((a) => a.pieces.length)) return;
    const left = r.day - day;
    const p = pz.params;
    const n = Math.round(rr.range(p.n[0], p.n[1]) * (r.geo === 'US' ? 1 : 0.85));
    const lv = p.usesLV && (primary || left < 80);
    const design: PollDesign = {
      n, deff: p.deff, population: lv ? 'LV' : 'RV', lvScreen: (1 - p.lvQuality) * (p.lvTilt ?? 0),
      house: p.house + 3 * p.houseDrift * Math.tanh((year - 2016) / 12), // slow, bounded drift
      classBias: p.classBias.map((b, h) => b + cyc.classBias[h]!), partisanNonresponse: p.partisanNonresponse + cyc.partisanNonresponse,
      undecided: p.undecided * (primary ? 1.6 : 1) * (1 + Math.max(0, left) / 160),
    };
    const recognition = r.options.map((o) => (o.personId !== null ? this.st.campaigns[`${r.campaign}|${o.personId}`]?.recognition ?? w.persons.get(o.personId)!.traits.recognition : 0.9));
    const res = fieldPoll(areas, design, recognition, rr);
    let pct = res.counts.map((c) => (100 * c) / res.n);
    // Herding: some pollsters lean toward the published average.
    const avg = this.averages.get(r.key);
    if (p.herding > 0 && avg) pct = pct.map((x, j) => { const a = avg.options[r.options[j]!.key]?.mean; return a === undefined ? x : x + p.herding * (a - x); });
    const fieldDays = 2 + rr.int(4), lag = 1 + rr.int(3);
    const rec: PollRec = {
      id: this.st.nextPollId++, pollster: pz.id, race: r.key, contestId: r.contestId, year, geo: r.geo, start: day - fieldDays + 1, end: day, published: at(day + lag, 7 + rr.int(10)),
      population: lv ? 'LV' : 'RV', n, moe: Math.round(1000 * 1.96 * Math.sqrt(0.25 / n) * 100) / 1000, method: pz.method, sponsor: pz.sponsor,
      responses: [...r.options.map((o, j) => ({ key: o.key, label: o.label, party: o.party, personId: o.personId, pct: Math.round(pct[j]!) })), { key: 'und', label: 'Undecided/other', party: 0, personId: null, pct: Math.round((100 * res.undecided) / res.n) }],
    };
    this.polls.push(rec); this.pend.polls.push(rec);
    const prev = this.raceDefs.get(r.key);
    if (!prev || r.options.some((o) => !prev.some((x) => x.key === o.key))) {
      const options = prev ? [...prev, ...r.options.filter((o) => !prev.some((x) => x.key === o.key))] : r.options;
      this.raceDefs.set(r.key, options); this.pend.races.set(r.key, { ...r, options });
      this.notePartisan(r.key, r.kind, r.options, r.day);
    }
  }

  private notePartisan(key: string, kind: RaceKind, options: Opt[], day: number): void {
    if (kind === 'primary' || kind.startsWith('nom')) return;
    const d = options.find((o) => o.party === PARTY_D), q = options.find((o) => o.party === PARTY_R);
    if (d && q) this.partisanRaces.set(key, { d: d.key, r: q.key, day });
  }

  /**
   * Publication: polls released today enter the averages. Two adjustments are estimated from published polls
   * only: registered-voter polls are moved toward the likely electorate by the gap between registered- and
   * likely-voter polls of the same races (shrunk toward a prior of 2 points before both kinds exist), and each
   * pollster's house effect is estimated from its residuals against the averages of general-election races.
   */
  private publish(day: DayNumber): string[] {
    const t0 = at(day, 0), t1 = at(day + 1, 0);
    const fresh = this.polls.filter((p) => p.published >= t0 && p.published < t1);
    if (!fresh.length) return [];
    const now = at(day + 1, 0);
    const published = this.polls.filter((p) => p.published < now);
    const margin = (p: PollRec, a: string, b: string) => { const x = p.responses.find((o) => o.key === a)?.pct, y = p.responses.find((o) => o.key === b)?.pct; return x === undefined || y === undefined ? null : x - y; };
    const resid: { pollster: number; resid: number; rv: boolean }[] = [];
    let sRV = 0, nRV = 0, sLV = 0, nLV = 0;
    for (const p of published) {
      const pr = this.partisanRaces.get(p.race), a = this.averages.get(p.race); if (!pr || !a?.margin) continue;
      const m = margin(p, pr.d, pr.r); if (m === null) continue;
      const e = m - a.margin.mean, rv = p.population === 'RV';
      resid.push({ pollster: p.pollster, resid: e, rv });
      if (pr.day - p.end <= 80) { if (rv) { sRV += e; nRV++; } else { sLV += e; nLV++; } }
    }
    const k = nRV && nLV ? (nRV * nLV) / (nRV + nLV) : 0;
    const lvGap = (k * (nRV && nLV ? sRV / nRV - sLV / nLV : 0) + 15 * 2) / (k + 15);
    const house = houseEffects(resid.map((x) => ({ pollster: x.pollster, resid: x.resid - (x.rv ? lvGap : 0) })));
    const touched = [...new Set(fresh.map((p) => p.race))];
    for (const key of touched) {
      const pr = this.partisanRaces.get(key);
      const obs: PollObs[] = published.filter((p) => p.race === key).map((p) => {
        const shares: Record<string, number> = Object.fromEntries(p.responses.filter((o) => o.key !== 'und').map((o) => [o.key, o.pct]));
        if (pr && p.population === 'RV' && shares[pr.d] !== undefined && shares[pr.r] !== undefined) { shares[pr.d] = shares[pr.d]! - lvGap / 2; shares[pr.r] = shares[pr.r]! + lvGap / 2; }
        return { day: (p.start + p.end) / 2, pollster: p.pollster, n: p.n, shares };
      });
      const out = raceAverage(obs, day, pr ? house : new Map(), pr ? [pr.d, pr.r] : null);
      if (out && pr) out.lvGap = lvGap;
      if (!out) continue;
      this.averages.set(key, out);
      this.pend.averages.push({ race: key, asOf: day, out });
    }
    return touched;
  }

  // ---- The lean index and forecasts ---------------------------------------------------------------------------------

  private leanCache: { year: number; v: { state: number[]; cd: number[] } } | null = null;
  /** Partisan lean by state and district (points, D+, relative to the nation): past presidential results when the archive has them, else the public index. */
  leanIndex(year: number): { state: number[]; cd: number[] } {
    if (this.leanCache?.year === year) return this.leanCache.v;
    const w = this.w;
    const prevYear = this.db.value<number>("SELECT MAX(year) FROM contest WHERE kind = 'pres_state' AND year < ? AND status IN ('decided','certified')", [year]);
    let v: { state: number[]; cd: number[] };
    if (prevYear) {
      const rows = this.db.all<{ state_idx: number; party_id: number; votes: number }>(`SELECT c.state_idx, k.party_id, SUM(t.votes) votes FROM contest c JOIN contest_total t ON t.contest_id = c.contest_id JOIN candidacy k ON k.candidacy_id = t.candidacy_id
        WHERE c.kind = 'pres_state' AND c.year = ? AND t.rev = (SELECT MAX(rev) FROM result_revision r WHERE r.contest_id = c.contest_id) GROUP BY c.state_idx, k.party_id`, [prevYear]);
      const D = new Float64Array(w.pack.states.length), R = new Float64Array(w.pack.states.length);
      for (const r of rows) { if (r.party_id === PARTY_D) D[r.state_idx]! += r.votes; else if (r.party_id === PARTY_R) R[r.state_idx]! += r.votes; }
      const nd = D.reduce((a, b) => a + b, 0), nr = R.reduce((a, b) => a + b, 0), nat = (100 * (nd - nr)) / Math.max(1, nd + nr);
      const state = Array.from(D, (d, s) => (d + R[s]! > 0 ? (100 * (d - R[s]!)) / (d + R[s]!) - nat : 0));
      // Districts: the state's lean plus the district's true deviation within it (district results are not archived for President by district in every state yet).
      const pub = this.publicLean(year);
      v = { state, cd: w.districts.cds.map((c, i) => state[c.stateIdx]! + (pub.cd[i]! - pub.state[c.stateIdx]!)) };
    } else v = this.publicLean(year);
    this.leanCache = { year, v };
    return v;
  }

  private publicLean(year: number): { state: number[]; cd: number[] } {
    const w = this.w, L = w.lean;
    const nat = (100 * (2 * L.national.d - L.national.t)) / Math.max(1, L.national.t);
    return publishedLean(w.seed, year, w.pack.states.map((_, s) => leanMargin(L.state, s)), w.pack.states.map((s) => s.division), w.districts.cds.map((_, i) => leanMargin(L.cd, i)), w.districts.cds.map((c) => c.stateIdx), nat);
  }

  /** Forecast cadence: weekly from June, daily in the final 100 days, through Election Day morning. */
  private forecastDue(day: DayNumber, gDay: number | null): boolean {
    if (gDay === null || day > gDay) return false;
    const left = gDay - day, c = daysToCivil(day);
    if (left <= 100) return true;
    return c.m >= 6 && (day - gDay) % 7 === 0;
  }

  private async forecastRun(day: DayNumber, races: Race[]): Promise<void> {
    const w = this.w, year = daysToCivil(day).y, gDay = this.generalDay(year);
    if (!this.forecastDue(day, gDay)) return;
    const tStart = performance.now();
    const lean = this.leanIndex(year);
    const presOffice = w.offices.find((o) => o.kind === 'president')!;
    const presParty = w.current.get(presOffice.id)?.partyId ?? PARTY_D;
    const sign = presParty === PARTY_D ? 1 : -1;
    const terms = this.db.all<{ party_id: number }>('SELECT party_id FROM office_term WHERE office_id = ? ORDER BY start_time DESC LIMIT 2', [presOffice.id]);
    // Fundamentals from the Public Record: the midterm and third-term penalties, the President's approval
    // average, and released economic figures (growth and the change in unemployment over a year).
    const pub = this.E.host.publicFundamentals(day);
    let fm = (year % 4 === 2 ? -4 : 0) + (year % 4 === 0 && terms.length === 2 && terms.every((t) => t.party_id === presParty) ? -2 : 0);
    if (pub.approval !== null) fm += 0.2 * (pub.approval - 47);
    if (pub.gdp !== null) fm += 0.5 * Math.max(-4, Math.min(4, pub.gdp - 2));
    if (pub.unempChange !== null) fm -= 1.2 * Math.max(-2, Math.min(4, pub.unempChange));
    const fundamentals = { mean: sign * fm, sd: pub.approval !== null ? 4.5 : 5 };
    const natRace = this.averages.get(`PN:${year}`) ?? this.averages.get(`GB:${year}`);
    const fr: ForecastRace[] = [];
    const lastPollOf = new Map<string, number>();
    for (const p of this.polls) if (p.published < at(day + 1, 0)) lastPollOf.set(p.race, Math.max(lastPollOf.get(p.race) ?? -1, p.end));
    const cashOf = (rk: string, person: number | null) => (person === null ? 0 : this.st.campaigns[`${rk}|${person}`]?.cash ?? 0);
    for (const r of races) {
      if (r.kind !== 'pres_state' && !(r.kind === 'general' && ['us_senator', 'governor', 'us_representative'].includes(r.office))) continue;
      const d = r.options.find((o) => o.party === PARTY_D), q = r.options.find((o) => o.party === PARTY_R);
      const div = r.stateIdx !== null ? w.pack.states[r.stateIdx]!.division : 0;
      const leanR = r.cd !== null ? lean.cd[r.cd]! : r.stateIdx !== null ? lean.state[r.stateIdx]! : 0;
      // Parties still choosing a nominee count as contesting the seat (with a generic candidate until then).
      const hasD = !!d || !!r.awaiting?.some((p) => p === PARTY_D || p === 0), hasR = !!q || !!r.awaiting?.some((p) => p === PARTY_R || p === 0);
      let cand = 0;
      if (r.contestId !== null && hasD && hasR) {
        let inc = this.incCache.get(r.contestId);
        // Incumbents on the general ballot, or running in a primary that has not been held yet.
        if (!inc) { inc = this.db.all<{ party_id: number }>("SELECT party_id FROM candidacy WHERE contest_id = ? AND incumbent = 1 UNION ALL SELECT k.party_id FROM candidacy k JOIN contest p ON p.contest_id = k.contest_id WHERE p.next_contest = ? AND p.status IN ('set','filing') AND k.incumbent = 1", [r.contestId, r.contestId]); this.incCache.set(r.contestId, inc); }
        const incEff = r.office === 'us_representative' ? 3 : r.office === 'us_senator' ? 2 : 1.5;
        for (const i of inc) cand += i.party_id === PARTY_D ? incEff : i.party_id === PARTY_R ? -incEff : 0;
        const cd = d ? cashOf(r.campaign, d.personId) : 0, cr = q ? cashOf(r.campaign, q.personId) : 0;
        if (d && q && cd + cr > 0) cand += 2 * Math.tanh(Math.log((cd + 1) / (cr + 1)) / 2);
      }
      const avg = this.averages.get(r.key);
      const lastPoll = lastPollOf.get(r.key) ?? -1;
      fr.push({
        key: r.key, kind: r.kind === 'pres_state' ? 'pres_state' : (r.office as ForecastRace['kind']), label: r.label, state: r.stateIdx ?? 0, division: div, ev: r.ev,
        lean: leanR, candidate: cand, poll: avg?.margin && d && q ? { mean: avg.margin.mean, sd: (avg.margin.hi - avg.margin.lo) / 2.563, n: avg.polls, age: day - lastPoll } : null,
        contested: hasD && hasR, sure: hasD && !hasR ? PARTY_D : hasR && !hasD ? PARTY_R : 0,
      });
    }
    if (!fr.length) return;
    const holdD = this.holdovers(year, PARTY_D), holdR = this.holdovers(year, PARTY_R);
    const vp = w.offices.find((o) => o.kind === 'vice_president')!;
    const input: ForecastInput = {
      seed: w.seed, year, asOf: day, daysLeft: (gDay ?? day) - day, fundamentals,
      national: natRace?.margin ? { mean: natRace.margin.mean, sd: (natRace.margin.hi - natRace.margin.lo) / 2.563, n: natRace.polls } : null,
      races: fr, chambers: { senate: { holdD, holdR, seats: 100 }, house: { seats: 435 } }, vpParty: w.current.get(vp.id)?.partyId ?? PARTY_D, presidential: year % 4 === 0 && fr.some((x) => x.kind === 'pres_state'),
      draws: 1500,
    };
    const TT = (globalThis as unknown as { __seasonT?: Record<string, number> }).__seasonT; const tq = performance.now();
    if (TT) TT.fcInput = (TT.fcInput ?? 0) + tq - tStart;
    const out = runForecast(input);
    if (TT) TT.fcRun = (TT.fcRun ?? 0) + performance.now() - tq;
    this.forecast = { day, out };
    this.st.lastForecast = day;
    const summary = JSON.stringify({ president: out.president ? { pD: out.president.pD, evMean: out.president.evMean } : null, senate: out.senate ? { pD: out.senate.pD, mean: out.senate.mean } : null, house: out.house ? { pD: out.house.pD, mean: out.house.mean } : null, national: out.national });
    const payload = await gzip(new TextEncoder().encode(JSON.stringify({ out, races: fr.map((x) => ({ key: x.key, label: x.label, kind: x.kind, state: x.state, ev: x.ev, lean: x.lean })) })));
    this.pend.forecasts.push({ year, asOf: day, summary, payload });
    if (day === gDay! - 100 || (out.president && (gDay! - day) % 14 === 0)) {
      const p = out.president;
      this.E.host.news('forecast', p ? `Forecast: ${p.pD >= 0.5 ? 'Democrats' : 'Republicans'} favoured to win the presidency (${Math.round(100 * Math.max(p.pD, p.pR))}%)` : 'Forecast update',
        `${p ? `Expected electoral votes for the Democratic ticket: ${Math.round(p.evMean)}. ` : ''}${out.senate ? `Senate control: Democrats ${Math.round(100 * out.senate.pD)}%. ` : ''}${out.house ? `House control: Democrats ${Math.round(100 * out.house.pD)}%.` : ''}`, {}, at(day, 9));
    }
  }

  private holdovers(year: number, party: number): number {
    const w = this.w;
    const up = new Set(this.db.all<{ office_id: number }>("SELECT c.office_id FROM contest c JOIN office o ON o.office_id = c.office_id WHERE c.year = ? AND c.kind IN ('general','special') AND o.kind = 'us_senator'", [year]).map((r) => r.office_id));
    return w.offices.filter((o) => o.kind === 'us_senator' && !up.has(o.id) && w.current.get(o.id)?.partyId === party).length;
  }

  /** The latest forecast of a race (for the election-night desk's prior): mean margin (D−R) and SD, points. */
  forecastFor(raceKey: string): { mean: number; sd: number } | null {
    const r = this.forecast?.out.races.find((x) => x.key === raceKey);
    return r ? { mean: r.mean, sd: Math.max(1.5, (r.hi80 - r.lo80) / 2.563) } : null;
  }

  // ---- Finance reports --------------------------------------------------------------------------------------------

  private finance(day: DayNumber): void {
    const c = daysToCivil(day);
    const quarter = (c.m === 1 && c.d === 31) || (c.d === 15 && [4, 7, 10].includes(c.m));
    if (!quarter) return;
    for (const [k, v] of Object.entries(this.st.campaigns)) {
      const ck = k.slice(0, k.lastIndexOf('|'));
      const contest = ck.startsWith('C:') ? Number(ck.slice(2)) : null;
      const cand = contest !== null ? this.db.value<number>('SELECT candidacy_id FROM candidacy WHERE contest_id = ? AND person_id = ?', [contest, v.person]) : null;
      if (cand !== null && cand !== undefined) this.pend.finance.push([cand, day, Math.round(v.raised), Math.round(v.spent), Math.round(v.cash)]);
    }
  }

  // ---- The day ----------------------------------------------------------------------------------------------------

  async daily(day: DayNumber): Promise<void> {
    const year = daysToCivil(day).y;
    if (!this.E.state.plannedYears.includes(year)) return;
    const gDay = this.generalDay(year);
    const anyFuture = gDay !== null && gDay >= day;
    if (!anyFuture) return;
    this.E.host.progress('Campaigns, polls and forecasts', 0);
    await this.loadPolls(year);
    const T0 = (globalThis as unknown as { __seasonT?: Record<string, number> }).__seasonT; const r0 = performance.now();
    const races = this.races(day);
    if (T0) T0.buildRaces = (T0.buildRaces ?? 0) + performance.now() - r0;
    if (!races.length) return;
    const T = (globalThis as unknown as { __seasonT?: Record<string, number> }).__seasonT;
    let t = performance.now();
    const lap = (k: string) => { if (T) { const n = performance.now(); T[k] = (T[k] ?? 0) + n - t; t = n; } };
    lap('races');
    this.campaigns(day, races); lap('campaigns');
    this.debates(day, races);
    this.endorsements(day, races); lap('endorse');
    this.finance(day);
    this.publish(day); lap('publish');
    await this.fieldwork(day, races); lap('fieldwork');
    await this.forecastRun(day, races); lap('forecast');
  }

  /** Load the year's polls, averages and latest forecast (before anything reads them, e.g. after a reload). */
  async ensure(year: number): Promise<void> { await this.loadPolls(year); }

  /** The current polling average of a race (public). */
  averageOf(key: string): AverageOut | undefined { return this.averages.get(key); }

  /** Called when a race's election is held (after realization): its campaigns are done. */
  clearDayCache(): void { this.dayRaces = null; }

  /** Description of a day for logs. */
  static label(day: DayNumber): string { return formatDay(day, true); }
}

const SCANDALS = ['campaign finance filings', 'a past business deal', 'statements to investigators', 'a former aide\'s allegations', 'undisclosed lobbying contacts', 'use of official resources'];
const GAFFES = ['remarks at a fundraiser', 'an off-the-cuff comment on the economy', 'a misstatement about the state\'s history', 'a heated exchange with a reporter', 'a widely shared interview answer'];
function pick<T>(r: Rng, xs: readonly T[]): T { return xs[r.int(xs.length)]!; }
