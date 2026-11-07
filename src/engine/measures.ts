/**
 * Ballot measures (Phase 7.3): which measures each state's ballot carries, what they propose, how voters decide
 * them, and what passing one does.
 *
 * - **How many:** per election and state, by the state's law and how active its ballot is (rules/measures2016):
 *   citizen initiatives where the law allows them, measures referred by the legislature, now and then a veto
 *   referendum. Even-year Novembers mostly; a few states also vote on measures in odd years.
 * - **What:** a topic (rules/measures2016 TOPICS) — a direction in the electorate's issue space — and a position along
 *   it relative to the state's own voters: legislatures refer measures close to the state's centre (they pass more
 *   often), initiatives are drafted by advocates (they fail more often). Parties take sides when their platforms
 *   differ along the topic's direction. Election-law topics come up more after "spoiler" races, as in the
 *   legislative sessions of Phase 7.1.
 * - **How voters decide:** on the issue (where each voter class stands along the topic's direction), with a pull
 *   toward the status quo, a party cue when the parties take sides, and more voters skipping low-profile questions.
 * - **What passing does:** election-law measures change the state's election law from the next January 1 (source
 *   "initiative"); other measures are enacted and recorded but change nothing else in the simulation.
 * - **Polls and the night:** the two most prominent measures of each state's ballot are polled and called on the
 *   broadcast night; the others are counted and certified.
 */
import { Rng } from '../core/rng';
import { civilToDays, formatDay } from '../core/time';
import { MEASURE_NO, MEASURE_YES } from '../institutions/model';
import { N_CLASS } from '../electorate/kernel';
import { N_COHORTS } from '../population/cohorts';
import { MEASURE_KIND_LABEL, MEASURE_RULES_2016, TOPICS, isInitiative, passes, thresholdFor, thresholdText, type LawEffect, type MeasureKind, type Threshold, type Topic } from '../rules/measures2016';
import type { LawChangeFields, StateLaw } from '../rules/electionLaw';
import { enactLaw } from './lawStore';
import { primaryBeforeTopFour, recentOutcomes } from './electionReform';
import { legislatureName } from './downballot';
import type { ElectionEngine } from './elections';
import type { World } from './world';

/** What the ballot kernel needs of a measure (stored with it). */
export interface MeasureParams {
  /** Issue-space direction of a yes vote, the cut point along it and the scale (the state's spread). */
  dir: number[]; cut: number; scale: number;
  /** Strength of the issue position, baseline lean to yes, pull of the status quo, party cue (+: Democrats for yes). */
  kappa: number; lean: number; statusQuo: number; cue: number;
  salience: number;
}

export interface MeasureRow {
  contest_id: number; state_idx: number; year: number; name: string; title: string; summary: string; kind: MeasureKind; topic: string; sponsor: string;
  threshold_json: string; params_json: string; parties_json: string; effect: LawEffect | null; salience: number; polled: number; outcome: string | null; law_id: number | null;
}

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

/** Where a state's voters stand along a direction: the class-weighted mean and spread of the voter classes' positions. */
export function stateMoments(w: World, classOf: Uint8Array, centroids: number[][], stateIdx: number, dir: readonly number[]): { mean: number; sd: number; byClass: number[] } {
  const wts = new Float64Array(N_CLASS);
  for (const c of w.pack.counties) {
    if (c.stateIdx !== stateIdx) continue;
    const v = w.pop.countyVep[c.idx]!; if (!(v > 0)) continue;
    for (let k = 0; k < N_COHORTS; k++) wts[classOf[k]!]! += v * w.pop.countyJoint[c.idx * N_COHORTS + k]!;
  }
  const tot = wts.reduce((a, x) => a + x, 0) || 1;
  const byClass = centroids.map((cen) => dot(cen, dir));
  const mean = byClass.reduce((s, p, h) => s + p * wts[h]! / tot, 0);
  const sd = Math.sqrt(byClass.reduce((s, p, h) => s + (p - mean) ** 2 * wts[h]! / tot, 0));
  return { mean, sd, byClass };
}

/** Expected number of measures of each kind on a state's ballot in a year (a deterministic draw per seed, year and state). */
export function measureCounts(seed: string, year: number, usps: string): { initiative: number; referral: number; veto: number } {
  const r = MEASURE_RULES_2016[usps];
  if (!r) return { initiative: 0, referral: 0, veto: 0 };
  const rng = Rng.stream(seed, 'measure-count', year, usps);
  const even = year % 2 === 0;
  const poisson = (m: number) => { if (m <= 0) return 0; let k = 0, p = Math.exp(-m), s = p; const u = rng.float(); while (u > s && k < 30) { k++; p *= m / k; s += p; } return k; };
  // Odd years: the states with odd-year measure elections, mostly referrals (initiatives in Washington, Ohio, Maine, Colorado).
  const oddInit = ['WA', 'OH', 'ME', 'CO'].includes(usps) ? 0.5 : 0;
  const initiative = r.initiative ? poisson(even ? r.activity.initiative : (r.activity.odd ?? 0) * oddInit) : 0;
  const referral = r.referrals ? poisson(even ? r.activity.referral : (r.activity.odd ?? 0) * (1 - oddInit)) : 0;
  const veto = r.vetoReferendum && even ? poisson(0.12) : 0;
  return { initiative, referral, veto };
}

