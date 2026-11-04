/**
 * The 2016 presidential nominating calendar and delegate rules of both major parties, for the 50 states and
 * DC (territories and Democrats Abroad are outside the universe's geography, so their delegates are omitted
 * and the majority is computed on the delegates that exist here).
 *
 * Compiled from general knowledge of the 2016 cycle (party rules and state party plans as widely reported),
 * not individually cited: dates, delegate counts and allocation rules are approximations of the 2016 baseline.
 * Dates are stored as weekday rules so later cycles keep the same rhythm (Iowa on the first Monday in
 * February, New Hampshire eight days later, Super Tuesday on the first Tuesday in March, and so on).
 */
import type { DateRule } from './elections2016';

export type NominatingEvent = 'primary' | 'caucus' | 'convention';

/**
 * Allocation of a state's pledged delegates:
 * - `prop`: proportional to the vote among candidates above `threshold`, statewide (Democrats split by
 *   district and at-large, Republicans statewide unless `byDistrict`);
 * - `wta`: winner-take-all statewide;
 * - `wta_cd`: at-large delegates winner-take-all statewide, three per congressional district to the district winner;
 * - `unbound`: no binding preference vote (delegates chosen at a state convention, free at the national one).
 * `wtaAbove`: a candidate above this share statewide takes all (Republican "winner-take-all trigger").
 */
export interface Allocation { rule: 'prop' | 'wta' | 'wta_cd' | 'unbound'; threshold: number; wtaAbove?: number; byDistrict?: boolean; unbound?: number }

export interface PartyContestRules { date: DateRule; event: NominatingEvent; delegates: number; alloc: Allocation }
export interface StateNominating { D: PartyContestRules; R: PartyContestRules }

const MON = 1, TUE = 2, SAT = 6, SUN = 0;
const d = (month: number, wd: number, nth: number | 'last'): DateRule => ({ month, weekday: wd, nth });
const IOWA = d(2, MON, 1), NH = d(2, TUE, 2), FEB20 = d(2, SAT, 3), FEB23 = d(2, TUE, 4), FEB27 = d(2, SAT, 4);
const ST = d(3, TUE, 1), MAR5 = d(3, SAT, 1), MAR6 = d(3, SUN, 1), MAR8 = d(3, TUE, 2), MAR12 = d(3, SAT, 2), MAR15 = d(3, TUE, 3), MAR22 = d(3, TUE, 4), MAR26 = d(3, SAT, 4);
const APR1 = d(4, SAT, 1), APR5 = d(4, TUE, 1), APR9 = d(4, SAT, 2), APR16 = d(4, SAT, 3), APR19 = d(4, TUE, 3), APR26 = d(4, TUE, 4);
const MAY3 = d(5, TUE, 1), MAY10 = d(5, TUE, 2), MAY17 = d(5, TUE, 3), MAY24 = d(5, TUE, 4), JUN7 = d(6, TUE, 1), JUN14 = d(6, TUE, 2);

const P = (threshold = 0.15): Allocation => ({ rule: 'prop', threshold });
const RP = (threshold: number, wtaAbove?: number, byDistrict = false): Allocation => ({ rule: 'prop', threshold, ...(wtaAbove ? { wtaAbove } : {}), ...(byDistrict ? { byDistrict } : {}) });
const WTA: Allocation = { rule: 'wta', threshold: 0 }, WTA_CD: Allocation = { rule: 'wta_cd', threshold: 0 }, UNB: Allocation = { rule: 'unbound', threshold: 0 };
const dem = (date: DateRule, event: NominatingEvent, delegates: number): PartyContestRules => ({ date, event, delegates, alloc: P() });
const rep = (date: DateRule, event: NominatingEvent, delegates: number, alloc: Allocation): PartyContestRules => ({ date, event, delegates, alloc });

