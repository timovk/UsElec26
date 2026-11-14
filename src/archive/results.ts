/**
 * The results archive (docs/architecture/07-historical-archive.md). Results are written once, sealed with
 * SHA-256, and never updated. Every aggregate stored here is a sum of the Base Unit (or county-part)
 * integers produced by the ballot kernel.
 */
import { ColumnTransform, crc32, decodeIntColumns, decodeJson, encodeIntColumns, encodeJson, sha256Hex } from '../core/codec';
import type { Db } from '../persistence/db';
import { contestFeed, decodeNightRecord } from '../counting/record';
import { MODE_PROV } from '../counting/types';
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

/**
 * A certified revision derived from the cast ballots: certified = cast − rejected at every unit, so the unit
 * grain is not stored again. Its seal chains to the cast revision's seal and covers the totals and the
 * RJ × mode table; the audit recomputes the unit grain from the cast and rejected blobs.
 */
export async function prepareDerived(r: ContestResult, rev: number, castSha: string): Promise<PreparedContest> {
  const k = K(r);
  const blobs: { grain: string; payload: Uint8Array }[] = [];
  if (r.rjMode.length) {
    const rows = r.rjMode;
    const rc = [{ values: rows.map((x) => x.rj), transform: ColumnTransform.Delta }, { values: rows.map((x) => x.mode), transform: ColumnTransform.Raw }];
    for (let j = 0; j < k; j++) rc.push({ values: rows.map((x) => x.votes[j]!), transform: ColumnTransform.Raw });
    blobs.push({ grain: 'rjmode', payload: await encodeIntColumns(rc) });
  }
  const totals = totalsOf(r);
  return { result: r, totals, blobs, sha256: await derivedSeal(r.contestId, rev, r.candidacyIds, totals, r.eligible, castSha, blobs[0]?.payload) };
}

export async function derivedSeal(contestId: number, rev: number, candidacyIds: number[], totals: number[], eligible: number, castSha: string, rjmode?: Uint8Array): Promise<string> {
  const canon = new TextEncoder().encode(JSON.stringify({ contest: contestId, rev, candidacies: candidacyIds, totals, eligible, derivedFrom: castSha }));
  const all = new Uint8Array(canon.length + (rjmode?.length ?? 0)); all.set(canon, 0); if (rjmode) all.set(rjmode, canon.length);
  return sha256Hex(all);
}

/** Write a prepared contest result as a revision (inside the caller's transaction). */
export function writeContest(db: Db, p: PreparedContest, time: number, kind: string, reason: string, rev = 0): void {
  const r = p.result;
  writeTotals(db, r.contestId, r.candidacyIds, p.totals, r.eligible, rev);
  if (p.blobs.length) db.run(`INSERT INTO result_blob VALUES ${rowsOf(p.blobs.length, 5)}`, p.blobs.flatMap((b) => [r.contestId, rev, b.grain, b.payload, crc32(b.payload)]));
  db.run('INSERT INTO result_revision VALUES (?,?,?,?,?,?)', [r.contestId, rev, kind, time, reason, p.sha256]);
  // Counties the contest was on the ballot in, a few dozen rows to a statement.
  const counties = [...r.countyTotals.keys()];
  for (let i = 0; i < counties.length; i += 50) {
    const chunk = counties.slice(i, i + 50);
    db.run(`INSERT OR IGNORE INTO contest_geo VALUES ${rowsOf(chunk.length, 2)}`, chunk.flatMap((c) => [c, r.contestId]));
  }
}

/** `(?,?),(?,?)…`: n rows of m values (one statement instead of n; the statement cache keeps one per shape). */
const rowsOf = (n: number, m: number): string => { const row = `(${new Array<string>(m).fill('?').join(',')})`; return new Array<string>(n).fill(row).join(','); };

