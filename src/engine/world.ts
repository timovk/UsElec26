/** The in-memory universe state held by the Engine Worker (mirrored to the universe database). */
import type { SimTime } from '../core/time';
import type { GeoPack } from '../geo/pack';
import type { Population } from '../population/population';
import type { Electorate, Lean } from '../electorate/model';
import type { Chamber, NewsItem, Office, Party, Person, Term, Vacancy } from '../institutions/model';

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

export function aggregateLean(bu: Lean, pack: GeoPack): Omit<LeanSet, 'bu'> {
  const C = pack.counties.length, S = pack.states.length, D = pack.cds.length;
  const county = { dVotes: new Float64Array(C), votes: new Float64Array(C) };
  const state = { dVotes: new Float64Array(S), votes: new Float64Array(S) };
  const cd = { dVotes: new Float64Array(D), votes: new Float64Array(D) };
  let nd = 0, nt = 0;
  for (let b = 0; b < pack.bu.rows; b++) {
    const d = bu.dVotes[b]!, t = bu.votes[b]!;
    const c = pack.bu.county[b]!, s = pack.counties[c]!.stateIdx, k = pack.bu.cd[b]!;
    county.dVotes[c]! += d; county.votes[c]! += t; state.dVotes[s]! += d; state.votes[s]! += t;
    if (k < D) { cd.dVotes[k]! += d; cd.votes[k]! += t; }
    nd += d; nt += t;
  }
  return { county, state, cd, national: { d: nd, t: nt } };
}

export const leanMargin = (l: { dVotes: Float64Array; votes: Float64Array }, i: number): number =>
  l.votes[i]! > 0 ? 100 * (2 * l.dVotes[i]! / l.votes[i]! - 1) : 0;
