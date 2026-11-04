/**
 * The results archive (docs/architecture/07-historical-archive.md). Results are written once, sealed with
 * SHA-256, and never updated. Every aggregate stored here is a sum of the Base Unit (or county-part)
 * integers produced by the ballot kernel.
 */
import { ColumnTransform, crc32, decodeIntColumns, decodeJson, encodeIntColumns, encodeJson, sha256Hex } from '../core/codec';
import type { Db } from '../persistence/db';
import { N_MODES } from '../electorate/kernel';

export interface ContestResult {
  contestId: number;
  candidacyIds: number[];            // ballot order; option K-1 is the undervote
  grain: 'bu' | 'cpart';
  units: Int32Array;                 // BU ids (grain bu) or county·65536+cd keys (grain cpart)
  votes: Int32Array;                 // units × K
  rjMode: { rj: number; mode: number; votes: number[] }[];
  eligible: number;
  countyTotals: Map<number, number[]>;
  cdTotals: Map<number, number[]>;
}

export const K = (r: ContestResult) => r.candidacyIds.length + 1;

export function totalsOf(r: ContestResult): number[] {
  const k = K(r), t = new Array<number>(k).fill(0);
  for (let i = 0; i < r.votes.length; i++) t[i % k]! += r.votes[i]!;
  return t;
}

export interface PreparedContest {
  result: ContestResult; totals: number[]; blobs: { grain: string; payload: Uint8Array }[]; sha256: string;
}

export async function prepareContest(r: ContestResult): Promise<PreparedContest> {
  const k = K(r), n = r.units.length;
  const cols = [{ values: r.units, transform: ColumnTransform.Delta }];
  for (let j = 0; j < k; j++) { const c = new Int32Array(n); for (let u = 0; u < n; u++) c[u] = r.votes[u * k + j]!; cols.push({ values: c, transform: ColumnTransform.Raw }); }
  const blobs: { grain: string; payload: Uint8Array }[] = [{ grain: r.grain, payload: await encodeIntColumns(cols) }];
  if (r.rjMode.length) {
    const rows = r.rjMode;
    const rc = [{ values: rows.map((x) => x.rj), transform: ColumnTransform.Delta }, { values: rows.map((x) => x.mode), transform: ColumnTransform.Raw }];
    for (let j = 0; j < k; j++) rc.push({ values: rows.map((x) => x.votes[j]!), transform: ColumnTransform.Raw });
    blobs.push({ grain: 'rjmode', payload: await encodeIntColumns(rc) });
  }
  const totals = totalsOf(r);
  const canon = new TextEncoder().encode(JSON.stringify({ contest: r.contestId, candidacies: r.candidacyIds, totals, eligible: r.eligible }));
  const all = new Uint8Array(canon.length + blobs.reduce((a, b) => a + b.payload.length, 0));
  all.set(canon, 0); let o = canon.length; for (const b of blobs) { all.set(b.payload, o); o += b.payload.length; }
  return { result: r, totals, blobs, sha256: await sha256Hex(all) };
}

