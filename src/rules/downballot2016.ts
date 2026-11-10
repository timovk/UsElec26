/**
 * Down-ballot offices, elected boards and state courts as of January 1, 2016 (Phase 7.2): which statewide
 * executive offices each state elects beyond governor, lieutenant governor, attorney general and secretary of
 * state; its elected commissions, boards of education and university boards; its supreme court (or courts) and
 * the intermediate appellate courts elected statewide. How each is chosen: partisan, nonpartisan or retention
 * elections, appointment by the governor or election by the legislature; terms, mandatory retirement ages and
 * election calendars. Courts of appeals elected by region (Texas, Ohio, Washington…) and appointed-only
 * intermediate courts are not included (docs/architecture/10-roadmap.md, future ideas).
 *
 * Compiled from state constitutions and statutes as summarized by the National Center for State Courts, NCSL,
 * Ballotpedia and the state election offices (developer knowledge). Seat counts, terms and selection methods are
 * legal facts of 2016; the staggering of individual seats (which seat is up in which year) is an estimate unless
 * given, as are the mandatory retirement ages listed in `APPROXIMATE_RETIREMENT`. Later phases change these only
 * through simulated law. Board districts are drawn by the simulation (the real lines are not in the geography
 * pack).
 */
/** Kinds of the offices this module adds (also members of the institutions' OfficeKind). */
export type DownballotKind = 'treasurer' | 'auditor' | 'superintendent' | 'insurance_commissioner' | 'agriculture_commissioner' | 'labor_commissioner'
  | 'land_commissioner' | 'other_statewide' | 'commissioner' | 'education_board' | 'regent' | 'justice' | 'appellate_judge';
type OfficeKind = DownballotKind;

/** How a body's members reach office. */
export type Selection =
  | 'partisan'            // party primaries (or the state's top-two or jungle ballot), party labels on the ballot
  | 'party_np'            // party nominees on a ballot without party labels (Michigan's and Ohio's Supreme Courts)
  | 'nonpartisan'         // a nonpartisan ballot from filing to election
  | 'retention'           // appointed, then yes/no retention elections
  | 'partisan_retention'  // partisan election to a first term, retention elections after (IL, NM, PA)
  | 'appointed'           // appointed (and reappointed) without elections
  | 'legislature';        // elected by the legislature (SC, VA)

/**
 * How a nonpartisan race is narrowed and decided:
 *  - `two`: a nonpartisan primary narrows the field to two for the general election (only with three or more);
 *  - `majority`: on primary day a majority wins outright, otherwise the top two meet in November;
 *  - `final`: decided on primary day by plurality (West Virginia's courts);
 *  - `none`: every candidate on the general ballot, plurality;
 *  - `runoff`: every candidate on the general ballot; without a majority, a runoff (Mississippi's courts).
 */
export type NpFlow = 'two' | 'majority' | 'final' | 'none' | 'runoff';

/** Which years a body's regular elections (or, for appointed courts, its terms' ends) fall in. */
export type YearRule = 'gov' | 'even' | 'odd' | 'any';

export interface BodyDef {
  key: string;
  kind: OfficeKind;
  /** The office or body ("Treasurer", "Supreme Court", "Public Service Commission"); `full` names it outright. */
  name: string;
  full?: string;
  /** Title of one member of a multi-member body ("Justice", "Commissioner", "Member", "Regent"). */
  member?: string;
  seats: number;
  /** Years per term; 0 for tenure until the retirement age (or for life). */
  termYears: number;
  years: YearRule;
  /** An election year of a single office's cycle when it is not the governor's (Pennsylvania's treasurer: 2016). */
  cycle?: number;
  /** Election years of each seat (otherwise seats are staggered evenly over the term). */
  seatCycles?: number[];
  selection: Selection;
  np?: NpFlow;
  /** Nonpartisan races held on the state's primary day (Georgia, Arkansas, Idaho, Oregon, West Virginia). */
  onPrimary?: boolean;
  /** Elected at Wisconsin's spring election (April, with a February primary). */
  spring?: boolean;
  /** Party nominees chosen by convention, not primary (Michigan's boards and Supreme Court). */
  noPrimary?: boolean;
  /** Seats up together are one "vote for N" race statewide (Michigan's boards, Arizona's Corporation Commission; Phase 7.4). */
  voteForN?: boolean;
  /** Members elected by district (drawn by the simulation from state house districts): number of districts. */
  districts?: number;
  /** Seats per district (default one each). */
  perDistrict?: number[];
  /** Seats elected statewide besides the district seats (Colorado's at-large regents, Nebraska's chief justice). */
  atLarge?: number;
  /** Share of yes votes needed to retain (default one half). */
  retention?: number;
  /** Mandatory retirement age. */
  retireAt?: number;
  /** Term start (month, day) when not the state's inauguration day. */
  start?: [number, number];
  /** Who fills vacancies (and appoints, on appointed courts). */
  appointer?: 'governor' | 'commission' | 'legislature' | 'governor_council';
}

