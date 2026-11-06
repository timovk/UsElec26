/**
 * Career hazards (docs/architecture/04-statistical-methodology.md §4.11), per month. Pure functions of traits,
 * office and circumstances; the engine draws the events.
 *
 * Calibration targets (U.S. orders of magnitude): a few congressional scandals a year, of which a minority
 * end in resignation; about one member of Congress in a hundred leaves mid-term in a given year for other
 * reasons; cabinet secretaries serve about two and a half years on average; party switches in Congress are
 * rare (about one a decade).
 */
import type { OfficeKind, Person } from '../institutions/model';

/** How closely an office is watched (scandals surface more often for prominent offices). */
const SCRUTINY: Partial<Record<OfficeKind, number>> = {
  president: 2.2, vice_president: 1.4, cabinet: 1.5, us_senator: 1.0, us_representative: 0.75, governor: 1.2,
  lt_governor: 0.6, attorney_general: 0.7, secretary_of_state: 0.5, congress_leader: 1.2, state_leg_leader: 0.6,
  treasurer: 0.45, auditor: 0.4, superintendent: 0.45, insurance_commissioner: 0.45, agriculture_commissioner: 0.4, labor_commissioner: 0.35, land_commissioner: 0.4,
  other_statewide: 0.3, commissioner: 0.4, education_board: 0.25, regent: 0.25, justice: 0.3, appellate_judge: 0.2,
};

/** Monthly probability that an officeholder is hit by a scandal. */
export function scandalHazard(p: Person, office: OfficeKind): number {
  const s = SCRUTINY[office] ?? 0.5;
  return 0.00045 * s * (0.3 + 2.2 * (1 - p.traits.integrity) ** 2);
}

/** Severity of a scandal (0–1): most are embarrassments, some are career-ending. */
export function scandalSeverity(u: number, integrity: number): number { return Math.min(1, u ** 1.6 * (0.6 + 0.8 * (1 - integrity))); }

/** Monthly probability of resigning over a scandal of a given severity, `months` after it broke. */
export function scandalResignHazard(severity: number, months: number, office: OfficeKind): number {
  if (severity < 0.35) return 0;
  const decay = Math.exp(-months / 4);
  const base = office === 'president' ? 0.04 : office === 'cabinet' ? 0.3 : 0.12;
  return Math.min(0.6, base * ((severity - 0.35) / 0.65) * decay * 2.5);
}

/** Monthly probability of leaving office mid-term for other reasons (health, family, a private-sector offer). */
export function otherExitHazard(age: number, office: OfficeKind): number {
  if (office === 'president' || office === 'vice_president') return 0;
  const base = office === 'cabinet' ? 1 / 32 : office === 'justice' || office === 'appellate_judge' ? 0.0011 : 0.00045;
  return office === 'cabinet' ? base : base * (1 + Math.max(0, age - 70) * 0.12);
}

/** Monthly probability of switching parties: only for officeholders much closer to the other party's platform. */
export function switchHazard(ideology: readonly number[], own: readonly number[], other: readonly number[]): number {
  const d = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((x, i) => x - b[i]!));
  const mismatch = d(ideology, own) - d(ideology, other);
  return mismatch > 0.35 ? 0.00018 * Math.min(4, mismatch / 0.35) : 0;
}

/** Added yearly probability of retiring at filing time: long tenure, a recent scandal, a hostile new district. */
export function retirementExtra(tenureYears: number, scandal: number, districtShift: number): number {
  return Math.min(0.5, 0.008 * Math.max(0, tenureYears - 12) + 0.35 * scandal + Math.max(0, districtShift) * 0.012);
}