/** Totals rows of a revision (candidates ranked, turnout), without unit-grain blobs. */
export function writeTotals(db: Db, contestId: number, candidacyIds: number[], totals: number[], eligible: number, rev: number): void {
  const k = candidacyIds.length + 1;
  const votes = totals.slice(0, k - 1), valid = votes.reduce((a, b) => a + b, 0);
  const order = votes.map((v, j) => [v, j] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  if (order.length) db.run(`INSERT INTO contest_total VALUES ${rowsOf(order.length, 6)}`, order.flatMap(([v, j], rank) => [contestId, rev, candidacyIds[j]!, v, valid > 0 ? v / valid : 0, rank + 1]));
  // A vote-for-N contest (Phase 7.4): its counts are marks, N per ballot (the unused ones last).
  const marks = marksOfContest(db, contestId);
  db.run('INSERT INTO contest_turnout VALUES (?,?,?,?,?,?)', [contestId, rev, Math.round(totals.reduce((a, b) => a + b, 0) / marks), valid, totals[k - 1]!, eligible]);
}

/** Members a contest elects (1 before schema 10). */
export function seatsOf(db: Db, contestId: number): number {
  return db.value<number>('SELECT seats FROM contest WHERE contest_id = ?', [contestId]) ?? 1;
}

/**
 * Names each voter may mark: the seats, except under Pennsylvania's limited voting (Phase 7.6, method `limited`), where
 * a voter marks one fewer than the seats elected.
 */
export function marksOf(c: { seats?: number | null; method?: string }): number {
  const seats = c.seats ?? 1;
  return c.method === 'limited' && seats > 1 ? seats - 1 : seats;
}
/** Marks per ballot of a contest, cached (its seats and method are fixed at filing, long before any result is written). */
const marksCache = new WeakMap<Db, Map<number, number>>();
const marksOfContest = (db: Db, contestId: number): number => {
  let m = marksCache.get(db); if (!m) { m = new Map(); marksCache.set(db, m); }
  const hit = m.get(contestId); if (hit !== undefined) return hit;
  const r = db.get<{ seats: number; method: string }>('SELECT seats, method FROM contest WHERE contest_id = ?', [contestId]);
  const n = r ? marksOf(r) : 1;
  if (m.size > 50_000) m.clear();
  m.set(contestId, n);
  return n;
};

/** A totals-only revision (unofficial count, canvass) sealed over its canonical totals. */
export async function writeTotalsRevision(db: Db, contestId: number, candidacyIds: number[], totals: number[], eligible: number, rev: number, kind: string, time: number, reason: string): Promise<() => void> {
  const sha = await sha256Hex(new TextEncoder().encode(JSON.stringify({ contest: contestId, rev, candidacies: candidacyIds, totals, eligible })));
  return () => { writeTotals(db, contestId, candidacyIds, totals, eligible, rev); db.run('INSERT INTO result_revision VALUES (?,?,?,?,?,?)', [contestId, rev, kind, time, reason, sha]); };
}

/** The latest revision of a contest (0 when only the cast or Phase 2 result exists). */
export function latestRev(db: Db, contestId: number): number { return db.value<number>('SELECT MAX(rev) FROM result_revision WHERE contest_id = ?', [contestId]) ?? 0; }

// ---- Ballots cast but never counted -------------------------------------------------------------------
/** Rejected mail and provisional ballots by (unit, mode): stored with revision 0 as grain 'rejected'. */
export async function prepareRejected(units: Int32Array, modes: Uint8Array, votes: Int32Array, k: number): Promise<Uint8Array> {
  const n = units.length;
  const cols = [{ values: units, transform: ColumnTransform.Delta }, { values: modes, transform: ColumnTransform.Raw }];
  for (let j = 0; j < k; j++) { const c = new Int32Array(n); for (let u = 0; u < n; u++) c[u] = votes[u * k + j]!; cols.push({ values: c, transform: ColumnTransform.Raw }); }
  return encodeIntColumns(cols);
}

/** Certified unit results: ballots cast minus rejected ballots, per unit and per (RJ, mode). */
export async function certifiedFromCast(db: Db, contestId: number, candidacyIds: number[], unitRj: (bu: number) => number, countyOf: (bu: number) => number, cdOf: (bu: number) => number): Promise<ContestResult | null> {
  const k = candidacyIds.length + 1;
  const cast = db.get<{ payload: Uint8Array }>("SELECT payload FROM result_blob WHERE contest_id = ? AND rev = 0 AND grain = 'bu'", [contestId]);
  if (!cast) return null;
  const { units, votes } = await decodeContestBlob(cast.payload, k);
  const idx = new Map<number, number>(); for (let u = 0; u < units.length; u++) idx.set(units[u]!, u);
  const v = new Int32Array(units.length * k);
  for (let u = 0; u < units.length; u++) for (let j = 0; j < k; j++) v[u * k + j] = votes[j]![u]!;
  const rjm = db.get<{ payload: Uint8Array }>("SELECT payload FROM result_blob WHERE contest_id = ? AND rev = 0 AND grain = 'rjmode'", [contestId]);
  const rjMap = new Map<number, number[]>();
  if (rjm) { const cols = await decodeIntColumns(rjm.payload); for (let i = 0; i < cols[0]!.length; i++) rjMap.set(cols[0]![i]! * 4 + cols[1]![i]!, Array.from({ length: k }, (_, j) => cols[2 + j]![i]!)); }
  const rej = db.get<{ payload: Uint8Array }>("SELECT payload FROM result_blob WHERE contest_id = ? AND rev = 0 AND grain = 'rejected'", [contestId]);
  if (rej) {
    const cols = await decodeIntColumns(rej.payload);
    for (let i = 0; i < cols[0]!.length; i++) {
      const bu = cols[0]![i]!, mode = cols[1]![i]!, u = idx.get(bu)!;
      const key = unitRj(bu) * 4 + mode, row = rjMap.get(key);
      for (let j = 0; j < k; j++) { const x = cols[2 + j]![i]!; v[u * k + j]! -= x; if (row) row[j]! -= x; }
    }
  }
  const county = new Map<number, number[]>(), cd = new Map<number, number[]>();
  const add = (m: Map<number, number[]>, key: number, u: number) => { let a = m.get(key); if (!a) { a = new Array<number>(k).fill(0); m.set(key, a); } for (let j = 0; j < k; j++) a[j]! += v[u * k + j]!; };
  for (let u = 0; u < units.length; u++) { add(county, countyOf(units[u]!), u); add(cd, cdOf(units[u]!), u); }
  const elig = db.value<number>('SELECT eligible FROM contest_turnout WHERE contest_id = ? AND rev = 0', [contestId]) ?? 0;
  return {
    contestId, candidacyIds, grain: 'bu', units: Int32Array.from(units), votes: v,
    rjMode: [...rjMap].sort((a, b) => a[0] - b[0]).map(([key, vv]) => ({ rj: Math.floor(key / 4), mode: key % 4, votes: vv })),
    eligible: elig, countyTotals: county, cdTotals: cd,
  };
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

/** County and district rollup of a state's election: the latest revision (certified), or a given one. */
export async function readRollup(db: Db, electionId: number, stateIdx: number, rev?: number): Promise<StateRollup | null> {
  const later = rev === 0 ? undefined : db.get<{ payload: Uint8Array }>(`SELECT payload FROM county_rollup_rev WHERE election_id = ? AND state_idx = ?${rev !== undefined ? ' AND rev = ?' : ''} ORDER BY rev DESC LIMIT 1`, rev !== undefined ? [electionId, stateIdx, rev] : [electionId, stateIdx]);
  if (later) return decodeJson<StateRollup>(later.payload);
  if (rev !== undefined && rev > 0) return null;
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
/** The last night record verified by the audit (one night serves every state election of a general). */
let auditNightCache: { sha: string; rec: Awaited<ReturnType<typeof decodeNightRecord>>; sums: number[][]; cumOk: boolean[]; rows: number[] } | null = null;

/** Per-race totals of a night's feed, whether every running total stayed within its final, and rows per race. */
function feedSums(rec: Awaited<ReturnType<typeof decodeNightRecord>>): { sums: number[][]; cumOk: boolean[]; rows: number[] } {
  const R = rec.races.length, sums = rec.races.map((r) => new Array<number>(r.k).fill(0)), rows = new Array<number>(R).fill(0);
  const rr = rec.raceRows;
  for (let i = 0; i < rr.race.length; i++) { const r = rr.race[i]!, k = rec.races[r]!.k; rows[r]!++; for (let j = 0; j < k; j++) sums[r]![j]! += rr.votes[rr.off[i]! + j]!; }
  const cum = rec.races.map((r) => new Array<number>(r.k).fill(0)), cumOk = new Array<boolean>(R).fill(true);
  for (let i = 0; i < rr.race.length; i++) { const r = rr.race[i]!, k = rec.races[r]!.k; for (let j = 0; j < k; j++) { const v = (cum[r]![j]! += rr.votes[rr.off[i]! + j]!); if (v > sums[r]![j]! || v < 0) cumOk[r] = false; } }
  return { sums, cumOk, rows };
}

export async function auditElection(db: Db, electionId: number, buState: (bu: number) => number, stateBuStart: (s: number) => number, buCounty: (bu: number) => number): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const fail = (check: string, detail: string) => findings.push({ check, ok: false, detail });
  const contests = db.all<{ contest_id: number; kind: string; state_idx: number | null; seats: number | null }>('SELECT contest_id, kind, state_idx, seats FROM contest WHERE election_id = ? ORDER BY contest_id', [electionId]);
  const turnoutByState = new Map<number, Awaited<ReturnType<typeof readTurnout>>>();
  // A state's rollup, decoded once per revision and indexed by contest (it holds every contest of the state's
  // election: thousands with county offices, Phase 7.6).
  const rollups = new Map<string, Map<number, StateRollup['contests'][number]> | null>();
  const rollupOf = async (state: number, rev: number) => {
    const k = `${state}|${rev}`;
    if (!rollups.has(k)) { const r = await readRollup(db, electionId, state, rev); rollups.set(k, r ? new Map(r.contests.map((x) => [x.id, x])) : null); }
    return rollups.get(k)!;
  };
  let checkedUnits = 0, checkedContests = 0, checkedRows = 0;
  // The election's night record, if it was counted.
  const nightRow = db.get<{ payload: Uint8Array; sha256: string }>('SELECT n.payload, n.sha256 FROM night n JOIN night_election e ON e.night_id = n.night_id WHERE e.election_id = ?', [electionId]);
  let night: Awaited<ReturnType<typeof decodeNightRecord>> | null = null;
  if (nightRow) {
    if (auditNightCache?.sha === nightRow.sha256) night = auditNightCache.rec;
    else if (await sha256Hex(nightRow.payload) !== nightRow.sha256) fail('Night record seal', `election ${electionId}: night record altered`);
    else { night = await decodeNightRecord(nightRow.payload); auditNightCache = { sha: nightRow.sha256, rec: night, ...feedSums(night) }; }
  }
  // The election's revisions, candidacies, totals and turnout, read once (an election can hold thousands of contests:
  // with county offices, Phase 7.6), and each contest's blobs in one statement.
  const inElection = 'contest_id IN (SELECT contest_id FROM contest WHERE election_id = ?)';
  const group = <T extends { contest_id: number }>(rows: T[]) => { const m = new Map<number, T[]>(); for (const r of rows) { const l = m.get(r.contest_id); if (l) l.push(r); else m.set(r.contest_id, [r]); } return m; };
  const revsOf = group(db.all<{ contest_id: number; rev: number; sha256: string; kind: string }>(`SELECT contest_id, rev, sha256, kind FROM result_revision WHERE ${inElection} ORDER BY contest_id, rev`, [electionId]));
  const candsOf = group(db.all<{ contest_id: number; candidacy_id: number }>(`SELECT contest_id, candidacy_id FROM candidacy WHERE ${inElection} ORDER BY contest_id, ballot_order`, [electionId]));
  const totals = new Map<string, Map<number, number>>();
  for (const r of db.all<{ contest_id: number; rev: number; candidacy_id: number; votes: number }>(`SELECT contest_id, rev, candidacy_id, votes FROM contest_total WHERE ${inElection}`, [electionId])) {
    const key = `${r.contest_id}|${r.rev}`; let m = totals.get(key); if (!m) { m = new Map(); totals.set(key, m); } m.set(r.candidacy_id, r.votes);
  }
  const turnouts = new Map<string, { undervotes: number; eligible: number }>();
  for (const r of db.all<{ contest_id: number; rev: number; undervotes: number; eligible: number }>(`SELECT contest_id, rev, undervotes, eligible FROM contest_turnout WHERE ${inElection}`, [electionId])) turnouts.set(`${r.contest_id}|${r.rev}`, r);
  const offNightSet = new Set(db.all<{ contest_id: number }>(`SELECT c.contest_id FROM contest c JOIN office o ON o.office_id = c.office_id LEFT JOIN office_seat s ON s.office_id = o.office_id WHERE c.election_id = ?
        AND (o.kind IN ('state_senator','state_representative','appellate_judge','commissioner','education_board','regent') OR c.kind = 'retention' OR (s.district > 0 AND s.county_idx IS NULL)
          OR (c.kind = 'measure' AND NOT EXISTS (SELECT 1 FROM ballot_measure m WHERE m.contest_id = c.contest_id AND m.polled = 1)))`, [electionId]).map((r) => r.contest_id));
  const totalsOfRev = (cid: number, rev: number, cands: number[]) => {
    const t = turnouts.get(`${cid}|${rev}`), m = totals.get(`${cid}|${rev}`);
    return { votes: [...cands.map((x) => m?.get(x) ?? 0), t?.undervotes ?? 0], eligible: t?.eligible ?? 0, present: !!t };
  };
  for (const c of contests) {
    const revs = revsOf.get(c.contest_id) ?? [];
    if (!revs.length) continue;
    checkedContests++;
    const cands = (candsOf.get(c.contest_id) ?? []).map((x) => x.candidacy_id);
    const k = cands.length + 1;
    const blobRows = db.all<{ rev: number; grain: string; payload: Uint8Array; crc32: number }>('SELECT rev, grain, payload, crc32 FROM result_blob WHERE contest_id = ?', [c.contest_id]);
    const blobOf = (rev: number, grain: string) => blobRows.find((b) => b.rev === rev && b.grain === grain);
    const unitsByRev = new Map<number, { units: Float64Array; votes: Float64Array[] }>();
    const derived = new Set<number>();
    for (const rv of revs) {
      const tot = totalsOfRev(c.contest_id, rv.rev, cands);
      const blob = blobOf(rv.rev, 'bu') ?? blobOf(rv.rev, 'cpart');
      const kind = rv.kind;
      if (!blob && kind === 'certified') {
        // Derived revision: recompute the unit grain (cast − rejected) and verify seal, totals and rollup.
        const castSha = revs.find((x) => x.rev === 0)?.sha256 ?? '';
        const rjm = blobOf(rv.rev, 'rjmode');
        if (await derivedSeal(c.contest_id, rv.rev, cands, tot.votes, tot.eligible, castSha, rjm?.payload) !== rv.sha256) fail('Result seals', `contest ${c.contest_id} rev ${rv.rev}: seal mismatch (archive altered)`);
        derived.add(rv.rev);
        continue;
      }
      if (!blob) {
        // Totals-only revision (unofficial count, canvass): sealed over its canonical totals.
        const sha = await sha256Hex(new TextEncoder().encode(JSON.stringify({ contest: c.contest_id, rev: rv.rev, candidacies: cands, totals: tot.votes, eligible: tot.eligible })));
        if (sha !== rv.sha256) fail('Result seals', `contest ${c.contest_id} rev ${rv.rev}: seal mismatch (archive altered)`);
        continue;
      }
      if (crc32(blob.payload) !== blob.crc32) { fail('Blob checksums', `contest ${c.contest_id} rev ${rv.rev}`); continue; }
      const { units, votes } = await decodeContestBlob(blob.payload, k);
      unitsByRev.set(rv.rev, { units, votes });
      // Seal: recompute SHA-256 over the canonical totals and the result blobs (not the rejected-ballot blob).
      const canon = new TextEncoder().encode(JSON.stringify({ contest: c.contest_id, candidacies: cands, totals: tot.votes, eligible: tot.eligible }));
      const blobs = blobRows.filter((b) => b.rev === rv.rev && b.grain !== 'rejected').sort((a, b) => (a.grain === 'rjmode' ? 1 : 0) - (b.grain === 'rjmode' ? 1 : 0));
      const all = new Uint8Array(canon.length + blobs.reduce((a, b) => a + b.payload.length, 0));
      all.set(canon, 0); let o = canon.length; for (const b of blobs) { all.set(b.payload, o); o += b.payload.length; }
      if (await sha256Hex(all) !== rv.sha256) fail('Result seals', `contest ${c.contest_id} rev ${rv.rev}: seal mismatch (archive altered)`);
      for (let j = 0; j < k; j++) {
        const sum = votes[j]!.reduce((a, b) => a + b, 0);
        if (sum !== tot.votes[j]) fail(j < k - 1 ? 'Candidate totals = Σ units' : 'Undervotes = Σ units', `contest ${c.contest_id} rev ${rv.rev} option ${j}: ${tot.votes[j]} ≠ ${sum}`);
      }
      if (blob.grain !== 'bu') continue;
      for (let u = 0; u < units.length; u++) {
        const bu = units[u]!, s = buState(bu);
        if (!turnoutByState.has(s)) turnoutByState.set(s, await readTurnout(db, electionId, s));
        const t = turnoutByState.get(s);
        if (!t) { fail('Per-unit turnout present', `state ${s}`); break; }
        const i = bu - stateBuStart(s);
        let sum = 0; for (let j = 0; j < k; j++) { const v = votes[j]![u]!; if (v < 0) { fail('No negative counts', `contest ${c.contest_id} rev ${rv.rev} BU ${bu}`); break; } sum += v; }
        // Cast ballots: votes + undervotes = ballots (N marks per ballot in a vote-for-N contest). Counted revisions: never more than were cast.
        const marks = marksOf(c) * t.ballots[i]!;
        if (rv.rev === 0 ? sum !== marks : sum > marks) { fail('Votes + undervotes = ballots (every unit)', `contest ${c.contest_id} rev ${rv.rev} BU ${bu}: ${sum} vs ${marks}`); break; }
        if (t.ballots[i]! > t.eligible[i]!) { fail('Ballots ≤ eligible', `BU ${bu}`); break; }
        checkedUnits++;
      }
      if (c.state_idx !== null) {
        const entry = (await rollupOf(c.state_idx, rv.rev))?.get(c.contest_id);
        if (!entry) fail('County rollup present', `contest ${c.contest_id} rev ${rv.rev}`);
        else {
          const sums = new Map<number, number[]>();
          for (let u = 0; u < units.length; u++) { const cc = buCounty(units[u]!); const a = sums.get(cc) ?? new Array(k).fill(0); for (let j = 0; j < k; j++) a[j] += votes[j]![u]!; sums.set(cc, a); }
          for (const [cc, v] of entry.counties) if (JSON.stringify(sums.get(cc)) !== JSON.stringify(v)) { fail('County rollup = Σ units', `contest ${c.contest_id} rev ${rv.rev} county ${cc}`); break; }
        }
      }
    }
    // Counted contests: certified = cast − rejected (every unit); canvass = certified; unofficial ≤ canvass; feed = canvass.
    const cast = unitsByRev.get(0);
    if (cast && derived.has(3)) {
      // Unit grain of the certified revision, recomputed from the cast and rejected blobs.
      const rej = blobOf(0, 'rejected');
      const votes = cast.votes.map((v) => Float64Array.from(v)), idx = new Map<number, number>();
      for (let u = 0; u < cast.units.length; u++) idx.set(cast.units[u]!, u);
      if (rej) { const cols = await decodeIntColumns(rej.payload); for (let i = 0; i < cols[0]!.length; i++) { const u = idx.get(cols[0]![i]!); if (u === undefined) { fail('Rejected ballots belong to cast units', `contest ${c.contest_id}`); break; } for (let j = 0; j < k; j++) votes[j]![u]! -= cols[2 + j]![i]!; } }
      const t3 = totalsOfRev(c.contest_id, 3, cands);
      for (let j = 0; j < k; j++) { let sum = 0; for (let u = 0; u < cast.units.length; u++) { if (votes[j]![u]! < 0) { fail('No negative counts', `contest ${c.contest_id} rev 3`); break; } sum += votes[j]![u]!; } if (sum !== t3.votes[j]) fail('Certified totals = Σ (cast − rejected)', `contest ${c.contest_id} option ${j}: ${t3.votes[j]} ≠ ${sum}`); }
      if (c.state_idx !== null) {
        const entry = (await rollupOf(c.state_idx, 3))?.get(c.contest_id);
        if (!entry) fail('County rollup present', `contest ${c.contest_id} rev 3`);
        else {
          const sums = new Map<number, number[]>();
          for (let u = 0; u < cast.units.length; u++) { const cc = buCounty(cast.units[u]!); const a = sums.get(cc) ?? new Array(k).fill(0); for (let j = 0; j < k; j++) a[j] += votes[j]![u]!; sums.set(cc, a); }
          for (const [cc, v] of entry.counties) if (JSON.stringify(sums.get(cc)) !== JSON.stringify(v)) { fail('County rollup = Σ units', `contest ${c.contest_id} rev 3 county ${cc}`); break; }
        }
      }
      unitsByRev.set(3, { units: cast.units, votes });
      checkedUnits += cast.units.length;
    }
    const cert = unitsByRev.get(3);
    if (cast && cert) {
      const rej = blobOf(0, 'rejected');
      const minus = new Map<number, number[]>();
      if (rej) { const cols = await decodeIntColumns(rej.payload); for (let i = 0; i < cols[0]!.length; i++) { const a = minus.get(cols[0]![i]!) ?? new Array<number>(k).fill(0); for (let j = 0; j < k; j++) a[j]! += cols[2 + j]![i]!; minus.set(cols[0]![i]!, a); } }
      const ci = new Map<number, number>(); for (let u = 0; u < cert.units.length; u++) ci.set(cert.units[u]!, u);
      if (cert.units.length !== cast.units.length) fail('Certified = cast − rejected (every unit)', `contest ${c.contest_id}: unit lists differ`);
      else for (let u = 0; u < cast.units.length; u++) {
        const v = ci.get(cast.units[u]!); const m = minus.get(cast.units[u]!);
        if (v === undefined) { fail('Certified = cast − rejected (every unit)', `contest ${c.contest_id} BU ${cast.units[u]}`); break; }
        let bad = false; for (let j = 0; j < k; j++) if (cast.votes[j]![u]! - (m?.[j] ?? 0) !== cert.votes[j]![v]!) bad = true;
        if (bad) { fail('Certified = cast − rejected (every unit)', `contest ${c.contest_id} BU ${cast.units[u]}`); break; }
      }
      const t2 = totalsOfRev(c.contest_id, 2, cands), t3 = totalsOfRev(c.contest_id, 3, cands), t1 = totalsOfRev(c.contest_id, 1, cands);
      if (t2.present && JSON.stringify(t2.votes) !== JSON.stringify(t3.votes)) fail('Canvass = certified', `contest ${c.contest_id}`);
      if (t1.present && t1.votes.some((v, j) => v > t2.votes[j]!)) fail('Unofficial ≤ canvass', `contest ${c.contest_id}`);
      // State legislative contests are certified from the cast ballots without a broadcast night feed, as are (Phase
      // 7.2) retention votes, appellate courts, boards and commissions, seats elected by district, and (7.3) the ballot
      // measures that were not polled.
      const offNight = offNightSet.has(c.contest_id);
      if (night && !offNight) {
        const ri = night.races.findIndex((r) => r.contestId === c.contest_id && r.cd < 0);
        // County races (Phase 7.6) are among the record's local races.
        const lf = ri < 0 ? contestFeed(night, c.contest_id, MODE_PROV) : null;
        if (ri < 0 && !lf) fail('Night feed covers the contest', `contest ${c.contest_id}`);
        else {
          const f = auditNightCache!;
          const sums = lf ? lf.rev2 : f.sums[ri], ok = lf ? lf.cumOk : f.cumOk[ri];
          if (JSON.stringify(sums) !== JSON.stringify(t2.votes)) fail('Σ night batches = canvass totals', `contest ${c.contest_id}: ${JSON.stringify(sums)} vs ${JSON.stringify(t2.votes)}`);
          if (!ok) fail('Cumulative count ≤ final', `contest ${c.contest_id}`);
          checkedRows += lf ? lf.rows : f.rows[ri]!;
        }
      }
    }
  }
  findings.unshift({ check: 'Contests audited', ok: true, detail: `${checkedContests} contests, ${checkedUnits.toLocaleString('en-US')} unit-contest records${checkedRows ? `, ${checkedRows.toLocaleString('en-US')} night batch rows` : ''}` });
  if (!findings.some((f) => !f.ok)) findings.push({ check: 'All archive invariants', ok: true, detail: 'ok' });
  return findings;
}
