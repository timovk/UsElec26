/**
 * Engine API: the only contract between the UI (main thread) and the Engine Worker.
 * Types only — imported by both sides.
 */
import type { SimTime } from '../core/time';
import type { Story } from '../counting/record';
/** Display labels of office kinds (shared with the engine's news and queries). */
export { OFFICE_LABEL } from '../institutions/offices';

export type { Story, StoryAlert, StoryLine } from '../counting/record';

export type AdvanceTargetMsg = { kind: 'days'; days: number } | { kind: 'until'; time: SimTime } | { kind: 'nextEvent'; maxDays?: number } | { kind: 'nextElection' };

export interface SlotInfo { id: string; name: string; seed: string; currentTime: SimTime; startTime: SimTime; createdReal: string; lastExportReal: string; bytes: number }

export interface StorageInfo { kind: 'opfs' | 'memory'; persisted: boolean | null; usage: number | null; quota: number | null }

export type Request =
  | { type: 'init' }
  | { type: 'list' }
  | { type: 'create'; name: string; seed?: string }
  | { type: 'open'; id: string }
  | { type: 'close' }
  | { type: 'delete'; id: string }
  | { type: 'export'; id: string }
  | { type: 'import'; bytes: Uint8Array }
  | { type: 'advance'; target: AdvanceTargetMsg }
  | { type: 'play'; daysPerSecond: number }
  | { type: 'pause' }
  | { type: 'query'; query: Query }
  | { type: 'integrity' }
  | { type: 'storage'; requestPersist?: boolean }
  | { type: 'diagnostics' };

export type Query =
  | { kind: 'desk' }
  | { kind: 'geoMeta' }
  | { kind: 'mapLayer'; layer: MapLayer; metric: MapMetric }
  | { kind: 'entity'; layer: MapLayer; idx: number }
  | { kind: 'people'; search?: string; office?: string; party?: number; state?: number; limit?: number; offset?: number }
  | { kind: 'person'; id: number }
  | { kind: 'news'; limit?: number; beforeId?: number }
  | { kind: 'calendar' }
  | { kind: 'electorate' }
  | ArchiveQuery
  | NightQuery
  | SeasonQuery
  | GovernmentQuery;

// ---- Phase 5: campaigns, polls, forecasts, primaries -------------------------------------------------
export type SeasonQuery =
  | { kind: 'seasonYears' }
  | { kind: 'seasonOverview'; year: number }
  | { kind: 'seasonRace'; key: string }
  | { kind: 'pollList'; year: number; race?: string; pollster?: number; limit?: number }
  | { kind: 'pollster'; id: number }
  | { kind: 'forecastRun'; year: number; asOf?: number }
  | { kind: 'forecastCalibration'; year: number }
  | { kind: 'primaries'; year: number };

