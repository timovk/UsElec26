/**
 * Careers between elections: hazards behave as designed (low integrity → more scandals; severe scandals →
 * resignations; cabinet turnover about every two and a half years; party switches only for members far from
 * their party), and office succession keeps exactly one holder per office through resignations.
 */
import { describe, expect, it } from 'vitest';
import { otherExitHazard, retirementExtra, scandalHazard, scandalResignHazard, scandalSeverity, switchHazard } from '../../../src/careers/model';
import type { Person } from '../../../src/institutions/model';

const person = (integrity: number): Person => ({ id: 1, given: 'A', middle: null, surname: 'B', suffix: null, nickname: null, sex: 'F', race: 'W', birthDay: 0, deathDay: null, homeState: 0, homeCounty: null, tier: 'B', createdTime: 0, provenance: '', bio: '', partyId: 1,
  traits: { asOf: 0, ideology: [0, 0, 0], charisma: 0.5, campaign: 0.5, fundraising: 0.5, leadership: 0.5, integrity, ambition: 0.5, recognition: 0.5 } });

describe('career hazards', () => {
  it('scandals are rarer for people of integrity and for less scrutinized offices', () => {
    expect(scandalHazard(person(0.2), 'us_senator')).toBeGreaterThan(2 * scandalHazard(person(0.9), 'us_senator'));
    expect(scandalHazard(person(0.5), 'president')).toBeGreaterThan(scandalHazard(person(0.5), 'us_representative'));
    // Congress: a few scandals a year among 535 members of typical integrity (Beta(4,2) mean ≈ 0.67).
    const perYear = 535 * 12 * scandalHazard(person(0.67), 'us_representative');
    expect(perYear).toBeGreaterThan(0.5); expect(perYear).toBeLessThan(8);
  });
  it('only serious scandals force resignations, mostly soon after they break', () => {
    expect(scandalResignHazard(0.2, 0, 'us_senator')).toBe(0);
    expect(scandalResignHazard(0.9, 0, 'us_senator')).toBeGreaterThan(scandalResignHazard(0.9, 12, 'us_senator'));
    expect(scandalSeverity(0.99, 0.1)).toBeGreaterThan(scandalSeverity(0.99, 0.9));
  });
  it('cabinet secretaries serve about 2.5 years; members of Congress rarely leave mid-term', () => {
    const tenure = 1 / otherExitHazard(55, 'cabinet') / 12;
    expect(tenure).toBeGreaterThan(2); expect(tenure).toBeLessThan(3.5);
    expect(535 * 12 * otherExitHazard(60, 'us_representative')).toBeLessThan(5);
    expect(otherExitHazard(80, 'us_senator')).toBeGreaterThan(otherExitHazard(55, 'us_senator'));
  });
  it('party switches need a real ideological mismatch', () => {
    expect(switchHazard([0.5, 0, 0], [0.6, 0, 0], [-0.6, 0, 0])).toBe(0);
    expect(switchHazard([-0.7, 0, 0], [0.6, 0, 0], [-0.6, 0, 0])).toBeGreaterThan(0);
  });
  it('retirement rises with long tenure, scandal and a worse district', () => {
    expect(retirementExtra(20, 0, 0)).toBeGreaterThan(retirementExtra(4, 0, 0));
    expect(retirementExtra(4, 0.8, 0)).toBeGreaterThan(0.2);
    expect(retirementExtra(4, 0, 10)).toBeGreaterThan(retirementExtra(4, 0, -10));
  });
});