// ---- Constructors -------------------------------------------------------------------------------------

type Opts = Partial<BodyDef>;
const exec = (kind: OfficeKind, name: string, o: Opts = {}): BodyDef => ({ key: o.key ?? kind, kind, name, seats: 1, termYears: 4, years: o.cycle !== undefined ? 'even' : 'gov', selection: 'partisan', ...o });
const treasurer = (o: Opts = {}) => exec('treasurer', 'Treasurer', o);
const auditor = (name = 'Auditor', o: Opts = {}) => exec('auditor', name, o);
const supt = (o: Opts = {}) => exec('superintendent', 'Superintendent of Public Instruction', o);
const insurance = (o: Opts = {}) => exec('insurance_commissioner', 'Insurance Commissioner', o);
const agriculture = (name = 'Commissioner of Agriculture', o: Opts = {}) => exec('agriculture_commissioner', name, o);
const labor = (name = 'Labor Commissioner', o: Opts = {}) => exec('labor_commissioner', name, o);
const land = (name = 'Land Commissioner', o: Opts = {}) => exec('land_commissioner', name, o);
const board = (kind: OfficeKind, key: string, name: string, member: string, seats: number, termYears: number, o: Opts = {}): BodyDef =>
  ({ key, kind, name, member, seats, termYears, years: 'even', selection: 'partisan', ...o });
const commission = (name: string, seats: number, termYears: number, o: Opts = {}) => board('commissioner', o.key ?? 'psc', name, 'Commissioner', seats, termYears, o);
const sboe = (seats: number, termYears: number, o: Opts = {}) => board('education_board', o.key ?? 'sboe', 'State Board of Education', 'Member', seats, termYears, o);
const regents = (key: string, full: string, member: string, seats: number, termYears: number, o: Opts = {}) => board('regent', key, full, member, seats, termYears, { full, ...o });
const court = (kind: OfficeKind, key: string, name: string, seats: number, termYears: number, selection: Selection, o: Opts = {}): BodyDef =>
  ({ key, kind, name, member: kind === 'justice' ? 'Justice' : 'Judge', seats, termYears, years: 'even', selection,
    appointer: selection === 'retention' ? 'commission' : selection === 'legislature' ? 'legislature' : 'governor', ...o });
const supreme = (seats: number, termYears: number, selection: Selection, o: Opts = {}) => court('justice', 'supreme', 'Supreme Court', seats, termYears, selection, o);
const appeals = (seats: number, termYears: number, selection: Selection, o: Opts = {}) => court('appellate_judge', o.key ?? 'appeals', o.name ?? 'Court of Appeals', seats, termYears, selection, o);