export interface SeasonOption { key: string; label: string; party: number; personId: number | null }
export interface RaceRowDto {
  key: string; kind: string; label: string; geo: string; office: string; day: number; contestId: number | null; polls: number;
  avg: { a: string; b: string; mean: number; lo: number; hi: number } | null;
  leader: { label: string; party: number; share: number } | null;
  forecast: { pD: number; mean: number; lo80: number; hi80: number } | null;
}
export interface ForecastRaceDto { key: string; label: string; kind: string; state: number; ev: number; pD: number; mean: number; lo80: number; hi80: number }
export interface ForecastDto {
  asOf: number; national: { mean: number; sd: number };
  president: { pD: number; pR: number; pTie: number; evMean: number; ev80: [number, number]; ev95: [number, number]; evHist: number[]; tipping: Record<string, number> } | null;
  senate: { pD: number; mean: number; hist: number[] } | null;
  house: { pD: number; mean: number; hist: number[] } | null;
  governors: { meanD: number; races: number } | null;
  races: ForecastRaceDto[];
  nominees: { party: number; name: string }[];
}
export interface SeasonOverviewDto {
  year: number; today: number; pollCount: number; pollsters: number;
  races: RaceRowDto[]; forecast: ForecastDto | null;
  history: { asOf: number; president: number | null; ev: number | null; senate: number | null; house: number | null }[];
}
export interface PollDto {
  id: number; pollster: number; pollsterName: string; race: string; raceLabel: string; start: number; end: number; published: SimTime;
  population: string; n: number; moe: number; method: string; sponsor: string | null; responses: { key: string; label: string; party: number; pct: number }[];
}
export interface SeasonRaceDto {
  key: string; label: string; kind: string; geo: string; day: number; options: SeasonOption[]; contestId: number | null;
  polls: PollDto[];
  averages: { day: number; options: Record<string, { mean: number; lo: number; hi: number }>; margin: { a: string; b: string; mean: number; lo: number; hi: number } | null; lvGap?: number }[];
  forecast: { asOf: number; pD: number; mean: number; lo80: number; hi80: number }[];
  result: { margin: number | null; shares: Record<string, number> } | null;
}
export interface PollsterDto {
  id: number; name: string; method: string; sponsor: string | null; scope: string; homeState: string | null; founded: number; polls: number;
  /** Estimated house effect on the Democratic-minus-Republican margin (points), from published polls against the averages. */
  house: number | null;
  /** Track record against certified results (final three weeks): races, mean absolute error and mean signed error of the margin. */
  accuracy: { polls: number; mae: number; bias: number } | null;
  recent: PollDto[];
}
export interface CalibrationDto {
  year: number; ready: boolean; asOf: number | null;
  races: { key: string; label: string; kind: string; pD: number; mean: number; lo80: number; hi80: number; actual: number; dWon: boolean }[];
  brier: number | null; bins: { lo: number; hi: number; n: number; predicted: number; observed: number }[];
  president: { pD: number; evMean: number; ev80: [number, number]; actualEV: number | null; dWon: boolean | null } | null;
}
export interface PrimaryPartyDto {
  party: number; total: number; needed: number; presumptive: number | null; nominee: number | null; open: boolean;
  candidates: { personId: number; name: string; status: string; pledged: number; supers: number; wins: number; endorsements: number }[];
  calendar: { day: number; state: string; usps: string; event: string; delegates: number; contestId: number; status: string; winner: number | null; results: { personId: number; share: number; delegates: number }[] }[];
  unbound: number;
  ballots: { ballot: number; personId: number; votes: number }[];
}
export interface PrimariesDto { year: number; parties: PrimaryPartyDto[] }

// ---- Phase 3: election nights ----------------------------------------------------------------------
export type NightQuery =
  | { kind: 'nights' }
  | { kind: 'nightMeta'; id: number }
  | { kind: 'nightPayload'; id: number }
  | { kind: 'nightContext'; id: number }
  | { kind: 'nightBaseline'; id: number; race: number }
  | { kind: 'nightSurvey'; id: number; race: number }
  | { kind: 'nightCalls'; id: number };

/** The voter survey of a race (toplines and crosstabs in ballot order), as published on the night. */
export interface SurveyDto { n: number; shares: number[]; crosstabs: { dim: string; groups: { label: string; pct: number; n: number; shares: number[] }[] }[] }
/** Every desk call of a night, for the calls timeline. */
export interface NightCallDto { time: SimTime; race: number; contestId: number; label: string; short: string; office: string; status: number; party: number; name: string; pct: number; pollClose: boolean }

/** A previous comparable result (for swing and turnout change): D and R votes, valid votes, ballots, eligible. */
export interface BaselineDto { contestId: number; label: string; year: number; d: number; r: number; valid: number; ballots: number; eligible: number }
/** Map context for a night: eligible voters by county and state, and each race's previous comparable result. */
export interface NightContextDto {
  eligibleCounty: Record<number, number>; eligibleState: Record<number, number>;
  baselines: Record<number, BaselineDto>;
}
/** A baseline result by county: [D, R, valid, ballots, eligible]. */
export type BaselineCountiesDto = Record<number, [number, number, number, number, number]> | null;

