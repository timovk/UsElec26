/**
 * Legislation (docs/architecture/03-simulation-architecture.md §3.7): a major bill is a position in the issue
 * space plus a salience. Members vote by ideological distance (the bill against the status quo), party
 * pressure and their constituency's lean. The 2016 rules: a House majority; Senate cloture at 60 except for a
 * budget-reconciliation bill; the President signs or vetoes; a two-thirds override in both chambers.
 */
import type { Rng } from '../core/rng';

export type Vec = [number, number, number];
export interface Member { personId: number; party: number; ideology: readonly number[]; /** Constituency lean (points of margin, D+). */ lean: number }
export interface Bill { position: Vec; salience: number; topic: string; title: string; reconciliation: boolean; sponsorParty: number }
export interface Vote { personId: number; yea: boolean }

const dist2 = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + (x - b[i]!) ** 2, 0);

/** How a member votes on moving policy from the status quo `q` to the bill's position. */
export function memberVote(m: Member, bill: Bill, q: readonly number[], dParty: readonly number[], r: Rng): boolean {
  const policy = 2.2 * (dist2(m.ideology, q) - dist2(m.ideology, bill.position));
  // Party pressure: the sponsoring party's whips push for the bill, the other party's against it (a polarized era).
  const pressure = m.party === bill.sponsorParty ? 1.6 : m.party === 1 || m.party === 2 ? -1.7 : 0;
  // Constituency: a bill that moves policy toward the Democratic platform is easier for members from Democratic-leaning seats.
  const toward = bill.position.reduce((s, x, i) => s + (x - q[i]!) * dParty[i]!, 0);
  const constituency = 0.03 * m.lean * Math.sign(toward) * Math.min(1, Math.abs(toward) * 2);
  const u = policy + pressure + constituency;
  return r.float() < 1 / (1 + Math.exp(-2.2 * u));
}

export function rollCall(members: Member[], bill: Bill, q: readonly number[], dParty: readonly number[], r: Rng): { votes: Vote[]; yea: number; nay: number } {
  const votes = members.map((m) => ({ personId: m.personId, yea: memberVote(m, bill, q, dParty, r) }));
  const yea = votes.filter((v) => v.yea).length;
  return { votes, yea, nay: votes.length - yea };
}

/** The President signs a bill that improves on the status quo from his position (or a very popular one). */
export function presidentSigns(ideology: readonly number[], bill: Bill, q: readonly number[], sameParty: boolean): boolean {
  if (sameParty) return true;
  return dist2(ideology, bill.position) + 0.15 * bill.salience < dist2(ideology, q);
}

const TOPICS: { axis: number; sign: 1 | -1; topic: string; names: string[] }[] = [
  { axis: 0, sign: 1, topic: 'economy', names: ['Infrastructure and Jobs', 'Working Families', 'Public Investment', 'Health Coverage Expansion', 'Wage Fairness'] },
  { axis: 0, sign: -1, topic: 'taxes', names: ['Tax Relief and Growth', 'Regulatory Reform', 'Spending Restraint', 'Small Business Freedom', 'Balanced Budget'] },
  { axis: 1, sign: 1, topic: 'rights', names: ['Equal Opportunity', 'Voting Access', 'Civil Liberties', 'Criminal Justice Reform', 'Family Leave'] },
  { axis: 1, sign: -1, topic: 'values', names: ['Community Safety', 'Religious Liberty', 'Parental Rights', 'Law Enforcement Support', 'Traditional Values'] },
  { axis: 2, sign: 1, topic: 'institutions', names: ['Trade Partnership', 'Climate Resilience', 'Government Accountability', 'Science and Research', 'Global Health Security'] },
  { axis: 2, sign: -1, topic: 'sovereignty', names: ['Border Security', 'Domestic Manufacturing', 'Energy Independence', 'National Sovereignty', 'American Workers First'] },
];

/**
 * The majority's next major bill: a position between its platform and what can pass, along the axis the
 * majority cares most about, with a fictional name.
 */
export function draftBill(r: Rng, majorityPlatform: readonly number[], q: readonly number[], sponsorParty: number, year: number, reconciliation: boolean): Bill {
  const dir = majorityPlatform.map((x, i) => x - q[i]!);
  const weights = dir.map((d) => Math.abs(d) + 0.05);
  const axis = reconciliation ? 0 : r.weighted(weights);
  const position = q.map((x, i) => x + (i === axis ? dir[i]! * r.range(0.35, 0.8) : dir[i]! * r.range(0, 0.15))) as Vec;
  const sign = Math.sign(position[axis]! - q[axis]!) >= 0 ? 1 : -1;
  const t = TOPICS.find((x) => x.axis === axis && x.sign === sign)!;
  const name = t.names[r.int(t.names.length)]!;
  const salience = reconciliation ? r.range(0.6, 1) : r.range(0.2, 1);
  return { position, salience, topic: reconciliation ? 'budget' : t.topic, title: reconciliation ? `Budget Reconciliation Act of ${year}` : `${name} Act of ${year}`, reconciliation, sponsorParty };
}
