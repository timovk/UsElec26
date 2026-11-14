/**
 * Compute jobs (run in compute workers or inline): the ballot kernel for one shard, followed — for counted
 * general elections — by that state's election night: synthetic precincts → count schedule → exact vote
 * partition → measurement (baseline, survey, wire priors) → wire and decision desk.
 */
import { Rng } from '../core/rng';
import { N_CLASS, N_TYPES, ZG, runShard, typeUtilities, type ShardInput, type ShardOutput } from '../electorate/kernel';
import { RCV_STOP_SHIFT, tabulateRcv, type RcvRound } from '../counting/rcv';
import { centreBaseline, measureTypes, publishedBaseline, voterSurveyCrosstabs, wirePriors, type PieceTypes } from '../electorate/measure';
import { planSchedule, partitionVotes } from '../counting/countPlan';
import { buildParts, buildPrecincts } from '../counting/precincts';
import { MODE_EARLY, MODE_PROV, type NightInput, type StateNight } from '../counting/types';
import { observe, type ObsRace } from '../projections/observer';
import { prepareContest, prepareRejected, prepareTurnout } from '../archive/results';
import { aggregate, shardGeo } from './electionModel';

export type JobInput = ShardInput & { night?: NightInput; stateIdx?: number; seal?: { contests: { id: number; candidacyIds: number[] }[] }; measure?: boolean };
export interface SealedContest { id: number; totals: number[]; blobs: { grain: string; payload: Uint8Array }[]; sha256: string }
/** A ranked-choice tabulation (Phase 7.1): rounds over the certified ballots, candidates by option index. */
export interface RcvOutcome { id: number; rounds: RcvRound[]; winner: number; runnerUp: number | null }
export type JobOutput = ShardOutput & { night?: StateNight; sealed?: { contests: SealedContest[]; turnout: Uint8Array; rejected: { contestId: number; payload: Uint8Array }[] }; types?: PieceTypes[]; rcv?: RcvOutcome[] };

/**
 * A job with its results sealed: the cast ballots of each counted contest are encoded and hashed here,
 * exactly as the engine would (same ContestResult for a one-state shard, same encoder), so the engine
 * thread only writes them.
 */
export async function runJobSealed(inp: JobInput): Promise<JobOutput> {
  const out = runJob(inp);
  if (!inp.seal) return out;
  const meta = new Map(inp.seal.contests.map((c) => [c.id, { candidacyIds: c.candidacyIds, grain: 'bu' as const }]));
  const res = aggregate(shardGeo(inp), [{ input: inp, output: out }], meta);
  const contests: SealedContest[] = [];
  for (const c of inp.seal.contests) {
    const r = res.get(c.id); if (!r) continue;
    const p = await prepareContest(r);
    contests.push({ id: c.id, totals: p.totals, blobs: p.blobs, sha256: p.sha256 });
  }
  const turnout = await prepareTurnout(inp.bus.start, out.eligible, out.ballots, out.ballotsByMode);
  const rejected: { contestId: number; payload: Uint8Array }[] = [];
  if (out.night) {
    const ids = inp.seal.contests.map((c) => c.id);
    for (let ri = 0; ri < out.night.races.length; ri++) {
      const race = inp.night!.races[ri]!; if (race.cd >= 0) continue;
      const ru = out.night.rejectedUnits[ri]!, contestId = ids[race.contest]!;
      rejected.push({ contestId, payload: await prepareRejected(ru.units, ru.modes, ru.votes, inp.contests[race.contest]!.options.length + 1) });
    }
  }
  out.sealed = { contests, turnout, rejected };
  return out;
}

export function runJob(inp: JobInput): JobOutput {
  // A measurement job: the electorate's voter types only (for polls), no ballots.
  if (inp.measure) return { ballots: new Int32Array(0), ballotsByMode: new Int32Array(0), eligible: new Int32Array(0), contests: [], expectedBallots: 0, types: measureTypes(inp) };
  const out: JobOutput = runShard(inp);
  if (inp.night) {
    out.night = runStateNight(inp, out, inp.night, inp.stateIdx ?? 0);
    // Per-mode detail and expectations stay in the worker; only the night and the archive results return.
    for (const c of out.contests) { delete c.votesByMode; delete c.expPartMode; }
    delete out.expBallotsPartMode;
  }
  if (out.contests.some((c) => c.rcvComp)) out.rcv = tabulateContests(inp, out);
  return out;
}

