/**
 * Campaigns (docs/architecture/03 §3.9): resources, spending, recognition and persuasion, plus short-lived
 * shocks (debates, scandals and gaffes, endorsements, primary momentum). Pure functions of the campaign state;
 * the engine runs one step per day and turns the state into contest-specific valence for the ballot kernel.
 *
 * Units: money in dollars; valence in utility (logit) units of the vote-choice model, where 0.04 is roughly one
 * point of vote share for an even race. Net effects are bounded (typically 1–3 points of margin).
 */
import type { Rng } from '../core/rng';

export type CampaignOffice = 'president' | 'us_senator' | 'governor' | 'us_representative' | 'other';

export interface CampaignState {
  person: number; party: number; office: CampaignOffice; primary: boolean;
  cash: number; raised: number; spent: number;
  /** Name recognition in the race's electorate, 0–1. */
  recognition: number;
  /** Persuasion stock from spending and organization (decays slowly). */
  persuasion: number;
  /** Shocks: debate performance, scandals and gaffes, endorsements, primary momentum (each decays). */
  debate: number; scandal: number; endorse: number; momentum: number;
  /** Primaries: viability from the candidate's standing in the polls (strategic voters desert trailing candidates). */
  viability?: number;
  /** Presidential general only: persuasion stock by state. */
  byState?: number[];
  withdrawn?: boolean;
  incumbent?: boolean;
}

export interface CampaignTraits { fundraising: number; campaign: number; charisma: number; integrity: number; quality: number; incumbent: boolean; recognition: number }

/** Daily fundraising scale by office (dollars per day for an average candidate in a typical race). */
const RAISE: Record<CampaignOffice, number> = { president: 900_000, us_senator: 45_000, governor: 40_000, us_representative: 6_000, other: 3_000 };
const SPEND_SCALE: Record<CampaignOffice, number> = { president: 2_500_000, us_senator: 120_000, governor: 110_000, us_representative: 18_000, other: 8_000 };

export function initCampaign(person: number, party: number, office: CampaignOffice, primary: boolean, t: CampaignTraits, states = 0): CampaignState {
  const seed = (t.incumbent ? 6 : 1) * RAISE[office] * (10 + 40 * t.fundraising);
  return {
    person, party, office, primary, cash: seed, raised: seed, spent: 0,
    recognition: Math.max(0.05, Math.min(0.95, t.recognition)), persuasion: 0, debate: 0, scandal: 0, endorse: 0, momentum: 0,
    ...(states > 0 ? { byState: new Array<number>(states).fill(0) } : {}),
  };
}

export interface DayContext {
  daysLeft: number;            // days until this campaign's election
  viability: number;           // 0–1: public sense of the candidate's chances (polls, delegates, forecast)
  mood: number;                // −1…1: national mood toward the candidate's party
  rng: Rng;
  /** Presidential general: each state's share of the campaign's attention (sums to 1). */
  stateWeights?: readonly number[];
}

const DECAY = { persuasion: 0.985, debate: 0.93, scandal: 0.965, endorse: 0.995, momentum: 0.95 };

/** One day of a campaign: money in and out, recognition, persuasion; shocks decay. */
export function stepCampaign(c: CampaignState, t: CampaignTraits, x: DayContext): void {
  if (c.withdrawn) return;
  const urgency = 1 / (1 + Math.max(0, x.daysLeft) / 45);                  // spending and attention rise toward the election
  const raise = RAISE[c.office] * (0.25 + 1.5 * t.fundraising) * (t.incumbent ? 1.6 : 1) * (0.4 + 1.2 * x.viability) * (1 + 0.25 * x.mood) * (0.5 + urgency)
    * Math.exp(x.rng.normal(0, 0.35));
  c.cash += raise; c.raised += raise;
  const spend = Math.min(c.cash, c.cash * (0.004 + 0.06 * urgency * urgency) + 0.2 * raise);
  c.cash -= spend; c.spent += spend;
  const intensity = Math.log1p(spend / SPEND_SCALE[c.office]);           // diminishing returns
  const skill = 0.5 + t.campaign;
  c.persuasion = c.persuasion * DECAY.persuasion + 0.0012 * skill * intensity;
  if (c.byState && x.stateWeights) for (let s = 0; s < c.byState.length; s++) c.byState[s] = c.byState[s]! * DECAY.persuasion + 0.0015 * skill * Math.log1p((spend * (x.stateWeights[s] ?? 0)) / (SPEND_SCALE.president / 25));
  c.recognition = Math.min(0.98, c.recognition + (1 - c.recognition) * (0.0015 + 0.004 * intensity + 0.01 * urgency * (c.primary ? 0.5 : 1)));
  c.debate *= DECAY.debate; c.scandal *= DECAY.scandal; c.endorse *= DECAY.endorse; c.momentum *= DECAY.momentum;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * The candidate's campaign valence relative to the field (utility units), optionally in one state for the
 * presidential general. Persuasion counts relative to the field's average, so equal campaigns cancel.
 */
export function valenceOf(c: CampaignState, field: readonly CampaignState[], state?: number): number {
  const live = field.filter((f) => !f.withdrawn);
  const avg = (sel: (f: CampaignState) => number) => (live.length ? live.reduce((a, f) => a + sel(f), 0) / live.length : 0);
  const pers = c.persuasion - avg((f) => f.persuasion);
  const st = state !== undefined && c.byState ? c.byState[state]! - avg((f) => f.byState?.[state] ?? 0) : 0;
  const shocks = c.debate + c.scandal + c.endorse + c.momentum;
  return clamp(pers, -0.05, 0.05) + clamp(st, -0.04, 0.04) + clamp(shocks, -0.12, 0.12) + clamp(c.viability ?? 0, -0.12, 0.06);
}

/** Debate performance: skill plus noise; the shock is relative to the stage's average. */
export function debatePerformance(t: CampaignTraits, rng: Rng): number { return 0.55 * t.charisma + 0.45 * t.campaign + rng.normal(0, 0.3); }

/** Daily hazard of a scandal or gaffe, and its size (negative valence). */
export function scandalDraw(t: CampaignTraits, c: CampaignState, rng: Rng): { kind: 'scandal' | 'gaffe'; size: number } | null {
  if (c.withdrawn) return null;
  const exposure = c.office === 'president' ? 2.2 : c.office === 'us_representative' ? 0.6 : 1;
  if (rng.float() < (exposure * (1.6 - t.integrity)) / 2500) return { kind: 'scandal', size: -(0.03 + 0.06 * rng.float()) };
  if (rng.float() < (exposure * (1.2 - t.campaign)) / 700) return { kind: 'gaffe', size: -(0.008 + 0.02 * rng.float()) };
  return null;
}

/**
 * Presidential attention by state from the campaign's own view of the race (public forecast or averages):
 * electoral votes times the chance the state is close, sharpened toward the tipping states.
 */
export function voterPower(ev: readonly number[], margin: readonly number[], sd: readonly number[]): number[] {
  const w = ev.map((e, s) => e * Math.exp(-0.5 * (margin[s]! / Math.max(2, sd[s]!)) ** 2));
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / tot);
}