export interface NightListItem { id: number; label: string; kind: string; day: number; date: string; lockTime: SimTime; coverageStart: SimTime; nightEnd: SimTime; feedEnd: SimTime }
export interface NightCandidate { candidacyId: number; personId: number; name: string; party: number; incumbent: boolean }
export interface NightRaceMeta {
  i: number; contestId: number; label: string; short: string; office: string; state: string; stateIdx: number; cd: number; ev: number; k: number;
  candidates: NightCandidate[]; precincts: number; close: SimTime;
  /** Congressional district index of a House race (null otherwise). */
  district: number | null;
  /** Ranked-choice contest: no first-choice majority means a ranked-choice count, not a runoff. */
  rcv?: boolean;
}
export interface NightChamberBase { holdovers: Record<number, number>; seats: number; majority: number }
export interface NightMetaDto {
  id: number; label: string; lockTime: SimTime; coverageStart: SimTime; nightEnd: SimTime; feedEnd: SimTime;
  races: NightRaceMeta[];
  states: { idx: number; usps: string; name: string; closeFirst: SimTime; closeLast: SimTime; certify: SimTime }[];
  chambers: { senate: NightChamberBase; house: NightChamberBase };
  network: string;
  /** Names of the reporting jurisdictions in the record (county, town or Alaska district). */
  rjs: Record<number, string>;
  /** County of each reporting jurisdiction (towns map to their county; Alaska's districts have none). */
  rjCounty: Record<number, number>;
  /** Alerts and commentary for the night (docs/architecture/08 §8.6). */
  story: Story;
}

/** Messages to the Broadcast Worker (playback of a sealed night record). */
export type BroadcastRequest =
  | { type: 'load'; payload: Uint8Array }
  | { type: 'frame'; t: number; focus: number | null; full?: boolean }
  | { type: 'markers' }
  | { type: 'raceDetail'; race: number; t: number; truth: boolean };
/** One race in detail (Analyst Mode); `final` is the end of the count (simulation truth until then), only on request. */
export interface RaceDetailDto {
  batches: { time: number; rj: number; mode: number; votes: number[] }[];
  byMode: number[][];
  events: { time: number; status: number; option: number; prob: number; ballots: number; expected: number }[];
  history: { time: number; ballots: number; votes: number[] }[];
  final: number[] | null;
}
export interface NightRaceFrame { i: number; s: number; o: number; o2: number; p: number; b: number; e: number; pr: number; v: number[]; ca: number; pc: boolean }
export interface NightTally { called: Record<number, number>; leading: Record<number, number> }
export interface NightFrameDto {
  t: number; full: boolean;
  races: NightRaceFrame[];
  president: NightTally; senate: NightTally; house: NightTally;
  control: { kind: string; party: number; person: number | null; time: SimTime; detail: string; status: number }[];
  /** The focused race by reporting jurisdiction: counted votes (ballot order + undervotes) and the wire's expected ballots. */
  focus: { race: number; byRj: [number, number[]][]; expected: [number, number][] } | null;
}
export interface NightMarker { time: SimTime; kind: 'close' | 'call' | 'control'; race: number }

export type MapLayer = 'state' | 'county' | 'cd';
export type MapMetric = 'lean' | 'governor' | 'senate' | 'house';

export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
export type EngineEvent =
  | { event: 'progress'; step: string; fraction: number }
  | { event: 'clock'; time: SimTime; playing: boolean }
  | { event: 'news'; items: NewsDto[] }
  | { event: 'error'; message: string };

// ---- DTOs ------------------------------------------------------------------------------------------
export interface PartyDto { id: number; name: string; short: string; abbrev: string; color: string }
export interface PersonRef { id: number; name: string; party: number; state: string | null; age: number; dead: boolean }
export interface OfficeHolderDto { officeId: number; title: string; kind: string; holder: PersonRef | null; since: SimTime | null; acquired: string | null; vacancy: { since: SimTime; reason: string; resolution: string } | null }
export interface ChamberDto { id: number; name: string; kind: string; stateUsps: string | null; seats: number; composition: { party: number; seats: number }[]; majority: number | null; provenance: string; asOf: SimTime }
export interface NewsDto { id: number; time: SimTime; kind: string; headline: string; body: string; personId?: number }

