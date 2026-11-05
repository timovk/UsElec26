/** In-memory institutional model shared by the engine, persistence and the API. */

export type OfficeKind =
  | 'president' | 'vice_president' | 'cabinet'
  | 'us_senator' | 'us_representative'
  | 'governor' | 'lt_governor' | 'attorney_general' | 'secretary_of_state'
  | 'congress_leader' | 'state_leg_leader'
  | 'state_senator' | 'state_representative';

/** State legislative seats (Phase 6). */
export const LEGISLATOR_KINDS: readonly OfficeKind[] = ['state_senator', 'state_representative'];
export const isLegislator = (k: OfficeKind | string): boolean => k === 'state_senator' || k === 'state_representative';

export interface Party { id: number; name: string; short: string; abbrev: string; color: string; major: boolean; status: 'active' | 'defunct' }

export const PARTY_D = 1, PARTY_R = 2, PARTY_L = 3, PARTY_G = 4, PARTY_IND = 5;

export const BASE_PARTIES: readonly Party[] = [
  { id: PARTY_D, name: 'Democratic Party', short: 'Democratic', abbrev: 'D', color: '#1F5FD6', major: true, status: 'active' },
  { id: PARTY_R, name: 'Republican Party', short: 'Republican', abbrev: 'R', color: '#D7263D', major: true, status: 'active' },
  { id: PARTY_L, name: 'Libertarian Party', short: 'Libertarian', abbrev: 'L', color: '#E0A800', major: false, status: 'active' },
  { id: PARTY_G, name: 'Green Party', short: 'Green', abbrev: 'G', color: '#2E9E5B', major: false, status: 'active' },
  { id: PARTY_IND, name: 'Independent', short: 'Independent', abbrev: 'I', color: '#8A8F9E', major: false, status: 'active' },
];

export interface Traits {
  asOf: number;
  ideology: [number, number, number];
  charisma: number; campaign: number; fundraising: number; leadership: number; integrity: number; ambition: number; recognition: number;
}

export type Tier = 'A' | 'B' | 'C';

export interface Person {
  id: number; given: string; middle: string | null; surname: string; suffix: string | null; nickname: string | null;
  sex: 'M' | 'F'; race: string; birthDay: number; deathDay: number | null;
  homeState: number; homeCounty: number | null; tier: Tier; createdTime: number; provenance: string; bio: string;
  partyId: number; traits: Traits;
}

export interface Office {
  id: number; kind: OfficeKind; title: string; stateIdx: number | null; districtIdx: number | null;
  senateClass: number | null; chamberId: number | null; dept: string | null; rank: number;
}

export interface Term {
  id: number; officeId: number; personId: number; partyId: number | null; start: number; end: number | null;
  acquired: string; endReason: string | null; provenance: string;
}

export interface Chamber {
  id: number; kind: 'us_senate' | 'us_house' | 'state_upper' | 'state_lower'; stateIdx: number | null; name: string; seats: number; termYears: number;
  composition: Map<number, number>; compositionAsOf: number; compositionProvenance: string;
}

export interface CareerEvent { id: number; personId: number; yearFrom: number | null; yearTo: number | null; simTime: number | null; kind: string; text: string; provenance: string }

export interface NewsItem { id: number; time: number; kind: string; headline: string; body: string; refs: Record<string, unknown> }

export interface Vacancy { officeId: number; since: number; reason: string; resolution: string }

export function fullName(p: Pick<Person, 'given' | 'middle' | 'surname' | 'suffix' | 'nickname'>, withMiddle = false): string {
  const given = p.nickname ?? p.given;
  return [given, withMiddle && p.middle ? `${p.middle}.` : null, p.surname].filter(Boolean).join(' ') + (p.suffix ? ` ${p.suffix}` : '');
}

export const PRE_SIM = 'pre-simulation background';
export const SIMULATED = 'simulated';
