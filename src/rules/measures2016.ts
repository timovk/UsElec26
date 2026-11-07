/**
 * Ballot measures (Phase 7.3): each state's law of January 1, 2016 on statewide measures — which kinds it allows
 * (initiated statutes and constitutional amendments, veto referendums, measures referred by the legislature), the
 * vote a measure needs, how measures are numbered — and how active each state's ballot is (expected measures per
 * election, from the order of magnitude of 2006–2015). Compiled from NCSL and Ballotpedia summaries of the state
 * constitutions and election codes (developer knowledge); the activity levels are estimates.
 *
 * The topics measures are written about are fictional in their particulars and generic in kind: each is a
 * direction in the electorate's issue space (economic, social, orientation), how readily parties take sides on
 * it, how prominent it is, and — for election-law topics only — the change in the state's election law if it
 * passes. Nothing from the real world's measures after 2016 is imported: every universe writes its own.
 */

/** The vote a measure needs. */
export type Threshold =
  | { kind: 'majority' }                                   // more yes than no votes
  | { kind: 'votes'; share: number }                       // yes ≥ share of the votes on the question (Florida 60%)
  | { kind: 'ballots'; share: number }                     // yes ≥ share of every ballot cast in the election (Minnesota, Wyoming)
  | { kind: 'majorityAndBallots'; share: number }          // a majority, and yes ≥ share of the ballots cast (Massachusetts 30%, Nebraska 35%)
  | { kind: 'votesOrBallots'; votes: number; ballots: number }; // Illinois: 60% of the votes on it, or a majority of the ballots cast

export type MeasureKind = 'initiative_statute' | 'initiative_amendment' | 'veto_referendum' | 'legislative_amendment' | 'legislative_statute' | 'bond';
export const MEASURE_KIND_LABEL: Record<MeasureKind, string> = {
  initiative_statute: 'Initiated statute', initiative_amendment: 'Initiated constitutional amendment', veto_referendum: 'Veto referendum',
  legislative_amendment: 'Legislatively referred constitutional amendment', legislative_statute: 'Legislatively referred statute', bond: 'Bond issue',
};
export const isInitiative = (k: MeasureKind) => k === 'initiative_statute' || k === 'initiative_amendment';

export interface StateMeasureRules {
  /** Citizen initiatives: statutes, constitutional amendments; signatures needed as a share of the last governor's vote (approximate). */
  initiative: { statute: boolean; amendment: boolean; signatures: number } | null;
  vetoReferendum: boolean;
  /** The legislature refers constitutional amendments to the voters (all but Delaware). */
  referrals: boolean;
  /** Expected measures per even-year general election (initiatives, referrals) and per odd-year November election. */
  activity: { initiative: number; referral: number; odd?: number };
  /** The vote needed: for constitutional amendments, for initiatives, otherwise a majority. */
  amendmentThreshold?: Threshold; initiativeThreshold?: Threshold;
  /**
   * Numbering: a label prefix for citizens' measures, for initiated statutes when the state numbers them apart
   * (Colorado's Propositions beside its Amendments), and for referrals; for continuing series, the 2016 starting
   * number (else 1 each election). Series with the same prefix and start share one numbering.
   */
  name: { initiative: string; referral: string; statute?: string; start?: { initiative?: number; referral?: number; statute?: number } };
}

const I = (statute: boolean, amendment: boolean, signatures = 0.08) => ({ statute, amendment, signatures });
const N = (initiative: string, referral = initiative, start?: { initiative?: number; referral?: number; statute?: number }, statute?: string) => ({ initiative, referral, ...(statute ? { statute } : {}), ...(start ? { start } : {}) });

