/**
 * Fictional polling organizations (docs/architecture/04 §4.8): each has a method, a house effect that drifts
 * slowly, class coverage biases, a likely-voter screen of some quality, a typical sample size and frequency, a
 * geographic scope, a herding tendency and a sponsor. Names are invented (checked against real pollsters).
 */
import { Rng } from '../core/rng';

export type PollMethod = 'live phone' | 'IVR/text' | 'online panel' | 'mixed mode';
export type PollScope = 'national' | 'multi-state' | 'state';

export interface PollsterParams {
  /** House effect (utility units toward the Democratic candidate) and its slow drift (bounded at three times this over decades). */
  house: number; houseDrift: number;
  classBias: number[];          // log weights by cohort class
  partisanNonresponse: number;
  lvQuality: number;            // 0–1: how well the likely-voter screen works
  lvTilt: number;               // direction and size of the screen's error (screen exponent = (1 − lvQuality) × lvTilt)
  n: [number, number];          // typical sample size range
  deff: number;
  perMonth: number;             // polls per month at peak season
  herding: number;              // 0–1: pull toward the public average
  undecided: number;            // base undecided share (pushing leaners lowers it)
  usesLV: boolean;              // switches to likely voters in the fall
}

export interface Pollster { id: number; name: string; short: string; method: PollMethod; sponsor: string | null; scope: PollScope; homeState: number | null; founded: number; params: PollsterParams }

const FIRST = ['Larkspur', 'Wexford', 'Ironbridge', 'Halcyon', 'Tidewater', 'Copperfield', 'Ashgrove', 'Redwing', 'Saltmarsh', 'Juniper Point', 'Stonebrook', 'Kettle Creek',
  'Brightwater', 'Pinecrest', 'Westmere', 'Quillfeather', 'Northgate', 'Driftwood', 'Cobalt', 'Ember Vale', 'Marrow Hill', 'Thistle', 'Glenwood', 'Harrowgate', 'Bramble',
  'Lindenfield', 'Corvid', 'Blackthorn', 'Featherstone', 'Amberly', 'Fernbrook', 'Coldwater Bay', 'Sable Ridge', 'Mistral', 'Oriel', 'Wren Hollow', 'Calloway Hill', 'Lowmoor'];
const KIND = ['Analytics', 'Opinion Research', 'Survey Group', 'Polling', 'Insights', 'Data', 'Research', 'Strategies', 'Polling Institute', 'Survey Center', 'Public Opinion Lab'];
const UNIVERSITIES = ['Ashgrove University', 'Stonebrook College', 'Harrowgate University', 'Glenwood College', 'Fernbrook University', 'Calloway State University'];
const SPONSORS = ['MNN', 'The Daily Ledger', 'Capitol Wire', 'Metro Herald', 'The Morning Courier', 'Plains Observer', 'Coastline Times', 'Union Gazette', 'The Civic Review', null, null, null];
const METHODS: PollMethod[] = ['live phone', 'IVR/text', 'online panel', 'mixed mode'];

/** Real polling organizations' names are never generated (a guard; the word lists above are invented). */
const REAL = /gallup|marist|quinnipiac|monmouth|siena|emerson|rasmussen|surveyusa|ipsos|yougov|morning consult|selzer|suffolk|harris|zogby|pew|ppp|public policy polling|trafalgar|insider advantage|mason-dixon|fox|cnn|abc|nbc|cbs|reuters|ap-norc|franklin|keystone|granite state|field poll|elway|epic-mra|ras/i;

export function makePollsters(seed: string, states: { idx: number; vep: number }[], startYear: number): Pollster[] {
  const r = Rng.stream(seed, 'pollsters');
  const names = new Set<string>();
  const out: Pollster[] = [];
  const pick = <T,>(xs: readonly T[]) => xs[r.int(xs.length)]!;
  const N = 32;
  for (let i = 0; i < N; i++) {
    const scope: PollScope = i < 9 ? 'national' : i < 19 ? 'multi-state' : 'state';
    let name = '';
    for (let tries = 0; tries < 50 && (!name || names.has(name) || REAL.test(name)); tries++) {
      name = scope === 'state' && r.bernoulli(0.35) ? `${pick(UNIVERSITIES)} Poll` : `${pick(FIRST)} ${pick(KIND)}`;
    }
    names.add(name);
    const method = pick(METHODS);
    const homeState = scope === 'state' ? states[r.weighted(states.map((s) => Math.sqrt(s.vep)))]!.idx : null;
    const big = scope === 'national';
    out.push({
      id: i + 1, name, short: name.split(' ').slice(0, 2).join(' ').replace(/ (Poll|Analytics|Polling|Research)$/, ''), method,
      sponsor: pick(SPONSORS), scope, homeState, founded: startYear - 1 - r.int(40),
      params: {
        house: r.normal(0, 0.02), houseDrift: r.normal(0, 0.006),
        classBias: [0, 1, 2, 3].map(() => r.normal(0, method === 'online panel' ? 0.05 : method === 'IVR/text' ? 0.06 : 0.035)),
        partisanNonresponse: r.normal(0, 0.006),
        lvQuality: r.range(0.45, 0.95), lvTilt: r.normal(0, 1.2), n: big ? [1000, 2000] : scope === 'multi-state' ? [550, 1000] : [400, 800],
        deff: r.range(1.2, 1.8), perMonth: big ? r.range(2, 8) : scope === 'multi-state' ? r.range(3, 9) : r.range(1, 4),
        herding: r.bernoulli(0.25) ? r.range(0.15, 0.5) : 0, undecided: r.range(0.03, 0.14), usesLV: !r.bernoulli(0.2),
      },
    });
  }
  return out;
}

/** The cycle's shared polling bias (correlated misses): class coverage and partisan nonresponse common to every pollster. */
export function cycleBias(seed: string, year: number): { classBias: number[]; partisanNonresponse: number } {
  const r = Rng.stream(seed, 'poll-cycle-bias', year);
  return { classBias: [0, 1, 2, 3].map(() => r.normal(0, 0.04)), partisanNonresponse: r.normal(0, 0.008) };
}
