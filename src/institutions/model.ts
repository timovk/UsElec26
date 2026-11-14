/** In-memory institutional model shared by the engine, persistence and the API. */
import type { DownballotKind } from '../rules/downballot2016';
import type { CountyKind } from '../rules/county2016';

export type OfficeKind =
  | 'president' | 'vice_president' | 'cabinet'
  | 'us_senator' | 'us_representative'
  | 'governor' | 'lt_governor' | 'attorney_general' | 'secretary_of_state'
  | 'congress_leader' | 'state_leg_leader'
  | 'state_senator' | 'state_representative'
  // Phase 7.2: down-ballot statewide offices, elected boards and state courts (rules/downballot2016).
  | DownballotKind
  // Phase 7.3: the statewide ballot measures of a state (one holderless office per state; its contests are measures).
  | 'ballot_measure'
  // Phase 7.6: county offices (rules/county2016).
  | CountyKind;

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
  /** A seat of a down-ballot office, board or court (Phase 7.2; table office_seat). */
  seat?: OfficeSeat;
}

/**
 * A seat of a down-ballot body: the body (its key in rules/downballot2016), the seat number, the district it is
 * elected from (1-based; 0 statewide), and its cycle: an election year (or, on appointed courts, the year a term
 * ends) and the term length. Appointments to elected and retention seats move the cycle to the appointee's first
 * election.
 */
export interface OfficeSeat {
  body: string; number: number; district: number; cycle: number; termYears: number;
  /** A county office (Phase 7.6): its county, or −1 for a prosecutor's multi-county district (body "pros:<key>"). */
  county?: number;
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

/**
 * The two options of a ballot measure (Phase 7.3): candidacies with these person and party ids. They are not people:
 * code that names a candidacy's person uses `optionPerson` for them.
 */
export const MEASURE_YES = -1, MEASURE_NO = -2;
const stubTraits = { asOf: 0, ideology: [0, 0, 0] as [number, number, number], charisma: 0, campaign: 0, fundraising: 0, leadership: 0, integrity: 1, ambition: 0, recognition: 0 };
const stub = (id: number, given: string): Person => ({ id, given, middle: null, surname: '', suffix: null, nickname: null, sex: 'F', race: '', birthDay: 0, deathDay: null,
  homeState: -1, homeCounty: null, tier: 'C', createdTime: 0, provenance: 'ballot measure option', bio: '', partyId: id, traits: stubTraits });
const OPTIONS = new Map<number, Person>([[MEASURE_YES, stub(MEASURE_YES, 'Yes')], [MEASURE_NO, stub(MEASURE_NO, 'No')]]);
/** The Yes or No option of a ballot measure as a person-like record (its name is "Yes" or "No"); undefined for real people. */
export const optionPerson = (id: number): Person | undefined => OPTIONS.get(id);
export const isMeasureOption = (id: number): boolean => id === MEASURE_YES || id === MEASURE_NO;

export const PRE_SIM = 'pre-simulation background';
export const SIMULATED = 'simulated';
