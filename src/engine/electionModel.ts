/** Contest-level modelling shared by the election engine: candidate quality, valence and result aggregation. */
import { Rng } from '../core/rng';
import type { Office, OfficeKind, Person } from '../institutions/model';
import { PARTY_D, PARTY_R } from '../institutions/model';
import type { KernelContest, ShardInput, ShardOutput } from '../electorate/kernel';
import { N_CLASS, N_MODES } from '../electorate/kernel';
import type { ContestResult } from '../archive/results';
import type { GeoPack } from '../geo/pack';

export interface ContestRow {
  contest_id: number; election_id: number; office_id: number | null; kind: string; party_id: number | null; state_idx: number | null;
  district_idx: number | null; method: string; label: string; status: string; winner_candidacy: number | null; runner_up_candidacy: number | null;
  term_start: number | null; parent_contest: number | null; next_contest: number | null; ev: number | null; year: number;
}
export interface CandidacyRow { candidacy_id: number; contest_id: number; person_id: number; party_id: number; ballot_order: number; incumbent: number; running_mate: number | null; status: string; quality: number }

/** Office salience in the vote choice (weight on partisanship). */
export function officeWeight(kind: string): number {
  return ({ president: 1, us_senator: 0.95, us_representative: 0.9, governor: 0.75, lt_governor: 0.85, attorney_general: 0.85, secretary_of_state: 0.85 } as Record<string, number>)[kind] ?? 0.85;
}
/** Undervote propensity by office (logit of abstaining relative to voting). */
export function officeAbstain(kind: string): number {
  return ({ president: -4.2, us_senator: -3.5, us_representative: -3.0, governor: -3.7, lt_governor: -2.4, attorney_general: -2.3, secretary_of_state: -2.3 } as Record<string, number>)[kind] ?? -2.5;
}
const INCUMBENCY: Record<string, number> = { president: 0.08, us_senator: 0.15, us_representative: 0.22, governor: 0.12, lt_governor: 0.12, attorney_general: 0.14, secretary_of_state: 0.14 };

const TIER: Partial<Record<OfficeKind, number>> = {
  president: 1, vice_president: 0.92, governor: 0.86, us_senator: 0.86, cabinet: 0.7, lt_governor: 0.64, attorney_general: 0.64,
  secretary_of_state: 0.6, us_representative: 0.62, state_leg_leader: 0.5, congress_leader: 0.62,
};

/** Candidate quality in [0,1]: experience (highest office held now or background) plus campaign skills. */
export function candidateQuality(p: Person, heldKinds: OfficeKind[], backgroundTier: number): number {
  const tier = Math.max(backgroundTier, ...heldKinds.map((k) => TIER[k] ?? 0.3));
  return Math.round((0.5 * tier + 0.3 * p.traits.campaign + 0.2 * p.traits.fundraising) * 1000) / 1000;
}

export interface Ctx {
  classCentroids: number[][]; platforms: { D: number[]; R: number[] };
  /** Campaign effects (Phase 5): valence added to the option and the candidate's campaign recognition in this race. */
  campaign?: (cand: CandidacyRow, person: Person, stateIdx: number) => { valence: number; recognition: number } | null;
}

const dist2 = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + (x - b[i]!) ** 2, 0);

/** Build the kernel representation of a contest (valence, ideology fit by cohort class, minor-party appeal). */
export function kernelContest(seed: string, c: ContestRow, cands: { cand: CandidacyRow; person: Person }[], officeKind: string, stateIdx: number, primary: boolean, ctx: Ctx): KernelContest {
  // Unmodelled candidate-specific appeal; a presidential state race keys it by year and state, so pre-convention matchup polls and the November ballot share it.
  const r = c.kind === 'pres_state' ? Rng.stream(seed, 'campaign', 'pres', c.year, stateIdx) : Rng.stream(seed, 'campaign', c.contest_id);
  const majorCount = cands.filter((x) => x.cand.party_id === PARTY_D || x.cand.party_id === PARTY_R).length;
  const options = cands.map(({ cand, person }) => {
    const party = cand.party_id;
    const major = party === PARTY_D || party === PARTY_R;
    const plat = party === PARTY_R ? ctx.platforms.R : ctx.platforms.D;
    const lambda = primary ? 0.3 : 0.12;
    const classFit = Array.from({ length: N_CLASS }, (_, h) => {
      const cen = ctx.classCentroids[h]!;
      return major ? -lambda * (dist2(cen, person.traits.ideology) - dist2(cen, plat)) : 0;
    });
    let base: number;
    const camp = ctx.campaign?.(cand, person, stateIdx) ?? null;
    const recog = camp?.recognition ?? person.traits.recognition;
    if (primary) base = 0.9 * (cand.quality - 0.5) + 0.8 * (recog - 0.3) + (cand.incumbent ? 0.5 : 0) + r.normal(0, 0.25);
    else if (major) base = 0.45 * (cand.quality - 0.5) + 0.25 * (recog - 0.3) + (cand.incumbent ? INCUMBENCY[officeKind] ?? 0.12 : 0) + r.normal(0, 0.1);
    else base = (party === 3 ? -2.3 : party === 4 ? -3.0 : -2.7) + (officeKind === 'president' ? 0.3 : 0) + 1.2 * (cand.quality - 0.4) + (majorCount < 2 ? 1.2 : 0) + r.normal(0, 0.15);
    if (camp) base += primary ? 2.5 * camp.valence : camp.valence;
    return {
      partySign: primary ? 0 : party === PARTY_D ? 0.5 : party === PARTY_R ? -0.5 : 0,
      base, classFit, minorAppeal: !primary && !major ? 0.55 : 0,
      homeCounty: person.homeCounty ?? -1, homeState: person.homeState === stateIdx,
    };
  });
  const uncontested = cands.length <= 1;
  return {
    id: c.contest_id, cd: officeKind === 'us_representative' && c.district_idx !== null ? c.district_idx : -1,
    weight: primary ? 0 : officeWeight(officeKind), abstain: (primary ? -2.2 : officeAbstain(officeKind)) + (uncontested ? 1.6 : majorCount < 2 ? 0.5 : 0),
    options,
  };
}

