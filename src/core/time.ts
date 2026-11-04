/**
 * Simulated time. Canonical instants are integer minutes since 1970-01-01T00:00Z ("SimTime").
 * Calendar dates are integer days since 1970-01-01 ("DayNumber").
 * Local times use an explicit US time-zone engine with the post-2007 federal DST rule
 * (second Sunday of March → first Sunday of November, 2:00 local), so no host time-zone data is used.
 */

export type SimTime = number;
export type DayNumber = number;

export const MINUTES_PER_DAY = 1440;

/** Days since 1970-01-01 for a proleptic Gregorian date (Hinnant's algorithm). */
export function civilToDays(y: number, m: number, d: number): DayNumber {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export interface CivilDate { y: number; m: number; d: number }

export function daysToCivil(z: DayNumber): CivilDate {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(days: DayNumber): number { return ((days % 7) + 7 + 4) % 7; }

export function utcMinutes(y: number, m: number, d: number, h = 0, min = 0): SimTime {
  return civilToDays(y, m, d) * MINUTES_PER_DAY + h * 60 + min;
}

/** The n-th (1-based) given weekday of a month, as a day number. */
export function nthWeekday(y: number, m: number, wd: number, n: number): DayNumber {
  const first = civilToDays(y, m, 1);
  const offset = (wd - weekday(first) + 7) % 7;
  return first + offset + (n - 1) * 7;
}

/** Federal general election day: the Tuesday after the first Monday in November (2 U.S.C. §7). */
export function generalElectionDay(year: number): DayNumber { return nthWeekday(year, 11, 1, 1) + 1; }

// ---- US time zones -------------------------------------------------------------------------------

export type ZoneId =
  | 'America/New_York' | 'America/Chicago' | 'America/Denver' | 'America/Phoenix'
  | 'America/Los_Angeles' | 'America/Anchorage' | 'America/Adak' | 'Pacific/Honolulu';

interface ZoneRule { std: number; dst: boolean; abbr: [string, string] }

const RULES: Record<ZoneId, ZoneRule> = {
  'America/New_York': { std: -300, dst: true, abbr: ['EST', 'EDT'] },
  'America/Chicago': { std: -360, dst: true, abbr: ['CST', 'CDT'] },
  'America/Denver': { std: -420, dst: true, abbr: ['MST', 'MDT'] },
  'America/Phoenix': { std: -420, dst: false, abbr: ['MST', 'MST'] },
  'America/Los_Angeles': { std: -480, dst: true, abbr: ['PST', 'PDT'] },
  'America/Anchorage': { std: -540, dst: true, abbr: ['AKST', 'AKDT'] },
  'America/Adak': { std: -600, dst: true, abbr: ['HST', 'HDT'] },
  'Pacific/Honolulu': { std: -600, dst: false, abbr: ['HST', 'HST'] },
};

/** IANA US zone names → the rule set they follow from 2016 onward. */
const ALIASES: Record<string, ZoneId> = {
  'America/New_York': 'America/New_York', 'America/Detroit': 'America/New_York',
  'America/Kentucky/Louisville': 'America/New_York', 'America/Kentucky/Monticello': 'America/New_York',
  'America/Indiana/Indianapolis': 'America/New_York', 'America/Indiana/Vincennes': 'America/New_York',
  'America/Indiana/Winamac': 'America/New_York', 'America/Indiana/Marengo': 'America/New_York',
  'America/Indiana/Petersburg': 'America/New_York', 'America/Indiana/Vevay': 'America/New_York',
  'America/Chicago': 'America/Chicago', 'America/Indiana/Tell_City': 'America/Chicago',
  'America/Indiana/Knox': 'America/Chicago', 'America/Menominee': 'America/Chicago',
  'America/North_Dakota/Center': 'America/Chicago', 'America/North_Dakota/New_Salem': 'America/Chicago',
  'America/North_Dakota/Beulah': 'America/Chicago',
  'America/Denver': 'America/Denver', 'America/Boise': 'America/Denver', 'America/Phoenix': 'America/Phoenix',
  'America/Los_Angeles': 'America/Los_Angeles',
  'America/Anchorage': 'America/Anchorage', 'America/Juneau': 'America/Anchorage', 'America/Sitka': 'America/Anchorage',
  'America/Metlakatla': 'America/Anchorage', 'America/Yakutat': 'America/Anchorage', 'America/Nome': 'America/Anchorage',
  'America/Adak': 'America/Adak', 'Pacific/Honolulu': 'Pacific/Honolulu',
};

export function resolveZone(name: string): ZoneId {
  const z = ALIASES[name];
  if (!z) throw new Error(`Unsupported time zone: ${name}`);
  return z;
}

function dstBounds(year: number, rule: ZoneRule): [SimTime, SimTime] {
  const start = nthWeekday(year, 3, 0, 2) * MINUTES_PER_DAY + 120 - rule.std;         // 2:00 standard
  const end = nthWeekday(year, 11, 0, 1) * MINUTES_PER_DAY + 120 - (rule.std + 60);  // 2:00 daylight
  return [start, end];
}

export function offsetAt(t: SimTime, zone: ZoneId): { offset: number; dst: boolean; abbr: string } {
  const rule = RULES[zone];
  if (!rule.dst) return { offset: rule.std, dst: false, abbr: rule.abbr[0] };
  const y = daysToCivil(Math.floor((t + rule.std) / MINUTES_PER_DAY)).y;
  const [s, e] = dstBounds(y, rule);
  const dst = t >= s && t < e;
  return { offset: rule.std + (dst ? 60 : 0), dst, abbr: rule.abbr[dst ? 1 : 0] };
}

export interface ZonedParts extends CivilDate { h: number; min: number; weekday: number; offset: number; abbr: string }

export function utcToZoned(t: SimTime, zone: ZoneId): ZonedParts {
  const { offset, abbr } = offsetAt(t, zone);
  const local = t + offset;
  const days = Math.floor(local / MINUTES_PER_DAY);
  const mins = local - days * MINUTES_PER_DAY;
  return { ...daysToCivil(days), h: Math.floor(mins / 60), min: mins % 60, weekday: weekday(days), offset, abbr };
}

/** Local wall time → instant. Nonexistent spring-forward times resolve forward; ambiguous fall-back times resolve to the first (daylight) instance. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, zone: ZoneId): SimTime {
  const rule = RULES[zone];
  const asStd = utcMinutes(y, m, d, h, min) - rule.std;
  if (!rule.dst) return asStd;
  const asDst = asStd - 60;
  if (offsetAt(asDst, zone).dst) return asDst;
  return asStd;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDate(t: SimTime, zone: ZoneId = 'America/New_York', long = false): string {
  const p = utcToZoned(t, zone);
  return long ? `${WEEKDAYS[p.weekday]}, ${MONTHS_LONG[p.m - 1]} ${p.d}, ${p.y}` : `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

export function formatDay(day: DayNumber, long = false): string {
  const c = daysToCivil(day);
  return long ? `${MONTHS_LONG[c.m - 1]} ${c.d}, ${c.y}` : `${MONTHS[c.m - 1]} ${c.d}, ${c.y}`;
}

export function formatTime(t: SimTime, zone: ZoneId = 'America/New_York'): string {
  const p = utcToZoned(t, zone);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${String(p.min).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'} ${p.abbr}`;
}

export function isoDay(day: DayNumber): string {
  const c = daysToCivil(day);
  return `${String(c.y).padStart(4, '0')}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

/** Completed years of age on `day` for someone born on `birth`. */
export function ageOn(birth: DayNumber, day: DayNumber): number {
  const b = daysToCivil(birth), c = daysToCivil(day);
  return c.y - b.y - (c.m < b.m || (c.m === b.m && c.d < b.d) ? 1 : 0);
}

/** Simulation start: January 1, 2016, 00:00 Eastern. */
export const SIM_START: SimTime = zonedToUtc(2016, 1, 1, 0, 0, 'America/New_York');

/** Day number of the Eastern-time calendar date containing instant t. */
export function easternDay(t: SimTime): DayNumber {
  return Math.floor((t + offsetAt(t, 'America/New_York').offset) / MINUTES_PER_DAY);
}