/** Pledged delegates per state (Democrats: pledged only; superdelegates are the party's officeholders, see below). */
export const NOMINATING_2016: Record<string, StateNominating> = {
  IA: { D: dem(IOWA, 'caucus', 44), R: rep(IOWA, 'caucus', 30, RP(0)) },
  NH: { D: dem(NH, 'primary', 24), R: rep(NH, 'primary', 23, RP(0.1)) },
  NV: { D: dem(FEB20, 'caucus', 35), R: rep(FEB23, 'caucus', 30, RP(0)) },
  SC: { D: dem(FEB27, 'primary', 53), R: rep(FEB20, 'primary', 50, WTA_CD) },
  AL: { D: dem(ST, 'primary', 53), R: rep(ST, 'primary', 50, RP(0.2, 0.5, true)) },
  AK: { D: dem(MAR26, 'caucus', 16), R: rep(ST, 'caucus', 28, RP(0.13)) },
  AR: { D: dem(ST, 'primary', 32), R: rep(ST, 'primary', 40, RP(0.15, 0.5)) },
  CO: { D: dem(ST, 'caucus', 66), R: rep(APR9, 'convention', 37, UNB) },
  GA: { D: dem(ST, 'primary', 102), R: rep(ST, 'primary', 76, RP(0.2, 0.5, true)) },
  MA: { D: dem(ST, 'primary', 91), R: rep(ST, 'primary', 42, RP(0.05)) },
  MN: { D: dem(ST, 'caucus', 77), R: rep(ST, 'caucus', 38, RP(0.1)) },
  OK: { D: dem(ST, 'primary', 38), R: rep(ST, 'primary', 43, RP(0.15, 0.5, true)) },
  TN: { D: dem(ST, 'primary', 67), R: rep(ST, 'primary', 58, RP(0.2, 0.67, true)) },
  TX: { D: dem(ST, 'primary', 222), R: rep(ST, 'primary', 155, RP(0.2, 0.5, true)) },
  VT: { D: dem(ST, 'primary', 16), R: rep(ST, 'primary', 16, RP(0.2, 0.5)) },
  VA: { D: dem(ST, 'primary', 95), R: rep(ST, 'primary', 49, RP(0)) },
  KS: { D: dem(MAR5, 'caucus', 33), R: rep(MAR5, 'caucus', 40, RP(0.1)) },
  KY: { D: dem(MAY17, 'primary', 55), R: rep(MAR5, 'caucus', 46, RP(0.05)) },
  LA: { D: dem(MAR5, 'primary', 51), R: rep(MAR5, 'primary', 46, RP(0.2)) },
  ME: { D: dem(MAR6, 'caucus', 25), R: rep(MAR5, 'caucus', 23, RP(0.1, 0.5)) },
  NE: { D: dem(MAR5, 'caucus', 25), R: rep(MAY10, 'primary', 36, WTA) },
  HI: { D: dem(MAR26, 'caucus', 25), R: rep(MAR8, 'caucus', 19, RP(0)) },
  ID: { D: dem(MAR22, 'caucus', 23), R: rep(MAR8, 'primary', 32, RP(0.2, 0.5)) },
  MI: { D: dem(MAR8, 'primary', 130), R: rep(MAR8, 'primary', 59, RP(0.15, 0.5)) },
  MS: { D: dem(MAR8, 'primary', 36), R: rep(MAR8, 'primary', 40, RP(0.15, 0.5, true)) },
  DC: { D: dem(JUN14, 'primary', 20), R: rep(MAR12, 'convention', 19, RP(0.15)) },
  WY: { D: dem(APR9, 'caucus', 14), R: rep(APR16, 'convention', 29, UNB) },
  FL: { D: dem(MAR15, 'primary', 214), R: rep(MAR15, 'primary', 99, WTA) },
  IL: { D: dem(MAR15, 'primary', 156), R: rep(MAR15, 'primary', 69, WTA_CD) },
  MO: { D: dem(MAR15, 'primary', 71), R: rep(MAR15, 'primary', 52, WTA_CD) },
  NC: { D: dem(MAR15, 'primary', 107), R: rep(MAR15, 'primary', 72, RP(0)) },
  OH: { D: dem(MAR15, 'primary', 143), R: rep(MAR15, 'primary', 66, WTA) },
  AZ: { D: dem(MAR22, 'primary', 75), R: rep(MAR22, 'primary', 58, WTA) },
  UT: { D: dem(MAR22, 'caucus', 33), R: rep(MAR22, 'caucus', 40, RP(0.15, 0.5)) },
  ND: { D: dem(JUN7, 'caucus', 18), R: rep(APR1, 'convention', 28, UNB) },
  WA: { D: dem(MAR26, 'caucus', 101), R: rep(MAY24, 'primary', 44, RP(0.2, 0.5, true)) },
  WI: { D: dem(APR5, 'primary', 86), R: rep(APR5, 'primary', 42, WTA_CD) },
  NY: { D: dem(APR19, 'primary', 247), R: rep(APR19, 'primary', 95, RP(0.2, 0.5, true)) },
  CT: { D: dem(APR26, 'primary', 55), R: rep(APR26, 'primary', 28, { rule: 'prop', threshold: 0.2, wtaAbove: 0.5, byDistrict: true }) },
  DE: { D: dem(APR26, 'primary', 21), R: rep(APR26, 'primary', 16, WTA) },
  MD: { D: dem(APR26, 'primary', 95), R: rep(APR26, 'primary', 38, WTA_CD) },
  PA: { D: dem(APR26, 'primary', 189), R: rep(APR26, 'primary', 71, { rule: 'wta', threshold: 0, unbound: 54 }) },
  RI: { D: dem(APR26, 'primary', 24), R: rep(APR26, 'primary', 19, RP(0.1)) },
  IN: { D: dem(MAY3, 'primary', 83), R: rep(MAY3, 'primary', 57, WTA_CD) },
  WV: { D: dem(MAY10, 'primary', 29), R: rep(MAY10, 'primary', 34, RP(0)) },
  OR: { D: dem(MAY17, 'primary', 61), R: rep(MAY17, 'primary', 28, RP(0.036)) },
  CA: { D: dem(JUN7, 'primary', 475), R: rep(JUN7, 'primary', 172, WTA_CD) },
  MT: { D: dem(JUN7, 'primary', 21), R: rep(JUN7, 'primary', 27, WTA) },
  NJ: { D: dem(JUN7, 'primary', 126), R: rep(JUN7, 'primary', 51, WTA) },
  NM: { D: dem(JUN7, 'primary', 34), R: rep(JUN7, 'primary', 24, RP(0.15)) },
  SD: { D: dem(JUN7, 'primary', 20), R: rep(JUN7, 'primary', 29, WTA) },
};

/**
 * Democratic superdelegates (2016 rules): the party's governors, U.S. senators and representatives, plus DNC
 * members. DNC members per state are approximated as 4 + 1 per 2.5 million residents (about 440 nationally).
 * They are free to vote for anyone and may commit (endorse) at any time.
 */
export const DNC_MEMBERS = (pop: number) => 4 + Math.floor(pop / 2_500_000);

/** Caucus participation relative to a primary (logit), and the share of caucus-goers among a primary electorate's most engaged. */
export const CAUCUS_TURNOUT_OFFSET = -2.1;
/** Days before the convention when the nominating season is considered over. */
export const CONVENTION_DAY = d(7, MON, 'last');

export function majorityOf(total: number): number { return Math.floor(total / 2) + 1; }