/** Whether a topic can come before a state's voters under its current law. */
function applicable(t: Topic, law: StateLaw): boolean {
  const ranked = law.rcv.general !== 'none' || law.rcv.primaries || law.primaryType === 'top_four';
  switch (t.effect) {
    case 'rcv': return !ranked && law.primaryType !== 'jungle';
    case 'top_four': return !ranked && law.primaryType !== 'jungle';
    case 'top_two': return law.primaryType === 'open' || law.primaryType === 'semi' || law.primaryType === 'closed';
    case 'open_primaries': return law.primaryType === 'semi' || law.primaryType === 'closed';
    case 'repeal_rcv': return ranked;
    default: return true;
  }
}

/** The election-law change an election-law measure makes if it passes. */
export function lawChangeOf(effect: LawEffect, law: StateLaw, prior: () => StateLaw['primaryType']): { change: LawChangeFields; summary: string } {
  switch (effect) {
    case 'rcv': return law.primaryType === 'top_two'
      ? { change: { primaryType: 'top_four' }, summary: 'A top-four primary and ranked-choice voting in general elections for every office but President' }
      : { change: { rcv: { primaries: true, general: 'all' } }, summary: 'Ranked-choice voting in party primaries and in general elections for every office but President' };
    case 'top_four': return { change: { primaryType: 'top_four' }, summary: 'A top-four primary and ranked-choice voting in general elections for every office but President' };
    case 'top_two': return { change: { primaryType: 'top_two' }, summary: 'A top-two primary for every candidate, replacing party primaries' };
    case 'open_primaries': return { change: { primaryType: 'open' }, summary: 'Open party primaries' };
    case 'repeal_rcv': return law.primaryType === 'top_four'
      ? { change: { primaryType: prior(), rcv: { primaries: false, general: 'none' } }, summary: 'Ranked-choice voting and the top-four primary repealed' }
      : { change: { rcv: { primaries: false, general: 'none' } }, summary: 'Ranked-choice voting repealed; plurality voting restored' };
  }
}

/** A measure's number within its series ("Proposition 51", "I-182", "Question 3"). */
function measureName(prefix: string, n: number): string { return prefix.endsWith('-') ? `${prefix}${n}` : `${prefix} ${n}`; }

/**
 * The measures of a state's election in `year`: topics, positions, party sides and names; inserted as contests
 * (kind 'measure') on the election, with their Yes and No candidacies and a ballot_measure row each. Returns the
 * labels of the contests created.
 */
