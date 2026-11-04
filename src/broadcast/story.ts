/**
 * Alerts and commentary (docs/architecture/08 §8.6): a deterministic pipeline over the night record.
 *
 *  1. Detection — typed stories with facts drawn only from the record (and the archive as of the night):
 *     poll closings, first votes, lead changes, margin moves with their cause (which jurisdictions reported),
 *     outstanding vote, projections (hold or flip, balance of power, historic notes), control, electoral
 *     votes, withdrawals, runoffs, recount watch, late counts, turnout and field reports.
 *  2. Scheduling — speaking slots every few minutes; the most important fresh story wins, subject to
 *     per-race and per-type cooldowns and novelty; speakers rotate within the story's roles.
 *  3. Realization — several templates per story type, each with the facts it requires; optional clauses are
 *     used only when their facts exist; numbers are rounded as people speak; recent templates are avoided.
 *  4. Validation — a line with any unbound slot is dropped, never shown.
 */
import { Rng } from '../core/rng';
import { formatTime } from '../core/time';
import { surname } from '../core/names';
import type { NightRecord, Story, StoryAlert, StoryLine } from '../counting/record';
import { ST_CALLED, ST_RUNOFF, ST_TOO_CLOSE, ST_TOO_EARLY, ST_WITHDRAWN } from '../counting/types';

export interface StoryRace {
  label: string; short: string; office: string; state: string; stateName: string; cd: number; ev: number;
  /** Spoken district ("Ohio's 9th District") for House and presidential district races. */
  district?: string;
  candidates: { name: string; party: number }[];
  /** Party holding the seat (or that carried the state for President) before this election. */
  prevParty: number | null;
  /** Party → the last year it won this seat or state in the archive. */
  lastWon: Record<number, number>;
  eligible: number;
  /** Automatic-recount threshold (fraction of votes), 0 = none. */
  recount: number;
}
export interface StoryContext { seed: string; year: number; races: StoryRace[]; rjNames: Record<number, string> }

export const SPEAKERS = [
  { name: 'Dana Whitfield', role: 'anchor' },
  { name: 'Marcus Oyelaran', role: 'data desk' },
  { name: 'Priya Kessler', role: 'political analyst' },
  { name: 'Tom Albrecht', role: 'political analyst' },
  { name: 'Lena Moravec', role: 'correspondent' },
] as const;
const ANCHOR = 0, DATA = 1, ANALYSTS = [2, 3], CORRESPONDENT = 4;

const PARTY = { 1: 'Democratic', 2: 'Republican', 3: 'Libertarian', 4: 'Green', 5: 'independent' } as Record<number, string>;
const PLURAL = { 1: 'Democrats', 2: 'Republicans', 3: 'Libertarians', 4: 'Greens', 5: 'independents' } as Record<number, string>;
const ABBR = { 1: 'D', 2: 'R', 3: 'L', 4: 'G', 5: 'I' } as Record<number, string>;
const MODE_WORD = ['Election Day', 'early in-person', 'mail', 'provisional'];

