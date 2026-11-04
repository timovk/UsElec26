/**
 * 2016 baseline counting rules by state: poll closing (local time), when early and mail ballots may be
 * processed and released, late-arriving mail, rejection rates, canvass and certification timing, and
 * automatic-recount thresholds.
 *
 * Compiled from general knowledge of 2016 state election law and practice, not from individually cited
 * statutes; values marked approximate in docs/phase-3-report.md should be checked against state codes.
 */
import type { ZoneId } from '../core/time';

export interface CountingRules {
  /** Local poll-closing time (hour, minute). */
  close: [number, number];
  /** Zone-specific closing times where state law differs by zone (e.g. Tennessee 7 pm CT / 8 pm ET). */
  closeByZone?: Partial<Record<ZoneId, [number, number]>>;
  /** Mail ballots received before Election Day are processed in advance and released shortly after polls close. */
  mailPreprocess: boolean;
  /** Days after Election Day that ballots postmarked by Election Day may still arrive (0 = must arrive by close). */
  latePostmarkDays: number;
  /** Typical share of a state's mail ballots that arrive late but valid (where allowed). */
  lateShare: number;
  /** Share of mail ballots received on Election Day itself (dropped off or delivered that day), counted after the first release. */
  edMailShare: number;
  /** Post-night counting pace: 1 = typical; larger = slower (days to finish remaining ballots). */
  slow: number;
  /** Days after Election Day when provisional adjudication and the canvass are complete. */
  canvassDays: number;
  /** Days after Election Day when the state certifies its results. */
  certifyDays: number;
  /** Automatic-recount threshold as a fraction of the votes cast in the contest (0 = none). */
  recountAuto: number;
}

const D: CountingRules = { close: [20, 0], mailPreprocess: true, latePostmarkDays: 0, lateShare: 0, edMailShare: 0.08, slow: 1, canvassDays: 10, certifyDays: 21, recountAuto: 0 };
const r = (o: Partial<CountingRules>): CountingRules => ({ ...D, ...o });