export interface DeskSummary {
  universe: { id: string; name: string; seed: string; time: SimTime; startTime: SimTime };
  parties: PartyDto[];
  executive: OfficeHolderDto[];       // President, VP, Cabinet
  congressLeaders: OfficeHolderDto[];
  senate: ChamberDto; house: ChamberDto;
  governors: { D: number; R: number; other: number; vacant: number };
  legislatures: { dControlled: number; rControlled: number; split: number; total: number; dSeats: number; rSeats: number; otherSeats: number };
  vacancies: OfficeHolderDto[];
  presidentTermNumber: number;
  nationalLean: number;               // D two-party margin, points (simulation truth)
  electorateNote: string;
}

export interface GeoMeta {
  packVersion: string;
  states: { idx: number; usps: string; name: string; fips: string }[];
  counties: { idx: number; geoid: string; name: string; stateIdx: number; legalType: string }[];
  cds: { idx: number; geoid: string; stateIdx: number; label: string }[];
}

export interface MapLayerDto { layer: MapLayer; metric: MapMetric; values: (number | null)[]; legend: string; provenance: 'simulationTruth' | 'publicRecord' }

export interface EntityDetail {
  layer: MapLayer; idx: number; title: string; subtitle: string;
  stats: { label: string; value: string; provenance?: string }[];
  officials: OfficeHolderDto[];
}

export interface PersonRow { id: number; name: string; party: number; stateUsps: string | null; office: string | null; age: number; tier: string; dead: boolean }
export interface PersonDetail {
  id: number; name: string; fullName: string; party: number; sex: string; race: string; age: number; birth: string; death: string | null;
  homeState: string | null; homeCounty: string | null; tier: string; provenance: string; bio: string;
  traits: { label: string; value: number }[]; ideology: { axis: string; value: number }[];
  terms: { title: string; start: SimTime; end: SimTime | null; acquired: string; endReason: string | null; provenance: string }[];
  career: { years: string; text: string; provenance: string }[];
  elections: { contestId: number; label: string; year: number; result: string; votes: number | null; share: number | null; kind: string }[];
}

export interface CalendarEntry { date: string; dayNumber: number; label: string; contests: { label: string; count: number }[]; status: string }

export interface ElectorateSummary {
  targets: Record<string, number>; achieved: Record<string, number>; ranges: Record<string, readonly [number, number]>;
  attempt: number; platforms: { D: number[]; R: number[] }; axes: string[];
  cohortLean: { label: string; margin: number; share: number }[];
  /** Phase 6: January 1 of each simulated year — party platforms, the national lean and the spread of state leans. */
  history: { year: number; platforms: { D: number[]; R: number[] }; national: number; stateSd: number }[];
}

export interface DiagnosticsResult { name: string; value: number; unit: string; note: string }
export type { IntegrityReport } from '../persistence/audit';

// ---- Phase 2: elections and the archive -----------------------------------------------------------
export type ArchiveQuery =
  | { kind: 'elections'; year?: number }
  | { kind: 'electionYears' }
  | { kind: 'contest'; id: number }
  | { kind: 'countyHistory'; county: number }
  | { kind: 'districtHistory'; code: string }
  | { kind: 'stateHistory'; state: number }
  | { kind: 'resultsMap'; year: number; office: ResultsOffice; layer: MapLayer }
  | { kind: 'yearSummary'; year: number }
  | { kind: 'audit'; year: number };

export type ResultsOffice = 'president' | 'us_senator' | 'governor' | 'us_representative';

