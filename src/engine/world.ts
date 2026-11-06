/** The in-memory universe state held by the Engine Worker (mirrored to the universe database). */
import type { SimTime } from '../core/time';
import type { GeoPack } from '../geo/pack';
import type { Population } from '../population/population';
import type { Electorate, Lean } from '../electorate/model';
import type { Chamber, NewsItem, Office, Party, Person, Term, Vacancy } from '../institutions/model';
import type { Districts } from './districts';
import type { ElectionLaw } from '../rules/electionLaw';

export interface LeanSet { bu: Lean; county: Lean; state: Lean; cd: Lean; national: { d: number; t: number } }

export interface World {
  seed: string; name: string; startTime: SimTime; time: SimTime;
  pack: GeoPack; pop: Population; electorate: Electorate; lean: LeanSet;
  parties: Party[];
  persons: Map<number, Person>;
  offices: Office[];
  officeById: Map<number, Office>;
  current: Map<number, Term>;          // officeId → current term
  vacancies: Map<number, Vacancy>;
  chambers: Chamber[];
  /** District plans (2016 and every later plan) and apportionments. */
  districts: Districts;
  /** Election law over time: the 2016 baseline plus changes enacted in the universe (Phase 7.1). */
  law: ElectionLaw;
  history: { env: Record<string, number>; presidentTermNumber: number };
  ids: { person: number; term: number; career: number; news: number; event: number };
  /** Rows produced since the last flush (written by persistence in one transaction). */
  pending: PendingWrites;
}

export interface PendingWrites {
  persons: Person[]; terms: Term[]; termEnds: { id: number; end: number; reason: string }[]; deaths: { id: number; day: number }[];
  careers: import('../institutions/model').CareerEvent[]; news: NewsItem[]; vacanciesSet: Vacancy[]; vacanciesCleared: number[];
  traits: Person[];
}

export function emptyPending(): PendingWrites {
  return { persons: [], terms: [], termEnds: [], deaths: [], careers: [], news: [], vacanciesSet: [], vacanciesCleared: [], traits: [] };
}

export function aggregateLean(bu: Lean, pack: GeoPack, districts?: Districts): Omit<LeanSet, 'bu'> {
  const C = pack.counties.length, S = pack.states.length, D = districts ? districts.cds.length : pack.cds.length;
  const county = { dVotes: new Float64Array(C), votes: new Float64Array(C) };
  const state = { dVotes: new Float64Array(S), votes: new Float64Array(S) };
  const cd = { dVotes: new Float64Array(D), votes: new Float64Array(D) };
  let nd = 0, nt = 0;
  for (let b = 0; b < pack.bu.rows; b++) {
    const d = bu.dVotes[b]!, t = bu.votes[b]!;
    const c = pack.bu.county[b]!, s = pack.counties[c]!.stateIdx;
    county.dVotes[c]! += d; county.votes[c]! += t; state.dVotes[s]! += d; state.votes[s]! += t;
    nd += d; nt += t;
  }
  // Districts: every plan's districts (each BU belongs to one district of each plan).
  const add = (b0: number, a: ArrayLike<number>) => { for (let i = 0; i < a.length; i++) { const k = a[i]!; if (k < D) { cd.dVotes[k]! += bu.dVotes[b0 + i]!; cd.votes[k]! += bu.votes[b0 + i]!; } } };
  if (districts) districts.eachPlan('cd', (s, b0, asg) => {
    if (asg) add(b0, asg);
    else { const rg = pack.counties.filter((c) => c.stateIdx === s); const b1 = rg[rg.length - 1]!.buStart + rg[rg.length - 1]!.buCount; add(b0, pack.bu.cd.subarray(b0, b1)); }
  });
  else add(0, pack.bu.cd);
  return { county, state, cd, national: { d: nd, t: nt } };
}

export const leanMargin = (l: { dVotes: Float64Array; votes: Float64Array }, i: number): number =>
  l.votes[i]! > 0 ? 100 * (2 * l.dVotes[i]! / l.votes[i]! - 1) : 0;