/** Every state's 2016 down-ballot offices, boards and courts (DC: none in scope). */
export const DOWNBALLOT_2016: Record<string, BodyDef[]> = {
  AL: [treasurer(), auditor(), agriculture('Commissioner of Agriculture and Industries'),
    commission('Public Service Commission', 3, 4, { seatCycles: [2016, 2018, 2018] }),
    sboe(8, 4, { districts: 8, seatCycles: [2016, 2018, 2016, 2018, 2016, 2018, 2016, 2018] }),
    supreme(9, 6, 'partisan', { retireAt: 70 }),
    appeals(5, 6, 'partisan', { key: 'civil', name: 'Court of Civil Appeals', retireAt: 70 }),
    appeals(5, 6, 'partisan', { key: 'criminal', name: 'Court of Criminal Appeals', retireAt: 70 })],
  AK: [supreme(5, 10, 'retention', { retireAt: 70 }), appeals(3, 8, 'retention', { retireAt: 70 })],
  AZ: [treasurer(), supt(), exec('other_statewide', 'Mine Inspector', { key: 'mine' }),
    commission('Corporation Commission', 5, 4, { voteForN: true, seatCycles: [2016, 2016, 2016, 2018, 2018] }),
    supreme(5, 6, 'retention', { retireAt: 70 })],
  AR: [treasurer(), auditor(), land(),
    supreme(7, 8, 'nonpartisan', { np: 'majority', onPrimary: true, retireAt: 70 })],
  CA: [treasurer(), auditor('Controller'), insurance(), supt({ selection: 'nonpartisan', np: 'majority' }),
    commission('Board of Equalization', 4, 4, { key: 'boe', member: 'Member', districts: 4, years: 'gov' }),
    supreme(7, 12, 'retention', { years: 'gov', appointer: 'governor' })],
  CO: [treasurer(),
    sboe(7, 6, { districts: 7 }),
    regents('cu', 'University of Colorado Board of Regents', 'Regent', 9, 6, { districts: 7, atLarge: 2 }),
    supreme(7, 10, 'retention', { retireAt: 72 }), appeals(22, 8, 'retention', { retireAt: 72 })],
  CT: [treasurer(), auditor('Comptroller'),
    supreme(7, 8, 'appointed', { years: 'any', retireAt: 70, appointer: 'governor' })],
  DE: [treasurer({ cycle: 2018 }), auditor('Auditor of Accounts', { cycle: 2018 }), insurance({ cycle: 2018 }),
    supreme(5, 12, 'appointed', { years: 'any', appointer: 'governor' })],
  FL: [treasurer({ name: 'Chief Financial Officer' }), agriculture('Commissioner of Agriculture'),
    supreme(7, 6, 'retention', { retireAt: 70, appointer: 'commission' })],
  GA: [supt({ name: 'State School Superintendent' }), insurance(), agriculture(), labor(),
    commission('Public Service Commission', 5, 6, { seatCycles: [2016, 2018, 2018, 2020, 2016] }),
    supreme(7, 6, 'nonpartisan', { np: 'majority', onPrimary: true }),
    appeals(15, 6, 'nonpartisan', { np: 'majority', onPrimary: true })],
  HI: [supreme(5, 10, 'appointed', { years: 'any', retireAt: 70, appointer: 'commission' })],
  ID: [treasurer(), auditor('Controller'), supt(),
    supreme(5, 6, 'nonpartisan', { np: 'majority', onPrimary: true }),
    appeals(4, 6, 'nonpartisan', { np: 'majority', onPrimary: true })],
  IL: [treasurer(), auditor('Comptroller'),
    supreme(7, 10, 'partisan_retention', { retention: 0.6, districts: 5, perDistrict: [3, 1, 1, 1, 1], appointer: 'commission' })],
  IN: [treasurer({ cycle: 2018 }), auditor('Auditor of State', { cycle: 2018 }), supt(),
    supreme(5, 10, 'retention', { retireAt: 75 })],
  IA: [treasurer(), auditor(), agriculture('Secretary of Agriculture'),
    supreme(7, 8, 'retention', { retireAt: 72 }), appeals(9, 6, 'retention', { retireAt: 72 })],
  KS: [treasurer(), insurance(),
    sboe(10, 4, { districts: 10, seatCycles: [2016, 2018, 2016, 2018, 2016, 2018, 2016, 2018, 2016, 2018] }),
    supreme(7, 6, 'retention', { retireAt: 75 }), appeals(14, 4, 'retention', { retireAt: 75, appointer: 'governor' })],
  KY: [treasurer(), auditor('Auditor of Public Accounts'), agriculture(),
    supreme(7, 8, 'nonpartisan', { np: 'two', districts: 7 })],
  LA: [treasurer(), agriculture('Commissioner of Agriculture and Forestry'), insurance(),
    commission('Public Service Commission', 5, 6, { districts: 5 }),
    board('education_board', 'bese', 'Board of Elementary and Secondary Education', 'Member', 8, 4, { districts: 8, years: 'gov' }),
    supreme(7, 10, 'partisan', { districts: 7, retireAt: 70 })],
  ME: [supreme(7, 7, 'appointed', { full: 'Maine Supreme Judicial Court', years: 'any', appointer: 'governor' })],
  MD: [auditor('Comptroller'),
    supreme(7, 10, 'retention', { full: 'Maryland Court of Appeals', districts: 7, retireAt: 70, appointer: 'governor' })],
  MA: [treasurer({ name: 'Treasurer and Receiver-General' }), auditor(),
    supreme(7, 0, 'appointed', { full: 'Massachusetts Supreme Judicial Court', years: 'any', retireAt: 70, appointer: 'governor_council' })],
  MI: [sboe(8, 8, { noPrimary: true, voteForN: true, seatCycles: [2016, 2016, 2018, 2018, 2020, 2020, 2022, 2022] }),
    regents('um', 'University of Michigan Board of Regents', 'Regent', 8, 8, { noPrimary: true, voteForN: true, seatCycles: [2016, 2016, 2018, 2018, 2020, 2020, 2022, 2022] }),
    regents('msu', 'Michigan State University Board of Trustees', 'Trustee', 8, 8, { noPrimary: true, voteForN: true, seatCycles: [2016, 2016, 2018, 2018, 2020, 2020, 2022, 2022] }),
    regents('wsu', 'Wayne State University Board of Governors', 'Governor', 8, 8, { noPrimary: true, voteForN: true, seatCycles: [2016, 2016, 2018, 2018, 2020, 2020, 2022, 2022] }),
    supreme(7, 8, 'party_np', { noPrimary: true, retireAt: 70 })],
  MN: [auditor(),
    supreme(7, 6, 'nonpartisan', { np: 'two', retireAt: 70 }), appeals(19, 6, 'nonpartisan', { np: 'two', retireAt: 70 })],
  MS: [treasurer(), auditor(), agriculture('Commissioner of Agriculture and Commerce'), insurance(),
    commission('Public Service Commission', 3, 4, { districts: 3, years: 'gov' }),
    commission('Transportation Commission', 3, 4, { key: 'transport', districts: 3, years: 'gov' }),
    supreme(9, 8, 'nonpartisan', { np: 'runoff', districts: 3, perDistrict: [3, 3, 3] })],
  MO: [treasurer(), auditor('Auditor', { cycle: 2018 }),
    supreme(7, 12, 'retention', { retireAt: 70 })],
  MT: [auditor('Auditor (Commissioner of Securities and Insurance)'), supt(),
    commission('Public Service Commission', 5, 4, { districts: 5, seatCycles: [2016, 2018, 2018, 2016, 2016] }),
    supreme(7, 8, 'nonpartisan', { np: 'two' })],
  NE: [treasurer(), auditor('Auditor of Public Accounts'),
    commission('Public Service Commission', 5, 6, { districts: 5 }),
    sboe(8, 4, { districts: 8, selection: 'nonpartisan', np: 'two', seatCycles: [2016, 2016, 2016, 2016, 2018, 2018, 2018, 2018] }),
    regents('nu', 'University of Nebraska Board of Regents', 'Regent', 8, 6, { districts: 8, selection: 'nonpartisan', np: 'two' }),
    supreme(7, 6, 'retention', { districts: 6, atLarge: 1 })],
  NV: [treasurer(), auditor('Controller'),
    regents('nshe', 'Nevada System of Higher Education Board of Regents', 'Regent', 13, 6, { districts: 13, selection: 'nonpartisan', np: 'two' }),
    sboe(4, 4, { districts: 4, selection: 'nonpartisan', np: 'two', seatCycles: [2016, 2018, 2016, 2018] }),
    supreme(7, 6, 'nonpartisan', { np: 'two' }), appeals(3, 6, 'nonpartisan', { np: 'two' })],
  NH: [supreme(5, 0, 'appointed', { years: 'any', retireAt: 70, appointer: 'governor_council' })],
  NJ: [supreme(7, 0, 'appointed', { years: 'any', retireAt: 70, appointer: 'governor' })],
  NM: [treasurer(), auditor(), land('Commissioner of Public Lands'),
    commission('Public Regulation Commission', 5, 4, { key: 'prc', districts: 5, seatCycles: [2016, 2018, 2016, 2018, 2016] }),
    board('education_board', 'pec', 'Public Education Commission', 'Member', 10, 4, { districts: 10, seatCycles: [2016, 2018, 2016, 2018, 2016, 2018, 2016, 2018, 2016, 2018] }),
    supreme(5, 8, 'partisan_retention', { retention: 0.57 }), appeals(10, 8, 'partisan_retention', { retention: 0.57 })],
  NY: [auditor('Comptroller'),
    supreme(7, 14, 'appointed', { full: 'New York Court of Appeals', years: 'any', retireAt: 70, appointer: 'commission' })],
  NC: [treasurer(), auditor(), supt(), agriculture(), insurance(), labor('Commissioner of Labor'),
    supreme(7, 8, 'nonpartisan', { np: 'two', retireAt: 72 }), appeals(15, 8, 'nonpartisan', { np: 'two', retireAt: 72 })],
  ND: [treasurer({ cycle: 2016 }), auditor('Auditor', { cycle: 2016 }), insurance({ cycle: 2016 }),
    agriculture('Agriculture Commissioner', { cycle: 2018 }), exec('other_statewide', 'Tax Commissioner', { key: 'tax', cycle: 2018 }),
    supt({ cycle: 2016, selection: 'nonpartisan', np: 'two' }),
    commission('Public Service Commission', 3, 6),
    supreme(5, 10, 'nonpartisan', { np: 'two' })],
  OH: [treasurer(), auditor(),
    sboe(11, 4, { districts: 11, selection: 'nonpartisan', np: 'none' }),
    supreme(7, 6, 'party_np', { retireAt: 70 })],
  OK: [treasurer(), auditor('State Auditor and Inspector'), supt(), insurance(), labor('Commissioner of Labor'),
    commission('Corporation Commission', 3, 6),
    supreme(9, 6, 'retention'), court('justice', 'cca', 'Court of Criminal Appeals', 5, 6, 'retention')],
  OR: [treasurer({ cycle: 2016 }), labor('Commissioner of Labor and Industries', { cycle: 2018, selection: 'nonpartisan', np: 'majority' }),
    supreme(7, 6, 'nonpartisan', { np: 'majority', onPrimary: true, retireAt: 75 }),
    appeals(13, 6, 'nonpartisan', { np: 'majority', onPrimary: true, retireAt: 75 })],
  PA: [treasurer({ cycle: 2016 }), auditor('Auditor General', { cycle: 2016 }),
    supreme(7, 10, 'partisan_retention', { years: 'odd', retireAt: 70 }),
    appeals(15, 10, 'partisan_retention', { key: 'superior', name: 'Superior Court', years: 'odd', retireAt: 70 }),
    appeals(9, 10, 'partisan_retention', { key: 'commonwealth', name: 'Commonwealth Court', years: 'odd', retireAt: 70 })],
  RI: [treasurer({ name: 'General Treasurer' }),
    supreme(5, 0, 'appointed', { years: 'any', appointer: 'commission' })],
  SC: [treasurer(), auditor('Comptroller General'), supt({ name: 'Superintendent of Education' }), agriculture(),
    supreme(5, 10, 'legislature', { years: 'any', retireAt: 72 })],
  SD: [treasurer(), auditor(), land('Commissioner of School and Public Lands'),
    commission('Public Utilities Commission', 3, 6, { key: 'puc' }),
    supreme(5, 8, 'retention', { retireAt: 70, appointer: 'commission' })],
  TN: [supreme(5, 8, 'retention'),
    appeals(12, 8, 'retention'), appeals(12, 8, 'retention', { key: 'criminal', name: 'Court of Criminal Appeals' })],
  TX: [auditor('Comptroller of Public Accounts'), land(), agriculture(),
    commission('Railroad Commission', 3, 6, { key: 'rrc' }),
    sboe(15, 4, { districts: 15 }),
    supreme(9, 6, 'partisan', { retireAt: 75 }), court('justice', 'cca', 'Court of Criminal Appeals', 9, 6, 'partisan', { retireAt: 75 })],
  UT: [treasurer(), auditor(),
    sboe(15, 4, { districts: 15, selection: 'nonpartisan', np: 'two' }),
    supreme(5, 10, 'retention', { retireAt: 75 }), appeals(7, 6, 'retention', { retireAt: 75 })],
  VT: [treasurer({ termYears: 2 }), auditor('Auditor of Accounts', { termYears: 2 }),
    supreme(5, 6, 'appointed', { years: 'any', appointer: 'commission' })],
  VA: [supreme(7, 12, 'legislature', { years: 'any', retireAt: 73 })],
  WA: [treasurer(), auditor(), insurance(), land('Commissioner of Public Lands'), supt({ selection: 'nonpartisan', np: 'two' }),
    supreme(9, 6, 'nonpartisan', { np: 'majority', retireAt: 75 })],
  WV: [treasurer(), auditor(), agriculture(),
    supreme(5, 12, 'nonpartisan', { full: 'Supreme Court of Appeals of West Virginia', np: 'final', onPrimary: true })],
  WI: [treasurer(), supt({ selection: 'nonpartisan', np: 'two', spring: true, years: 'odd', cycle: 2017, start: [7, 1] }),
    supreme(7, 10, 'nonpartisan', { np: 'two', spring: true, years: 'any', start: [8, 1] })],
  WY: [treasurer(), auditor(), supt(),
    supreme(5, 8, 'retention', { retireAt: 70 })],
};