export interface ElectionListItem {
  id: number; day: number; date: string; kind: string; label: string; status: string; stateUsps: string | null; year: number;
  /** The election night that counted this election (null for primaries and elections held before Phase 3). */
  nightId: number | null;
  contests: {
    id: number; label: string; kind: string; office: string; status: string; winner: CandidateDto | null; margin: number | null;
    /** State of the contest (null for national contests). */
    state: string | null;
    /** The winner's party differs from the seat holder's at the election (null when not applicable). */
    flip: boolean | null;
    /** An incumbent ran and did not win. */
    incumbentLost: boolean;
  }[];
}
export interface CandidateDto { candidacyId: number; personId: number; name: string; party: number; incumbent: boolean; status: string; runningMate: string | null; votes: number | null; share: number | null }
export interface ContestDetail {
  id: number; label: string; kind: string; method: string; status: string; office: string | null; officeKind: string | null; stateUsps: string | null; stateIdx: number | null; districtLabel: string | null;
  date: string; electionLabel: string; candidates: CandidateDto[]; ballots: number | null; undervotes: number | null; eligible: number | null;
  ev: number | null; seal: string | null; revisionKind: string | null; parent: number | null; next: number | null; grain: string | null;
  counties: { county: number; name: string; votes: number[]; total: number }[];
  modes: { mode: string; votes: number[] }[];
  note: string;
  /** While the contest is being counted: the wire's expected vote, precincts and the desk's status. */
  counting: { expected: number; precincts: number; totalPrecincts: number; status: number; called: number | null; calledAt: SimTime | null; prob: number; nightId: number } | null;
  /** The election night that counted this contest (null for primaries and elections held before Phase 3). */
  nightId: number | null;
  revisions: { rev: number; kind: string; time: SimTime }[];
  /** The ballot carried no party labels (Phase 7.1). */
  nonpartisan: boolean;
  /** A judge's retention vote (Phase 7.2): the share of yes votes needed, and the outcome once decided. */
  retention: { threshold: number; retained: boolean | null } | null;
  /** Ranked-choice tabulation, round by round, once the contest is decided (Phase 7.1). */
  rcv: { round: number; candidates: { candidacyId: number; name: string; party: number; votes: number; status: string }[]; exhausted: number }[] | null;
}
/** One contest's result in a county, a district or a state. */
export interface HistoryRow {
  contestId: number; year: number; date: string; office: string; officeKind: string; label: string;
  candidates: { name: string; party: number; votes: number; share: number; winner: boolean }[]; total: number; undervotes: number; dMargin: number | null;
}
export interface CountyHistoryDto {
  county: number; name: string; state: string; stateIdx: number;
  /** Congressional districts the county lies in today (codes). */
  districts: string[];
  rows: HistoryRow[];
}
/** A congressional district by its code (e.g. TX-15): its House elections, and every contest's result within it as drawn at the time. */
export interface DistrictHistoryDto {
  /** False when the code names no state (the rest is then empty). */
  found: boolean;
  code: string; state: string; stateIdx: number; number: number;
  /** The district as drawn today, its representative and counties (null when the state no longer has a district of this number). */
  now: { lean: number; population: number; plan: string; holder: { personId: number; name: string; party: number; since: SimTime } | null; counties: { idx: number; name: string; share: number }[] } | null;
  /** The plans the district has been drawn under, oldest first. */
  plans: { firstYear: number; label: string }[];
  rows: HistoryRow[];
}
/** A state's statewide election history, its congressional districts and its counties. */
export interface StateHistoryDto {
  stateIdx: number; name: string; usps: string;
  rows: HistoryRow[];
  districts: { code: string; holder: { personId: number; name: string; party: number } | null; lean: number }[];
  counties: { idx: number; name: string }[];
}
export interface ResultsMapDto {
  year: number; office: ResultsOffice; layer: MapLayer; values: (number | null)[]; legend: string; national: { party: number; votes: number }[] | null; ev: { party: number; ev: number; name: string }[] | null;
  /** Per area: D and R votes, valid votes, leading party, ballots and eligible voters; and the previous comparable result. */
  cells?: {
    d: number[]; r: number[]; valid: number[]; has: number[]; lead: number[]; ballots: number[] | null; eligible: number[] | null;
    base: { label: string; d: number[]; r: number[]; valid: number[]; has: number[]; ballots: number[] | null; eligible: number[] | null } | null;
  };
}
export interface YearSummary {
  year: number; hasPresident: boolean;
  president: { name: string; party: number; ev: number; votes: number; share: number }[];
  chambers: { label: string; before: { party: number; seats: number }[]; after: { party: number; seats: number }[] }[];
  flips: { label: string; from: number; to: number; contestId: number }[];
  turnout: { ballots: number; eligible: number } | null;
  /** Electoral votes are the decision desk's projections (the count is still in progress). */
  projected: boolean;
}

// ---- Phase 6: the economy and approval, Congress, legislatures, census and districts ----------------------
export type GovernmentQuery =
  | { kind: 'economy' }
  | { kind: 'congress'; congress?: number }
  | { kind: 'bill'; id: number }
  | { kind: 'legislatures' }
  | { kind: 'census' }
  | { kind: 'districtMap'; state: number; plan: 'cd' | 'sldu' | 'sldl'; year: number }
  | { kind: 'electionLaw' }
  | { kind: 'stateOffices'; state?: number };