export function createMeasures(E: ElectionEngine, year: number, stateIdx: number, electionId: number, officeId: number, termStart: number | null): string[] {
  const w = E.w, db = E.db, st = w.pack.states[stateIdx]!, rules = MEASURE_RULES_2016[st.usps];
  if (!rules) return [];
  const counts = measureCounts(w.seed, year, st.usps);
  const total = counts.initiative + counts.referral + counts.veto;
  if (!total) return [];
  const r = Rng.stream(w.seed, 'measures', year, stateIdx);
  const day = db.value<number>('SELECT day FROM election WHERE election_id = ?', [electionId])!;
  const law = w.law.on(stateIdx, day);
  const { spoilerLosers, rcvReversedLeaders } = recentOutcomes(db, stateIdx, year);
  const recent = new Set(db.all<{ topic: string }>("SELECT topic FROM ballot_measure WHERE state_idx = ? AND year >= ? AND outcome = 'passed'", [stateIdx, year - 8]).map((x) => x.topic));
  const plat = w.electorate.params.platforms;
  const cls = E.cls;
  const leg = legislatureName(st.usps);
  const used = new Set<string>();
  type Draft = { kind: MeasureKind; topic: Topic; salience: number };
  const drafts: Draft[] = [];
  const pick = (by: 'initiative' | 'referral' | 'veto'): Topic | null => {
    const pool = TOPICS.filter((t) => t.by.includes(by) && !used.has(t.key) && !recent.has(t.key) && applicable(t, law)
      && !(t.key === 'med_marijuana' && (used.has('marijuana') || recent.has('marijuana'))) && !(t.key === 'marijuana' && used.has('med_marijuana')));
    if (!pool.length) return null;
    const wt = pool.map((t) => t.weight * (t.effect === 'rcv' || t.effect === 'top_four' ? 1 + 2 * Math.min(2, spoilerLosers.length) : t.effect === 'repeal_rcv' ? 1 + 3 * Math.min(1, rcvReversedLeaders.length) : 1));
    const t = pool[r.weighted(wt)]!; used.add(t.key); return t;
  };
  for (let i = 0; i < counts.initiative; i++) {
    const t = pick('initiative'); if (!t) break;
    const amendment = rules.initiative!.amendment && (t.amendment || !rules.initiative!.statute) || (!rules.initiative!.statute && rules.initiative!.amendment);
    drafts.push({ kind: amendment ? 'initiative_amendment' : 'initiative_statute', topic: t, salience: Math.min(1, t.salience + r.normal(0, 0.12)) });
  }
  for (let i = 0; i < counts.referral; i++) {
    const t = pick('referral'); if (!t) break;
    drafts.push({ kind: t.bond ? 'bond' : t.amendment || r.bernoulli(0.7) ? 'legislative_amendment' : 'legislative_statute', topic: t, salience: Math.min(1, t.salience * 0.85 + r.normal(0, 0.1)) });
  }
  for (let i = 0; i < counts.veto; i++) {
    const t = pick('veto'); if (!t) break;
    drafts.push({ kind: 'veto_referendum', topic: t, salience: Math.min(1, t.salience + 0.1 + r.normal(0, 0.1)) });
  }
  if (!drafts.length) return [];
  // The two most prominent are polled and called on the broadcast night.
  const ranked = drafts.map((d, i) => ({ i, s: d.salience + 0.05 * r.float() })).sort((a, b) => b.s - a.s).slice(0, 2).map((x) => x.i);
  // Names: continuing series count every earlier measure of the series; others number this election's measures from 1.
  const nextIn = new Map<string, number>();
  const out: string[] = [];
  const govVotes = 0.5 * w.pop.stateVep[stateIdx]!;
  drafts.forEach((d, i) => {
    const series = isInitiative(d.kind) || d.kind === 'veto_referendum' ? 'initiative' : 'referral';
    const prefix = rules.name[series];
    const start = rules.name.start?.[series];
    let n = nextIn.get(prefix);
    if (n === undefined) n = start !== undefined ? start + Number(db.value<number>('SELECT COUNT(*) FROM ballot_measure WHERE state_idx = ? AND name LIKE ?', [stateIdx, `${prefix}%`]) ?? 0) : 1;
    nextIn.set(prefix, n + 1);
    const name = measureName(prefix, n);
    // Position: relative to the state's voters (legislatures near the centre; advocates further out).
    const m = stateMoments(w, cls.classOf, cls.centroids, stateIdx, d.topic.dir);
    const scale = Math.max(0.08, m.sd);
    const delta = isInitiative(d.kind) ? r.normal(-0.15, 0.6) : d.kind === 'veto_referendum' ? r.normal(0, 0.5) : r.normal(-0.75, 0.45);
    const pD = dot(plat.D, d.topic.dir), pR = dot(plat.R, d.topic.dir);
    const gap = (pD - pR) / Math.max(0.1, 2 * scale);
    const cue = d.topic.partisan * Math.max(-1, Math.min(1, gap));
    const params: MeasureParams = {
      dir: [...d.topic.dir], cut: m.mean + delta * scale, scale, kappa: 0.5 + 1.1 * d.salience, lean: d.topic.lean + r.normal(0, 0.25),
      statusQuo: 0.25 + 0.2 * (1 - d.salience), cue: Math.round(1000 * cue) / 1000, salience: Math.round(1000 * d.salience) / 1000,
    };
    const parties: Record<string, 'yes' | 'no' | null> = { D: Math.abs(cue) >= 0.25 ? (cue > 0 ? 'yes' : 'no') : null, R: Math.abs(cue) >= 0.25 ? (cue > 0 ? 'no' : 'yes') : null };
    const threshold: Threshold = thresholdFor(st.usps, d.kind);
    const sponsor = isInitiative(d.kind) ? `Placed on the ballot by petition (about ${Math.round(rules.initiative!.signatures * govVotes / 1000) * 1000 || 1000} signatures needed)`
      : d.kind === 'veto_referendum' ? `Petition to overturn a law the ${leg} passed in ${year - 1}` : `Referred to the voters by the ${leg}`;
    const sides = [parties.D && `Democrats: ${parties.D}`, parties.R && `Republicans: ${parties.R}`].filter(Boolean).join(' · ');
    const summary = `${MEASURE_KIND_LABEL[d.kind]}. A yes vote would ${d.topic.title.charAt(0).toLowerCase()}${d.topic.title.slice(1)}. Passing requires ${thresholdText(threshold)}.${sides ? ` Party positions: ${sides}.` : ''}`;
    const label = `${year} ${st.name} ${name}`;
    db.run('INSERT INTO contest(election_id, office_id, kind, party_id, state_idx, district_idx, method, label, status, winner_candidacy, runner_up_candidacy, term_start, parent_contest, next_contest, ev, year, nonpartisan) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [electionId, officeId, 'measure', null, stateIdx, null, 'measure', label, 'set', null, null, termStart, null, null, null, year, 1]);
    const cid = Number(db.value('SELECT last_insert_rowid()'));
    for (const [o, id] of [[0, MEASURE_YES], [1, MEASURE_NO]] as const) db.run('INSERT INTO candidacy(contest_id, person_id, party_id, ballot_order, incumbent, running_mate, status, quality) VALUES (?,?,?,?,?,?,?,?)', [cid, id, id, o, 0, null, 'running', 0.5]);
    db.run('INSERT INTO ballot_measure VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [cid, stateIdx, year, name, d.topic.title, summary, d.kind, d.topic.key, sponsor, JSON.stringify(threshold), JSON.stringify(params),
      JSON.stringify(parties), d.topic.effect ?? null, params.salience, ranked.includes(i) ? 1 : 0, null, null]);
    out.push(label);
  });
  E.host.news('measures', `${st.name}: ${drafts.length} measure${drafts.length === 1 ? '' : 's'} on the ${year} ballot`, drafts.map((d) => d.topic.title).slice(0, 4).join('; ') + (drafts.length > 4 ? '; …' : ''), { state: stateIdx });
  return out;
}