export const MEASURE_RULES_2016: Record<string, StateMeasureRules> = {
  AL: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 6 }, name: N('Amendment') },
  AK: { initiative: I(true, false, 0.1), vetoReferendum: true, referrals: true, activity: { initiative: 1, referral: 0.5 }, name: N('Ballot Measure') },
  AZ: { initiative: I(true, true, 0.1), vetoReferendum: true, referrals: true, activity: { initiative: 2, referral: 1.5 }, name: N('Proposition', 'Proposition', { initiative: 205, referral: 123 }) },
  AR: { initiative: I(true, true, 0.08), vetoReferendum: true, referrals: true, activity: { initiative: 1.5, referral: 1.5 }, name: N('Issue') },
  CA: { initiative: I(true, true, 0.05), vetoReferendum: true, referrals: true, activity: { initiative: 8, referral: 3 }, name: N('Proposition', 'Proposition', { initiative: 51, referral: 51 }) },
  CO: { initiative: I(true, true, 0.05), vetoReferendum: true, referrals: true, activity: { initiative: 4, referral: 2, odd: 1.3 }, name: N('Amendment', 'Referred Measure', { initiative: 69, statute: 106 }, 'Proposition') },
  CT: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.5 }, name: N('Question') },
  DE: { initiative: null, vetoReferendum: false, referrals: false, activity: { initiative: 0, referral: 0 }, name: N('Question') },
  DC: { initiative: I(true, false, 0.05), vetoReferendum: true, referrals: false, activity: { initiative: 0.3, referral: 0 }, name: N('Initiative', 'Initiative', { initiative: 72 }) },
  FL: { initiative: I(false, true, 0.08), vetoReferendum: false, referrals: true, activity: { initiative: 1.5, referral: 2.5 }, amendmentThreshold: { kind: 'votes', share: 0.6 }, name: N('Amendment') },
  GA: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 3 }, name: N('Amendment') },
  HI: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 1 }, amendmentThreshold: { kind: 'ballots', share: 0.5 }, name: N('Question') },
  ID: { initiative: I(true, false, 0.06), vetoReferendum: true, referrals: true, activity: { initiative: 0.5, referral: 1 }, name: N('Proposition') },
  IL: { initiative: I(false, true, 0.08), vetoReferendum: false, referrals: true, activity: { initiative: 0.1, referral: 1 }, amendmentThreshold: { kind: 'votesOrBallots', votes: 0.6, ballots: 0.5 }, name: N('Amendment') },
  IN: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.5 }, name: N('Public Question') },
  IA: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.4 }, name: N('Amendment') },
  KS: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.8 }, name: N('Amendment') },
  KY: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.6 }, name: N('Amendment') },
  LA: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 4, odd: 3 }, name: N('Amendment') },
  ME: { initiative: I(true, false, 0.1), vetoReferendum: true, referrals: true, activity: { initiative: 3, referral: 1.5, odd: 4 }, name: N('Question') },
  MD: { initiative: null, vetoReferendum: true, referrals: true, activity: { initiative: 0, referral: 1.5 }, name: N('Question') },
  MA: { initiative: I(true, true, 0.03), vetoReferendum: true, referrals: true, activity: { initiative: 3, referral: 0.3 }, initiativeThreshold: { kind: 'majorityAndBallots', share: 0.3 }, name: N('Question') },
  MI: { initiative: I(true, true, 0.08), vetoReferendum: true, referrals: true, activity: { initiative: 1.5, referral: 0.5 }, name: N('Proposal') },
  MN: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.4 }, amendmentThreshold: { kind: 'ballots', share: 0.5 }, name: N('Amendment') },
  MS: { initiative: I(false, true, 0.12), vetoReferendum: false, referrals: true, activity: { initiative: 0.4, referral: 0.3 }, initiativeThreshold: { kind: 'majorityAndBallots', share: 0.4 }, name: N('Initiative Measure', 'Amendment') },
  MO: { initiative: I(true, true, 0.08), vetoReferendum: true, referrals: true, activity: { initiative: 2, referral: 1.5 }, name: N('Amendment', 'Amendment', undefined, 'Proposition') },
  MT: { initiative: I(true, true, 0.05), vetoReferendum: true, referrals: true, activity: { initiative: 1.5, referral: 1 }, name: N('CI-', 'LR-', { initiative: 116, statute: 182, referral: 126 }, 'I-') },
  NE: { initiative: I(true, true, 0.07), vetoReferendum: true, referrals: true, activity: { initiative: 0.7, referral: 1 }, initiativeThreshold: { kind: 'majorityAndBallots', share: 0.35 }, name: N('Initiative', 'Amendment', { initiative: 427 }) },
  NV: { initiative: I(true, true, 0.1), vetoReferendum: true, referrals: true, activity: { initiative: 2, referral: 1.5 }, name: N('Question') },
  NH: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.5 }, amendmentThreshold: { kind: 'votes', share: 2 / 3 }, name: N('Question') },
  NJ: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 1.5, odd: 1.5 }, name: N('Public Question') },
  NM: { initiative: null, vetoReferendum: true, referrals: true, activity: { initiative: 0, referral: 2 }, name: N('Amendment', 'Question') },
  NY: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.5, odd: 1.5 }, name: N('Proposal') },
  NC: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.8 }, name: N('Amendment') },
  ND: { initiative: I(true, true, 0.04), vetoReferendum: true, referrals: true, activity: { initiative: 2, referral: 1.5 }, name: N('Measure') },
  OH: { initiative: I(true, true, 0.1), vetoReferendum: true, referrals: true, activity: { initiative: 1, referral: 0.8, odd: 2 }, name: N('Issue') },
  OK: { initiative: I(true, true, 0.08), vetoReferendum: true, referrals: true, activity: { initiative: 1.5, referral: 2.5 }, name: N('State Question', 'State Question', { initiative: 776, referral: 776 }) },
  OR: { initiative: I(true, true, 0.06), vetoReferendum: true, referrals: true, activity: { initiative: 4, referral: 2 }, name: N('Measure', 'Measure', { initiative: 94, referral: 94 }) },
  PA: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.5, odd: 0.5 }, name: N('Question') },
  RI: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 1 }, name: N('Question') },
  SC: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.6 }, name: N('Amendment') },
  SD: { initiative: I(true, true, 0.05), vetoReferendum: true, referrals: true, activity: { initiative: 3, referral: 2 }, name: N('Amendment', 'Amendment', { statute: 22 }, 'Initiated Measure') },
  TN: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.3 }, amendmentThreshold: { kind: 'ballots', share: 0.5 }, name: N('Amendment') },
  TX: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.3, odd: 8 }, name: N('Proposition') },
  UT: { initiative: I(true, false, 0.1), vetoReferendum: true, referrals: true, activity: { initiative: 0.8, referral: 2 }, name: N('Proposition', 'Amendment') },
  VT: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.1 }, name: N('Proposal') },
  VA: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 1 }, name: N('Question') },
  WA: { initiative: I(true, false, 0.08), vetoReferendum: true, referrals: true, activity: { initiative: 3, referral: 1, odd: 3 }, name: N('Initiative Measure', 'Referendum Measure', { initiative: 1433, referral: 88 }) },
  WV: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.5 }, name: N('Amendment') },
  WI: { initiative: null, vetoReferendum: false, referrals: true, activity: { initiative: 0, referral: 0.5 }, name: N('Question') },
  WY: { initiative: I(true, false, 0.15), vetoReferendum: true, referrals: true, activity: { initiative: 0.2, referral: 1 }, initiativeThreshold: { kind: 'ballots', share: 0.5 }, amendmentThreshold: { kind: 'ballots', share: 0.5 }, name: N('Initiative', 'Amendment') },
};

