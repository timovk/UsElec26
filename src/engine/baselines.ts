/** Previous comparable results and eligible voters, shared by the night's maps and the archive map. */
import { readTurnout } from '../archive/results';
import { stateRanges } from '../electorate/shards';
import type { Universe } from './universe';

/** Eligible voters by county (and state) for one election and state, from the sealed turnout record. */
export async function eligibleOf(u: Universe, electionId: number, stateIdx: number, out: { county: Record<number, number>; ballots?: Record<number, number> }): Promise<number> {
  const t = await readTurnout(u.db, electionId, stateIdx); if (!t) return 0;
  const start = ranges(u)[stateIdx]!.buStart, county = u.world.pack.bu.county;
  let sum = 0;
  for (let i = 0; i < t.eligible.length; i++) {
    const c = county[start + i]!; out.county[c] = (out.county[c] ?? 0) + t.eligible[i]!; sum += t.eligible[i]!;
    if (out.ballots) out.ballots[c] = (out.ballots[c] ?? 0) + t.ballots[i]!;
  }
  return sum;
}
let rangeCache: { pack: unknown; r: ReturnType<typeof stateRanges> } | null = null;
export const ranges = (u: Universe) => { if (rangeCache?.pack !== u.world.pack) rangeCache = { pack: u.world.pack, r: stateRanges(u.world.pack) }; return rangeCache.r; };

/** The previous comparable contest: the same office's last election, else the state's last presidential race. */
export function baselineContest(u: Universe, contestId: number): { contest_id: number; election_id: number; state_idx: number; year: number; label: string } | null {
  const c = u.db.get<{ office_id: number | null; kind: string; state_idx: number; year: number }>('SELECT office_id, kind, state_idx, year FROM contest WHERE contest_id = ?', [contestId]);
  if (!c) return null;
  const done = "status IN ('decided','certified')";
  const same = c.kind === 'pres_state'
    ? u.db.get<{ contest_id: number; election_id: number; state_idx: number; year: number; label: string }>(`SELECT contest_id, election_id, state_idx, year, label FROM contest WHERE kind = 'pres_state' AND state_idx = ? AND year < ? AND ${done} ORDER BY year DESC LIMIT 1`, [c.state_idx, c.year])
    : c.office_id !== null ? u.db.get<{ contest_id: number; election_id: number; state_idx: number; year: number; label: string }>(`SELECT contest_id, election_id, state_idx, year, label FROM contest WHERE office_id = ? AND kind IN ('general','special') AND parent_contest IS NULL AND year < ? AND ${done} ORDER BY year DESC, contest_id DESC LIMIT 1`, [c.office_id, c.year]) : undefined;
  if (same) return same;
  return u.db.get<{ contest_id: number; election_id: number; state_idx: number; year: number; label: string }>(`SELECT contest_id, election_id, state_idx, year, label FROM contest WHERE kind = 'pres_state' AND state_idx = ? AND year < ? AND ${done} ORDER BY year DESC LIMIT 1`, [c.state_idx, c.year]) ?? null;
}


/** Eligible voters and ballots of one election and state, by base unit (for any geographic rollup). */
export async function turnoutByBu(u: Universe, electionId: number, stateIdx: number): Promise<{ start: number; eligible: Float64Array; ballots: Float64Array } | null> {
  const t = await readTurnout(u.db, electionId, stateIdx); if (!t) return null;
  return { start: ranges(u)[stateIdx]!.buStart, eligible: t.eligible, ballots: t.ballots };
}