export const COUNTING_RULES_2016: Record<string, CountingRules> = {
  AL: r({ close: [19, 0], mailPreprocess: false, certifyDays: 15, recountAuto: 0.005 }),
  AK: r({ close: [20, 0], latePostmarkDays: 10, lateShare: 0.12, slow: 2.5, canvassDays: 15, certifyDays: 22 }),
  AZ: r({ close: [19, 0], edMailShare: 0.2, slow: 2.2, canvassDays: 18, certifyDays: 27, recountAuto: 0.001 }),
  AR: r({ close: [19, 30], certifyDays: 15 }),
  CA: r({ close: [20, 0], latePostmarkDays: 3, lateShare: 0.1, edMailShare: 0.25, slow: 4, canvassDays: 30, certifyDays: 38 }),
  CO: r({ close: [19, 0], edMailShare: 0.18, slow: 1.6, canvassDays: 14, certifyDays: 29, recountAuto: 0.005 }),
  CT: r({ close: [20, 0], mailPreprocess: false, certifyDays: 21, recountAuto: 0.005 }),
  DE: r({ close: [20, 0], mailPreprocess: false, certifyDays: 3, recountAuto: 0.005 }),
  DC: r({ close: [20, 0], latePostmarkDays: 10, lateShare: 0.05, canvassDays: 14, certifyDays: 21 }),
  FL: r({ close: [19, 0], certifyDays: 21, recountAuto: 0.005 }),
  GA: r({ close: [19, 0], certifyDays: 14 }),
  HI: r({ close: [19, 0], certifyDays: 14 }),
  ID: r({ close: [20, 0], certifyDays: 21 }),
  IL: r({ close: [19, 0], latePostmarkDays: 14, lateShare: 0.05, canvassDays: 21, certifyDays: 27 }),
  IN: r({ close: [18, 0], mailPreprocess: false, certifyDays: 20 }),
  IA: r({ close: [21, 0], latePostmarkDays: 6, lateShare: 0.02, certifyDays: 22 }),
  KS: r({ close: [19, 0], latePostmarkDays: 3, lateShare: 0.03, certifyDays: 22 }),
  KY: r({ close: [18, 0], mailPreprocess: false, certifyDays: 15 }),
  LA: r({ close: [20, 0], certifyDays: 12 }),
  ME: r({ close: [20, 0], mailPreprocess: false, certifyDays: 20 }),
  MD: r({ close: [20, 0], mailPreprocess: false, latePostmarkDays: 10, lateShare: 0.05, slow: 2, canvassDays: 12, certifyDays: 22 }),
  MA: r({ close: [20, 0], mailPreprocess: false, certifyDays: 22 }),
  MI: r({ close: [20, 0], mailPreprocess: false, certifyDays: 20, recountAuto: 0.0004 }),
  MN: r({ close: [20, 0], certifyDays: 14, recountAuto: 0.0025 }),
  MS: r({ close: [19, 0], mailPreprocess: false, certifyDays: 22 }),
  MO: r({ close: [19, 0], mailPreprocess: false, certifyDays: 27 }),
  MT: r({ close: [20, 0], certifyDays: 27 }),
  NE: r({ close: [20, 0], certifyDays: 22, recountAuto: 0.01 }),
  NV: r({ close: [19, 0], edMailShare: 0.12, slow: 1.4, certifyDays: 17 }),
  NH: r({ close: [20, 0], mailPreprocess: false, certifyDays: 22 }),
  NJ: r({ close: [20, 0], latePostmarkDays: 2, lateShare: 0.03, canvassDays: 14, certifyDays: 21 }),
  NM: r({ close: [19, 0], certifyDays: 21, recountAuto: 0.0025 }),
  NY: r({ close: [21, 0], mailPreprocess: false, latePostmarkDays: 7, lateShare: 0.08, slow: 3, canvassDays: 21, certifyDays: 36 }),
  NC: r({ close: [19, 30], latePostmarkDays: 3, lateShare: 0.03, certifyDays: 21 }),
  ND: r({ close: [20, 0], latePostmarkDays: 13, lateShare: 0.03, certifyDays: 20 }),
  OH: r({ close: [19, 30], latePostmarkDays: 10, lateShare: 0.03, canvassDays: 18, certifyDays: 28, recountAuto: 0.0025 }),
  OK: r({ close: [19, 0], certifyDays: 7 }),
  OR: r({ close: [20, 0], edMailShare: 0.2, slow: 1.5, canvassDays: 20, certifyDays: 30, recountAuto: 0.002 }),
  PA: r({ close: [20, 0], mailPreprocess: false, canvassDays: 14, certifyDays: 34, recountAuto: 0.005 }),
  RI: r({ close: [20, 0], certifyDays: 14 }),
  SC: r({ close: [19, 0], mailPreprocess: false, certifyDays: 9, recountAuto: 0.01 }),
  SD: r({ close: [19, 0], certifyDays: 7 }),
  TN: r({ close: [19, 0], closeByZone: { 'America/New_York': [20, 0] }, certifyDays: 20 }),
  TX: r({ close: [19, 0], latePostmarkDays: 1, lateShare: 0.01, certifyDays: 22 }),
  UT: r({ close: [20, 0], latePostmarkDays: 14, lateShare: 0.1, edMailShare: 0.15, slow: 2.2, canvassDays: 14, certifyDays: 20 }),
  VT: r({ close: [19, 0], mailPreprocess: false, certifyDays: 7 }),
  VA: r({ close: [19, 0], mailPreprocess: false, certifyDays: 20 }),
  WA: r({ close: [20, 0], latePostmarkDays: 21, lateShare: 0.18, edMailShare: 0.22, slow: 3, canvassDays: 21, certifyDays: 30, recountAuto: 0.005 }),
  WV: r({ close: [19, 30], latePostmarkDays: 6, lateShare: 0.02, certifyDays: 20 }),
  WI: r({ close: [20, 0], mailPreprocess: false, certifyDays: 22 }),
  WY: r({ close: [19, 0], certifyDays: 15 }),
};

/** Mail-ballot and provisional rejection rates (2016-era magnitudes; approximate). */
export const MAIL_REJECT = 0.009;
export const PROVISIONAL_REJECT = 0.26;

/**
 * Counties split between time zones (2016 boundaries, 49 CFR Part 71): the secondary zone and an
 * approximate coordinate rule for which Base Units observe it (Arizona's Navajo Nation split matters only
 * during daylight saving time and is not needed for November elections).
 */
export const SPLIT_COUNTY_ZONES: Record<string, { zone: ZoneId; coord: 'lon' | 'lat'; below: boolean; at: number }> = {
  '02016': { zone: 'America/Adak', coord: 'lon', below: true, at: -169.5 },         // Aleutians West: Adak and the western islands
  '12045': { zone: 'America/Chicago', coord: 'lat', below: false, at: 30.0 },       // Gulf County FL: northern part on Central time
  '16049': { zone: 'America/Denver', coord: 'lat', below: true, at: 45.6 },         // Idaho County: south of the Salmon River on Mountain time
  '31031': { zone: 'America/Denver', coord: 'lon', below: true, at: -101.0 },       // Cherry County NE: western part Mountain
  '32007': { zone: 'America/Denver', coord: 'lon', below: false, at: -114.1 },      // Elko County NV: West Wendover on Mountain
  '38053': { zone: 'America/Denver', coord: 'lon', below: true, at: -103.3 },       // McKenzie County ND: western part Mountain
  '38085': { zone: 'America/Denver', coord: 'lon', below: true, at: -101.0 },       // Sioux County ND: western part Mountain
  '41045': { zone: 'America/Los_Angeles', coord: 'lat', below: true, at: 42.45 },   // Malheur County OR: southern strip Pacific
  '48109': { zone: 'America/Denver', coord: 'lon', below: true, at: -104.6 },       // Culberson County TX: western part Mountain
};