/** The vote a measure of a kind needs in a state. */
export function thresholdFor(usps: string, kind: MeasureKind): Threshold {
  const r = MEASURE_RULES_2016[usps];
  if (!r) return { kind: 'majority' };
  if (isInitiative(kind) && r.initiativeThreshold) return r.initiativeThreshold;
  if ((kind === 'initiative_amendment' || kind === 'legislative_amendment') && r.amendmentThreshold) return r.amendmentThreshold;
  return { kind: 'majority' };
}

/** Whether yes votes pass a measure: yes and no votes on it, and every ballot cast in the election. */
export function passes(t: Threshold, yes: number, no: number, ballots: number): boolean {
  const votes = yes + no;
  switch (t.kind) {
    case 'majority': return yes > no;
    case 'votes': return votes > 0 && yes >= t.share * votes;
    case 'ballots': return ballots > 0 && yes > t.share * ballots;
    case 'majorityAndBallots': return yes > no && ballots > 0 && yes >= t.share * ballots;
    case 'votesOrBallots': return (votes > 0 && yes >= t.votes * votes) || (ballots > 0 && yes > t.ballots * ballots);
  }
}

/** The rule in words ("60% of the votes on the question"). */
export function thresholdText(t: Threshold): string {
  const pct = (x: number) => `${Math.round(100 * x)}%`;
  switch (t.kind) {
    case 'majority': return 'a majority of the votes on the question';
    case 'votes': return `${pct(t.share)} of the votes on the question`;
    case 'ballots': return `a majority of every ballot cast in the election (blank counts as no)`;
    case 'majorityAndBallots': return `a majority, with yes votes at least ${pct(t.share)} of the ballots cast`;
    case 'votesOrBallots': return `${pct(t.votes)} of the votes on the question, or a majority of the ballots cast`;
  }
}