/** Write a prepared contest result as revision 0 (inside the caller's transaction). */
export function writeContest(db: Db, p: PreparedContest, time: number, kind: string, reason: string): void {
  const r = p.result, k = K(r);
  const votes = p.totals.slice(0, k - 1), valid = votes.reduce((a, b) => a + b, 0);
  const order = votes.map((v, j) => [v, j] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  order.forEach(([v, j], rank) => db.run('INSERT INTO contest_total VALUES (?,?,?,?,?,?)', [r.contestId, 0, r.candidacyIds[j]!, v, valid > 0 ? v / valid : 0, rank + 1]));
  const ballots = p.totals.reduce((a, b) => a + b, 0);
  db.run('INSERT INTO contest_turnout VALUES (?,?,?,?,?,?)', [r.contestId, 0, ballots, valid, p.totals[k - 1]!, r.eligible]);
  for (const b of p.blobs) db.run('INSERT INTO result_blob VALUES (?,?,?,?,?)', [r.contestId, 0, b.grain, b.payload, crc32(b.payload)]);
  db.run('INSERT INTO result_revision VALUES (?,?,?,?,?,?)', [r.contestId, 0, kind, time, reason, p.sha256]);
  for (const c of r.countyTotals.keys()) db.run('INSERT OR IGNORE INTO contest_geo VALUES (?,?)', [c, r.contestId]);
}

export async function decodeContestBlob(payload: Uint8Array, k: number): Promise<{ units: Float64Array; votes: Float64Array[] }> {
  const cols = await decodeIntColumns(payload);
  if (cols.length !== k + 1) throw new Error(`result blob has ${cols.length} columns, expected ${k + 1}`);
  return { units: cols[0]!, votes: cols.slice(1) };
}

// ---- Rollups ---------------------------------------------------------------------------------------
export interface StateRollup { contests: { id: number; k: number; counties: [number, number[]][]; cds: [number, number[]][] }[] }

export async function prepareRollup(results: ContestResult[]): Promise<Uint8Array> {
  const roll: StateRollup = { contests: results.map((r) => ({ id: r.contestId, k: K(r), counties: [...r.countyTotals].sort((a, b) => a[0] - b[0]), cds: [...r.cdTotals].sort((a, b) => a[0] - b[0]) })) };
  return encodeJson(roll);
}

export async function readRollup(db: Db, electionId: number, stateIdx: number): Promise<StateRollup | null> {
  const row = db.get<{ payload: Uint8Array }>('SELECT payload FROM county_rollup WHERE election_id = ? AND state_idx = ?', [electionId, stateIdx]);
  return row ? decodeJson<StateRollup>(row.payload) : null;
}

/** Per-BU eligible electorate and ballots for one state and election (for turnout analysis and audits). */
export async function prepareTurnout(buStart: number, eligible: Int32Array, ballots: Int32Array, byMode: Int32Array): Promise<Uint8Array> {
  void buStart;
  const pad = (a: ArrayLike<number>) => ({ values: Array.from(a), transform: ColumnTransform.Raw });
  const n = eligible.length;
  const modes = Array.from({ length: N_MODES }, (_, m) => { const c = new Int32Array(n); for (let i = 0; i < n; i++) c[i] = byMode[i * N_MODES + m]!; return c; });
  return encodeIntColumns([pad(eligible), pad(ballots), ...modes.map(pad)]);
}

export async function readTurnout(db: Db, electionId: number, stateIdx: number): Promise<{ eligible: Float64Array; ballots: Float64Array; byMode: Float64Array[] } | null> {
  const row = db.get<{ payload: Uint8Array }>('SELECT payload FROM election_turnout WHERE election_id = ? AND state_idx = ?', [electionId, stateIdx]);
  if (!row) return null;
  const cols = await decodeIntColumns(row.payload);
  return { eligible: cols[0]!, ballots: cols[1]!, byMode: cols.slice(2) };
}

// ---- Audit -----------------------------------------------------------------------------------------
export interface AuditFinding { check: string; ok: boolean; detail: string }

/**
 * Archive audit for one election (docs/architecture/07 §7.7): unit grain sums to totals; every unit's
 * votes + undervotes equal its ballots; ballots ≤ eligible; county rollups equal unit sums; SHA-256 seals are
 * recomputed from the stored totals and blobs and must match.
 */
export async function auditElection(db: Db, electionId: number, buState: (bu: number) => number, stateBuStart: (s: number) => number, buCounty: (bu: number) => number): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const fail = (check: string, detail: string) => findings.push({ check, ok: false, detail });
  const contests = db.all<{ contest_id: number; kind: string; state_idx: number | null }>('SELECT contest_id, kind, state_idx FROM contest WHERE election_id = ? ORDER BY contest_id', [electionId]);
  const turnoutByState = new Map<number, Awaited<ReturnType<typeof readTurnout>>>();
  let checkedUnits = 0, checkedContests = 0;
  for (const c of contests) {
    const rev = db.get<{ sha256: string }>('SELECT sha256 FROM result_revision WHERE contest_id = ? AND rev = 0', [c.contest_id]);
    if (!rev) continue;
    checkedContests++;
    const cands = db.all<{ candidacy_id: number }>('SELECT candidacy_id FROM candidacy WHERE contest_id = ? ORDER BY ballot_order', [c.contest_id]).map((x) => x.candidacy_id);
    const k = cands.length + 1;
    const blob = db.get<{ grain: string; payload: Uint8Array; crc32: number }>("SELECT grain, payload, crc32 FROM result_blob WHERE contest_id = ? AND rev = 0 AND grain IN ('bu','cpart')", [c.contest_id]);
    if (!blob) { fail('Unit-grain results present', `contest ${c.contest_id} has no unit-grain blob`); continue; }
    if (crc32(blob.payload) !== blob.crc32) { fail('Blob checksums', `contest ${c.contest_id}`); continue; }
    const { units, votes } = await decodeContestBlob(blob.payload, k);
    // Seal: recompute SHA-256 over the canonical encoding and the stored blobs.
    {
      const tot = cands.map((cid) => db.value<number>('SELECT votes FROM contest_total WHERE contest_id = ? AND rev = 0 AND candidacy_id = ?', [c.contest_id, cid]) ?? 0);
      const t = db.get<{ undervotes: number; eligible: number }>('SELECT undervotes, eligible FROM contest_turnout WHERE contest_id = ? AND rev = 0', [c.contest_id]);
      const canon = new TextEncoder().encode(JSON.stringify({ contest: c.contest_id, candidacies: cands, totals: [...tot, t?.undervotes ?? 0], eligible: t?.eligible ?? 0 }));
      const blobs = db.all<{ payload: Uint8Array }>("SELECT payload FROM result_blob WHERE contest_id = ? AND rev = 0 ORDER BY CASE grain WHEN 'rjmode' THEN 1 ELSE 0 END", [c.contest_id]);
      const all = new Uint8Array(canon.length + blobs.reduce((a, b) => a + b.payload.length, 0));
      all.set(canon, 0); let o = canon.length; for (const b of blobs) { all.set(b.payload, o); o += b.payload.length; }
      if (await sha256Hex(all) !== rev.sha256) fail('Result seals', `contest ${c.contest_id}: seal mismatch (archive altered)`);
    }
    const totals = db.all<{ candidacy_id: number; votes: number }>('SELECT candidacy_id, votes FROM contest_total WHERE contest_id = ? AND rev = 0', [c.contest_id]);
    cands.forEach((cid, j) => {
      const sum = votes[j]!.reduce((a, b) => a + b, 0), stored = totals.find((t) => t.candidacy_id === cid)?.votes;
      if (sum !== stored) fail('Candidate totals = Σ units', `contest ${c.contest_id} candidacy ${cid}: ${stored} ≠ ${sum}`);
    });
    const tt = db.get<{ ballots: number; undervotes: number }>('SELECT ballots, undervotes FROM contest_turnout WHERE contest_id = ? AND rev = 0', [c.contest_id]);
    const under = votes[k - 1]!.reduce((a, b) => a + b, 0);
    if (tt && tt.undervotes !== under) fail('Undervotes = Σ units', `contest ${c.contest_id}`);
    if (blob.grain === 'bu') {
      for (let u = 0; u < units.length; u++) {
        const bu = units[u]!, s = buState(bu);
        if (!turnoutByState.has(s)) turnoutByState.set(s, await readTurnout(db, electionId, s));
        const t = turnoutByState.get(s);
        if (!t) { fail('Per-unit turnout present', `state ${s}`); break; }
        const i = bu - stateBuStart(s);
        let sum = 0; for (let j = 0; j < k; j++) sum += votes[j]![u]!;
        if (sum !== t.ballots[i]) { fail('Votes + undervotes = ballots (every unit)', `contest ${c.contest_id} BU ${bu}: ${sum} ≠ ${t.ballots[i]}`); break; }
        if (t.ballots[i]! > t.eligible[i]!) { fail('Ballots ≤ eligible', `BU ${bu}`); break; }
        checkedUnits++;
      }
      // county rollup equals unit sums
      if (c.state_idx !== null) {
        const roll = await readRollup(db, electionId, c.state_idx);
        const entry = roll?.contests.find((x) => x.id === c.contest_id);
        if (!entry) fail('County rollup present', `contest ${c.contest_id}`);
        else {
          const sums = new Map<number, number[]>();
          for (let u = 0; u < units.length; u++) { const cc = buCounty(units[u]!); const a = sums.get(cc) ?? new Array(k).fill(0); for (let j = 0; j < k; j++) a[j] += votes[j]![u]!; sums.set(cc, a); }
          for (const [cc, v] of entry.counties) if (JSON.stringify(sums.get(cc)) !== JSON.stringify(v)) { fail('County rollup = Σ units', `contest ${c.contest_id} county ${cc}`); break; }
        }
      }
    }
  }
  findings.unshift({ check: 'Contests audited', ok: true, detail: `${checkedContests} contests, ${checkedUnits.toLocaleString('en-US')} unit-contest records` });
  if (!findings.some((f) => !f.ok)) findings.push({ check: 'All archive invariants', ok: true, detail: 'ok' });
  return findings;
}
