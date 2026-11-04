/**
 * Engine API: the only contract between the UI (main thread) and the Engine Worker.
 * Types only — imported by both sides.
 */
import type { SimTime } from '../core/time';

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
  | NightQuery;

// ---- Phase 3: election nights ----------------------------------------------------------------------
export type NightQuery =
  | { kind: 'nights' }
  | { kind: 'nightMeta'; id: number }
  | { kind: 'nightPayload'; id: number };

export interface NightListItem { id: number; label: string; kind: string; day: number; date: string; lockTime: SimTime; coverageStart: SimTime; nightEnd: SimTime; feedEnd: SimTime }
export interface NightCandidate { candidacyId: number; personId: number; name: string; party: number; incumbent: boolean }
export interface NightRaceMeta {
  i: number; contestId: number; label: string; short: string; office: string; state: string; stateIdx: number; cd: number; ev: number; k: number;
  candidates: NightCandidate[]; precincts: number; close: SimTime;
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
}

/** Messages to the Broadcast Worker (playback of a sealed night record). */
export type BroadcastRequest =
  | { type: 'load'; payload: Uint8Array }
  | { type: 'frame'; t: number; focus: number | null; full?: boolean }
  | { type: 'markers' };
export interface NightRaceFrame { i: number; s: number; o: number; o2: number; p: number; b: number; e: number; pr: number; v: number[]; ca: number; pc: boolean }
export interface NightTally { called: Record<number, number>; leading: Record<number, number> }
export interface NightFrameDto {
  t: number; full: boolean;
  races: NightRaceFrame[];
  president: NightTally; senate: NightTally; house: NightTally;
  control: { kind: string; party: number; person: number | null; time: SimTime; detail: string; status: number }[];
  focus: { race: number; byRj: [number, number[]][] } | null;
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
}

export interface DiagnosticsResult { name: string; value: number; unit: string; note: string }
export type { IntegrityReport } from '../persistence/audit';

// ---- Phase 2: elections and the archive -----------------------------------------------------------
export type ArchiveQuery =
  | { kind: 'elections'; year?: number }
  | { kind: 'electionYears' }
  | { kind: 'contest'; id: number }
  | { kind: 'countyHistory'; county: number }
  | { kind: 'resultsMap'; year: number; office: ResultsOffice; layer: MapLayer }
  | { kind: 'yearSummary'; year: number }
  | { kind: 'audit'; year: number };

export type ResultsOffice = 'president' | 'us_senator' | 'governor' | 'us_representative';

export interface ElectionListItem {
  id: number; day: number; date: string; kind: string; label: string; status: string; stateUsps: string | null; year: number;
  contests: { id: number; label: string; kind: string; office: string; status: string; winner: CandidateDto | null; margin: number | null }[];
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
  revisions: { rev: number; kind: string; time: SimTime }[];
}
export interface CountyHistoryDto {
  county: number; name: string; state: string; stateIdx: number;
  rows: { contestId: number; year: number; date: string; office: string; officeKind: string; label: string; candidates: { name: string; party: number; votes: number; share: number; winner: boolean }[]; total: number; undervotes: number; dMargin: number | null }[];
}
export interface ResultsMapDto { year: number; office: ResultsOffice; layer: MapLayer; values: (number | null)[]; legend: string; national: { party: number; votes: number }[] | null; ev: { party: number; ev: number; name: string }[] | null }
export interface YearSummary {
  year: number; hasPresident: boolean;
  president: { name: string; party: number; ev: number; votes: number; share: number }[];
  chambers: { label: string; before: { party: number; seats: number }[]; after: { party: number; seats: number }[] }[];
  flips: { label: string; from: number; to: number; contestId: number }[];
  turnout: { ballots: number; eligible: number } | null;
  /** Electoral votes are the decision desk's projections (the count is still in progress). */
  projected: boolean;
}
