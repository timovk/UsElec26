/**
 * Engine API: the only contract between the UI (main thread) and the Engine Worker.
 * Types only — imported by both sides.
 */
import type { SimTime } from '../core/time';

export type AdvanceTargetMsg = { kind: 'days'; days: number } | { kind: 'until'; time: SimTime } | { kind: 'nextEvent'; maxDays?: number };

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
  | { kind: 'electorate' };

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
}

export interface CalendarEntry { date: string; dayNumber: number; label: string; contests: { label: string; count: number }[]; status: string }

export interface ElectorateSummary {
  targets: Record<string, number>; achieved: Record<string, number>; ranges: Record<string, readonly [number, number]>;
  attempt: number; platforms: { D: number[]; R: number[] }; axes: string[];
  cohortLean: { label: string; margin: number; share: number }[];
}

export interface DiagnosticsResult { name: string; value: number; unit: string; note: string }
export type { IntegrityReport } from '../persistence/audit';
