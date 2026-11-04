/**
 * Institutional baseline of the 50 states and DC as of January 1, 2016 — real constitutional and
 * statutory structure that the fictional universe inherits. Subsequent changes happen only through
 * simulated legislation or ballot measures.
 *
 * Sources: state constitutions and statutes as summarized by the National Conference of State
 * Legislatures, the National Association of Secretaries of State and the National Governors
 * Association (2016), compiled from the developer's knowledge. Entries marked in `APPROXIMATE`
 * carry estimates rather than legal facts. Verification against primary sources is tracked in
 * docs/data-sources.md. Invariants (seat totals, class sizes, office counts) are tested.
 */

export type TermLimit =
  | { kind: 'none' }
  | { kind: 'consecutive'; terms: number }
  | { kind: 'lifetime'; terms: number }
  | { kind: 'window'; years: number; within: number }; // e.g. 8 of 16 years

export type LtGov = 'joint' | 'separate' | 'senate_president' | 'none';
export type SenateVacancy = 'appoint' | 'appoint_same_party' | 'special_only';
export type Successor = 'lt_governor' | 'secretary_of_state' | 'senate_president';

export interface Chamber { name: string; seats: number; termYears: number }

export interface StateInstitutions {
  usps: string;
  senateClasses: readonly number[];      // U.S. Senate classes present (empty for DC)
  governor: { termYears: number; lastElection: number; termLimit: TermLimit; successor: Successor } | null;
  ltGov: LtGov;
  agElected: boolean;
  sos: 'elected' | 'appointed' | 'legislature' | 'none';
  upper: Chamber | null;
  lower: Chamber | null;                 // null for Nebraska's unicameral legislature and DC
  senateVacancy: SenateVacancy;
  /** Approximate share of voting-age population disenfranchised by felony conviction (2016 estimates). */
  felonyShare: number;
}

const none: TermLimit = { kind: 'none' };
const c2: TermLimit = { kind: 'consecutive', terms: 2 };
const l2: TermLimit = { kind: 'lifetime', terms: 2 };
const w816: TermLimit = { kind: 'window', years: 8, within: 16 };

const S = (seats: number, termYears = 4, name = 'Senate'): Chamber => ({ name, seats, termYears });
const H = (seats: number, termYears = 2, name = 'House of Representatives'): Chamber => ({ name, seats, termYears });
const gov = (termYears: number, lastElection: number, termLimit: TermLimit, successor: Successor = 'lt_governor') => ({ termYears, lastElection, termLimit, successor });