/** Retirement ages that are estimates (rules of eligibility or pension, not a fixed age, in some states). */
export const APPROXIMATE_RETIREMENT: readonly string[] = ['AL', 'AR', 'MI', 'OH', 'PA'];

/** Kinds of the offices this module adds. */
export const DOWNBALLOT_KINDS: readonly DownballotKind[] = ['treasurer', 'auditor', 'superintendent', 'insurance_commissioner', 'agriculture_commissioner',
  'labor_commissioner', 'land_commissioner', 'other_statewide', 'commissioner', 'education_board', 'regent', 'justice', 'appellate_judge'];
export const JUDICIAL_KINDS: readonly DownballotKind[] = ['justice', 'appellate_judge'];
export const isDownballot = (k: string): boolean => (DOWNBALLOT_KINDS as readonly string[]).includes(k);
export const isJudicial = (k: string): boolean => k === 'justice' || k === 'appellate_judge';

/** The body definition of a state's office (by the office's body key). */
export function bodyDef(usps: string, key: string): BodyDef | undefined { return DOWNBALLOT_2016[usps]?.find((b) => b.key === key); }

/** Full name of a body in a state ("Ohio Supreme Court", "Texas Railroad Commission", "Georgia Insurance Commissioner"). */
export function bodyName(b: BodyDef, stateName: string): string { return b.full ?? `${stateName} ${b.name}`; }