/** Measures' kernel parameters and facts, loaded on demand (one row per measure contest). */
export class MeasureStore {
  private cache = new Map<number, MeasureRow | null>();
  constructor(private readonly E: ElectionEngine) {}
  row(contestId: number): MeasureRow | null {
    let m = this.cache.get(contestId);
    if (m === undefined) { m = this.E.db.get<MeasureRow>('SELECT * FROM ballot_measure WHERE contest_id = ?', [contestId]) ?? null; if (this.cache.size > 2000) this.cache.clear(); this.cache.set(contestId, m); }
    return m;
  }
  params(contestId: number): MeasureParams | null { const m = this.row(contestId); return m ? JSON.parse(m.params_json) as MeasureParams : null; }
  forget(contestId: number): void { this.cache.delete(contestId); }
}

/**
 * Decide a measure from its votes (yes, no, blank ballots): record the outcome; a passed election-law measure
 * changes the state's law from the next January 1.
 */
export function decideMeasure(E: ElectionEngine, contestId: number, yes: number, no: number, ballots: number): boolean {
  const db = E.db, w = E.w;
  const m = db.get<MeasureRow>('SELECT * FROM ballot_measure WHERE contest_id = ?', [contestId]); if (!m) return yes > no;
  const t = JSON.parse(m.threshold_json) as Threshold;
  const ok = passes(t, yes, no, ballots);
  let lawId: number | null = null;
  const st = w.pack.states[m.state_idx]!;
  const pct = yes + no > 0 ? `${(100 * yes / (yes + no)).toFixed(1)}%` : '—';
  if (ok && m.effect) {
    const effective = civilToDays(m.year + 1, 1, 1);
    const law = w.law.on(m.state_idx, effective);
    const d = lawChangeOf(m.effect, law, () => primaryBeforeTopFour(w.law, st.usps, m.state_idx, effective));
    const c = enactLaw(db, w.law, { stateIdx: m.state_idx, enacted: w.time, effective, source: 'initiative', change: d.change, summary: `${d.summary} (${m.name})` });
    lawId = c.id;
    E.host.news('election_law', `${st.name} voters change the election law: ${d.summary.charAt(0).toLowerCase()}${d.summary.slice(1)}`, `${m.name} passed with ${pct} yes; it takes effect on ${formatDay(effective, true)}.`, { state: m.state_idx });
  }
  db.run('UPDATE ballot_measure SET outcome = ?, law_id = ? WHERE contest_id = ?', [ok ? 'passed' : 'failed', lawId, contestId]);
  E.measures.forget(contestId);
  if (m.polled || m.effect || m.salience >= 0.6) E.host.news('results', `${st.name} ${m.name} ${ok ? 'passes' : 'fails'}`, `${m.title}: ${pct} yes${t.kind !== 'majority' ? ` (${thresholdText(t)} needed)` : ''}.`, { contestId, state: m.state_idx });
  return ok;
}