/**
 * Night-call weights over (yes, no, blank): a measure passes when Σ weight × votes ≥ 0 (for the rules the desk can
 * call; a combined rule is called on its majority part and decided exactly at certification).
 */
export function passWeights(t: Threshold): [number, number, number] | null {
  switch (t.kind) {
    case 'majority': case 'majorityAndBallots': return null;
    case 'votes': return [2 * (1 - t.share), -2 * t.share, 0];
    case 'ballots': return [2 * (1 - t.share), -2 * t.share, -2 * t.share];
    case 'votesOrBallots': return [2 * (1 - t.votes), -2 * t.votes, 0];
  }
}

// ---- Topics ------------------------------------------------------------------------------------------------

/** An election-law change a measure makes if it passes (Phase 7.1's law framework). */
export type LawEffect = 'rcv' | 'top_four' | 'top_two' | 'open_primaries' | 'repeal_rcv';

export interface Topic {
  key: string;
  /** What a yes vote does. */
  title: string;
  /**
   * Direction in issue space (economic, social, orientation) that a yes vote moves policy toward, in the senses of
   * Congress's bill topics (government/congress.ts): + economic is public investment, coverage and wages, − is
   * tax relief and spending restraint; + social is rights and liberties, − is safety and traditional values;
   * + orientation is institutions, accountability and reform, − is sovereignty. Which party stands where is the
   * universe's own (its platforms), so either party may be on either side.
   */
  dir: [number, number, number];
  /** Prominence (0–1): campaigns, attention, how many voters skip it. */
  salience: number;
  /** How readily the parties take sides (0–1). */
  partisan: number;
  /** Baseline lean of voters toward yes in logit (bonds and housekeeping amendments pass more easily). */
  lean: number;
  /** Which kinds of measure carry it: initiatives, legislative referrals, veto referendums. */
  by: ('initiative' | 'referral' | 'veto')[];
  weight: number;
  effect?: LawEffect;
  /** Amendment or statute when it comes by initiative (constitutional amendment if the state allows only that). */
  amendment?: boolean;
  bond?: boolean;
  /**
   * A one-time reform: once it passes in a state it is not proposed there again (other topics can return eight
   * years after passing: a new minimum wage, a new bond). `had2016` lists the states where it was already law
   * on January 1, 2016, so it is never proposed there.
   */
  once?: boolean;
  had2016?: readonly string[];
}

const T = (key: string, title: string, dir: [number, number, number], salience: number, partisan: number, by: Topic['by'], weight: number, extra: Partial<Topic> = {}): Topic =>
  ({ key, title, dir, salience, partisan, lean: 0, by, weight, ...extra });

