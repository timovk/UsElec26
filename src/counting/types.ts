/** Shared types of the election-night pipeline (docs/architecture/08-election-night.md). */
import type { CountingRules } from '../rules/counting2016';

export const MODE_ED = 0, MODE_EARLY = 1, MODE_MAIL = 2, MODE_PROV = 3;
export const FLAG_NORMAL = 0, FLAG_GLITCH = 1, FLAG_CORRECTION = 2;

/** Desk status codes, in the record. */
export const ST_NONE = 0, ST_TOO_EARLY = 1, ST_TOO_CLOSE = 2, ST_CALLED = 3, ST_WITHDRAWN = 4, ST_RUNOFF = 5;
export const STATUS_NAME = ['Polls open', 'Too early to call', 'Too close to call', 'Projected', 'Projection withdrawn', 'Runoff projected'] as const;

/** A race tracked on the night: a contest, or a presidential contest restricted to one congressional district (ME/NE). */
export interface NightRace {
  contest: number;        // index into the shard's contests
  cd: number;             // −1 = every unit of the contest; otherwise only units in this congressional district
  office: string;         // office kind
  surveyed: boolean;      // covered by the voter survey
  majority: boolean;      // a majority is required (otherwise a runoff)
  /** Per option (excluding the undervote): +1 for the option the prior error favours, −1 for its opponent, 0 otherwise. */
  axis: number[];
  /**
   * Ballot measures with a threshold other than a simple majority (Phase 7.3): weights over the options and the
   * blank ballots (yes, no, blank) — the measure passes when Σ weight × votes ≥ 0 — so the desk calls the rule, not the leader.
   */
  pass?: number[];
  /** Automatic-recount threshold (fraction of votes), 0 = none. */
  recount: number;
  /**
   * The last public forecast of the race (Phase 5): margin of the axis's + option over its − option (points) and
   * its SD. With it, the desk's baseline is centred on the forecast instead of carrying a drawn prior error.
   */
  forecast?: { mean: number; sd: number };
}

export interface DeskParams {
  network: number;
  callThreshold: number;   // θ_call
  stressMin: number;       // P under doubled systematic error must stay ≥ this
  surveyWeight: number;    // precision multiplier of the voter survey
  latency: [number, number]; // human review, minutes
  retract: number;         // P(called candidate) below this withdraws the projection
}

export const FLAGSHIP_DESK: DeskParams = { network: 0, callThreshold: 0.995, stressMin: 0.95, surveyWeight: 1, latency: [3, 10], retract: 0.9 };

export interface NightInput {
  key: string;             // RNG key of the night (seed | election | state)
  seed: string;
  year: number;
  close: Int32Array;       // per unit: poll closing, UTC minutes
  rjOffset: Int16Array;    // per RJ (local): UTC offset in minutes on Election Day (local business hours)
  rjPrecincts: Float32Array; // per RJ (local): target number of precincts
  rules: CountingRules;
  mailReject: number;
  provReject: number;
  races: NightRace[];
  desk: DeskParams;
  /** Pre-election information error of the desk's baseline (margin per ballot along each race's axis). */
  priorError: { state: number; mode: number[]; race: number[] };
  surveyBias: number;      // survey nonresponse bias (margin units along the race axis)
  surveyN: number;
  coverageStart: number;   // 5:00 pm ET on Election Day
  /** Diagnostics only (tests): log the desk's reasoning for this race index. */
  trace?: number;
}

/** One state's night, produced in a compute worker. All arrays are parallel columns. */
export interface StateNight {
  stateIdx: number;
  parts: { rj: Int32Array; cd: Int32Array; precincts: Int32Array; close: Int32Array };
  races: { contestId: number; cd: number; k: number; parts: Int32Array }[];
  batches: { time: Int32Array; rj: Int32Array; mode: Uint8Array; flag: Uint8Array };
  partRows: { batch: Int32Array; part: Int32Array; ballots: Int32Array; precincts: Int32Array };
  raceRows: { batch: Int32Array; race: Int32Array; part: Int32Array; votes: Int32Array /* rows × K of that race, concatenated */ };
  /** Per race: votes cast but never counted (rejected mail and provisional ballots), K values. */
  rejected: Int32Array[];
  /** Per race: rejected ballots by (unit, mode) for the certified archive: unit ids, modes and K values per row. */
  rejectedUnits: { units: Int32Array; modes: Uint8Array; votes: Int32Array }[];
  /** Expected-vote estimates (wire): rows of (time, race, expected ballots). */
  wire: { time: Int32Array; race: Int32Array; expected: Float64Array };
  /** Desk events: (time, race, status, option index or −1, P×10⁴, flags). */
  events: { time: Int32Array; race: Int32Array; status: Uint8Array; option: Int16Array; option2: Int16Array; prob: Int16Array; flags: Uint8Array };
  /** Expected ballots per part (wire) whenever an estimate moves: (time, part, expected). */
  partWire: { time: Int32Array; part: Int32Array; expected: Int32Array };
  /** Voter-survey toplines per surveyed race (shares of the options, K−1), with crosstabs. */
  survey: SurveyTopline[];
  closeFirst: number; closeLast: number;
}

export const EVENT_POLLCLOSE_CALL = 1;  // flags bit: projection made at poll closing

export interface SurveyTopline {
  race: number; shares: number[]; n: number;
  crosstabs?: { dim: 'age' | 'sex' | 'race' | 'edu'; groups: { label: string; pct: number; n: number; shares: number[] }[] }[];
}
