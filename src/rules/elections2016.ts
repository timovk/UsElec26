/**
 * Election-law baseline of the 50 states and DC as practised in 2016: primary calendars and systems,
 * runoff rules, voting-method availability, inauguration timing and presidential ballot access.
 * Compiled from state election codes as summarized by NCSL and state election offices (developer
 * knowledge). Calendars repeat the 2016 pattern every cycle, so states that move primaries between
 * presidential and midterm years are approximated. Entries are structural data, not code branches;
 * later phases change them only through simulated law.
 */
import { civilToDays, nthWeekday, weekday, type DayNumber } from '../core/time';

export type PrimaryType = 'open' | 'semi' | 'closed' | 'top_two' | 'jungle';

export interface DateRule { month: number; weekday: number; nth: number | 'last' }

export interface StateElectionRules {
  primary: DateRule;
  primaryType: PrimaryType;
  /** Primary runoff: required when no candidate reaches `threshold` of the vote. */
  primaryRunoff: { threshold: number; daysAfter: number } | null;
  /** General-election runoff (majority requirement). */
  generalRunoff: { threshold: number; daysAfter: number; federalDaysAfter: number } | null;
  modes: { allMail: boolean; earlyInPerson: boolean; noExcuseAbsentee: boolean };
  /** Governor (and statewide officers) take office: month/weekday/nth in the year after the election (KY: December of election year). */
  inauguration: DateRule & { sameYear?: boolean };
  /** Presidential ballot access for minor parties (2016). */
  ballot: { L: boolean; G: boolean };
}

const TUE = 2, MON = 1, WED = 3, THU = 4, SAT = 6;
const d = (month: number, wd: number, nth: number | 'last'): DateRule => ({ month, weekday: wd, nth });
const inaug = d(1, MON, 2);
const R50 = (days: number) => ({ threshold: 0.5, daysAfter: days });

type Row = [DateRule, PrimaryType, StateElectionRules['primaryRunoff'], [boolean, boolean, boolean], boolean];
// primary rule, primary type, primary runoff, [allMail, earlyInPerson, noExcuseAbsentee], Green on presidential ballot
const T: Record<string, Row> = {
  AL: [d(3, TUE, 1), 'open', R50(42), [false, false, false], true],
  AK: [d(8, TUE, 3), 'semi', null, [false, true, true], true],
  AZ: [d(8, TUE, 'last'), 'semi', null, [false, true, true], true],
  AR: [d(3, TUE, 1), 'open', R50(21), [false, true, false], true],
  CA: [d(6, TUE, 1), 'top_two', null, [false, true, true], true],
  CO: [d(6, TUE, 'last'), 'semi', null, [true, true, true], true],
  CT: [d(8, TUE, 2), 'semi', null, [false, false, false], true],
  DE: [d(9, TUE, 2), 'closed', null, [false, false, false], true],
  DC: [d(6, TUE, 3), 'closed', null, [false, true, true], true],
  FL: [d(8, TUE, 'last'), 'closed', null, [false, true, true], true],
  GA: [d(5, TUE, 4), 'open', R50(63), [false, true, true], false],
  HI: [d(8, SAT, 2), 'open', null, [false, true, true], true],
  ID: [d(5, TUE, 3), 'semi', null, [false, true, true], true],
  IL: [d(3, TUE, 3), 'open', null, [false, true, true], true],
  IN: [d(5, TUE, 1), 'open', null, [false, true, false], false],
  IA: [d(6, TUE, 1), 'open', null, [false, true, true], true],
  KS: [d(8, TUE, 1), 'semi', null, [false, true, true], true],
  KY: [d(5, TUE, 3), 'closed', null, [false, false, false], true],
  LA: [d(11, TUE, 1), 'jungle', null, [false, true, false], true],
  ME: [d(6, TUE, 2), 'semi', null, [false, true, true], true],
  MD: [d(4, TUE, 'last'), 'closed', null, [false, true, true], true],
  MA: [d(9, THU, 2), 'semi', null, [false, true, false], true],
  MI: [d(8, TUE, 1), 'open', null, [false, false, false], true],
  MN: [d(8, TUE, 2), 'open', null, [false, true, true], true],
  MS: [d(3, TUE, 2), 'open', R50(21), [false, false, false], true],
  MO: [d(8, TUE, 1), 'open', null, [false, false, false], true],
  MT: [d(6, TUE, 1), 'open', null, [false, true, true], true],
  NE: [d(5, TUE, 2), 'semi', null, [false, true, true], true],
  NV: [d(6, TUE, 2), 'closed', null, [false, true, true], false],
  NH: [d(9, TUE, 2), 'semi', null, [false, false, false], true],
  NJ: [d(6, TUE, 1), 'semi', null, [false, true, true], true],
  NM: [d(6, TUE, 1), 'closed', null, [false, true, true], true],
  NY: [d(6, TUE, 'last'), 'closed', null, [false, false, false], true],
  NC: [d(3, TUE, 3), 'semi', { threshold: 0.3, daysAfter: 49 }, [false, true, true], false],
  ND: [d(6, TUE, 2), 'open', null, [false, true, true], true],
  OH: [d(3, TUE, 3), 'open', null, [false, true, true], true],
  OK: [d(6, TUE, 'last'), 'semi', R50(56), [false, true, true], false],
  OR: [d(5, TUE, 3), 'closed', null, [true, false, true], true],
  PA: [d(4, TUE, 'last'), 'closed', null, [false, false, false], true],
  RI: [d(9, TUE, 2), 'semi', null, [false, false, false], true],
  SC: [d(6, TUE, 2), 'open', R50(14), [false, false, false], true],
  SD: [d(6, TUE, 1), 'semi', { threshold: 0.35, daysAfter: 70 }, [false, true, true], false],
  TN: [d(8, THU, 1), 'open', null, [false, true, false], true],
  TX: [d(3, TUE, 1), 'open', R50(84), [false, true, false], true],
  UT: [d(6, TUE, 'last'), 'semi', null, [false, true, true], true],
  VT: [d(8, TUE, 2), 'open', null, [false, true, true], true],
  VA: [d(6, TUE, 2), 'open', null, [false, false, false], true],
  WA: [d(8, TUE, 1), 'top_two', null, [true, false, true], true],
  WV: [d(5, TUE, 2), 'semi', null, [false, true, false], true],
  WI: [d(8, TUE, 2), 'open', null, [false, true, true], true],
  WY: [d(8, TUE, 3), 'semi', null, [false, true, true], true],
};