/**
 * The election year of each seat in a cycle: given seat cycles, a single office's cycle (or the governor's), or
 * seats staggered evenly over the term within the body's election years.
 */
export function seatCycles(b: BodyDef, govLastElection: number): number[] {
  if (b.seatCycles) return b.seatCycles.slice(0, b.seats);
  const term = b.termYears || 10;
  if (b.seats === 1 || b.years === 'gov') return Array.from({ length: b.seats }, () => b.cycle ?? govLastElection);
  const slots: number[] = [];
  const first = b.years === 'odd' ? 2017 : 2016;
  for (let y = first; y < first + term; y++) {
    if (b.years === 'even' && y % 2 !== 0) continue;
    if (b.years === 'odd' && y % 2 !== 1) continue;
    slots.push(y);
  }
  return Array.from({ length: b.seats }, (_, i) => slots[i % Math.max(1, slots.length)]!);
}

/** Whether a seat with election year `cycle` and a term of `termYears` is up (or its term ends) in `year`. */
export function seatUp(cycle: number, termYears: number, year: number): boolean {
  if (termYears <= 0) return false;
  return year >= cycle && (year - cycle) % termYears === 0;
}

/** District number (1-based, 0 for at-large) of each seat of a body. */
export function seatDistricts(b: BodyDef): number[] {
  if (!b.districts) return Array.from({ length: b.seats }, () => 0);
  const per = b.perDistrict ?? Array.from({ length: b.districts }, () => 1);
  const out: number[] = [];
  per.forEach((n, d) => { for (let i = 0; i < n; i++) out.push(d + 1); });
  for (let i = 0; i < (b.atLarge ?? 0); i++) out.push(0);
  return out.slice(0, b.seats);
}

/** Whether a body's members face voters at all. */
export const elected = (b: BodyDef): boolean => b.selection !== 'appointed' && b.selection !== 'legislature';
