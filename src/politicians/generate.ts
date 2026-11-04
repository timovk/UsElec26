/** Generation of fictional politicians: identities, traits and pre-simulation biographies. */
import type { Rng } from '../core/rng';
import { civilToDays } from '../core/time';
import type { CareerEvent, Person, Tier, Traits } from '../institutions/model';
import { PRE_SIM } from '../institutions/model';
import type { NameGenerator } from './names';

export interface PersonSpec {
  id: number; tier: Tier; stateIdx: number; homeCounty: number | null; partyId: number;
  raceShares: ArrayLike<number>;  // White, Black, Hispanic, Asian/Other shares of the constituency electorate
  femaleShare: number; ageMean: number; ageSd: number; minAge: number; asOfYear: number;
  platform: readonly number[]; moderation: number; prominence: number; createdTime: number;
}

const RACE_NAMES = ['White', 'Black', 'Hispanic', 'Asian/Other'];
const REP_WEIGHT = [1, 0.85, 0.75, 0.7];

export function generatePerson(spec: PersonSpec, r: Rng, names: NameGenerator): Person {
  const w = [0, 1, 2, 3].map((i) => Math.pow(Math.max(0, spec.raceShares[i]!), 1.25) * REP_WEIGHT[i]!);
  const race = r.weighted(w);
  const sex: 'M' | 'F' = r.bernoulli(spec.femaleShare) ? 'F' : 'M';
  const n = names.generate(r, sex, race);
  const age = Math.round(r.truncNormal(spec.ageMean, spec.ageSd, spec.minAge, 88));
  const birthYear = spec.asOfYear - age - (r.bernoulli(0.5) ? 1 : 0);
  const birthDay = civilToDays(birthYear, 1, 1) + r.int(365);
  const ideo = spec.platform.map((x) => x * (1 - spec.moderation) + r.normal(0, 0.28)) as [number, number, number];
  const skill = (a: number, b: number) => Math.round(r.beta(a, b) * 1000) / 1000;
  const boost = spec.tier === 'A' ? 1.6 : spec.tier === 'B' ? 1.0 : 0.6;
  const traits: Traits = {
    asOf: spec.createdTime, ideology: ideo.map((x) => Math.round(x * 1000) / 1000) as [number, number, number],
    charisma: skill(2 + boost, 3), campaign: skill(2 + boost, 3), fundraising: skill(2 + boost, 3),
    leadership: skill(1.5 + boost, 3), integrity: skill(4, 2), ambition: skill(2 + boost * 0.8, 2.5),
    recognition: Math.min(0.99, Math.round((spec.prominence * (0.75 + 0.5 * r.float())) * 1000) / 1000),
  };
  return {
    id: spec.id, given: n.given, middle: n.middle, surname: n.surname, suffix: n.suffix, nickname: null,
    sex, race: RACE_NAMES[race]!, birthDay, deathDay: null, homeState: spec.stateIdx, homeCounty: spec.homeCounty,
    tier: spec.tier, createdTime: spec.createdTime, provenance: PRE_SIM, bio: '', partyId: spec.partyId, traits,
  };
}

const PROFESSIONS: [string, number][] = [
  ['an attorney', 34], ['a small-business owner', 14], ['a corporate executive', 8], ['a teacher', 6], ['a physician', 4],
  ['a military officer', 7], ['a prosecutor', 6], ['a farmer and rancher', 4], ['a journalist', 3], ['a nonprofit director', 5],
  ['a labor organizer', 3], ['an engineer', 3], ['a real-estate developer', 3], ['a congressional aide', 5], ['a professor', 3], ['a nurse', 2],
];

export function pickProfession(r: Rng): string {
  return PROFESSIONS[r.weighted(PROFESSIONS.map((p) => p[1]))]![0];
}

export type CareerDraft = Omit<CareerEvent, 'id'>;

/**
 * Pre-simulation biography: offices held before 2016 as narrative facts (provenance = pre-simulation
 * background). These never carry vote totals — the election archive begins with simulated elections.
 */
export function preSimCareer(personId: number, r: Rng, ctx: {
  stateName: string; birthYear: number; currentTitle: string; currentSince: number; priorChances: Partial<Record<'state_leg' | 'house' | 'statewide' | 'governor' | 'local' | 'senate', number>>;
}): CareerDraft[] {
  const out: CareerDraft[] = [];
  const ev = (kind: string, from: number | null, to: number | null, text: string) => out.push({ personId, yearFrom: from, yearTo: to, simTime: null, kind, text, provenance: PRE_SIM });
  let year = ctx.currentSince;
  const earliest = ctx.birthYear + 26;
  const steps: [keyof typeof ctx.priorChances, string, number][] = [
    ['senate', `U.S. Senator from ${ctx.stateName}`, 6], ['governor', `Governor of ${ctx.stateName}`, 4], ['house', `U.S. Representative from ${ctx.stateName}`, 2],
    ['statewide', `statewide office in ${ctx.stateName}`, 4], ['state_leg', `${ctx.stateName} state legislature`, 2], ['local', 'local office', 4],
  ];
  for (const [key, label, termLen] of steps) {
    const p = ctx.priorChances[key] ?? 0;
    if (p <= 0 || !r.bernoulli(p)) continue;
    const terms = 1 + Math.floor(r.float() * (key === 'house' || key === 'state_leg' ? 4 : 2));
    const to = year; const from = Math.max(earliest, to - terms * termLen);
    if (from >= to) continue;
    const text = key === 'statewide' ? `Held ${label}` : key === 'local' ? `Served in ${label}` : key === 'state_leg' ? `Member of the ${label}` : `Served as ${label}`;
    ev('prior_office', from, to, `${text} (${from}–${to})`);
    year = from;
  }
  ev('early_career', null, year, `Worked as ${pickProfession(r)} before entering elected office`);
  out.reverse();
  ev('current_office', ctx.currentSince, null, `${ctx.currentTitle} since ${ctx.currentSince}`);
  return out;
}