const INAUG: Record<string, StateElectionRules['inauguration']> = {
  KY: { ...d(12, TUE, 2), sameYear: true }, LA: d(1, MON, 2), MS: d(1, TUE, 2), VA: d(1, SAT, 2),
  NJ: d(1, TUE, 3), MD: d(1, WED, 3), AL: d(1, MON, 3), TX: d(1, TUE, 3),
};

export const ELECTION_RULES_2016: Record<string, StateElectionRules> = Object.fromEntries(Object.entries(T).map(([usps, [primary, primaryType, primaryRunoff, [allMail, earlyInPerson, noExcuseAbsentee], green]]) => [usps, {
  primary, primaryType, primaryRunoff,
  generalRunoff: usps === 'GA' ? { threshold: 0.5, daysAfter: 28, federalDaysAfter: 63 } : usps === 'LA' ? { threshold: 0.5, daysAfter: 32, federalDaysAfter: 32 } : null,
  modes: { allMail, earlyInPerson, noExcuseAbsentee },
  inauguration: INAUG[usps] ?? inaug,
  ballot: { L: true, G: green },
}]));

/** Day number of a date rule in a year. */
export function ruleDay(year: number, r: DateRule): DayNumber {
  if (r.nth === 'last') {
    const next = r.month === 12 ? civilToDays(year + 1, 1, 1) : civilToDays(year, r.month + 1, 1);
    const last = next - 1;
    return last - ((weekday(last) - r.weekday + 7) % 7);
  }
  return nthWeekday(year, r.month, r.weekday, r.nth);
}

/** Electoral votes per state from House apportionment (+2), DC 3 (23rd Amendment). */
export function electoralVotes(usps: string, houseSeats: number): number { return usps === 'DC' ? 3 : houseSeats + 2; }

/** States that award electoral votes by congressional district (2 at-large + 1 per district). */
export const DISTRICT_EV_STATES = new Set(['ME', 'NE']);

/** Federal fixed dates. */
/** Electors meet on the first Monday after the second Wednesday in December (3 U.S.C. §7, 2016 text). */
export const ELECTORS_MEET = (year: number) => nthWeekday(year, 12, WED, 2) + 5;
export const CONGRESS_COUNT_DAY = (year: number) => civilToDays(year + 1, 1, 6);

/**
 * Approximate 2016 usage of each ballot mode (shares of ballots cast: early in person, mail, provisional;
 * Election Day is the rest), from the general pattern of the 2016 Election Administration and Voting Survey.
 * Availability still follows `modes`: a state without early in-person voting has none.
 */
export const MODE_USAGE_2016: Record<string, [number, number, number]> = {
  AL: [0.02, 0.04, 0.005], AK: [0.2, 0.1, 0.02], AZ: [0.1, 0.6, 0.02], AR: [0.5, 0.04, 0.005], CA: [0.05, 0.53, 0.05],
  CO: [0, 0.93, 0.01], CT: [0, 0.07, 0.005], DE: [0, 0.06, 0.005], DC: [0.2, 0.05, 0.03], FL: [0.38, 0.3, 0.005],
  GA: [0.45, 0.06, 0.005], HI: [0.15, 0.5, 0.01], ID: [0.1, 0.2, 0.01], IL: [0.22, 0.07, 0.01], IN: [0.25, 0.05, 0.005],
  IA: [0.2, 0.2, 0.005], KS: [0.25, 0.1, 0.02], KY: [0.02, 0.04, 0.005], LA: [0.25, 0.04, 0.005], ME: [0.15, 0.15, 0.005],
  MD: [0.23, 0.06, 0.02], MA: [0.2, 0.05, 0.005], MI: [0.05, 0.23, 0.005], MN: [0.05, 0.22, 0.005], MS: [0.02, 0.05, 0.005],
  MO: [0.02, 0.07, 0.005], MT: [0.05, 0.6, 0.01], NE: [0.1, 0.25, 0.01], NV: [0.55, 0.08, 0.01], NH: [0, 0.08, 0.005],
  NJ: [0.02, 0.1, 0.02], NM: [0.5, 0.1, 0.01], NY: [0, 0.05, 0.03], NC: [0.6, 0.04, 0.01], ND: [0.3, 0.25, 0.005],
  OH: [0.1, 0.23, 0.02], OK: [0.1, 0.05, 0.005], OR: [0, 0.93, 0.01], PA: [0, 0.05, 0.005], RI: [0, 0.05, 0.005],
  SC: [0.25, 0.05, 0.005], SD: [0.2, 0.1, 0.005], TN: [0.6, 0.03, 0.005], TX: [0.55, 0.06, 0.005], UT: [0.05, 0.68, 0.02],
  VT: [0.2, 0.12, 0.005], VA: [0.1, 0.07, 0.005], WA: [0, 0.93, 0.01], WV: [0.3, 0.04, 0.005], WI: [0.2, 0.07, 0.005], WY: [0.2, 0.1, 0.005],
};
