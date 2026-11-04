/**
 * Demographic cohorts: age(4) × sex(2) × education(2) × race/ethnicity(4) = 64 cells.
 * k = race + 4·(edu + 2·(sex + 2·age))
 */
export const AGE_BANDS = ['18–29', '30–44', '45–64', '65+'] as const;
export const SEXES = ['Male', 'Female'] as const;
export const EDUS = ['Non-college', 'College'] as const;
export const RACES = ['White', 'Black', 'Hispanic', 'Asian/Other'] as const;
export const N_COHORTS = 64;

export const cohortIndex = (age: number, sex: number, edu: number, race: number): number => race + 4 * (edu + 2 * (sex + 2 * age));
export const cohortAge = (k: number): number => (k >> 4) & 3;
export const cohortSex = (k: number): number => (k >> 3) & 1;
export const cohortEdu = (k: number): number => (k >> 2) & 1;
export const cohortRace = (k: number): number => k & 3;

export function cohortLabel(k: number): string {
  return `${RACES[cohortRace(k)]!} ${SEXES[cohortSex(k)]!.toLowerCase()} ${AGE_BANDS[cohortAge(k)]!}, ${EDUS[cohortEdu(k)]!.toLowerCase()}`;
}

/**
 * Stylized national interaction seed (log scale) for iterative proportional fitting. It encodes broad
 * American demographic structure (younger Hispanic and Asian populations, older White population,
 * educational attainment differences, more women at older ages). It is not partisan.
 */
export function interactionSeed(): Float64Array {
  const ageRace = [
    [-0.15, 0.15, 0.40, 0.20],
    [-0.05, 0.05, 0.25, 0.20],
    [0.05, 0.00, -0.15, -0.05],
    [0.25, -0.20, -0.60, -0.40],
  ];
  const eduRace = [0.10, -0.35, -0.60, 0.60];
  const ageSexF = [-0.02, 0.0, 0.03, 0.15];
  const s = new Float64Array(N_COHORTS);
  for (let k = 0; k < N_COHORTS; k++) {
    const a = cohortAge(k), x = cohortSex(k), e = cohortEdu(k), r = cohortRace(k);
    s[k] = Math.exp(ageRace[a]![r]! + (e ? eduRace[r]! : 0) + (x ? ageSexF[a]! : 0));
  }
  return s;
}

/** Relative probability of a bachelor's degree by age band, given the 25+ rate (18–29 includes students). */
export const COLLEGE_AGE_FACTOR = [0.78, 1.18, 1.0, 0.82] as const;

export interface Marginals {
  age: Float64Array;      // 4 shares
  male: number;           // share male
  race: Float64Array;     // 4 shares
  collegeByAge: Float64Array; // 4 probabilities
}

/** Rake `cells` (64, in place) to the given marginals. */
export function rake(cells: Float64Array, m: Marginals, iterations = 6): void {
  const tmp = new Float64Array(4);
  for (let it = 0; it < iterations; it++) {
    // age
    let tot = 0;
    tmp.fill(0); for (let k = 0; k < N_COHORTS; k++) { tmp[cohortAge(k)]! += cells[k]!; tot += cells[k]!; }
    for (let k = 0; k < N_COHORTS; k++) { const t = tmp[cohortAge(k)]!; cells[k] = t > 0 ? cells[k]! * m.age[cohortAge(k)]! * tot / t : 0; }
    // sex
    let male = 0; tot = 0;
    for (let k = 0; k < N_COHORTS; k++) { tot += cells[k]!; if (cohortSex(k) === 0) male += cells[k]!; }
    const fm = male > 0 ? m.male * tot / male : 0, ff = tot - male > 0 ? (1 - m.male) * tot / (tot - male) : 0;
    for (let k = 0; k < N_COHORTS; k++) cells[k]! *= cohortSex(k) === 0 ? fm : ff;
    // race
    tmp.fill(0); tot = 0; for (let k = 0; k < N_COHORTS; k++) { tmp[cohortRace(k)]! += cells[k]!; tot += cells[k]!; }
    for (let k = 0; k < N_COHORTS; k++) { const t = tmp[cohortRace(k)]!; cells[k] = t > 0 ? cells[k]! * m.race[cohortRace(k)]! * tot / t : 0; }
    // education within age band
    for (let a = 0; a < 4; a++) {
      let col = 0, all = 0;
      for (let k = 0; k < N_COHORTS; k++) if (cohortAge(k) === a) { all += cells[k]!; if (cohortEdu(k)) col += cells[k]!; }
      if (all <= 0) continue;
      const target = m.collegeByAge[a]!;
      const fc = col > 0 ? target * all / col : 0, fn = all - col > 0 ? (1 - target) * all / (all - col) : 0;
      for (let k = 0; k < N_COHORTS; k++) if (cohortAge(k) === a) cells[k]! *= cohortEdu(k) ? fc : fn;
    }
  }
  let tot = 0; for (let k = 0; k < N_COHORTS; k++) tot += cells[k]!;
  if (tot > 0) for (let k = 0; k < N_COHORTS; k++) cells[k]! /= tot;
}
