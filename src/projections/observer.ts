/**
 * Observers of one state's night (docs/architecture/08-election-night.md §8.5): the wire's expected-vote
 * model, the voter survey and the flagship decision desk. They see only what is public at each moment —
 * the feed, published ballot-return counts, a noisy pre-election baseline and the survey — never the cast
 * results themselves.
 */
import { Rng } from '../core/rng';
import { project, pInside, type Belief, type Cell } from './desk';
import { normCdf } from '../core/math';
import { EVENT_POLLCLOSE_CALL, MODE_EARLY, MODE_ED, MODE_MAIL, MODE_PROV, ST_CALLED, ST_NONE, ST_RUNOFF, ST_TOO_CLOSE, ST_TOO_EARLY, ST_WITHDRAWN, type DeskParams, type NightRace } from '../counting/types';
import type { CountingRules } from '../rules/counting2016';

const N_MODES = 4;
const DRIFT = [0.04, 0.02, 0.03, 0.05];
const SYS_DRIFT = [0.025, 0.01, 0.035, 0.04];

export interface ObsRace {
  def: NightRace; k: number;
  parts: number[];                 // part ids
  close: number;                   // last poll closing in the race
  baseline: Float64Array;          // published pre-election shares per (race part × mode × option)
  has: Uint8Array;                 // cells with ballots expected
  survey: number[] | null;         // voter-survey shares (options, excluding the undervote)
  surveyN: number;                 // effective survey sample size
}

export interface ObsInput {
  key: string;
  parts: { count: number; precincts: Int32Array };
  races: ObsRace[];
  wirePrior: { ed: Float64Array; prov: Float64Array };
  known: { early: Float64Array; mailReceived: Float64Array; mailCounted: Float64Array; mailEd: Float64Array; mailLate: Float64Array };
  lastClose: number;
  /** Batches sorted by time with their rows (indices into the row arrays). */
  batch: { time: Int32Array; mode: Uint8Array; rows: number[][]; partRows: number[][] };
  partRows: { part: Int32Array; ballots: Int32Array; precincts: Int32Array };
  raceRows: { race: Int32Array; part: Int32Array; off: Int32Array; votes: Int32Array };
  rules: CountingRules;
  desk: DeskParams;
  trace?: number;
}

export interface ObsOutput {
  wire: { time: number[]; race: number[]; expected: number[] };
  partWire: { time: number[]; part: number[]; expected: number[] };
  events: { time: number[]; race: number[]; status: number[]; option: number[]; option2: number[]; prob: number[]; flags: number[] };
}

