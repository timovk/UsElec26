/** The 2016 cycle on real Census geography (opt-in: ENA_CYCLE=seed1,seed2). Prints a statistical report. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SEMANTIC_FILES } from '../../../src/geo/pack';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { parseNameFile } from '../../../src/politicians/nameData';
import { zonedToUtc } from '../../../src/core/time';
import { auditElection } from '../../../src/archive/results';

const DIR = 'public/geo-packs/2016.1/';
const seeds = (process.env.ENA_CYCLE ?? '').split(',').filter(Boolean);
describe.skipIf(!existsSync(`${DIR}manifest.json`) || seeds.length === 0)('2016 cycle on real geography', () => {
  it.each(seeds)('seed %s', async (seed) => {
    const sqlite3 = await initSqlite();
    const files = new Map<string, Uint8Array>(SEMANTIC_FILES.map((f) => [f, new Uint8Array(readFileSync(DIR + f))]));
    const names = parseNameFile(JSON.parse(readFileSync('public/data/names-v1.json', 'utf8')));
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'R', seed }, files, names);
    const size0 = u.exportBytes().length;
    const timings: string[] = [];
    let last = performance.now();
    // Time spent per progress step (the last label seen owns the time until the next label).
    const stepMs = new Map<string, number>(); let cur = '', curT = performance.now();
    u.onProgress = (step) => { if (step === cur) return; const now = performance.now(); if (cur) stepMs.set(cur, (stepMs.get(cur) ?? 0) + now - curT); cur = step; curT = now; };
    const steps: [string, number][] = [['Jun 30 (primaries)', zonedToUtc(2016, 6, 30, 0, 0, 'America/New_York')], ['Nov 7', zonedToUtc(2016, 11, 7, 0, 0, 'America/New_York')], ['Nov 9 (general)', zonedToUtc(2016, 11, 9, 0, 0, 'America/New_York')], ['Feb 1 2017', zonedToUtc(2017, 2, 1, 0, 0, 'America/New_York')]];
    for (const [label, t] of steps) {
      stepMs.clear(); cur = '';
      await u.advance({ kind: 'until', time: t }); const now = performance.now(); timings.push(`${label} ${Math.round(now - last)} ms`); last = now;
      if (cur) stepMs.set(cur, (stepMs.get(cur) ?? 0) + now - curT);
      if (label.includes('general')) timings.push(`[general day: ${[...stepMs].map(([k, v]) => `${k} ${Math.round(v)} ms`).join(', ')}]`);
    }
    const db = u.db; const q = <T>(sql: string) => db.all<T>(sql);
    const turnout = q<{ b: number; e: number }>("SELECT SUM(ballots) b, SUM(eligible) e FROM election_turnout t JOIN election x ON x.election_id = t.election_id WHERE x.kind = 'general' AND x.year = 2016")[0]!;
    const pres = q<{ party_id: number; v: number }>("SELECT k.party_id, SUM(t.votes) v FROM contest c JOIN contest_total t ON t.contest_id = c.contest_id JOIN candidacy k ON k.candidacy_id = t.candidacy_id WHERE c.kind = 'pres_state' AND c.year = 2016 GROUP BY k.party_id ORDER BY k.party_id");
    const pv = pres.reduce((a, x) => a + x.v, 0);
    const winnerParty = (kind: string) => new Map(q<{ s: number; p: number }>(`SELECT c.state_idx s, k.party_id p FROM contest c JOIN candidacy k ON k.candidacy_id = c.winner_candidacy JOIN office o ON o.office_id = c.office_id WHERE c.year = 2016 AND c.parent_contest IS NULL AND (c.kind = 'pres_state' AND '${kind}' = 'president' OR o.kind = '${kind}' AND c.kind IN ('general','special'))`).map((r) => [r.s, r.p]));
    const presW = winnerParty('president'), senW = winnerParty('us_senator');
    let split = 0; for (const [s, p] of senW) if (presW.get(s) !== undefined && presW.get(s) !== p) split++;
    const houseUncontested = Number(db.value("SELECT COUNT(*) FROM contest c JOIN office o ON o.office_id = c.office_id WHERE c.year = 2016 AND o.kind = 'us_representative' AND c.kind = 'general' AND c.parent_contest IS NULL AND (SELECT COUNT(*) FROM candidacy k WHERE k.contest_id = c.contest_id AND k.party_id IN (1,2)) < 2"));
    const incRun = q<{ won: number; n: number }>("SELECT SUM(k.status = 'won') won, COUNT(*) n FROM candidacy k JOIN contest c ON c.contest_id = k.contest_id JOIN office o ON o.office_id = c.office_id WHERE c.year = 2016 AND c.kind = 'general' AND o.kind = 'us_representative' AND k.incumbent = 1")[0]!;
    const under = q<{ kind: string; u: number; b: number }>("SELECT o.kind, SUM(t.undervotes) u, SUM(t.ballots) b FROM contest_turnout t JOIN contest c ON c.contest_id = t.contest_id LEFT JOIN office o ON o.office_id = c.office_id WHERE c.year = 2016 AND c.kind IN ('general','pres_state') GROUP BY o.kind");
    const ev = q<{ person_id: number; ev: number }>('SELECT person_id, ev FROM electoral_vote ORDER BY ev DESC');
    const houseD = Number(db.value("SELECT COUNT(*) FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE o.kind = 'us_representative' AND t.end_time IS NULL AND t.party_id = 1"));
    const senD = Number(db.value("SELECT COUNT(*) FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE o.kind = 'us_senator' AND t.end_time IS NULL AND t.party_id = 1"));
    const eid = Number(db.value("SELECT election_id FROM election WHERE kind = 'general' AND year = 2016 AND state_idx = (SELECT idx FROM (SELECT 4 idx))"));
    const pack = u.world.pack; const stateOfBu = (b: number) => pack.counties[pack.bu.county[b]!]!.stateIdx;
    const ranges = pack.states.map((s) => pack.counties.find((c) => c.stateIdx === s.idx)!.buStart);
    const audit = await auditElection(db, eid, stateOfBu, (s) => ranges[s]!, (b) => pack.bu.county[b]!);
    const lean = u.world.lean.national; const envN = u.elections.state.env['2016']; const presP = db.value('SELECT party_id FROM office_term t JOIN office o ON o.office_id=t.office_id WHERE o.kind=\'president\' ORDER BY t.start_time LIMIT 1');
    console.log([`seed ${seed}: ${timings.join(' | ')}`, `underlying lean D2 ${(100 * lean.d / lean.t).toFixed(1)}%; env national ${envN?.national.toFixed(3)} (fund ${JSON.stringify(envN?.fundamentals)}); 2012 president party ${presP}`,
      `turnout ${(100 * turnout.b / turnout.e).toFixed(1)}% of VEP (${(turnout.b / 1e6).toFixed(1)}M ballots); universe target ${(100 * (u.elections.state.turnoutTarget ?? 0)).toFixed(1)}%`,
      `presidential vote: ${pres.map((p) => `${p.party_id}:${(100 * p.v / pv).toFixed(1)}%`).join(' ')}; EV ${ev.map((e) => e.ev).join('–')}`,
      `Senate races won by party losing the state's presidential vote: ${split}/${senW.size}`,
      `House: uncontested by a major party ${houseUncontested}/435; incumbents re-elected ${incRun.won}/${incRun.n}; new House D ${houseD}, new Senate D ${senD}`,
      `undervote: ${under.map((x) => `${x.kind ?? 'president'} ${(100 * x.u / x.b).toFixed(1)}%`).join(', ')}`,
      `audit (California): ${audit.map((f) => `${f.ok ? 'ok' : 'FAIL'} ${f.check}: ${f.detail}`).join('; ')}`].join('\n'));
    expect(audit.every((f) => f.ok)).toBe(true);
    // Archive size and a full audit of every held 2016 election.
    const kinds = q<{ kind: string; n: number }>('SELECT kind, COUNT(*) n FROM contest WHERE year = 2016 GROUP BY kind ORDER BY kind');
    const blobs = q<{ grain: string; n: number; bytes: number }>('SELECT grain, COUNT(*) n, SUM(LENGTH(payload)) bytes FROM result_blob GROUP BY grain');
    const t0 = performance.now(); let failed = 0, records = 0;
    const els = q<{ election_id: number }>("SELECT election_id FROM election WHERE year = 2016 AND status <> 'scheduled'");
    for (const e of els) {
      const f = await auditElection(db, e.election_id, stateOfBu, (s) => ranges[s]!, (b) => pack.bu.county[b]!);
      failed += f.filter((x) => !x.ok).length;
      records += Number(/([\d,]+) unit-contest/.exec(f[0]!.detail)?.[1]?.replace(/,/g, '') ?? 0);
    }
    console.log([`contests: ${kinds.map((k) => `${k.kind} ${k.n}`).join(', ')}`,
      `archive blobs: ${blobs.map((b) => `${b.grain} ${b.n} (${(b.bytes / 1e6).toFixed(1)} MB)`).join(', ')}; county rollups ${(Number(db.value('SELECT SUM(LENGTH(payload)) FROM county_rollup')) / 1e6).toFixed(1)} MB; per-unit turnout ${(Number(db.value('SELECT SUM(LENGTH(payload)) FROM election_turnout')) / 1e6).toFixed(1)} MB`,
      `database ${(size0 / 1e6).toFixed(1)} MB at creation → ${(u.exportBytes().length / 1e6).toFixed(1)} MB on Feb 1, 2017`,
      `full audit: ${els.length} elections, ${records.toLocaleString('en-US')} unit-contest records, ${failed} failures, ${Math.round(performance.now() - t0)} ms`].join('\n'));
    expect(failed).toBe(0);
    expect(ev.reduce((a, x) => a + x.ev, 0)).toBe(538);
  }, 1_200_000);
});