export const TOPICS: readonly Topic[] = [
  // Economic.
  T('min_wage', 'Raise the state minimum wage in steps over four years', [1, 0, 0], 0.75, 0.6, ['initiative'], 1.0),
  T('paid_leave', 'Require employers to provide paid sick leave', [0.9, 0.2, 0], 0.55, 0.55, ['initiative'], 0.5, { once: true, had2016: ['CA', 'CT', 'MA', 'OR', 'DC'] }),
  T('top_tax', 'Add an income-tax surcharge on the highest incomes for schools', [1, 0, -0.1], 0.7, 0.75, ['initiative'], 0.6),
  T('tax_cut', 'Cut the state income tax rate and cap its growth', [-1, 0, 0], 0.65, 0.75, ['initiative', 'referral'], 0.6, { amendment: true }),
  T('spending_cap', 'Limit state spending growth to population and inflation', [-0.9, 0, 0.3], 0.5, 0.6, ['initiative', 'referral'], 0.4, { amendment: true }),
  T('property_tax', 'Expand the homestead property-tax exemption', [-0.5, 0, 0], 0.4, 0.2, ['referral', 'initiative'], 0.8, { lean: 0.6, amendment: true }),
  T('right_to_work', 'Bar contracts that require union membership or fees', [-1, -0.2, 0], 0.6, 0.85, ['referral', 'initiative'], 0.3, { amendment: true, once: true }),
  T('medicaid', 'Expand public health coverage to low-income adults', [0.9, 0.1, 0], 0.65, 0.7, ['initiative'], 0.5, { once: true, had2016: ['AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'HI', 'IL', 'IN', 'IA', 'KY', 'MD', 'MA', 'MI', 'MN', 'MT', 'NV', 'NH', 'NJ', 'NM', 'NY', 'ND', 'OH', 'OR', 'PA', 'RI', 'VT', 'WA', 'WV'] }),
  T('renewables', 'Require utilities to draw half their power from renewable sources', [0.6, 0.3, 0.3], 0.55, 0.55, ['initiative'], 0.5, { once: true }),
  T('fuel_tax', 'Raise the fuel tax for road and bridge repairs', [0.6, 0, -0.2], 0.45, 0.35, ['referral', 'veto'], 0.5),
  T('bond_infra', 'Authorize a bond for roads, water systems and public buildings', [0.4, 0, -0.2], 0.3, 0.15, ['referral'], 1.0, { lean: 0.5, bond: true }),
  T('bond_schools', 'Authorize a bond for school and college construction', [0.5, 0.1, -0.2], 0.35, 0.2, ['referral'], 0.8, { lean: 0.55, bond: true }),
  T('rainy_day', 'Raise the cap on the budget reserve fund', [-0.3, 0, -0.2], 0.15, 0.05, ['referral'], 0.6, { lean: 0.7 }),
  T('labor_law', 'Uphold the new law limiting public-employee bargaining', [-0.9, -0.1, 0], 0.6, 0.85, ['veto'], 0.6),
  // Social.
  T('marijuana', 'Legalize and tax marijuana for adults', [0, 1, 0.3], 0.85, 0.35, ['initiative'], 1.2, { once: true, had2016: ['AK', 'CO', 'OR', 'WA', 'DC'] }),
  T('med_marijuana', 'Allow marijuana for medical use', [0, 0.8, 0.2], 0.6, 0.2, ['initiative'], 0.6, { lean: 0.6, once: true, had2016: ['AK', 'AZ', 'CA', 'CO', 'CT', 'DE', 'HI', 'IL', 'ME', 'MD', 'MA', 'MI', 'MN', 'MT', 'NV', 'NH', 'NJ', 'NM', 'NY', 'OR', 'RI', 'VT', 'WA', 'DC'] }),
  T('background_checks', 'Require background checks on private gun sales', [0.2, 0.8, -0.1], 0.75, 0.7, ['initiative'], 0.5, { once: true, had2016: ['CA', 'CO', 'CT', 'DE', 'HI', 'IL', 'MD', 'MA', 'NJ', 'NY', 'OR', 'RI', 'WA', 'DC'] }),
  T('gun_rights', 'Add a strict-scrutiny right to bear arms to the constitution', [-0.2, -0.9, 0], 0.5, 0.7, ['referral'], 0.3, { amendment: true, lean: 0.3, once: true, had2016: ['AL', 'LA', 'MO'] }),
  T('death_penalty', 'Repeal the death penalty, replacing it with life without parole', [0, 0.9, 0.2], 0.6, 0.55, ['initiative'], 0.3, { once: true, had2016: ['AK', 'CT', 'HI', 'IL', 'IA', 'ME', 'MD', 'MA', 'MI', 'MN', 'NJ', 'NM', 'NY', 'ND', 'RI', 'VT', 'WV', 'WI', 'DC'] }),
  T('abortion_rights', 'Protect the right to abortion in the state constitution', [0, 1, 0], 0.8, 0.8, ['initiative'], 0.35, { amendment: true, once: true }),
  T('abortion_limits', 'Ban most abortions after 20 weeks', [0, -1, 0], 0.75, 0.8, ['referral', 'initiative'], 0.3, { amendment: true, once: true }),
  T('end_of_life', 'Allow medical aid in dying for terminally ill adults', [0, 0.8, 0.3], 0.55, 0.4, ['initiative'], 0.3, { once: true, had2016: ['CA', 'MT', 'OR', 'VT', 'WA'] }),
  T('sentencing', 'Reduce sentences for drug possession and fund treatment', [0.2, 0.7, 0.2], 0.5, 0.45, ['initiative'], 0.45),
  T('gambling', 'Allow new casinos, with their taxes going to education', [0, 0.5, 0.2], 0.45, 0.15, ['initiative', 'referral'], 0.5),
  T('hunting', 'Guarantee the right to hunt and fish', [-0.2, -0.6, -0.2], 0.25, 0.3, ['referral'], 0.4, { amendment: true, lean: 0.7, once: true, had2016: ['AL', 'AR', 'GA', 'ID', 'KY', 'LA', 'MN', 'MS', 'MT', 'NE', 'ND', 'OK', 'SC', 'TN', 'TX', 'VT', 'VA', 'WI', 'WY'] }),
  T('animal_welfare', 'Ban the sale of eggs from caged hens', [0.2, 0.5, 0.3], 0.4, 0.25, ['initiative'], 0.3, { once: true, had2016: ['CA'] }),
  // Orientation (trust in institutions, how the state governs itself).
  T('redistricting', 'Give redistricting to an independent citizens commission', [0, 0, 0.9], 0.5, 0.4, ['initiative'], 0.5, { amendment: true, once: true, had2016: ['AK', 'AZ', 'CA', 'HI', 'ID', 'IA', 'MT', 'NJ', 'WA'] }),
  T('term_limits', 'Limit legislators to twelve years in office', [-0.3, 0, -0.6], 0.45, 0.2, ['initiative', 'referral'], 0.3, { amendment: true, lean: 0.4, once: true, had2016: ['AZ', 'AR', 'CA', 'CO', 'FL', 'LA', 'ME', 'MI', 'MO', 'MT', 'NE', 'NV', 'OH', 'OK', 'SD'] }),
  T('voter_id', 'Require photo identification to vote', [-0.3, -0.4, -0.6], 0.65, 0.8, ['referral', 'initiative'], 0.35, { amendment: true }),
  T('campaign_finance', 'Limit campaign contributions and require disclosure of political spending', [0.3, 0, 0.8], 0.45, 0.35, ['initiative'], 0.45),
  T('ethics', 'Create an independent ethics commission for state officials', [0, 0, 0.8], 0.3, 0.2, ['initiative', 'referral'], 0.4, { lean: 0.5 }),
  T('housekeeping', 'Update outdated provisions of the state constitution', [0, 0, 0.3], 0.1, 0.05, ['referral'], 1.0, { amendment: true, lean: 0.8 }),
  T('judges', 'Raise the mandatory retirement age for judges', [0, -0.1, 0.4], 0.15, 0.1, ['referral'], 0.4, { amendment: true, lean: -0.1 }),
  T('english', 'Make English the official language of the state', [-0.1, -0.5, -0.8], 0.4, 0.5, ['referral', 'initiative'], 0.15, { amendment: true, once: true, had2016: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'MA', 'MS', 'MO', 'MT', 'NE', 'NH', 'NC', 'ND', 'OK', 'SC', 'SD', 'TN', 'UT', 'VA', 'WY'] }),
  // Election law (the only measures that change the simulation).
  T('rcv', 'Adopt ranked-choice voting for primaries and general elections', [0, 0.1, 0.9], 0.55, 0.35, ['initiative'], 0.12, { effect: 'rcv' }),
  T('top_four', 'Replace party primaries with a top-four primary and ranked-choice general elections', [0, 0, 0.9], 0.55, 0.4, ['initiative'], 0.07, { effect: 'top_four' }),
  T('top_two', 'Replace party primaries with a top-two primary open to every candidate', [0, 0, 0.8], 0.5, 0.4, ['initiative'], 0.06, { effect: 'top_two' }),
  T('open_primaries', 'Open party primaries to every voter', [0, 0, 0.7], 0.45, 0.3, ['initiative'], 0.07, { effect: 'open_primaries' }),
  T('repeal_rcv', 'Repeal ranked-choice voting and restore plurality elections', [0, -0.1, -0.8], 0.55, 0.45, ['initiative', 'referral'], 0.3, { effect: 'repeal_rcv' }),
];
