import { describe, expect, it } from 'vitest';
import { civilToDays, daysToCivil, formatTime, generalElectionDay, isoDay, offsetAt, utcMinutes, utcToZoned, weekday, zonedToUtc, ageOn, SIM_START } from '../../../src/core/time';

describe('calendar', () => {
  it('round-trips dates', () => {
    for (let d = civilToDays(1900, 1, 1); d < civilToDays(2200, 1, 1); d += 37) {
      const c = daysToCivil(d); expect(civilToDays(c.y, c.m, c.d)).toBe(d);
    }
    expect(civilToDays(1970, 1, 1)).toBe(0); expect(weekday(0)).toBe(4);
  });
  it('general election days', () => {
    expect(isoDay(generalElectionDay(2016))).toBe('2016-11-08');
    expect(isoDay(generalElectionDay(2020))).toBe('2020-11-03');
    expect(isoDay(generalElectionDay(2018))).toBe('2018-11-06');
    expect(isoDay(generalElectionDay(2022))).toBe('2022-11-08');
    expect(isoDay(generalElectionDay(2116))).toBe('2116-11-03');
    for (let y = 2016; y < 2200; y++) { const d = generalElectionDay(y); expect(weekday(d)).toBe(2); const c = daysToCivil(d); expect(c.d >= 2 && c.d <= 8).toBe(true); }
  });
  it('ages', () => { expect(ageOn(civilToDays(1950, 6, 15), civilToDays(2016, 6, 14))).toBe(65); expect(ageOn(civilToDays(1950, 6, 15), civilToDays(2016, 6, 15))).toBe(66); });
});

describe('US time zones', () => {
  it('simulation starts at midnight Eastern on Jan 1, 2016', () => { expect(SIM_START).toBe(utcMinutes(2016, 1, 1, 5, 0)); });
  it('DST transitions in 2016 (Mar 13, Nov 6)', () => {
    expect(offsetAt(utcMinutes(2016, 3, 13, 6, 59), 'America/New_York').offset).toBe(-300);
    expect(offsetAt(utcMinutes(2016, 3, 13, 7, 0), 'America/New_York').offset).toBe(-240);
    expect(offsetAt(utcMinutes(2016, 11, 6, 5, 59), 'America/New_York').offset).toBe(-240);
    expect(offsetAt(utcMinutes(2016, 11, 6, 6, 0), 'America/New_York').offset).toBe(-300);
    expect(offsetAt(utcMinutes(2016, 7, 1), 'America/Phoenix').offset).toBe(-420);
    expect(offsetAt(utcMinutes(2016, 7, 1), 'Pacific/Honolulu').offset).toBe(-600);
    expect(offsetAt(utcMinutes(2016, 7, 1), 'America/Adak').offset).toBe(-540);
  });
  it('poll closings on Nov 8, 2016 convert correctly to Eastern', () => {
    const hi = zonedToUtc(2016, 11, 8, 19, 0, 'Pacific/Honolulu');
    expect(formatTime(hi, 'America/New_York')).toBe('12:00 AM EST');
    const ak = zonedToUtc(2016, 11, 8, 20, 0, 'America/Adak');
    expect(formatTime(ak, 'America/New_York')).toBe('1:00 AM EST');
    const ky = zonedToUtc(2016, 11, 8, 18, 0, 'America/Chicago');
    expect(formatTime(ky, 'America/New_York')).toBe('7:00 PM EST');
    expect(utcToZoned(ky, 'America/Chicago').h).toBe(18);
  });
});