/**
 * Ranked-choice contests: the instant runoff over the ballots that will be certified (cast, less the provisional
 * and mail ballots the night rejects), by reporting jurisdiction. The rankings come from the kernel's own
 * utilities for each type in the RJ's county (docs/architecture/04 §4.5).
 */
function tabulateContests(inp: JobInput, out: JobOutput): RcvOutcome[] {
  const res: RcvOutcome[] = [];
  out.contests.forEach((co, ci) => {
    if (!co.rcvComp) return;
    const c = inp.contests[ci]!, J = c.options.length, K = J + 1, A = inp.rjCount;
    const first = new Int32Array(A * J);
    for (let a = 0; a < A; a++) for (let m = 0; m < N_MODES; m++) for (let j = 0; j < J; j++) first[a * J + j]! += co.rjMode[(a * N_MODES + m) * K + j]!;
    const ri = inp.night && out.night ? inp.night.races.findIndex((r) => r.contest === ci && r.cd < 0) : -1;
    if (ri >= 0) {
      const ru = out.night!.rejectedUnits[ri]!;
      for (let u = 0; u < ru.units.length; u++) {
        const a = inp.bus.rj[ru.units[u]! - inp.bus.start]! - inp.rjFirst;
        for (let j = 0; j < J; j++) first[a * J + j]! -= ru.votes[u * K + j]!;
      }
    }
    const util = new Float64Array(A * N_TYPES * K), u = new Float64Array(K);
    for (let a = 0; a < A; a++) {
      const county = co.rcvCounty![a]!; if (county < 0) continue;
      for (let h = 0; h < N_CLASS; h++) for (let g = 0; g < ZG; g++) {
        typeUtilities(inp, c, h, g, county, 0, u);
        const o = (a * N_TYPES + h * ZG + g) * K;
        for (let j = 0; j < J; j++) util[o + j] = u[j]!;
        util[o + J] = u[J]! + RCV_STOP_SHIFT;
      }
    }
    const r = tabulateRcv({ J, areas: A, T: N_TYPES, first, comp: co.rcvComp, util }, Rng.stream(inp.seedKey, 'rcv', c.id));
    res.push({ id: c.id, rounds: r.rounds, winner: r.winner, runnerUp: r.runnerUp });
    delete co.rcvComp; delete co.rcvCounty;
  });
  return res;
}

/** Transferable buffers of a job output (zero-copy return from a worker). */
export function jobTransferables(o: JobOutput): ArrayBuffer[] {
  const t = new Set<ArrayBuffer>([o.ballots.buffer as ArrayBuffer, o.ballotsByMode.buffer as ArrayBuffer, o.eligible.buffer as ArrayBuffer]);
  for (const c of o.contests) for (const a of [c.units, c.votes, c.rjMode, c.expected]) t.add(a.buffer as ArrayBuffer);
  const n = o.night;
  if (n) {
    for (const g of [n.parts, n.batches, n.partRows, n.raceRows, n.wire, n.partWire, n.events]) for (const v of Object.values(g)) t.add((v as { buffer: ArrayBuffer }).buffer);
    for (const r of n.races) t.add(r.parts.buffer as ArrayBuffer);
    for (const r of n.rejected) t.add(r.buffer as ArrayBuffer);
    for (const r of n.rejectedUnits) { t.add(r.units.buffer as ArrayBuffer); t.add(r.modes.buffer as ArrayBuffer); t.add(r.votes.buffer as ArrayBuffer); }
  }
  if (o.types) for (const p of o.types) { t.add(p.lv.buffer as ArrayBuffer); t.add(p.rv.buffer as ArrayBuffer); }
  if (o.sealed) {
    for (const c of o.sealed.contests) for (const b of c.blobs) t.add(b.payload.buffer as ArrayBuffer);
    t.add(o.sealed.turnout.buffer as ArrayBuffer);
    for (const r of o.sealed.rejected) t.add(r.payload.buffer as ArrayBuffer);
  }
  return [...t];
}

const N_MODES = 4;