/** A state's down-ballot offices, elected boards and courts (Phase 7.2), and a national summary of who holds them. */
export interface StateOfficesDto {
  stateIdx: number;
  states: { stateIdx: number; usps: string; name: string }[];
  bodies: {
    key: string; name: string; group: 'executive' | 'boards' | 'courts'; selection: string; seats: number; termYears: number; notes: string[];
    composition: { party: number; seats: number }[];
    members: { officeId: number; title: string; seat: string; personId: number | null; name: string | null; party: number | null; since: SimTime | null; acquired: string | null; next: string | null; age: number | null }[];
  }[];
  /** Per state: seats on its supreme court(s) and its down-ballot executive offices by party (0 = vacant). */
  summary: { stateIdx: number; usps: string; name: string; court: { party: number; seats: number }[]; courtSelection: string; executive: { party: number; seats: number }[] }[];
}

/** Each state's election law today and every change enacted in the universe (Phase 7.1). */
export interface ElectionLawDto {
  states: { stateIdx: number; usps: string; name: string; rules: string[]; changed: boolean }[];
  changes: { stateIdx: number; usps: string; name: string; enacted: SimTime; effective: string; source: string; summary: string; inForce: boolean }[];
}

export interface EconomyDto {
  /** Published figures only (releases), by period. */
  releases: { time: number; kind: string; period: string; value: number }[];
  /** Approval polls and a smoothed average (published). */
  approvalPolls: { day: number; pollster: string; approve: number; disapprove: number; n: number }[];
  approvalAverage: { day: number; approve: number }[];
  president: { name: string; party: number; since: number } | null;
  /** Monthly truth (simulation), labelled as such in the UI: approval by party, the economy's regime. */
  truth: { month: number; approve: number; copartisans: number; opponents: number; recession: boolean; unemployment: number; gdp: number; inflation: number }[];
}
export interface BillRowDto { id: number; congress: number; title: string; topic: string; introduced: number; sponsorParty: number; status: string; enacted: number | null; house: string | null; senate: string | null }
export interface CongressDto {
  congress: number; congresses: number[]; bills: BillRowDto[];
  years: { year: number; congress: number; minor: number; major: number; vetoes: number; overrides: number; unified: boolean; houseMajority: number; senateMajority: number }[];
  chambers: { name: string; seats: number; composition: { party: number; seats: number }[] }[];
}
export interface BillDto extends BillRowDto {
  salience: number; reconciliation: boolean;
  rollCalls: { chamber: string; time: number; question: string; yea: number; nay: number; passed: boolean; byParty: { party: number; yea: number; nay: number }[] }[];
}
export interface LegislaturesDto {
  states: { stateIdx: number; usps: string; name: string; governorParty: number | null;
    chambers: { name: string; kind: string; seats: number; composition: { party: number; seats: number }[]; majority: number | null }[];
    trifecta: number | null; session: { year: number; laws: number; vetoes: number; budgetLate: boolean } | null }[];
  totals: { dChambers: number; rChambers: number; split: number; dTrifectas: number; rTrifectas: number; dLegislators: number; rLegislators: number; others: number };
}
export interface CensusDto {
  censuses: { year: number; total: number; states: { stateIdx: number; usps: string; name: string; population: number; seats: number | null; change: number | null }[]; lastSeat: string | null; nextInLine: string | null }[];
  demography: { year: number; adults: number; total: number; age65: number; white: number; hispanic: number; college: number }[];
  plans: { planId: number; kind: string; stateIdx: number; usps: string; firstYear: number; districts: number; maxDeviation: number; countiesSplit: number; contiguous: boolean }[];
}
export interface DistrictMapDto {
  state: number; plan: string; year: number; planLabel: string;
  /** BU centroids in the basemap projection (y down), √(land area) in the same units, and the district (local index into `districts`). */
  x: number[]; y: number[]; side: number[]; district: number[];
  districts: { idx: number; label: string; population: number; holderParty: number | null; lean: number }[];
}
