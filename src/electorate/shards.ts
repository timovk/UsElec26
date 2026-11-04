/** Builds kernel shard inputs (one per state) from the universe electorate, an environment and contests. */
import { Rng } from '../core/rng';
import type { GeoPack } from '../geo/pack';
import { N_COHORTS, cohortAge } from '../population/cohorts';
import { MARG_STRIDE, type Population } from '../population/population';
import type { Electorate } from './model';
import type { Environment } from './environment';
import { N_MODES, cohortClasses, type KernelContest, type ShardInput } from './kernel';
import { ELECTION_RULES_2016, MODE_USAGE_2016 } from '../rules/elections2016';

export interface StateRange { buStart: number; buEnd: number; countyFirst: number; countyEnd: number; rjFirst: number; rjCount: number }

export function stateRanges(pack: GeoPack): StateRange[] {
  return pack.states.map((s) => {
    const cs = pack.counties.filter((c) => c.stateIdx === s.idx);
    const rjs = pack.rj.filter((r) => r.stateIdx === s.idx);
    const first = cs[0]!, last = cs[cs.length - 1]!;
    return { buStart: first.buStart, buEnd: last.buStart + last.buCount, countyFirst: first.idx, countyEnd: last.idx + 1, rjFirst: rjs[0]?.idx ?? 0, rjCount: rjs.length };
  });
}

/**
 * Base logits of the four ballot modes by age band, from the state's 2016 voting options and approximate
 * 2016 usage levels (older voters favour mail and early voting).
 */
export function modeLogits(usps: string): Float64Array {
  const m = ELECTION_RULES_2016[usps]?.modes ?? { allMail: false, earlyInPerson: true, noExcuseAbsentee: true };
  const use = MODE_USAGE_2016[usps] ?? [0.2, 0.12, 0.01];
  const early = m.earlyInPerson && !m.allMail ? use[0] : 0, mail = use[1], prov = use[2];
  const ed = Math.max(0.03, 1 - early - mail - prov);
  const out = new Float64Array(4 * N_MODES);
  // Age effects are centred on a typical electorate so the usage levels hold on average.
  const ageMail = [-0.55, -0.3, 0, 0.55], ageEarly = [-0.22, -0.12, 0.03, 0.18];
  for (let a = 0; a < 4; a++) {
    const base = [0, early > 0 ? Math.log(early / ed) + ageEarly[a]! : -Infinity, Math.log(mail / ed) + ageMail[a]!, Math.log(prov / ed)];
    for (let k = 0; k < N_MODES; k++) out[a * N_MODES + k] = base[k]!;
  }
  return out;
}

export interface ShardContext {
  seed: string; electionKey: string; pack: GeoPack; pop: Population; electorate: Electorate; env: Environment | null;
  tauE: number; ranges: StateRange[];
}

let classCache: { key: unknown; classOf: Uint8Array } | null = null;
export function classOf(e: Electorate): Uint8Array {
  if (classCache?.key !== e.params) classCache = { key: e.params, classOf: cohortClasses(e.params).classOf };
  return classCache.classOf;
}

export function buildShard(ctx: ShardContext, stateIdx: number, kind: ShardInput['kind'], primaryParty: number, contests: KernelContest[], competitiveness: number): ShardInput {
  const { pack, pop, electorate: e, env } = ctx;
  const rg = ctx.ranges[stateIdx]!;
  const count = rg.buEnd - rg.buStart;
  const nC = rg.countyEnd - rg.countyFirst;
  const cls = classOf(e);
  const state = pack.states[stateIdx]!;
  const r = Rng.stream(ctx.seed, 'shard', ctx.electionKey, stateIdx, primaryParty);
  // County means: long-run partisanship + short-term environment (shared by every contest on the ballot).
  const mu = new Float32Array(nC * N_COHORTS), cTurn = new Float32Array(nC);
  const stateShift = env ? env.national + env.division[state.division]! + env.state[stateIdx]! : 0;
  for (let i = 0; i < nC; i++) {
    const c = rg.countyFirst + i;
    const shift = stateShift + (env ? env.county[c]! : 0);
    for (let k = 0; k < N_COHORTS; k++) mu[i * N_COHORTS + k] = e.mu[c * N_COHORTS + k]! + shift + (env ? env.classSwing[cls[k]!]! : 0);
    cTurn[i] = (env ? env.countyTurnout[c]! + env.stateTurnout[stateIdx]! : 0) + 0.3 * (competitiveness - 0.45); // battleground mobilization, centred
  }
  const shift = new Float32Array(count), turnout = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const b = rg.buStart + i;
    shift[i] = e.buShift[b]! + (env ? r.normal(0, 0.07) : 0);
    turnout[i] = r.normal(0, 0.1);
  }
  const marg = pop.marg.slice(rg.buStart * MARG_STRIDE, rg.buEnd * MARG_STRIDE);
  const joint = pop.countyJoint.slice(rg.countyFirst * N_COHORTS, rg.countyEnd * N_COHORTS);
  const offset = kind === 'general' || kind === 'allparty' ? 0 : 0;
  const tau = Float64Array.from({ length: N_COHORTS }, (_, k) => ctx.tauE + offset + e.params.turnoutBase[k]! + (kind === 'primary' ? 0.35 * (cohortAge(k) - 1.5) : 0));
  const primaryType = ELECTION_RULES_2016[state.usps]?.primaryType ?? 'open';
  return {
    seedKey: `${ctx.seed}|${ctx.electionKey}|${stateIdx}|${primaryParty}`, kind, primaryParty,
    crossover: primaryType === 'closed' ? 0.03 : primaryType === 'semi' ? 0.12 : 0.22,
    homeStateBonus: 0.1, homeCountyBonus: 0.22,
    bus: { start: rg.buStart, count, county: pack.bu.county.slice(rg.buStart, rg.buEnd), cd: pack.bu.cd.slice(rg.buStart, rg.buEnd), rj: pack.bu.rj.slice(rg.buStart, rg.buEnd),
      vep: pop.vep.slice(rg.buStart, rg.buEnd), shift, turnout, marg },
    counties: { first: rg.countyFirst, mu, turnout: cTurn, joint },
    classOf: cls, sigma: Float64Array.from(e.params.sigma), tau,
    betaInt: kind === 'primary' ? e.params.betaIntensity * 3 : e.params.betaIntensity, enth: env?.enthusiasm ?? 0,
    modeLogits: modeLogits(state.usps), modeGap: Float64Array.from(env?.modeGap ?? [0, 0, 0, 0]),
    rjFirst: rg.rjFirst, rjCount: rg.rjCount, contests,
  };
}