export function observe(inp: ObsInput): ObsOutput {
  const P = inp.parts.count;
  const rng = Rng.stream(inp.key, 'observers');
  const out: ObsOutput = { wire: { time: [], race: [], expected: [] }, partWire: { time: [], part: [], expected: [] }, events: { time: [], race: [], status: [], option: [], option2: [], prob: [], flags: [] } };

  // ---- Wire: priors per part and mode -----------------------------------------------------------------
  const priorEd = inp.wirePrior.ed, priorProv = inp.wirePrior.prov, priorMailExtra = new Float64Array(P), priorLate = new Float64Array(P);
  const edShare = inp.rules.edMailShare, lateShare = inp.rules.latePostmarkDays > 0 ? inp.rules.lateShare : 0;
  for (let p = 0; p < P; p++) {
    const base = inp.known.mailReceived[p]!;
    priorMailExtra[p] = base * (edShare / Math.max(0.05, 1 - edShare - lateShare)) * Math.exp(rng.normal(0, 0.25));
    priorLate[p] = base * (lateShare / Math.max(0.05, 1 - edShare - lateShare)) * Math.exp(rng.normal(0, 0.4));
  }
  const counted = new Float64Array(P * N_MODES), precDone = new Int32Array(P);
  const lastPart = new Float64Array(P).fill(-1);
  const provSeen = new Uint8Array(P);
  let mailKnown = false; // after the first full day the wire learns each office's count of ballots still on hand
  let final = false;     // canvass complete: every count is final
  // The wire's estimates change only when a batch is applied: they are computed once per part and mode per state
  // of the count (every race of the state reads the same parts), and reused until the next batch.
  let wireGen = 1;
  const wireG = new Int32Array(P * N_MODES), wireTup: [number, number][] = Array.from({ length: P * N_MODES }, () => [0, 0]);
  const wireEst = (p: number, m: number): [number, number] => {
    const i = p * N_MODES + m, tp = wireTup[i]!;
    if (wireG[i] !== wireGen) { const [e, sd] = wireEstRaw(p, m); tp[0] = e; tp[1] = sd; wireG[i] = wireGen; }
    return tp;
  };
  const wireEstRaw = (p: number, m: number): [number, number] => {
    const c = counted[p * N_MODES + m]!;
    if (final) return [c, 0];
    if (m === MODE_EARLY) return [Math.max(c, inp.known.early[p]!), 0];
    if (m === MODE_ED) {
      const tot = inp.parts.precincts[p]!; const f = tot > 0 ? precDone[p]! / tot : 1;
      if (f >= 1) return [c, 0];
      const prior = priorEd[p]!;
      const ratio = (c + 0.3 * prior * stRatio) / (f * prior + 0.3 * prior);
      const rest = (1 - f) * prior * ratio;
      return [c + rest, rest * 0.08 + 1];
    }
    if (m === MODE_MAIL) {
      if (mailKnown) { const e = Math.max(c, inp.known.mailCounted[p]! + priorLate[p]!); return [e, Math.max(0, e - c) * 0.1 + priorLate[p]! * 0.3 + 1]; }
      const exp = inp.known.mailReceived[p]! * (1 - 0.01) + priorMailExtra[p]! + priorLate[p]!;
      const e = Math.max(c, exp);
      return [e, Math.max(0, e - c) * 0.25 + 1];
    }
    if (provSeen[p]) return [c, 0];
    const e = Math.max(c, priorProv[p]!);
    return [e, e * 0.3 + 1];
  };
  // Statewide Election-Day turnout ratio (reported vs prior, shrunk).
  let stRatio = 1;
  const updateStRatio = () => {
    let a = 0, b = 0, tot = 0;
    for (let p = 0; p < P; p++) { const t = inp.parts.precincts[p]!; tot += priorEd[p]!; if (!t || !precDone[p]) continue; a += counted[p * N_MODES + MODE_ED]!; b += (precDone[p]! / t) * priorEd[p]!; }
    stRatio = (a + 0.1 * tot) / (b + 0.1 * tot);
    wireGen++; // the count moved: wire estimates are recomputed when next read
  };

  // ---- Races: baselines and counted cells ----------------------------------------------------------
  const races = inp.races.map((rc) => ({
    rc, K: rc.k, local: new Map(rc.parts.map((p, i) => [p, i])), base: rc.baseline, has: rc.has, cnt: new Float64Array(rc.parts.length * N_MODES * rc.k),
    survey: rc.survey, surveyN: rc.surveyN,
    status: ST_NONE, option: -1, closed: false, pending: null as null | { at: number; option: number; prob: number },
    lastOk: false, lastWire: 0, calledAt: -1, nextEval: -Infinity, dirty: false, doubtSince: -1,
  }));
  type R = (typeof races)[number];

  // Prior uncertainty of the race's margin: the forecast's when there is one, else a default by office.
  const sdPrior = (r: R) => (r.rc.def.forecast ? Math.max(0.015, r.rc.def.forecast.sd / 100) : ['president', 'us_senator', 'governor'].includes(r.rc.def.office) ? 0.05 : 0.08);

  /** Cells of a race for contrast w. */
  const cellsFor = (r: R, w: Float64Array): Cell[] => {
    const cells: Cell[] = [];
    r.rc.parts.forEach((p, i) => {
      for (let m = 0; m < N_MODES; m++) {
        const ci = i * N_MODES + m; if (!r.has[ci]) continue;
        const [e, sd] = wireEst(p, m);
        let c = 0, d = 0, sq = 0, b = 0, b2 = 0;
        for (let k = 0; k < r.K; k++) { const v = r.cnt[ci * r.K + k]!; c += v; d += w[k]! * v; sq += w[k]! * w[k]! * v; const s = r.base[ci * r.K + k]!; b += w[k]! * s; b2 += w[k]! * w[k]! * s; }
        // Election Day: the precincts still out can differ a lot from those counted; the fewer remain, the larger the deviation.
        const left = m === MODE_ED ? Math.max(0, inp.parts.precincts[p]! - precDone[p]!) : 0;
        const drift = m === MODE_ED && left > 0 ? Math.max(DRIFT[0]!, 0.25 / Math.sqrt(left)) : undefined;
        cells.push({ mode: m, counted: c, contrast: d, sq, expected: e, expectedSd: sd, base: b, baseSq: b2, ...(drift !== undefined ? { drift } : {}) });
      }
    });
    return cells;
  };
  const contrast = (K: number, a: number, b: number) => { const w = new Float64Array(K); if (b >= 0) { w[a] = 1; w[b] = -1; } else { for (let k = 0; k < K - 1; k++) w[k] = -1; w[a] = 1; } return w; };

  interface Eval { a: number; b: number; p: number; stress: number; recount: number; pct: number; prior: number; svy: number; svyMargin: number; modes: boolean; second?: number }
  const evaluate = (r: R, forced?: number): Eval => {
    const K = r.K;
    // Projected final votes, to identify the leading pair.
    const proj = new Float64Array(K - 1);
    let expTot = 0, cntTot = 0, validExp = 0;
    r.rc.parts.forEach((p, i) => {
      for (let m = 0; m < N_MODES; m++) {
        const ci = i * N_MODES + m; if (!r.has[ci]) continue;
        const [e] = wireEst(p, m);
        let c = 0; for (let k = 0; k < K; k++) c += r.cnt[ci * K + k]!;
        const R = Math.max(0, e - c); expTot += Math.max(e, c); cntTot += c;
        for (let k = 0; k < K - 1; k++) { const sh = (r.cnt[ci * K + k]! + 200 * r.base[ci * K + k]!) / (c + 200); proj[k]! += r.cnt[ci * K + k]! + R * sh; }
        validExp += Math.max(e, c) * (1 - r.base[ci * K + K - 1]!);
      }
    });
    const order = Array.from(proj.keys()).sort((x, y) => proj[y]! - proj[x]! || x - y);
    // A ballot measure with a threshold (Phase 7.3): the side that wins is the side of the rule (yes ≥ 60%, or yes
    // beyond half of all ballots), and the contrast weighs the votes (and blank ballots) by the rule.
    const pass = r.rc.def.pass;
    let passA = -1;
    if (pass && forced === undefined) {
      let blank = 0;
      r.rc.parts.forEach((p, i) => { for (let m = 0; m < N_MODES; m++) { const ci = i * N_MODES + m; if (!r.has[ci]) continue; const [e] = wireEst(p, m); let c = 0; for (let k = 0; k < K; k++) c += r.cnt[ci * K + k]!; const R = Math.max(0, e - c); blank += r.cnt[ci * K + K - 1]! + R * ((r.cnt[ci * K + K - 1]! + 200 * r.base[ci * K + K - 1]!) / (c + 200)); } });
      passA = pass[0]! * proj[0]! + pass[1]! * proj[1]! + pass[2]! * blank >= 0 ? 0 : 1;
    }
    const a = forced ?? (passA >= 0 ? passA : order[0]!), b = order.find((x) => x !== a) ?? -1;
    const w = pass ? Float64Array.from({ length: K }, (_, k) => (k === 0 ? pass[0]! : k === 1 ? pass[1]! : k === K - 1 ? pass[2]! : 0) * (a === 0 ? 1 : -1))
      : contrast(K, a, r.rc.def.majority && K - 1 >= 3 ? -1 : b);
    const cells = cellsFor(r, w);
    // Baseline contrast per ballot (expected-vote weighted) and the survey's view of it.
    let bt = 0, et = 0; for (const c of cells) { bt += c.expected * c.base; et += c.expected; }
    const bRate = et > 0 ? bt / et : 0;
    const sP = sdPrior(r);
    let s0 = 0, sdS = sP, svyP = 0.5, svyMargin = 0;
    if (r.survey) {
      let sv = 0, sq = 0; for (let k = 0; k < K - 1; k++) { sv += w[k]! * r.survey[k]!; sq += w[k]! * w[k]! * r.survey[k]!; }
      const uRate = 1 - (validExp / Math.max(1, expTot));
      const svyRate = sv * (1 - uRate), sdSvy = Math.sqrt(Math.max(1e-6, (sq - sv * sv) / r.surveyN) * (1 - uRate) ** 2 + 0.03 ** 2);
      const prec = 1 / (sP * sP) + inp.desk.surveyWeight / (sdSvy * sdSvy);
      s0 = (inp.desk.surveyWeight * (svyRate - bRate) / (sdSvy * sdSvy)) / prec; sdS = Math.sqrt(1 / prec);
      svyP = normCdf(svyRate / sdSvy); svyMargin = sv;
    }
    const belief: Belief = { s0, sdS, sdDelta: 0.06, sdU: 0.05, drift: DRIFT, sysDrift: SYS_DRIFT };
    const pr = project(cells, belief);
    const st = project(cells, { ...belief, sdS: sdS * 2, sdDelta: 0.12, sysDrift: SYS_DRIFT.map((x) => x * 2) });
    const thr = r.rc.def.recount;
    const recount = thr > 0 && b >= 0 ? pInside(pr, thr * validExp) : 0;
    // Evidence from every major voting mode: each mode with ≥ 15% of the expected vote must be ≥ 20% counted.
    const mc = [0, 0, 0, 0], me = [0, 0, 0, 0];
    for (const c of cells) { mc[c.mode]! += c.counted; me[c.mode]! += c.expected; }
    const modes = me.every((e, m) => e < 0.15 * Math.max(1, expTot) || mc[m]! >= 0.2 * e);
    const ev: Eval = { a, b, p: pr.p, stress: st.p, recount, pct: expTot > 0 ? cntTot / expTot : 0, prior: normCdf(bRate / sP), svy: svyP, svyMargin, modes };
    if (inp.trace !== undefined && inp.races[inp.trace] === r.rc) {
      const byMode = [0, 1, 2, 3].map((m) => { let c = 0, e = 0, d = 0, bb = 0; for (const x of cells) if (x.mode === m) { c += x.counted; e += x.expected; d += x.contrast; bb += x.expected * x.base; } return `m${m}: cnt ${Math.round(c)} exp ${Math.round(e)} obs ${(c ? d / c : 0).toFixed(3)} base ${(e ? bb / e : 0).toFixed(3)}`; });
      console.log(`  trace a=${a} b=${b} mean ${(pr.mean / Math.max(1, expTot)).toFixed(4)} sd ${(pr.sd / Math.max(1, expTot)).toFixed(4)} p ${pr.p.toFixed(4)} stress ${st.p.toFixed(4)} pct ${ev.pct.toFixed(2)} s0 ${s0.toFixed(3)} sdS ${sdS.toFixed(3)} | ${byMode.join(' | ')}`);
    }
    // Majority contests: is the second place secure if there is a runoff?
    if (r.rc.def.majority && K - 1 >= 3 && b >= 0) {
      const c = order.find((x) => x !== a && x !== b) ?? -1;
      ev.second = c >= 0 ? project(cellsFor(r, contrast(K, b, c)), belief).p : 1;
    }
    return ev;
  };

  const emit = (r: R, ri: number, t: number, status: number, option: number, option2: number, prob: number, flags = 0) => {
    out.events.time.push(t); out.events.race.push(ri); out.events.status.push(status); out.events.option.push(option); out.events.option2.push(option2);
    out.events.prob.push(Math.max(0, Math.min(10000, Math.round(prob * 10000)))); out.events.flags.push(flags);
    r.status = status; r.option = option;
  };
  const wireRow = (r: R, ri: number, t: number) => {
    let e = 0; r.rc.parts.forEach((p) => { for (let m = 0; m < N_MODES; m++) if (r.has[r.local.get(p)! * N_MODES + m]) e += wireEst(p, m)[0]; });
    if (r.lastWire > 0 && Math.abs(e - r.lastWire) / r.lastWire < 0.003) return;
    r.lastWire = e; out.wire.time.push(t); out.wire.race.push(ri); out.wire.expected.push(Math.round(e));
  };
  const okToCall = (ev: Eval) => ev.p >= inp.desk.callThreshold && ev.stress >= inp.desk.stressMin && ev.recount < 0.05 && ev.pct >= 0.25 && ev.modes;
  const latency = () => rng.range(inp.desk.latency[0], inp.desk.latency[1]);

  const pollClose = (r: R, ri: number, t: number) => {
    r.closed = true;
    wireRow(r, ri, t);
    if (r.K - 1 <= 1) { emit(r, ri, t, ST_CALLED, 0, -1, 1, EVENT_POLLCLOSE_CALL); return; }
    const ev = evaluate(r);
    const strong = r.survey
      ? ev.prior >= 0.999 && ev.svy >= 0.999 && ev.svyMargin >= 0.1
      : ev.prior >= 0.9995 && proxMargin(r, ev.a) >= 0.25;
    if (strong && ev.p >= inp.desk.callThreshold) { emit(r, ri, t, ST_CALLED, ev.a, -1, ev.p, EVENT_POLLCLOSE_CALL); r.calledAt = t; return; }
    emit(r, ri, t, ev.p >= 0.8 ? ST_TOO_EARLY : ST_TOO_CLOSE, ev.a, -1, ev.p);
  };
  /** Baseline margin of option a over the next option among valid votes. */
  const proxMargin = (r: R, a: number): number => {
    const K = r.K, sh = new Float64Array(K); let tot = 0;
    r.rc.parts.forEach((p, i) => { for (let m = 0; m < N_MODES; m++) { const ci = i * N_MODES + m; if (!r.has[ci]) continue; const e = wireEst(p, m)[0]; for (let k = 0; k < K - 1; k++) { sh[k]! += e * r.base[ci * K + k]!; tot += e * r.base[ci * K + k]!; } } });
    if (tot <= 0) return 0;
    let best = 0; for (let k = 0; k < K - 1; k++) if (k !== a && sh[k]! > best) best = sh[k]!;
    return (sh[a]! - best) / tot;
  };

  const step = (r: R, ri: number, t: number) => {
    // A pending projection is published at its time if the evidence held until then.
    if (r.pending && r.pending.at <= t) {
      if (r.lastOk) { emit(r, ri, r.pending.at, ST_CALLED, r.pending.option, -1, r.pending.prob); r.calledAt = r.pending.at; }
      r.pending = null;
    }
    wireRow(r, ri, t);
    if (r.status === ST_CALLED || (r.status === ST_RUNOFF && r.calledAt >= 0)) {
      if (r.status === ST_RUNOFF) return;
      // A projection is withdrawn only when the doubt persists for 30 minutes (desks investigate first).
      const ev = evaluate(r, r.option);
      if (ev.p >= inp.desk.retract) { r.doubtSince = -1; return; }
      if (r.doubtSince < 0) { r.doubtSince = t; return; }
      if (t - r.doubtSince >= 30) { emit(r, ri, t, ST_WITHDRAWN, r.option, -1, ev.p); emit(r, ri, t, ST_TOO_CLOSE, ev.a, -1, ev.p); r.calledAt = -1; r.doubtSince = -1; }
      return;
    }
    const ev = evaluate(r);
    const majority = r.rc.def.majority && r.K - 1 >= 3;
    // Runoff projection: nobody reaches a majority and the top two are secure.
    if (majority && ev.p <= 1 - inp.desk.callThreshold && (ev.second ?? 0) >= inp.desk.callThreshold && ev.pct >= 0.25) {
      emit(r, ri, t, ST_RUNOFF, ev.a, ev.b, 1 - ev.p); r.calledAt = t; r.pending = null; return;
    }
    r.lastOk = okToCall(ev);
    if (r.lastOk && !r.pending) r.pending = { at: Math.round(t + latency()), option: ev.a, prob: ev.p };
    else if (!r.lastOk) r.pending = null;
    else if (r.pending && r.pending.option !== ev.a) r.pending = { at: Math.round(t + latency()), option: ev.a, prob: ev.p };
    // Hysteresis keeps the status from flickering between Too Early and Too Close.
    // Before half the expected vote is counted, a likely leader is "too early"; afterwards an unprojected race is
    // "too close" unless the leader is nearly certain and the desk is only waiting for evidence.
    const early = ev.pct < 0.5
      ? (r.status === ST_TOO_EARLY ? ev.p >= 0.75 : ev.p >= 0.85)
      : (r.status === ST_TOO_EARLY ? ev.p >= 0.97 : ev.p >= 0.985) && ev.recount < 0.05;
    const status = early ? ST_TOO_EARLY : ST_TOO_CLOSE;
    if (status !== r.status || (r.option !== ev.a && status === ST_TOO_EARLY)) emit(r, ri, t, status, ev.a, -1, ev.p);
  };

  // ---- Timeline -------------------------------------------------------------------------------------
  const nB = inp.batch.time.length;
  const closes = races.map((r, ri) => ({ t: r.rc.close, ri })).sort((a, b) => a.t - b.t || a.ri - b.ri);
  let ci = 0;
  const affected = new Set<number>();
  for (let b = 0; b <= nB; b++) {
    const t = b < nB ? inp.batch.time[b]! : Infinity;
    // Poll closings strictly before this batch time.
    while (ci < closes.length && closes[ci]!.t < t) { const { t: tc, ri } = closes[ci++]!; pollClose(races[ri]!, ri, tc); }
    if (b === nB) break;
    // Apply every batch at time t.
    let e = b;
    affected.clear();
    for (; e < nB && inp.batch.time[e] === t; e++) {
      const mode = inp.batch.mode[e]!;
      for (const pr of inp.batch.partRows[e]!) {
        const p = inp.partRows.part[pr]!;
        counted[p * N_MODES + mode]! += inp.partRows.ballots[pr]!; precDone[p]! += inp.partRows.precincts[pr]!;
        if (mode === MODE_PROV) provSeen[p] = 1;
      }
      for (const rr of inp.batch.rows[e]!) {
        const ri = inp.raceRows.race[rr]!, r = races[ri]!, li = r.local.get(inp.raceRows.part[rr]!)!;
        const o = inp.raceRows.off[rr]!;
        for (let k = 0; k < r.K; k++) r.cnt[(li * N_MODES + mode) * r.K + k]! += inp.raceRows.votes[o + k]!;
        affected.add(ri);
      }
    }
    // The wire's estimate per part, recorded when it moves by more than 2% (or the part is first reported).
    const touched = new Set<number>();
    for (let q = b; q < e; q++) for (const pr of inp.batch.partRows[q]!) touched.add(inp.partRows.part[pr]!);
    const wasKnown = mailKnown, wasFinal = final;
    if (!mailKnown && t >= inp.lastClose + 18 * 60) mailKnown = true;
    if (!final && t >= inp.lastClose + inp.rules.canvassDays * 1440) final = true;
    updateStRatio();
    const parts = mailKnown !== wasKnown || final !== wasFinal ? Array.from({ length: P }, (_, p) => p) : [...touched].sort((x, y) => x - y);
    for (const p of parts) {
      let est = 0; for (let m = 0; m < N_MODES; m++) est += wireEst(p, m)[0];
      const prev = lastPart[p]!;
      if (prev < 0 || Math.abs(est - prev) > 0.02 * Math.max(1, prev)) { lastPart[p] = est; out.partWire.time.push(t); out.partWire.part.push(p); out.partWire.expected.push(Math.round(est)); }
    }
    while (ci < closes.length && closes[ci]!.t === t) { const { ri } = closes[ci++]!; pollClose(races[ri]!, ri, t); affected.delete(ri); }
    // Desks re-evaluate a race at most every 2 minutes (15 once projected), and always when a projection is due.
    for (const ri of [...affected].sort((x, y) => x - y)) {
      const r = races[ri]!; if (!r.closed) continue;
      if (t >= r.nextEval || (r.pending && r.pending.at <= t)) { step(r, ri, t); r.dirty = false; r.nextEval = t + (r.status === ST_CALLED && r.doubtSince < 0 ? 15 : 2); } else r.dirty = true;
    }
    b = e - 1;
  }
  // End of the feed: evaluate races with unexamined data, then publish projections still pending.
  const tEnd = nB ? inp.batch.time[nB - 1]! : 0;
  races.forEach((r, ri) => { if (r.closed && r.dirty) { step(r, ri, Math.max(tEnd, r.nextEval)); r.dirty = false; } });
  races.forEach((r, ri) => { if (r.pending && r.lastOk) { emit(r, ri, r.pending.at, ST_CALLED, r.pending.option, -1, r.pending.prob); r.pending = null; } });
  return out;
}