export function runStateNight(inp: ShardInput, out: ShardOutput, night: NightInput, stateIdx: number): StateNight {
  const n = inp.bus.count;
  const parts = buildParts(inp.bus.rj, inp.bus.cd);
  const precincts = buildPrecincts(parts, inp.rjFirst, night.rjPrecincts, inp.bus.vep);
  const young = new Float32Array(n);
  for (let i = 0; i < n; i++) young[i] = inp.bus.marg[i * 13]!;
  const sch = planSchedule({
    seed: night.seed, key: night.key, rjFirst: inp.rjFirst, rjCount: inp.rjCount, rj: inp.bus.rj, close: night.close, young,
    ballotsByMode: out.ballotsByMode, rjOffset: night.rjOffset, parts, precincts, rules: night.rules, mailReject: night.mailReject, provReject: night.provReject,
  });
  const specs = night.races.map((r) => ({ contest: r.contest, cd: r.cd, k: inp.contests[r.contest]!.options.length + 1, ...(r.local ? { pooled: true } : {}) }));
  const cells = out.contests.map((c) => ({ units: c.units, votesByMode: c.votesByMode! }));
  const part = partitionVotes(sch, specs, cells, inp.bus.start, inp.bus.cd, parts, night.key);

  // Batches in time order (dropping empty ones).
  const nb = sch.batchTime.length, used = new Uint8Array(nb);
  for (const b of sch.partRows.keys()) used[b] = 1;
  const rowKeys = [...part.rows.keys()];
  for (const k of rowKeys) used[part.unkey(k)[0]] = 1;
  const order = [...Array(nb).keys()].filter((b) => used[b]).sort((a, b) => sch.batchTime[a]! - sch.batchTime[b]! || sch.batchRj[a]! - sch.batchRj[b]! || sch.batchMode[a]! - sch.batchMode[b]! || a - b);
  const newId = new Int32Array(nb).fill(-1); order.forEach((b, i) => { newId[b] = i; });
  const batches = {
    time: Int32Array.from(order, (b) => sch.batchTime[b]!), rj: Int32Array.from(order, (b) => inp.rjFirst + sch.batchRj[b]!),
    mode: Uint8Array.from(order, (b) => sch.batchMode[b]!), flag: Uint8Array.from(order, (b) => sch.batchFlag[b]!),
  };
  const pr: [number, number, number, number][] = [];
  for (const [b, m] of sch.partRows) for (const [p, v] of m) if (newId[b]! >= 0) pr.push([newId[b]!, p, v[0], v[1]]);
  pr.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rr = rowKeys.map((k) => { const [b, race, p] = part.unkey(k); return [newId[b]!, race, p, k] as const; }).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const off = new Int32Array(rr.length); let tot = 0;
  rr.forEach((x, i) => { off[i] = tot; tot += specs[x[1]]!.k; });
  const votes = new Int32Array(tot);
  rr.forEach((x, i) => votes.set(part.rows.get(x[3])!, off[i]!));

  // Parts: precincts and last poll closing.
  const partClose = new Int32Array(parts.count).fill(-2147483648);
  for (let i = 0; i < n; i++) { const p = parts.of[i]!; if (night.close[i]! > partClose[p]!) partClose[p] = night.close[i]!; }
  // Races: their parts, last closing and cast votes (for the survey).
  const raceParts = specs.map((sp) => {
    const c = out.contests[sp.contest]!; const set = new Set<number>();
    for (let u = 0; u < c.units.length; u++) { const i = c.units[u]! - inp.bus.start; if (sp.cd >= 0 && inp.bus.cd[i] !== sp.cd) continue; set.add(parts.of[i]!); }
    return [...set].sort((a, b) => a - b);
  });
  const known = { early: new Float64Array(parts.count), mailReceived: new Float64Array(parts.count), mailCounted: new Float64Array(parts.count), mailEd: new Float64Array(parts.count), mailLate: new Float64Array(parts.count) };
  for (let i = 0; i < n; i++) known.early[parts.of[i]!]! += out.ballotsByMode[i * N_MODES + MODE_EARLY]!;
  for (const [i, [rej, late, ed, early]] of sch.mailSplit) {
    const p = parts.of[i]!; known.mailReceived[p]! += early + rej; known.mailCounted[p]! += early + ed; known.mailEd[p]! += ed; known.mailLate[p]! += late;
  }
  let lastClose = -Infinity, firstClose = Infinity;
  for (let i = 0; i < n; i++) { if (out.ballots[i]! <= 0) continue; lastClose = Math.max(lastClose, night.close[i]!); firstClose = Math.min(firstClose, night.close[i]!); }
  // Measurement: the desks' published baseline, the voter survey and the wire's turnout priors.
  const mr = Rng.stream(night.key, 'measure');
  const survey: StateNight['survey'] = [];
  const obsRaces: ObsRace[] = specs.map((sp, ri) => {
    const c = out.contests[sp.contest]!; const K = sp.k, def = night.races[ri]!;
    const fc = def.forecast;
    // The contest's expected votes start at its first part (a county race spans a few of the state's parts; Phase 7.6).
    const localParts = (raceParts[ri]!).map((p) => p - (c.partBase ?? 0));
    const base = publishedBaseline(c.expPartMode!, localParts, K, def.axis, fc ? { state: 0, mode: night.priorError.mode, race: 0 } : { state: night.priorError.state, mode: night.priorError.mode, race: night.priorError.race[ri] ?? 0 }, mr);
    // With a public forecast, the desk's expectations are centred on it (the geography still comes from past results).
    if (fc) centreBaseline(base, c.expPartMode!, localParts, K, def.axis, fc.mean / 100);
    let svy: ReturnType<typeof voterSurveyCrosstabs> = null;
    if (def.surveyed && K - 1 >= 2) {
      const cast = new Array<number>(K - 1).fill(0);
      for (let u = 0; u < c.units.length; u++) {
        const i = c.units[u]! - inp.bus.start; if (sp.cd >= 0 && inp.bus.cd[i] !== sp.cd) continue;
        for (let m = 0; m < N_MODES; m++) { if (m === MODE_PROV) continue; for (let k = 0; k < K - 1; k++) cast[k]! += c.votesByMode![(u * N_MODES + m) * K + k]!; }
      }
      svy = voterSurveyCrosstabs(inp, sp.contest, sp.cd, cast, def.axis, night.surveyBias, night.surveyN, mr);
      if (svy) survey.push({ race: ri, shares: svy.shares, n: night.surveyN, crosstabs: svy.crosstabs });
    }
    return { def, k: K, parts: raceParts[ri]!, close: Math.max(...raceParts[ri]!.map((p) => partClose[p]!)), baseline: base.shares, has: base.has, survey: svy?.shares ?? null, surveyN: svy?.nEff ?? 0 };
  });
  const batchRows: number[][] = order.map(() => []), batchPartRows: number[][] = order.map(() => []);
  rr.forEach((x, i) => batchRows[x[0]]!.push(i));
  pr.forEach((x, i) => batchPartRows[x[0]]!.push(i));
  const obs = observe({
    key: night.key, parts: { count: parts.count, precincts: precincts.perPart }, races: obsRaces, wirePrior: wirePriors(out.expBallotsPartMode!, parts.count, night.provReject, mr), known, lastClose,
    batch: { time: batches.time, mode: batches.mode, rows: batchRows, partRows: batchPartRows },
    partRows: { part: Int32Array.from(pr, (x) => x[1]), ballots: Int32Array.from(pr, (x) => x[2]), precincts: Int32Array.from(pr, (x) => x[3]) },
    raceRows: { race: Int32Array.from(rr, (x) => x[1]), part: Int32Array.from(rr, (x) => x[2]), off, votes },
    rules: night.rules, desk: night.desk, ...(night.trace !== undefined ? { trace: night.trace } : {}),
  });
  return {
    stateIdx,
    parts: { rj: parts.rj, cd: parts.cd, precincts: precincts.perPart, close: partClose },
    races: specs.map((sp, ri) => ({ contestId: inp.contests[sp.contest]!.id, cd: sp.cd, k: sp.k, parts: Int32Array.from(raceParts[ri]!) })),
    batches,
    partRows: { batch: Int32Array.from(pr, (x) => x[0]), part: Int32Array.from(pr, (x) => x[1]), ballots: Int32Array.from(pr, (x) => x[2]), precincts: Int32Array.from(pr, (x) => x[3]) },
    raceRows: { batch: Int32Array.from(rr, (x) => x[0]), race: Int32Array.from(rr, (x) => x[1]), part: Int32Array.from(rr, (x) => x[2]), votes },
    rejected: part.rejected,
    rejectedUnits: part.rejectedUnits.map((x) => ({ units: Int32Array.from(x.units), modes: Uint8Array.from(x.modes), votes: Int32Array.from(x.votes) })),
    wire: { time: Int32Array.from(obs.wire.time), race: Int32Array.from(obs.wire.race), expected: Float64Array.from(obs.wire.expected) },
    partWire: { time: Int32Array.from(obs.partWire.time), part: Int32Array.from(obs.partWire.part), expected: Int32Array.from(obs.partWire.expected) },
    events: { time: Int32Array.from(obs.events.time), race: Int32Array.from(obs.events.race), status: Uint8Array.from(obs.events.status), option: Int16Array.from(obs.events.option), prob: Int16Array.from(obs.events.prob), flags: Uint8Array.from(obs.events.flags), option2: Int16Array.from(obs.events.option2) },
    survey,
    closeFirst: Number.isFinite(firstClose) ? firstClose : 0, closeLast: Number.isFinite(lastClose) ? lastClose : 0,
  };
}