export const STATES_2016: Record<string, StateInstitutions> = {
  AL: { usps: 'AL', senateClasses: [2, 3], governor: gov(4, 2014, c2), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(35), lower: H(105, 4), senateVacancy: 'appoint', felonyShare: 0.076 },
  AK: { usps: 'AK', senateClasses: [2, 3], governor: gov(4, 2014, c2), ltGov: 'joint', agElected: false, sos: 'none', upper: S(20), lower: H(40), senateVacancy: 'appoint', felonyShare: 0.019 },
  AZ: { usps: 'AZ', senateClasses: [1, 3], governor: gov(4, 2014, c2, 'secretary_of_state'), ltGov: 'none', agElected: true, sos: 'elected', upper: S(30, 2), lower: H(60), senateVacancy: 'appoint_same_party', felonyShare: 0.049 },
  AR: { usps: 'AR', senateClasses: [2, 3], governor: gov(4, 2014, l2), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(35), lower: H(100), senateVacancy: 'appoint', felonyShare: 0.033 },
  CA: { usps: 'CA', senateClasses: [1, 3], governor: gov(4, 2014, l2), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(40), lower: H(80, 2, 'Assembly'), senateVacancy: 'appoint', felonyShare: 0.010 },
  CO: { usps: 'CO', senateClasses: [2, 3], governor: gov(4, 2014, c2), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(35), lower: H(65), senateVacancy: 'appoint', felonyShare: 0.005 },
  CT: { usps: 'CT', senateClasses: [1, 3], governor: gov(4, 2014, none), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(36, 2), lower: H(151), senateVacancy: 'appoint', felonyShare: 0.006 },
  DE: { usps: 'DE', senateClasses: [1, 2], governor: gov(4, 2012, l2), ltGov: 'separate', agElected: true, sos: 'appointed', upper: S(21), lower: H(41), senateVacancy: 'appoint', felonyShare: 0.022 },
  DC: { usps: 'DC', senateClasses: [], governor: null, ltGov: 'none', agElected: false, sos: 'none', upper: null, lower: null, senateVacancy: 'appoint', felonyShare: 0.003 },
  FL: { usps: 'FL', senateClasses: [1, 3], governor: gov(4, 2014, c2), ltGov: 'joint', agElected: true, sos: 'appointed', upper: S(40), lower: H(120), senateVacancy: 'appoint', felonyShare: 0.104 },
  GA: { usps: 'GA', senateClasses: [2, 3], governor: gov(4, 2014, c2), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(56, 2), lower: H(180), senateVacancy: 'appoint', felonyShare: 0.038 },
  HI: { usps: 'HI', senateClasses: [1, 3], governor: gov(4, 2014, c2), ltGov: 'joint', agElected: false, sos: 'none', upper: S(25), lower: H(51), senateVacancy: 'appoint_same_party', felonyShare: 0.006 },
  ID: { usps: 'ID', senateClasses: [2, 3], governor: gov(4, 2014, none), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(35, 2), lower: H(70), senateVacancy: 'appoint', felonyShare: 0.016 },
  IL: { usps: 'IL', senateClasses: [2, 3], governor: gov(4, 2014, none), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(59), lower: H(118), senateVacancy: 'appoint', felonyShare: 0.005 },
  IN: { usps: 'IN', senateClasses: [1, 3], governor: gov(4, 2012, c2), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(50), lower: H(100), senateVacancy: 'appoint', felonyShare: 0.005 },
  IA: { usps: 'IA', senateClasses: [2, 3], governor: gov(4, 2014, none), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(50), lower: H(100), senateVacancy: 'appoint', felonyShare: 0.017 },
  KS: { usps: 'KS', senateClasses: [2, 3], governor: gov(4, 2014, c2), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(40), lower: H(125), senateVacancy: 'appoint', felonyShare: 0.008 },
  KY: { usps: 'KY', senateClasses: [2, 3], governor: gov(4, 2015, c2), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(38), lower: H(100), senateVacancy: 'appoint', felonyShare: 0.091 },
  LA: { usps: 'LA', senateClasses: [2, 3], governor: gov(4, 2015, c2), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(39), lower: H(105, 4), senateVacancy: 'appoint', felonyShare: 0.022 },
  ME: { usps: 'ME', senateClasses: [1, 2], governor: gov(4, 2014, c2, 'senate_president'), ltGov: 'none', agElected: false, sos: 'legislature', upper: S(35, 2), lower: H(151), senateVacancy: 'appoint', felonyShare: 0.0 },
  MD: { usps: 'MD', senateClasses: [1, 3], governor: gov(4, 2014, c2), ltGov: 'joint', agElected: true, sos: 'appointed', upper: S(47), lower: H(141, 4, 'House of Delegates'), senateVacancy: 'appoint_same_party', felonyShare: 0.011 },
  MA: { usps: 'MA', senateClasses: [1, 2], governor: gov(4, 2014, none), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(40, 2), lower: H(160), senateVacancy: 'appoint', felonyShare: 0.002 },
  MI: { usps: 'MI', senateClasses: [1, 2], governor: gov(4, 2014, l2), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(38), lower: H(110), senateVacancy: 'appoint', felonyShare: 0.005 },
  MN: { usps: 'MN', senateClasses: [1, 2], governor: gov(4, 2014, none), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(67), lower: H(134), senateVacancy: 'appoint', felonyShare: 0.014 },
  MS: { usps: 'MS', senateClasses: [1, 2], governor: gov(4, 2015, l2), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(52), lower: H(122, 4), senateVacancy: 'appoint', felonyShare: 0.096 },
  MO: { usps: 'MO', senateClasses: [1, 3], governor: gov(4, 2012, l2), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(34), lower: H(163), senateVacancy: 'appoint', felonyShare: 0.015 },
  MT: { usps: 'MT', senateClasses: [1, 2], governor: gov(4, 2012, w816), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(50), lower: H(100), senateVacancy: 'appoint', felonyShare: 0.004 },
  NE: { usps: 'NE', senateClasses: [1, 2], governor: gov(4, 2014, c2), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(49, 4, 'Legislature'), lower: null, senateVacancy: 'appoint', felonyShare: 0.014 },
  NV: { usps: 'NV', senateClasses: [1, 3], governor: gov(4, 2014, l2), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(21), lower: H(42, 2, 'Assembly'), senateVacancy: 'appoint', felonyShare: 0.040 },
  NH: { usps: 'NH', senateClasses: [2, 3], governor: gov(2, 2014, none, 'senate_president'), ltGov: 'none', agElected: false, sos: 'legislature', upper: S(24, 2), lower: H(400), senateVacancy: 'appoint', felonyShare: 0.002 },
  NJ: { usps: 'NJ', senateClasses: [1, 2], governor: gov(4, 2013, c2), ltGov: 'joint', agElected: false, sos: 'appointed', upper: S(40), lower: H(80, 2, 'General Assembly'), senateVacancy: 'appoint', felonyShare: 0.013 },
  NM: { usps: 'NM', senateClasses: [1, 2], governor: gov(4, 2014, c2), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(42), lower: H(70), senateVacancy: 'appoint', felonyShare: 0.011 },
  NY: { usps: 'NY', senateClasses: [1, 3], governor: gov(4, 2014, none), ltGov: 'joint', agElected: true, sos: 'appointed', upper: S(63, 2), lower: H(150, 2, 'Assembly'), senateVacancy: 'appoint', felonyShare: 0.007 },
  NC: { usps: 'NC', senateClasses: [2, 3], governor: gov(4, 2012, c2), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(50, 2), lower: H(120), senateVacancy: 'appoint_same_party', felonyShare: 0.012 },
  ND: { usps: 'ND', senateClasses: [1, 3], governor: gov(4, 2012, none), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(47), lower: H(94, 4), senateVacancy: 'appoint', felonyShare: 0.003 },
  OH: { usps: 'OH', senateClasses: [1, 3], governor: gov(4, 2014, c2), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(33), lower: H(99), senateVacancy: 'appoint', felonyShare: 0.006 },
  OK: { usps: 'OK', senateClasses: [2, 3], governor: gov(4, 2014, l2), ltGov: 'separate', agElected: true, sos: 'appointed', upper: S(48), lower: H(101), senateVacancy: 'special_only', felonyShare: 0.016 },
  OR: { usps: 'OR', senateClasses: [2, 3], governor: gov(4, 2014, c2, 'secretary_of_state'), ltGov: 'none', agElected: true, sos: 'elected', upper: S(30), lower: H(60), senateVacancy: 'special_only', felonyShare: 0.005 },
  PA: { usps: 'PA', senateClasses: [1, 3], governor: gov(4, 2014, c2), ltGov: 'joint', agElected: true, sos: 'appointed', upper: S(50), lower: H(203), senateVacancy: 'appoint', felonyShare: 0.005 },
  RI: { usps: 'RI', senateClasses: [1, 2], governor: gov(4, 2014, c2), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(38, 2), lower: H(75), senateVacancy: 'special_only', felonyShare: 0.006 },
  SC: { usps: 'SC', senateClasses: [2, 3], governor: gov(4, 2014, c2), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(46), lower: H(124), senateVacancy: 'appoint', felonyShare: 0.013 },
  SD: { usps: 'SD', senateClasses: [2, 3], governor: gov(4, 2014, c2), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(35, 2), lower: H(70), senateVacancy: 'appoint', felonyShare: 0.009 },
  TN: { usps: 'TN', senateClasses: [1, 2], governor: gov(4, 2014, c2, 'senate_president'), ltGov: 'senate_president', agElected: false, sos: 'legislature', upper: S(33), lower: H(99), senateVacancy: 'appoint', felonyShare: 0.083 },
  TX: { usps: 'TX', senateClasses: [1, 2], governor: gov(4, 2014, none), ltGov: 'separate', agElected: true, sos: 'appointed', upper: S(31), lower: H(150), senateVacancy: 'appoint', felonyShare: 0.019 },
  UT: { usps: 'UT', senateClasses: [1, 3], governor: gov(4, 2012, none), ltGov: 'joint', agElected: true, sos: 'none', upper: S(29), lower: H(75), senateVacancy: 'appoint_same_party', felonyShare: 0.003 },
  VT: { usps: 'VT', senateClasses: [1, 3], governor: gov(2, 2014, none), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(30, 2), lower: H(150), senateVacancy: 'appoint', felonyShare: 0.0 },
  VA: { usps: 'VA', senateClasses: [1, 2], governor: gov(4, 2013, { kind: 'consecutive', terms: 1 }), ltGov: 'separate', agElected: true, sos: 'appointed', upper: S(40), lower: H(100, 2, 'House of Delegates'), senateVacancy: 'appoint', felonyShare: 0.078 },
  WA: { usps: 'WA', senateClasses: [1, 3], governor: gov(4, 2012, none), ltGov: 'separate', agElected: true, sos: 'elected', upper: S(49), lower: H(98), senateVacancy: 'appoint', felonyShare: 0.018 },
  WV: { usps: 'WV', senateClasses: [1, 2], governor: gov(4, 2012, c2, 'senate_president'), ltGov: 'senate_president', agElected: true, sos: 'elected', upper: S(34), lower: H(100, 2, 'House of Delegates'), senateVacancy: 'appoint_same_party', felonyShare: 0.006 },
  WI: { usps: 'WI', senateClasses: [1, 3], governor: gov(4, 2014, none), ltGov: 'joint', agElected: true, sos: 'elected', upper: S(33), lower: H(99, 2, 'Assembly'), senateVacancy: 'special_only', felonyShare: 0.012 },
  WY: { usps: 'WY', senateClasses: [1, 2], governor: gov(4, 2014, w816, 'secretary_of_state'), ltGov: 'none', agElected: false, sos: 'elected', upper: S(30), lower: H(60), senateVacancy: 'appoint_same_party', felonyShare: 0.042 },
};