// ---- Spoken numbers ---------------------------------------------------------------------------------
/** A vote count as spoken, without a qualifier: "41,000", "1.2 million". */
export function spoken(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(Math.round(a / 1e5) / 10).toLocaleString('en-US')} million`;
  if (a >= 10000) return (Math.round(a / 1000) * 1000).toLocaleString('en-US');
  if (a >= 1000) return (Math.round(a / 100) * 100).toLocaleString('en-US');
  return Math.max(10, Math.round(a / 10) * 10).toLocaleString('en-US');
}
export const about = (n: number) => `about ${spoken(n)}`;
const pts = (m: number) => { const a = Math.round(Math.abs(m) * 10) / 10; return `${a.toFixed(1)} point${a === 1 ? '' : 's'}`; };
const pct = (x: number) => `${Math.max(1, Math.min(99, Math.round(100 * x)))} percent`;
const list = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const clock = (t: number) => {
  const s = formatTime(t, 'America/New_York').replace(/ E[SD]T$/, '');
  const m = /^(\d+):(\d\d) (AM|PM)$/.exec(s);
  return m ? `${m[1]}${m[2] === '00' ? '' : `:${m[2]}`} ${m[3] === 'AM' ? 'a.m.' : 'p.m.'}` : s;
};

// ---- Templates --------------------------------------------------------------------------------------
type Facts = Record<string, string | number | boolean | undefined | null>;
/** A template: text with {slot}s and [[fact| optional clause]]s; `when` facts must be bound, `not` facts unbound. */
interface Tpl { id: string; text: string; when?: string[]; not?: string[] }

const T: Record<string, Tpl[]> = {
  polls_closed: [
    { id: 'pc1', text: "It's {clock} in the East, and polls have now closed in {states}.[[calls| MNN can project {calls}.]][[openList| {openList} {openVerb} too early to call.]]" },
    { id: 'pc2', text: 'Polls are closed in {states}.[[calls| Based on the voter survey and the votes counted so far, MNN projects {calls}.]][[openList| We are not ready to make a call in {openList}.]]' },
    { id: 'pc3', text: 'The polls have just closed in {states}.[[calls| Our decision desk projects {calls}.]][[openList| {openList} {openVerb} too early to call.]]' },
    { id: 'pc4', text: '{clock}: voting has ended in {states}.[[calls| MNN projects {calls}.]][[openList| For {openList}, we will wait for the count.]]' },
    { id: 'pc5', text: 'A new wave of poll closings at {clock}: {states}.[[calls| We can project {calls}.]][[openList| No call yet in {openList}.]]' },
  ],
  first_votes: [
    { id: 'fv1', text: 'The first votes are in from {where1}: {leader} leads with {share}, with {pctin} of the expected vote counted[[mode|, mostly {mode} ballots]].' },
    { id: 'fv2', text: 'We have our first numbers in {race}. {leader} is ahead, {share}, but only {pctin} of the expected vote is in[[mode|, most of it {mode} votes]].' },
    { id: 'fv3', text: 'Early returns in {race} show {leader} out front with {share}[[mode|, largely from {mode} ballots]]. It is very early: {pctin} of the expected vote.' },
    { id: 'fv4', text: 'First results in {race}: {leader}, {share}. Remember, that is only {pctin} of the vote we expect[[mode|, and mostly {mode} ballots]].' },
  ],
  lead_change: [
    { id: 'lc1', text: '{gainer} has taken the lead in {race} after {cause}. {gainerLast} is now ahead by {margin}[[outN|, with about {outN} votes still to be counted]].' },
    { id: 'lc2', text: 'A lead change in {race}: {gainer} moves ahead of {other} after {cause}.[[outN| There are still about {outN} votes outstanding.]]' },
    { id: 'lc3', text: 'Look at {race}. {Cause} just put {gainer} in front, by {margin}.[[whereVote| But {whereVote} are still out in {where}.]]' },
    { id: 'lc4', text: '{gainer} now leads {other} in {race}. The change came with {cause}.' },
    { id: 'lc5', text: 'New leader in {race}: {gainer}, by {margin}, after {cause}.[[pctin| We have {pctin} of the expected vote.]]' },
    { id: 'lc6', text: '{race} has flipped on the board: {gainer} pulls ahead of {other} with {cause}.' },
  ],
  seesaw: [
    { id: 'ss1', text: 'The lead in {race} has now changed hands {changes} times tonight. {leader} is ahead by {margin} at the moment.' },
    { id: 'ss2', text: '{race} keeps going back and forth: {changes} lead changes so far, and {leader} is up by {margin} right now.' },
  ],
  margin_move: [
    { id: 'mm1', when: ['narrowed'], text: '{gainer} has cut {leaderPoss} lead in {race} to {margin} after {cause}.[[where| Substantial votes remain in {where}[[beneficiary|, where {beneficiary} has been running ahead]].]]' },
    { id: 'mm2', when: ['narrowed'], text: '{race} is tightening: {leaderPoss} lead is down to {margin} after {cause}.[[outN| There are still about {outN} votes out.]]' },
    { id: 'mm5', when: ['narrowed'], text: 'After {cause}, {leaderPoss} lead in {race} has shrunk to {margin}, {moved}.' },
    { id: 'mm3', when: ['widened'], text: '{leader} has stretched the lead in {race} to {margin} after {cause}.[[where| The big question is {where}, where votes are still being counted.]]' },
    { id: 'mm4', when: ['widened'], text: 'After {cause}, {leader} now leads {race} by {margin}, {moved}.' },
    { id: 'mm6', when: ['widened'], text: '{leader} is pulling away in {race}: up {margin} after {cause}.[[outN| About {outN} votes remain.]]' },
  ],
  outstanding: [
    { id: 'os1', text: 'Where is the vote left in {race}? Mostly in {where}: roughly {outN} votes{whereShare}.[[beneficiary| {beneficiary} has been winning those places.]]' },
    { id: 'os2', text: 'With {pctin} of the expected vote counted in {race}, {leader} leads by {margin}. The outstanding vote, about {outN}, is concentrated in {where}.' },
    { id: 'os3', text: 'Keep an eye on {where}: that is where much of the vote still to be counted in {race} is, about {outN} ballots.[[beneficiary| It has been good territory for {beneficiary}.]]' },
    { id: 'os4', text: 'Let us go to the map in {race}. {leader} leads by {margin}, but {where} still {whereHave} {whereVote} to report.[[beneficiary| That is {beneficiary} country.]]' },
    { id: 'os5', text: 'The math in {race}: about {outN} votes left, mostly in {where}.[[beneficiary| {beneficiary} has been carrying those areas so far.]]' },
  ],
  projection: [
    { id: 'pj1', text: 'MNN can now project that {winner} will win {race}.[[flip| That is a {winnerParty} pickup.]][[hold| {winnerPlural} hold the seat.]][[balance| {balance}]][[historic| {historic}]]' },
    { id: 'pj2', text: 'A projection: {winner} wins {race}.[[flip| A flip for the {winnerParty} Party.]][[hold| {winnerPlural} keep it.]][[balance| {balance}]]' },
    { id: 'pj3', text: 'MNN projects {winner} as the winner in {race}, with {pctin} of the expected vote counted.[[flip| {winnerPlural} take it from the {prevPlural}.]][[balance| {balance}]][[historic| {historic}]]' },
    { id: 'pj4', text: 'We have a call: {race} goes to {winner}.[[hold| No change in party there.]][[flip| That changes hands.]][[balance| {balance}]]' },
    { id: 'pj5', text: 'Our decision desk has made a projection in {race}: {winner} wins.[[flip| {winnerPlural} pick it up.]][[hold| A hold for the {winnerPlural}.]][[balance| {balance}]]' },
    { id: 'pj6', text: 'MNN projects {race} for {winner}.[[flip| The {prevPlural} lose it.]][[hold| {winnerPlural} keep it.]][[historic| {historic}]][[balance| {balance}]]' },
    { id: 'pj7', text: '{winner} will win {race}, MNN projects.[[flip| A {winnerParty} gain.]][[hold| No change in party.]][[balance| {balance}]]' },
    { id: 'pj8', text: 'Another projection to tell you about: {race}, {winner}.[[flip| That is a pickup for the {winnerPlural}.]][[hold| {winnerPlural} hold on.]][[balance| {balance}]]' },
  ],
  president: [
    { id: 'pr1', text: 'MNN projects that {winner} will be the next President of the United States. With {state}, {winnerShort} has {ev} electoral votes, past the 270 needed.' },
    { id: 'pr2', text: 'It is {clock}, and MNN can now project {winner} the winner of the presidential election. {state} puts {winnerShort} at {ev} electoral votes.' },
  ],
  hq: [
    { id: 'hq1', text: 'I am at the {winner} election-night party, where the room erupted as the projection came in. The candidate is expected to speak shortly.' },
    { id: 'hq2', text: 'Here with the {winner} campaign, supporters have been waiting for this moment all night. A big celebration is under way.' },
  ],
  field: [
    { id: 'fd1', text: 'At {winnerPoss} headquarters in {state}, a cheer just went up as our projection appeared on the screens.' },
    { id: 'fd2', text: 'Our team with the {winnerLast} campaign in {state} tells us the room is celebrating.[[loserLast| {loserLast} has not yet spoken.]]' },
    { id: 'fd3', text: 'In {state}, {winnerPoss} supporters are on their feet. It has been a long night for both campaigns here.' },
  ],
  control: [
    { id: 'ct1', text: 'MNN projects {plural} will control the {chamber}. {detail}.' },
    { id: 'ct2', text: 'A major projection: control of the {chamber} goes to the {party} Party. {detail}.' },
  ],
  control_field: [
    { id: 'cf1', text: 'At {party} Party headquarters, the reaction to the {chamber} projection was immediate: applause, and then chants.' },
    { id: 'cf2', text: 'The mood among {plural} here changed the moment the {chamber} projection came in.' },
  ],
  ev_update: [
    { id: 'ev1', text: '{leader} is now at {ev} electoral votes to {other2} {ev2}.[[need| {leaderLast} needs {need} more.]][[left| {left} still too close or too early to call.]]' },
    { id: 'ev2', text: 'The electoral count stands at {ev} for {leader}, {ev2} for {other}.[[need| That is {need} short of 270.]]' },
    { id: 'ev3', text: 'Here is the electoral scoreboard: {leader} {ev}, {other} {ev2}.[[left| {left} still to be decided.]]' },
  ],
  too_close: [
    { id: 'tc1', text: '{race} is too close to call. {leader} leads {other} by {margin} with {pctin} of the expected vote counted.' },
    { id: 'tc2', text: 'We are not able to make a projection in {race}: {leader} is ahead by {margin}[[outN|, and about {outN} votes are still out]].' },
    { id: 'tc3', text: '{race} remains too close to call, {leader} up by just {margin}.[[where| A lot depends on {where}.]]' },
    { id: 'tc4', text: 'Still no call in {race}. {leader} leads {other} by {margin}, with {pctin} of the vote in.' },
  ],
  withdrawn: [
    { id: 'wd1', text: 'MNN is withdrawing its projection in {race}. With more votes counted, {leader} now leads by {margin}, and the race is too close to call.' },
    { id: 'wd2', text: 'An important correction: our decision desk has withdrawn the projection in {race}. The race is now too close to call.' },
  ],
  runoff: [
    { id: 'ro1', text: 'MNN projects {race} is headed to a runoff between {a} and {b}: no candidate will reach a majority.' },
    { id: 'ro2', text: 'Nobody will clear 50 percent in {race}. MNN projects a runoff between {a} and {b}.' },
  ],
  recount: [
    { id: 'rc1', text: '{race} is inside the recount margin: {leader} leads by {marginVotes} votes with {pctin} of the expected vote counted.' },
    { id: 'rc2', text: "Recount watch in {race}: the margin is {marginVotes} votes, within the state's automatic recount threshold." },
  ],
  late_count: [
    { id: 'lt1', text: 'Counting in {state} will go on for days. About {outPct} of the expected vote is still out, and {race} remains uncalled.' },
    { id: 'lt2', text: 'Do not expect a result in {race} tonight: roughly {outN} votes are still to be counted.' },
    { id: 'lt3', text: '{race} will not be settled tonight. With {pctin} of the expected vote counted, {leader} leads by {margin}.' },
  ],
  turnout: [
    { id: 'to1', text: 'Turnout in {state} is on pace for about {turnout} of eligible voters, based on the expected vote.' },
    { id: 'to2', text: 'A note on turnout: {state} looks headed for roughly {turnout} of its eligible voters casting a ballot.' },
    { id: 'to3', text: 'Our expected-vote model puts {state} turnout at about {turnout} of the eligible population.' },
  ],
  major_county: [
    { id: 'mc1', text: 'A big batch just came in from {rj} in {race}: {batch} votes, breaking {batchShare} for {batchLeader}.' },
    { id: 'mc2', text: '{rj} has reported {batch} more votes in {race}, {batchShare} of them for {batchLeader}.' },
    { id: 'mc3', text: 'New numbers from {rj}: {batch} votes in {race}, and {batchLeader} took {batchShare} of them.' },
  ],
};

const SLOT = /\{(\w+)\}/g;
const OPT = /\[\[(\w+)\|((?:[^[\]]|\[(?!\[)|\](?!\]))*?)\]\]/g;
const fmt = (v: Facts[string]) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
const bound = (f: Facts, k: string) => {
  const v = f[k];
  return v !== undefined && v !== null && v !== '' && v !== false && !(typeof v === 'number' && !Number.isFinite(v));
};

/** Fill a template; returns null when a required slot has no fact (the line is never shown). */
export function realize(text: string, f: Facts): string | null {
  let out = text;
  // Optional clauses (innermost first): kept only if their condition holds and all their slots are bound.
  for (let i = 0; i < 3; i++) out = out.replace(OPT, (_, cond: string, inner: string) => (bound(f, cond) && [...inner.matchAll(SLOT)].every((m) => bound(f, m[1]!)) ? inner : ''));
  let ok = true;
  out = out.replace(SLOT, (_, k: string) => { if (!bound(f, k)) { ok = false; return ''; } return fmt(f[k]); });
  if (!ok) return null;
  out = out.replace(/\s+/g, ' ').replace(/\s([.,;:])/g, '$1').trim();
  // Every sentence starts with a capital letter.
  out = out.replace(/(^|(?<![ap]\.m)[.!?] )([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
  return validateLine(out) ? out : null;
}

/** The fact-binding validator: no unbound slots or placeholders ever reach the screen. */
export function validateLine(text: string): boolean {
  return !/[{}]|\[\[|\]\]|\bundefined\b|\bNaN\b|\bnull\b|Infinity/.test(text) && text.length > 4;
}

const usable = (tpl: Tpl, f: Facts) => (tpl.when ?? []).every((k) => bound(f, k)) && (tpl.not ?? []).every((k) => !bound(f, k));

// ---- Detection and scheduling --------------------------------------------------------------------------
/** Stories about the state of a count: stale once the race is called or a newer one exists. */
const COUNT_TYPES = new Set(['margin_move', 'outstanding', 'too_close', 'lead_change', 'seesaw', 'major_county', 'first_votes']);
interface Pending { time: number; type: string; race: number; importance: number; facts: Facts; speakers: number[]; ttl?: number }

export function buildStory(rec: Omit<NightRecord, 'story'>, ctx: StoryContext): Story {
  const R = rec.races.length;
  const rng = Rng.stream(ctx.seed, 'story', rec.lockTime);
  const alerts: StoryAlert[] = [];
  const lines: StoryLine[] = [];
  const votes = rec.races.map((r) => new Float64Array(r.k));
  const expected = new Float64Array(R);
  const st = rec.races.map(() => ({
    status: 0, option: -1, calledAt: -1, key: false, first: false, leader: -1, lastMargin: 0, lastPct: 0, lastStory: -1e9, lastOut: -1e9, lastOutPct: 0,
    lastLead: -1e9, changes: 0, seesaw: 0, turnout: false, pc: false, recentRj: new Map<number, { b: number; mode: Int32Array }>(),
  }));
  const X = (r: number) => ctx.races[r]!;
  const partRj = rec.parts.rj;
  // Per part: counted ballots and the wire's expected ballots (for "where the vote is").
  const partCounted = new Float64Array(partRj.length), partExpected = new Float64Array(partRj.length);
  const raceByRj = rec.races.map(() => new Map<number, Float64Array>());
  const called = new Map<number, number>(); // race → option
  const stateName = new Map<number, string>(), stateUsps = new Map<number, string>();
  rec.races.forEach((r, i) => { stateName.set(r.stateIdx, X(i).stateName); stateUsps.set(r.stateIdx, X(i).state); });
  let pending: Pending[] = [];
  // A newer story about the count in a race supersedes an unspoken older one (its facts would be stale).
  const add = (p: Pending) => {
    if (p.type === 'ev_update') pending = pending.filter((q) => q.type !== 'ev_update');
    else if (p.race >= 0 && COUNT_TYPES.has(p.type)) pending = pending.filter((q) => q.race !== p.race || !COUNT_TYPES.has(q.type) || q.type === 'first_votes');
    pending.push(p);
  };
  const alert = (a: StoryAlert) => alerts.push(a);

  // --- Fact helpers ------------------------------------------------------------------------------------
  const name = (r: number, j: number) => X(r).candidates[j]?.name ?? 'the candidate';
  const lastName = surname;
  const poss = (n: string) => (n.endsWith('s') ? `${n}'` : `${n}'s`);
  const party = (r: number, j: number) => X(r).candidates[j]?.party ?? 5;
  const withParty = (r: number, j: number) => `${name(r, j)} (${ABBR[party(r, j)] ?? 'I'})`;
  const order = (r: number) => Array.from({ length: rec.races[r]!.k - 1 }, (_, j) => j).sort((a, b) => votes[r]![b]! - votes[r]![a]! || a - b);
  const valid = (r: number) => { let s = 0; for (let j = 0; j < rec.races[r]!.k - 1; j++) s += votes[r]![j]!; return s; };
  const ballots = (r: number) => { let s = 0; for (let j = 0; j < rec.races[r]!.k; j++) s += votes[r]![j]!; return s; };
  const marginPts = (r: number) => { const o = order(r), v = valid(r); return v > 0 && o.length > 1 ? (100 * (votes[r]![o[0]!]! - votes[r]![o[1]!]!)) / v : 100; };
  const pctIn = (r: number) => (expected[r]! > 0 ? Math.min(1, ballots(r) / expected[r]!) : 0);
  const officeWord = (o: string, label: string) => (o === 'us_senator' ? 'Senate race' : o === 'governor' ? "governor's race" : o === 'lt_governor' ? "lieutenant governor's race" : o === 'attorney_general' ? 'attorney general race' : o === 'secretary_of_state' ? 'secretary of state race' : `${label} race`);
  const raceName = (r: number) => {
    const x = X(r);
    if (x.office === 'president') return x.cd >= 0 ? `the presidential vote in ${x.district ?? x.short}` : x.stateName;
    if (x.office === 'us_representative') return x.district ?? x.short;
    return `the ${x.stateName} ${officeWord(x.office, x.label)}`;
  };
  const outFacts = (r: number): Facts => {
    const out = Math.max(0, expected[r]! - ballots(r));
    if (out < 500) return {};
    const byRj = new Map<number, number>();
    for (const p of rec.races[r]!.parts) { const o = partExpected[p]! - partCounted[p]!; if (o > 0) byRj.set(partRj[p]!, (byRj.get(partRj[p]!) ?? 0) + o); }
    const top = [...byRj].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 2).filter(([, o]) => o > 0.08 * out);
    const res: Facts = { outN: spoken(out) };
    if (top.length) {
      const sum = top.reduce((a, [, o]) => a + o, 0);
      res.where = list(top.map(([rj]) => ctx.rjNames[rj] ?? 'several counties'));
      res.whereVote = `about ${spoken(sum)} votes`;
      res.whereHave = top.length > 1 ? 'have' : 'has';
      const share = sum / out;
      res.whereShare = share >= 0.4 ? `, ${pct(share)} of what is outstanding` : '';
      // Who has been winning those places so far.
      const tv = new Float64Array(rec.races[r]!.k);
      for (const [rj] of top) { const v = raceByRj[r]!.get(rj); if (v) for (let j = 0; j < tv.length; j++) tv[j]! += v[j]!; }
      const tvv = Array.from(tv).slice(0, -1); const best = tvv.indexOf(Math.max(...tvv));
      const tot = tvv.reduce((a, b) => a + b, 0);
      if (tot > 1000 && best >= 0) res.beneficiary = name(r, best);
    }
    return res;
  };
  const causeOf = (r: number): string | undefined => {
    const top = [...st[r]!.recentRj].sort((a, b) => b[1].b - a[1].b || a[0] - b[0]).slice(0, 2).filter(([, x]) => x.b > 0);
    if (!top.length) return undefined;
    const total = top.reduce((a, [, x]) => a + x.b, 0);
    const mode = new Int32Array(4); for (const [, x] of top) for (let m = 0; m < 4; m++) mode[m]! += x.mode[m]!;
    const dm = mode.indexOf(Math.max(...Array.from(mode)));
    const kind = dm === 0 || mode[dm]! < 0.6 * total ? '' : `${MODE_WORD[dm]} `;
    return top.length === 1 ? `a batch of about ${spoken(total)} ${kind}votes from ${ctx.rjNames[top[0]![0]] ?? 'one county'}` : `about ${spoken(total)} ${kind}votes from ${list(top.map(([rj]) => ctx.rjNames[rj] ?? 'a county'))}`;
  };
  const officeImportance = (r: number) => { const x = X(r); return x.office === 'president' ? (x.cd >= 0 ? 4 : 5 + Math.min(3, x.ev / 10)) : x.office === 'us_senator' ? 7 : x.office === 'governor' ? 6 : x.office === 'us_representative' ? 4 : 3; };
  const isKeyOffice = (r: number) => ['president', 'us_senator', 'governor'].includes(X(r).office) && X(r).cd < 0;
  const seats = (office: string, p: number) => {
    const base = office === 'us_senator' ? rec.chambers.senate : rec.chambers.house;
    let n = base.holdovers[p] ?? 0;
    for (const [race, opt] of called) { const x = X(race); if (x.office === office && x.cd < 0 && party(race, opt) === p) n++; }
    return n;
  };
  const senateUp = rec.races.filter((rr, i) => X(i).office === 'us_senator' && rr.cd < 0).length >= 10;
  const houseUp = rec.races.filter((rr, i) => X(i).office === 'us_representative').length >= 10;
  const balanceOf = (r: number, p: number) => {
    const x = X(r);
    if (x.office === 'us_senator' && senateUp) return `That gives ${PLURAL[p] ?? 'them'} ${seats(x.office, p)} Senate seats, counting those not up this year; ${rec.chambers.senate.majority} make a majority.`;
    if (x.office === 'us_representative' && houseUp) return `${PLURAL[p] ?? 'They'} have now won ${seats(x.office, p)} House seats; ${rec.chambers.house.majority} make a majority.`;
    return undefined;
  };
  const evTotals = () => { const m = new Map<number, number>(); for (const [race, opt] of called) { const x = X(race); if (x.office === 'president' && x.ev) { const key = party(race, opt); m.set(key, (m.get(key) ?? 0) + x.ev); } } return m; };
  const nominee = (p: number) => { for (let r = 0; r < R; r++) if (X(r).office === 'president') { const j = X(r).candidates.findIndex((c) => c.party === p); if (j >= 0) return X(r).candidates[j]!.name; } return PARTY[p] ?? 'the candidate'; };
  const evMilestones = new Set<string>();
  const RANK: Record<string, number> = { president: 0, us_senator: 1, governor: 2 };
  const turnoutRace = new Map<number, number>();
  rec.races.forEach((rr, i) => {
    const x = X(i); if (x.cd >= 0 || RANK[x.office] === undefined) return;
    const cur = turnoutRace.get(rr.stateIdx);
    if (cur === undefined || RANK[x.office]! < RANK[X(cur).office]!) turnoutRace.set(rr.stateIdx, i);
  });

  // --- Timeline -----------------------------------------------------------------------------------------
  const BEAT = 5;
  const times = new Set<number>();
  for (let b = 0; b < rec.batches.time.length; b++) times.add(rec.batches.time[b]!);
  for (let i = 0; i < rec.events.time.length; i++) times.add(rec.events.time[i]!);
  for (const s of rec.states) times.add(s.closeLast);
  for (const c of rec.control) times.add(c.time);
  for (let t = rec.coverageStart; t <= rec.nightEnd; t += BEAT) times.add(t);
  const sorted = [...times].filter((t) => t >= rec.coverageStart - 60 && t <= rec.nightEnd).sort((a, b) => a - b);
  const closeTimes = new Set(rec.states.map((s) => s.closeLast));
  let bi = 0, ei = 0, wi = 0, pwi = 0;
  let lastLine = -1e9;
  const recentTpl: string[] = [];
  const lastSpoke = new Array<number>(SPEAKERS.length).fill(-1e9);
  const raceSpoken = new Map<number, number>(), typeSpoken = new Map<string, number>(), raceTypeSpoken = new Map<string, number>();
  const spokenText = new Set<string>();

  const speak = (t: number) => {
    pending = pending.filter((p) => t - p.time <= (p.ttl ?? 25) && (p.race < 0 || !COUNT_TYPES.has(p.type) || st[p.race]!.status !== ST_CALLED));
    let best = -1, bestScore = -1e9;
    pending.forEach((p, i) => {
      if (p.time > t) return; // scheduled for later (a field report after the projection)
      let s = p.importance - 0.08 * (t - p.time);
      if (p.importance < 9) {
        if (p.race >= 0 && t - (raceSpoken.get(p.race) ?? -1e9) < 15) s -= 4;
        if (t - (typeSpoken.get(p.type) ?? -1e9) < 10) s -= 1.5;
        if (p.race >= 0 && t - (raceTypeSpoken.get(`${p.race}:${p.type}`) ?? -1e9) < 60) s -= 2;
      }
      if (t - (typeSpoken.get(p.type) ?? -1e9) > 60) s += 1.5; // novelty: a kind of story not heard for an hour
      if (s > bestScore) { bestScore = s; best = i; }
    });
    if (bestScore < 1) return;
    const p = pending.splice(best, 1)[0]!;
    const sp = [...p.speakers].sort((a, b) => lastSpoke[a]! - lastSpoke[b]! || a - b)[0]!;
    const tpls = (T[p.type] ?? []).filter((x) => usable(x, p.facts));
    // Prefer templates not used recently (least recently used first); deterministic shuffle among the rest.
    for (let i = tpls.length - 1; i > 0; i--) { const j = rng.int(i + 1); [tpls[i], tpls[j]] = [tpls[j]!, tpls[i]!]; }
    tpls.sort((a, b) => recentTpl.lastIndexOf(a.id) - recentTpl.lastIndexOf(b.id));
    for (const tpl of tpls) {
      const text = realize(tpl.text, p.facts);
      if (!text || spokenText.has(text)) continue;
      lines.push({ time: t, speaker: sp, type: p.type, race: p.race, text, template: tpl.id });
      spokenText.add(text); recentTpl.push(tpl.id); if (recentTpl.length > 40) recentTpl.shift();
      lastSpoke[sp] = t; lastLine = t; typeSpoken.set(p.type, t);
      if (p.race >= 0) { raceSpoken.set(p.race, t); raceTypeSpoken.set(`${p.race}:${p.type}`, t); }
      return;
    }
  };

  for (const t of sorted) {
    // 1. Batches at t.
    while (bi < rec.batches.time.length && rec.batches.time[bi]! <= t) {
      const mode = rec.batches.mode[bi]!;
      for (let i = rec.batches.partStart[bi]!; i < rec.batches.partStart[bi + 1]!; i++) partCounted[rec.partRows.part[i]!]! += rec.partRows.ballots[i]!;
      for (let i = rec.batches.rowStart[bi]!; i < rec.batches.rowStart[bi + 1]!; i++) {
        const r = rec.raceRows.race[i]!, k = rec.races[r]!.k, o = rec.raceRows.off[i]!, rj = partRj[rec.raceRows.part[i]!]!;
        let b = 0;
        let byRj = raceByRj[r]!.get(rj); if (!byRj) { byRj = new Float64Array(k); raceByRj[r]!.set(rj, byRj); }
        const s = st[r]!; let acc = s.recentRj.get(rj); if (!acc) { acc = { b: 0, mode: new Int32Array(4) }; s.recentRj.set(rj, acc); }
        for (let j = 0; j < k; j++) { const v = rec.raceRows.votes[o + j]!; votes[r]![j]! += v; byRj[j]! += v; b += v; }
        acc.b += b; acc.mode[mode]! += b;
        // Major county report: one large batch in a key race.
        if (s.key && isKeyOffice(r) && s.status !== ST_CALLED && expected[r]! > 0 && b >= Math.max(25000, 0.08 * expected[r]!)) {
          const vv = Array.from({ length: k - 1 }, (_, j) => rec.raceRows.votes[o + j]!), tot = vv.reduce((a2, c) => a2 + c, 0), top = vv.indexOf(Math.max(...vv));
          if (tot > 0) {
            const share = Math.round((100 * vv[top]!) / tot);
            alert({ time: t, kind: 'major_county', race: r, importance: 5, headline: `Major report · ${ctx.rjNames[rj] ?? 'County'}`, detail: `${X(r).short}: ${spoken(b)} votes, ${share}% ${name(r, top)}`, party: party(r, top), flip: false });
            add({ time: t, type: 'major_county', race: r, importance: 5, speakers: [DATA], ttl: 12, facts: { rj: ctx.rjNames[rj], batch: about(b), batchShare: `${share} percent`, batchLeader: name(r, top), race: raceName(r) } });
          }
        }
      }
      bi++;
    }
    while (wi < rec.wire.time.length && rec.wire.time[wi]! <= t) { expected[rec.wire.race[wi]!] = rec.wire.expected[wi]!; wi++; }
    while (pwi < rec.partWire.time.length && rec.partWire.time[pwi]! <= t) { partExpected[rec.partWire.part[pwi]!] = rec.partWire.expected[pwi]!; pwi++; }

    // 2. Poll closings at t (a state is closed when its last polling place closes).
    if (closeTimes.has(t) && t >= rec.coverageStart) {
      const sts = rec.states.filter((s) => s.closeLast === t);
      const names = [...new Set(sts.map((s) => stateName.get(s.stateIdx)).filter((x): x is string => !!x))].sort();
      const calls: { text: string; imp: number }[] = [], open: string[] = [];
      for (let i = ei; i < rec.events.time.length && rec.events.time[i] === t; i++) {
        const r = rec.events.race[i]!; if (!isKeyOffice(r) || rec.races[r]!.close !== t) continue;
        const status = rec.events.status[i]!;
        if (status === ST_CALLED) calls.push({ text: X(r).office === 'president' ? `${X(r).stateName} for ${withParty(r, rec.events.option[i]!)}` : `${withParty(r, rec.events.option[i]!)} in ${raceName(r)}`, imp: officeImportance(r) });
        else if (status === ST_TOO_EARLY || status === ST_TOO_CLOSE) open.push(raceName(r));
      }
      calls.sort((a, b) => b.imp - a.imp);
      if (names.length) {
        const more = names.length - 6;
        const callText = calls.length ? list(calls.slice(0, 3).map((c) => c.text).concat(calls.length > 3 ? [`${calls.length - 3} other race${calls.length - 3 === 1 ? '' : 's'}`] : [])) : undefined;
        const openList = open.length ? list(open.slice(0, 3).concat(open.length > 3 ? [`${open.length - 3} other race${open.length - 3 === 1 ? '' : 's'}`] : [])) : undefined;
        alert({ time: t, kind: 'polls_closed', race: -1, importance: 6, headline: `Polls closed · ${list(sts.map((s) => stateUsps.get(s.stateIdx) ?? '').filter(Boolean))}`, detail: `${calls.length} projected at closing${open.length ? ` · ${open.length} too early or too close` : ''}`, party: 0, flip: false });
        add({ time: t, type: 'polls_closed', race: -1, importance: 10.5, speakers: [ANCHOR], facts: { clock: clock(t), states: more > 0 ? `${names.slice(0, 6).join(', ')} and ${more} more state${more === 1 ? '' : 's'}` : list(names), calls: callText, openList, openVerb: open.length === 1 ? 'is' : 'are' } });
      }
    }

    // 3. Desk events at t.
    while (ei < rec.events.time.length && rec.events.time[ei]! <= t) {
      const r = rec.events.race[ei]!, status = rec.events.status[ei]!, opt = rec.events.option[ei]!, s = st[r]!, x = X(r);
      const wasNone = s.status === 0;
      s.status = status; s.option = opt;
      if (wasNone) s.key = isKeyOffice(r) ? status !== ST_CALLED : status === ST_TOO_CLOSE && x.office === 'us_representative';
      if (status === ST_TOO_CLOSE && !s.key && pctIn(r) > 0.5 && (isKeyOffice(r) || x.office === 'us_representative')) s.key = true;
      if (status === ST_CALLED) {
        called.set(r, opt); s.calledAt = t; s.pc = (rec.events.flags[ei]! & 1) === 1;
        const p = party(r, opt), flip = x.prevParty !== null && x.prevParty !== 0 && x.prevParty !== p;
        const imp = officeImportance(r) + (s.key ? 2 : 0) + (flip ? 2 : 0);
        const lw = x.lastWon[p];
        const historic = flip && lw !== undefined && lw < ctx.year - 4 ? `It is the first ${PARTY[p]} win here since ${lw}.` : undefined;
        if (x.office !== 'us_representative' || flip || s.key) {
          const rn = raceName(r).replace(/^the /, '');
          alert({ time: t, kind: 'projection', race: r, importance: imp, headline: `MNN projection · ${x.short}`, detail: `${withParty(r, opt)} wins ${rn.charAt(0).toUpperCase() + rn.slice(1)}${flip ? ` · ${ABBR[p]} pickup` : x.prevParty ? ` · ${ABBR[p]} hold` : ''}`, party: p, flip });
        }
        if (!s.pc && (s.key || flip || (x.office !== 'us_representative' && x.cd < 0 && imp >= 7))) {
          // House calls are spoken when there is room; they never interrupt (the anchor reads the big ones at once).
          add({ time: t, type: 'projection', race: r, importance: x.office === 'us_representative' ? Math.min(7, imp) : Math.min(9.5, imp + 1), speakers: [ANCHOR], facts: {
            winner: withParty(r, opt), race: raceName(r), flip: flip || undefined, hold: !flip && x.prevParty ? true : undefined, winnerParty: PARTY[p], winnerPlural: PLURAL[p],
            prevPlural: x.prevParty ? PLURAL[x.prevParty] : undefined, balance: balanceOf(r, p), historic, pctin: pct(pctIn(r)),
          } });
          // A field report from the winner's party for the night's big races.
          if (s.key && (x.office === 'us_senator' || x.office === 'governor')) {
            const o = order(r), loser = o.find((j) => j !== opt);
            add({ time: t + 2, type: 'field', race: r, importance: 7, speakers: [CORRESPONDENT], ttl: 20, facts: { winnerLast: lastName(name(r, opt)), winnerPoss: poss(lastName(name(r, opt))), state: x.stateName, loserLast: loser !== undefined ? lastName(name(r, loser)) : undefined } });
          }
        }
        // Electoral-vote milestones.
        if (x.office === 'president') {
          const tot = evTotals();
          // Milestones of the leader only, and none once someone has 270.
          const lead = [...tot].sort((a2, b2) => b2[1] - a2[1] || a2[0] - b2[0])[0];
          if (lead && lead[1] < 270) for (const [pp, ev] of [lead]) for (const m of [100, 200, 250, 260]) {
            const key = `${pp}:${m}`;
            if (ev < m || evMilestones.has(key)) continue;
            evMilestones.add(key);
            if (m < 260 && ev >= m + 10 && tot.size) continue; // passed several milestones at once: speak once
            const op = [...tot].filter(([q]) => q !== pp).sort((a2, b2) => b2[1] - a2[1])[0];
            const otherParty = op?.[0] ?? (pp === 1 ? 2 : 1), ev2 = op?.[1] ?? 0;
            const open2 = rec.races.filter((rr, i) => X(i).office === 'president' && rr.cd < 0 && !called.has(i)).length;
            alert({ time: t, kind: 'electoral', race: -1, importance: m >= 250 ? 8 : 6, headline: `Electoral votes · ${nominee(pp)} ${ev}`, detail: `${nominee(otherParty)} ${ev2} · 270 to win`, party: pp, flip: false });
            add({ time: t, type: 'ev_update', race: -1, importance: m >= 250 ? 8 : 6, speakers: ANALYSTS, facts: { leader: nominee(pp), leaderLast: lastName(nominee(pp)), ev, other: nominee(otherParty), other2: poss(nominee(otherParty)), ev2, need: 270 - ev, left: open2 ? `${open2} state${open2 === 1 ? ' is' : 's are'}` : undefined } });
          }
        }
      } else if (status === ST_WITHDRAWN) {
        called.delete(r);
        alert({ time: t, kind: 'withdrawn', race: r, importance: 9, headline: `Projection withdrawn · ${x.short}`, detail: 'Too close to call', party: party(r, opt), flip: false });
        const o = order(r);
        add({ time: t, type: 'withdrawn', race: r, importance: 9.5, speakers: [ANCHOR], facts: { race: raceName(r), leader: o.length ? name(r, o[0]!) : undefined, margin: pts(marginPts(r)) } });
      } else if (status === ST_RUNOFF) {
        alert({ time: t, kind: 'runoff', race: r, importance: 7, headline: `Runoff projected · ${x.short}`, detail: `${name(r, opt)} and ${name(r, rec.events.option2[ei]!)}`, party: 0, flip: false });
        add({ time: t, type: 'runoff', race: r, importance: 7, speakers: ANALYSTS, facts: { race: raceName(r), a: withParty(r, opt), b: withParty(r, rec.events.option2[ei]!) } });
      } else if (status === ST_TOO_CLOSE && s.key && t > rec.races[r]!.close && pctIn(r) >= 0.5 && t - s.lastStory > 45) {
        const o = order(r);
        if (o.length > 1) {
          s.lastStory = t;
          alert({ time: t, kind: 'too_close', race: r, importance: officeImportance(r), headline: `Too close to call · ${x.short}`, detail: `${withParty(r, o[0]!)} leads by ${marginPts(r).toFixed(1)} pts`, party: party(r, o[0]!), flip: false });
          add({ time: t, type: 'too_close', race: r, importance: officeImportance(r), speakers: ANALYSTS, facts: { race: raceName(r), leader: name(r, o[0]!), other: name(r, o[1]!), margin: pts(marginPts(r)), pctin: pct(pctIn(r)), ...outFacts(r) } });
        }
      }
      ei++;
    }

    // 4. Control projections.
    for (const c of rec.control) {
      if (c.time !== t) continue;
      if (c.kind === 'president') {
        if (c.status !== 1) continue;
        const ev = evTotals().get(c.party) ?? 270;
        const lastState = [...called.keys()].filter((r) => X(r).office === 'president' && X(r).cd < 0).sort((a, b) => st[b]!.calledAt - st[a]!.calledAt)[0];
        alert({ time: t, kind: 'president', race: -1, importance: 10, headline: `MNN projects ${nominee(c.party)} wins the presidency`, detail: c.detail, party: c.party, flip: false });
        add({ time: t, type: 'president', race: -1, importance: 10, speakers: [ANCHOR], facts: { winner: `${nominee(c.party)} (${ABBR[c.party]})`, winnerShort: lastName(nominee(c.party)), ev, state: lastState !== undefined ? X(lastState).stateName : undefined, clock: clock(t) } });
        add({ time: t + 3, type: 'hq', race: -1, importance: 9.2, speakers: [CORRESPONDENT], facts: { winner: nominee(c.party) } });
      } else if ((c.kind === 'senate' && senateUp) || (c.kind === 'house' && houseUp)) {
        const chamber = c.kind === 'senate' ? 'Senate' : 'House';
        alert({ time: t, kind: 'control', race: -1, importance: 9, headline: c.status ? `MNN projects ${PLURAL[c.party]} control the ${chamber}` : `${chamber} control projection withdrawn`, detail: c.detail, party: c.party, flip: false });
        if (c.status) {
          add({ time: t, type: 'control', race: -1, importance: 9.5, speakers: [ANCHOR], facts: { plural: PLURAL[c.party], party: PARTY[c.party], chamber, detail: `${c.detail.replace(/ projected$/, '')} are now projected or not up this year` } });
          add({ time: t + 4, type: 'control_field', race: -1, importance: 6.5, speakers: [CORRESPONDENT], ttl: 20, facts: { plural: PLURAL[c.party], party: PARTY[c.party], chamber } });
        }
      }
    }

    // 5. Key races: first votes, lead changes, margin moves, outstanding vote, turnout.
    for (let r = 0; r < R; r++) {
      const s = st[r]!;
      // Turnout, once per state (from the presidential race, or the top statewide race in a midterm), when most of the vote is in.
      if (!s.turnout && X(r).eligible > 0 && X(r).cd < 0 && turnoutRace.get(rec.races[r]!.stateIdx) === r && expected[r]! > 0 && pctIn(r) >= 0.6) {
        s.turnout = true;
        const tr = expected[r]! / X(r).eligible;
        if (tr > 0.2 && tr < 0.95) add({ time: t, type: 'turnout', race: r, importance: 5.5, speakers: ANALYSTS, ttl: 90, facts: { state: X(r).stateName, turnout: pct(tr) } });
      }
      if (!s.key || s.status === ST_CALLED || s.status === 0) continue;
      const b = ballots(r), e = expected[r]!; if (b <= 0 || e <= 0) continue;
      const pi = pctIn(r), o = order(r); if (o.length < 2) continue;
      const leader = o[0]!, m = marginPts(r), x = X(r);
      if (!s.first) {
        if (pi < 0.005) continue;
        const mm = new Int32Array(4); for (const [, a] of s.recentRj) for (let q = 0; q < 4; q++) mm[q]! += a.mode[q]!;
        const d = mm.indexOf(Math.max(...Array.from(mm)));
        s.first = true; s.leader = leader; s.lastMargin = m; s.lastPct = pi; s.lastStory = t;
        if (isKeyOffice(r)) alert({ time: t, kind: 'key_race', race: r, importance: 5, headline: `Key Race Alert · ${x.short}`, detail: `First votes · ${withParty(r, leader)} leads`, party: party(r, leader), flip: false });
        const firstRj = [...s.recentRj].sort((a, b2) => b2[1].b - a[1].b || a[0] - b2[0])[0];
        add({ time: t, type: 'first_votes', race: r, importance: officeImportance(r) - 1, speakers: [DATA], facts: {
          race: raceName(r), where1: firstRj && x.office !== 'us_representative' ? `${ctx.rjNames[firstRj[0]] ?? 'the first county'} in ${raceName(r)}` : undefined,
          leader: withParty(r, leader), share: pct(votes[r]![leader]! / Math.max(1, valid(r))), pctin: pct(pi), mode: d > 0 && mm[d]! > 0.6 * b ? MODE_WORD[d]!.toLowerCase() : undefined,
        } });
        s.recentRj.clear();
        continue;
      }
      // Lead change, with hysteresis: a real lead (≥ 0.3 points), not in the first trickle, and not every few minutes.
      if (leader !== s.leader && pi >= 0.08 && m >= 0.3 && t - s.lastLead >= 20) {
        s.changes++;
        const cause = causeOf(r);
        alert({ time: t, kind: 'key_race', race: r, importance: 7, headline: `Key Race Alert · ${x.short}`, detail: `Lead change · ${withParty(r, leader)} ahead by ${m.toFixed(1)} pts`, party: party(r, leader), flip: false });
        if (s.changes >= 3 && t - s.seesaw >= 60) {
          s.seesaw = t;
          add({ time: t, type: 'seesaw', race: r, importance: officeImportance(r) + 1.5, speakers: ANALYSTS, facts: { race: raceName(r), changes: s.changes, leader: name(r, leader), margin: pts(m) } });
        } else if (s.changes < 3) {
          const c2 = cause ?? 'the latest batch of votes';
          add({ time: t, type: 'lead_change', race: r, importance: officeImportance(r) + 2, speakers: [DATA, ...ANALYSTS], ttl: 15, facts: { race: raceName(r), gainer: withParty(r, leader), gainerLast: lastName(name(r, leader)), other: name(r, o[1]!), cause: c2, Cause: c2.charAt(0).toUpperCase() + c2.slice(1), margin: pts(m), pctin: pct(pi), ...outFacts(r) } });
        }
        s.leader = leader; s.lastMargin = m; s.lastPct = pi; s.lastStory = t; s.lastLead = t; s.recentRj.clear();
        continue;
      }
      if (leader !== s.leader) continue; // a momentary lead change: wait until it holds
      if (Math.abs(m - s.lastMargin) >= 3 && Math.min(m, s.lastMargin) < 15 && pi - s.lastPct >= 0.05 && t - s.lastStory >= 10) {
        const narrowed = m < s.lastMargin, c2 = causeOf(r) ?? 'the latest returns';
        if (Math.abs(m - s.lastMargin) >= 5) alert({ time: t, kind: 'key_race', race: r, importance: 6, headline: `Key Race Alert · ${x.short}`, detail: `${withParty(r, leader)} leads by ${m.toFixed(1)} pts (${narrowed ? 'down' : 'up'} from ${s.lastMargin.toFixed(1)})`, party: party(r, leader), flip: false });
        const of = outFacts(r);
        add({ time: t, type: 'margin_move', race: r, importance: officeImportance(r) + (narrowed ? 1 : 0), speakers: [DATA, ...ANALYSTS], ttl: 15, facts: {
          race: raceName(r), leader: name(r, leader), leaderPoss: poss(name(r, leader)), gainer: narrowed ? name(r, o[1]!) : undefined, margin: pts(m), cause: c2,
          moved: `${narrowed ? 'down' : 'up'} from ${pts(s.lastMargin)} earlier`, narrowed: narrowed || undefined, widened: !narrowed || undefined,
          outN: of.outN, where: of.where, beneficiary: narrowed ? of.beneficiary : undefined,
        } });
        s.lastMargin = m; s.lastPct = pi; s.lastStory = t; s.recentRj.clear();
        continue;
      }
      // Where the vote is: only when the count has moved on since the race's last such story.
      if (pi >= 0.4 && pi <= 0.92 && m < 10 && t - s.lastOut >= 45 && pi - s.lastOutPct >= 0.05 && t - s.lastStory >= 15) {
        const of = outFacts(r);
        if (of.where) { s.lastOut = t; s.lastOutPct = pi; add({ time: t, type: 'outstanding', race: r, importance: officeImportance(r) - 1, speakers: [DATA, ...ANALYSTS], facts: { race: raceName(r), leader: name(r, leader), margin: pts(m), pctin: pct(pi), ...of } }); }
      }
    }

    // 6. Morning after: recount watch and late counts.
    if (t === rec.nightEnd) {
      for (let r = 0; r < R; r++) {
        const s = st[r]!, x = X(r); if (s.status === ST_CALLED || s.status === ST_RUNOFF || !isKeyOffice(r)) continue;
        const o = order(r), pi = pctIn(r); if (o.length < 2 || valid(r) <= 0) continue;
        const mv = votes[r]![o[0]!]! - votes[r]![o[1]!]!;
        if (x.recount > 0 && pi >= 0.9 && mv < x.recount * valid(r)) {
          alert({ time: t, kind: 'recount', race: r, importance: 7, headline: `Recount watch · ${x.short}`, detail: `Margin ${Math.round(mv).toLocaleString('en-US')} votes`, party: party(r, o[0]!), flip: false });
          add({ time: t, type: 'recount', race: r, importance: 7, speakers: ANALYSTS, facts: { race: raceName(r), leader: name(r, o[0]!), marginVotes: Math.round(mv).toLocaleString('en-US'), pctin: pct(pi) } });
        } else {
          add({ time: t, type: 'late_count', race: r, importance: 6, speakers: ANALYSTS, facts: { state: x.stateName, race: raceName(r), leader: name(r, o[0]!), margin: pts(marginPts(r)), pctin: pct(pi), outPct: pi < 0.97 ? pct(1 - pi) : undefined, outN: expected[r]! - ballots(r) > 500 ? spoken(expected[r]! - ballots(r)) : undefined } });
        }
      }
    }

    // 7. Speak at beats, and immediately for the biggest moments.
    const urgent = pending.some((p) => p.importance >= 9 && p.time <= t && t - p.time <= 4);
    if ((t >= rec.coverageStart && (t - rec.coverageStart) % BEAT === 0) || (urgent && t - lastLine >= 1)) speak(t);
  }
  // The morning-after wrap-up: speak what remains, one line a minute.
  for (let k = 1; k <= 6 && pending.length; k++) speak(rec.nightEnd + k);
  return { version: 1, alerts: alerts.sort((a, b) => a.time - b.time || b.importance - a.importance), lines, speakers: SPEAKERS.map((s) => ({ ...s })) };
}
