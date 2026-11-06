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

/**
 * Rake `cells` (64, in place) to the given marginals. Cohort k = race + 4·(edu + 2·(sex + 2·age)), so an age
 * band is 16 consecutive cells, sex is bit 3, education bit 2 and race the low two bits. The arithmetic is the
 * same, in the same order, as the plain loops it replaces (results are bit-identical); it is the kernel's
 * hottest function, run for every base unit of every election.
 */
const RAKE_TMP = new Float64Array(4);
export function rake(cells: Float64Array, m: Marginals, iterations = 6): void {
  const tmp = RAKE_TMP;
  for (let it = 0; it < iterations; it++) {
    // age
    let tot = 0;
    tmp[0] = 0; tmp[1] = 0; tmp[2] = 0; tmp[3] = 0;
    for (let k = 0; k < 64; k++) { const c = cells[k]!; tmp[k >> 4]! += c; tot += c; }
    for (let a = 0; a < 4; a++) { const t = tmp[a]!, f = m.age[a]!; for (let k = a << 4, e = k + 16; k < e; k++) cells[k] = t > 0 ? cells[k]! * f * tot / t : 0; }
    // sex
    let male = 0; tot = 0;
    for (let k = 0; k < 64; k++) { const c = cells[k]!; tot += c; if (((k >> 3) & 1) === 0) male += c; }
    const fm = male > 0 ? m.male * tot / male : 0, ff = tot - male > 0 ? (1 - m.male) * tot / (tot - male) : 0;
    for (let k = 0; k < 64; k++) cells[k]! *= ((k >> 3) & 1) === 0 ? fm : ff;
    // race
    tmp[0] = 0; tmp[1] = 0; tmp[2] = 0; tmp[3] = 0; tot = 0;
    for (let k = 0; k < 64; k++) { const c = cells[k]!; tmp[k & 3]! += c; tot += c; }
    for (let k = 0; k < 64; k++) { const t = tmp[k & 3]!; cells[k] = t > 0 ? cells[k]! * m.race[k & 3]! * tot / t : 0; }
    // education within age band
    for (let a = 0; a < 4; a++) {
      let col = 0, all = 0;
      const k0 = a << 4, k1 = k0 + 16;
      for (let k = k0; k < k1; k++) { const c = cells[k]!; all += c; if ((k >> 2) & 1) col += c; }
      if (all <= 0) continue;
      const target = m.collegeByAge[a]!;
      const fc = col > 0 ? target * all / col : 0, fn = all - col > 0 ? (1 - target) * all / (all - col) : 0;
      for (let k = k0; k < k1; k++) cells[k]! *= (k >> 2) & 1 ? fc : fn;
    }
  }
  let tot = 0; for (let k = 0; k < N_COHORTS; k++) tot += cells[k]!;
  if (tot > 0) for (let k = 0; k < N_COHORTS; k++) cells[k]! /= tot;
}