/** Fields that are estimates rather than legal facts. */
export const APPROXIMATE: readonly (keyof StateInstitutions)[] = ['felonyShare'];

/** U.S. Senate class → year of the class's next regular election from 2016 (class 3 in 2016, 1 in 2018, 2 in 2020). */
export const SENATE_CLASS_NEXT_ELECTION: Record<number, number> = { 1: 2018, 2: 2020, 3: 2016 };

/** The 15 executive departments, in order of presidential succession. */
export const EXECUTIVE_DEPARTMENTS = [
  ['State', 'Secretary of State'], ['Treasury', 'Secretary of the Treasury'], ['Defense', 'Secretary of Defense'],
  ['Justice', 'Attorney General'], ['Interior', 'Secretary of the Interior'], ['Agriculture', 'Secretary of Agriculture'],
  ['Commerce', 'Secretary of Commerce'], ['Labor', 'Secretary of Labor'], ['Health and Human Services', 'Secretary of Health and Human Services'],
  ['Housing and Urban Development', 'Secretary of Housing and Urban Development'], ['Transportation', 'Secretary of Transportation'],
  ['Energy', 'Secretary of Energy'], ['Education', 'Secretary of Education'], ['Veterans Affairs', 'Secretary of Veterans Affairs'],
  ['Homeland Security', 'Secretary of Homeland Security'],
] as const;