/** Collect shard outputs into per-contest results (unit grain or county-part grain). */
/** County and congressional district of a base unit: from the pack (engine) or from a shard's own columns (worker). */
export interface BuGeo { county(bu: number): number; cd(bu: number): number }
export const packGeo = (pack: GeoPack, cdOf: Uint16Array = pack.bu.cd): BuGeo => ({ county: (bu) => pack.bu.county[bu]!, cd: (bu) => cdOf[bu]! });
export const shardGeo = (inp: ShardInput): BuGeo => ({ county: (bu) => inp.bus.county[bu - inp.bus.start]!, cd: (bu) => inp.bus.cd[bu - inp.bus.start]! });

export function aggregate(geo: BuGeo, shards: { input: ShardInput; output: ShardOutput }[], contests: Map<number, { candidacyIds: number[]; grain: 'bu' | 'cpart' }>): Map<number, ContestResult> {
  const res = new Map<number, ContestResult>();
  const acc = new Map<number, { units: number[]; votes: number[]; rj: Map<number, number[]>; elig: number; county: Map<number, number[]>; cd: Map<number, number[]>; cpart: Map<number, number[]> }>();
  for (const { input, output } of shards) {
    const eligByBu = new Map<number, number>();
    for (let i = 0; i < output.eligible.length; i++) eligByBu.set(input.bus.start + i, output.eligible[i]!);
    for (const co of output.contests) {
      const meta = contests.get(co.id); if (!meta) continue;
      const k = meta.candidacyIds.length + 1;
      let a = acc.get(co.id);
      if (!a) { a = { units: [], votes: [], rj: new Map(), elig: 0, county: new Map(), cd: new Map(), cpart: new Map() }; acc.set(co.id, a); }
      for (let u = 0; u < co.units.length; u++) {
        const bu = co.units[u]!, county = geo.county(bu), cd = geo.cd(bu);
        a.elig += eligByBu.get(bu) ?? 0;
        const add = (m: Map<number, number[]>, key: number) => { let v = m.get(key); if (!v) { v = new Array<number>(k).fill(0); m.set(key, v); } for (let j = 0; j < k; j++) v[j]! += co.votes[u * k + j]!; };
        add(a.county, county); add(a.cd, cd);
        if (meta.grain === 'cpart') add(a.cpart, county * 65536 + cd);
        else { a.units.push(bu); for (let j = 0; j < k; j++) a.votes.push(co.votes[u * k + j]!); }
      }
      for (let lr = 0; lr < input.rjCount; lr++) for (let m = 0; m < N_MODES; m++) {
        const o = (lr * N_MODES + m) * k; let any = false;
        for (let j = 0; j < k; j++) if (co.rjMode[o + j]!) { any = true; break; }
        if (!any) continue;
        const key = (input.rjFirst + lr) * N_MODES + m;
        let v = a.rj.get(key); if (!v) { v = new Array<number>(k).fill(0); a.rj.set(key, v); }
        for (let j = 0; j < k; j++) v[j]! += co.rjMode[o + j]!;
      }
    }
  }
  for (const [id, a] of acc) {
    const meta = contests.get(id)!;
    let units: Int32Array, votes: Int32Array;
    if (meta.grain === 'cpart') {
      const keys = [...a.cpart.keys()].sort((x, y) => x - y);
      units = Int32Array.from(keys); votes = Int32Array.from(keys.flatMap((kk) => a.cpart.get(kk)!));
    } else { units = Int32Array.from(a.units); votes = Int32Array.from(a.votes); }
    res.set(id, {
      contestId: id, candidacyIds: meta.candidacyIds, grain: meta.grain, units, votes,
      rjMode: [...a.rj].sort((x, y) => x[0] - y[0]).map(([key, v]) => ({ rj: Math.floor(key / N_MODES), mode: key % N_MODES, votes: v })),
      eligible: a.elig, countyTotals: a.county, cdTotals: a.cd,
    });
  }
  return res;
}

export function heldKinds(current: Map<number, { personId: number }>, officeById: Map<number, Office>, personId: number): OfficeKind[] {
  const out: OfficeKind[] = [];
  for (const [oid, t] of current) if (t.personId === personId) out.push(officeById.get(oid)!.kind);
  return out;
}
