/**
 * Election law over time (Phase 7.1): each state's rules are the real legal baseline of January 1, 2016
 * (`ELECTION_RULES_2016`) plus the changes enacted in the universe since, each with an effective date. A change
 * applies only to elections held on or after its effective date — never retroactively. Changes come from
 * simulated law (state legislative sessions now; ballot measures from Phase 7.3), never from the real world's
 * later history: what Maine or Alaska did after 2016 is not imported (docs/architecture/03 §3.4, 06 §6.6).
 */
import type { DayNumber } from '../core/time';
import { ELECTION_RULES_2016, type PrimaryType, type StateElectionRules } from './elections2016';

/** Where ranked-choice voting applies. Presidential contests are never ranked (they are decided by the Electoral College in Phase 7.1). */
export interface RcvRule {
  /** Party primaries for every office but President. */
  primaries: boolean;
  /** General elections: none, federal offices (U.S. Senate and House) or every office but President and Governor's running mate. */
  general: 'none' | 'federal' | 'all';
}

/** The rules of one state on one day. */
export interface StateLaw extends StateElectionRules {
  rcv: RcvRule;
  /** Offices elected on a nonpartisan ballot (no party label). */
  nonpartisan: string[];
}

/** What a law changes (absent fields are left as they were). */
export interface LawChangeFields {
  primaryType?: PrimaryType;
  primaryRunoff?: StateElectionRules['primaryRunoff'];
  rcv?: Partial<RcvRule>;
  nonpartisan?: string[];
}

export interface LawChange {
  id: number;
  stateIdx: number;
  /** When it was enacted (simulation minutes) and from which day it applies (inclusive). */
  enacted: number; effective: DayNumber;
  source: 'legislature' | 'initiative' | 'scenario';
  change: LawChangeFields;
  summary: string;
}

/** The 2016 baseline: ranked-choice voting nowhere; Nebraska's unicameral legislature nonpartisan. */
export function baselineLaw(usps: string): StateLaw {
  const r = ELECTION_RULES_2016[usps]!;
  return { ...r, rcv: { primaries: false, general: 'none' }, nonpartisan: usps === 'NE' ? ['state_senator'] : [] };
}

function apply(law: StateLaw, c: LawChangeFields): StateLaw {
  return {
    ...law,
    ...(c.primaryType !== undefined ? { primaryType: c.primaryType } : {}),
    ...(c.primaryRunoff !== undefined ? { primaryRunoff: c.primaryRunoff } : {}),
    ...(c.rcv ? { rcv: { ...law.rcv, ...c.rcv } } : {}),
    ...(c.nonpartisan ? { nonpartisan: [...c.nonpartisan] } : {}),
  };
}

/** Every state's law: the baseline plus dated changes. */
export class ElectionLaw {
  private changes: LawChange[] = [];
  private cache = new Map<string, StateLaw>();
  constructor(private readonly usps: readonly string[], changes: LawChange[] = []) { for (const c of changes) this.add(c); }

  /** The rules in force in a state on a day (an election held that day follows them). */
  on(stateIdx: number, day: DayNumber): StateLaw {
    const key = `${stateIdx}:${day}`;
    let law = this.cache.get(key);
    if (!law) {
      law = baselineLaw(this.usps[stateIdx]!);
      for (const c of this.changes) if (c.stateIdx === stateIdx && c.effective <= day) law = apply(law, c.change);
      if (this.cache.size > 4000) this.cache.clear();
      this.cache.set(key, law);
    }
    return law;
  }

  /** Add a change (in enactment order; ties apply in id order). */
  add(c: LawChange): void {
    this.changes.push(c);
    this.changes.sort((a, b) => a.effective - b.effective || a.id - b.id);
    this.cache.clear();
  }

  /** Changes of a state (or all), in effective-date order. */
  history(stateIdx?: number): LawChange[] { return this.changes.filter((c) => stateIdx === undefined || c.stateIdx === stateIdx); }
  get nextId(): number { return this.changes.reduce((m, c) => Math.max(m, c.id), 0) + 1; }
}

/** Whether a general-election contest for an office is ranked under a state's law. */
export function rcvGeneral(law: StateLaw, officeKind: string): boolean {
  if (officeKind === 'president' || officeKind === 'vice_president') return false;
  if (law.primaryType === 'top_four') return true; // a top-four primary feeds a ranked general (the Alaska model)
  if (law.rcv.general === 'all') return true;
  return law.rcv.general === 'federal' && (officeKind === 'us_senator' || officeKind === 'us_representative');
}

/**
 * The counting method of a general-election contest:
 *  - `jungle`: every candidate on one November ballot, a runoff without a majority (Louisiana);
 *  - `rcv`: ranked-choice (instant runoff) — after a top-four primary, or where the law ranks general elections;
 *  - `top_two_general`: the two candidates from a top-two primary, plurality;
 *  - `majority`: a runoff without a majority (Georgia);
 *  - `plurality` otherwise.
 */
export function generalMethod(law: StateLaw, officeKind: string): string {
  if (law.primaryType === 'jungle') return 'jungle';
  if (rcvGeneral(law, officeKind)) return 'rcv';
  if (law.primaryType === 'top_two') return 'top_two_general';
  if (law.generalRunoff) return 'majority';
  return 'plurality';
}

/** The method of a party primary: ranked where the law ranks primaries, else a runoff threshold or plurality. */
export function partyPrimaryMethod(law: StateLaw): string {
  if (law.rcv.primaries) return 'rcv';
  return law.primaryRunoff ? `runoff_${law.primaryRunoff.threshold}` : 'plurality';
}

/** Candidates who advance from an all-candidate primary (top-two or top-four), else 0 (party primaries). */
export function advancingFromPrimary(law: StateLaw): number { return law.primaryType === 'top_two' ? 2 : law.primaryType === 'top_four' ? 4 : 0; }

/** A plain-language summary of a state's election law (for the Government page). */
export function describeLaw(law: StateLaw): string[] {
  const out: string[] = [];
  const pt: Record<PrimaryType, string> = { open: 'Open party primaries', semi: 'Semi-closed party primaries', closed: 'Closed party primaries', top_two: 'Top-two primary (all candidates on one ballot; the top two advance)', top_four: 'Top-four primary (all candidates on one ballot; the top four advance to a ranked-choice general)', jungle: 'November all-candidate ballot, with a runoff when nobody wins a majority' };
  out.push(pt[law.primaryType]);
  if (law.primaryRunoff && law.primaryType !== 'jungle' && law.primaryType !== 'top_two' && law.primaryType !== 'top_four' && !law.rcv.primaries) out.push(`Primary runoff when nobody reaches ${Math.round(100 * law.primaryRunoff.threshold)}%`);
  if (law.generalRunoff && law.primaryType !== 'jungle' && law.rcv.general === 'none') out.push('General-election runoff when nobody wins a majority');
  if (law.rcv.primaries) out.push('Ranked-choice voting in party primaries');
  if (law.rcv.general === 'federal' && law.primaryType !== 'top_four') out.push('Ranked-choice voting in general elections for Congress');
  if (law.rcv.general === 'all' || law.primaryType === 'top_four') out.push('Ranked-choice voting in general elections (not for President)');
  if (law.nonpartisan.length) out.push(`Nonpartisan ballot: ${law.nonpartisan.map((k) => (k === 'state_senator' ? 'state legislature' : k.replace(/_/g, ' '))).join(', ')}`);
  return out;
}
