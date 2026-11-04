/** Queries for the campaign season: polls, averages, forecasts, calibration and the presidential primaries. Only published polls. */
import { gunzip } from '../core/codec';
import { easternDay } from '../core/time';
import { fullName, PARTY_D, PARTY_R } from '../institutions/model';
import { needed } from '../primaries/delegates';
import { NOMINATING_2016 } from '../rules/primaries2016';
import type { CalibrationDto, ForecastDto, PollDto, PollsterDto, PrimariesDto, PrimaryPartyDto, RaceRowDto, SeasonOverviewDto, SeasonQuery, SeasonRaceDto } from './protocol';
import type { Universe } from './universe';

export async function runSeasonQuery(u: Universe, q: SeasonQuery): Promise<unknown> {
  switch (q.kind) {
    case 'seasonYears': return u.db.all<{ year: number }>('SELECT DISTINCT year FROM race_def UNION SELECT DISTINCT year FROM forecast_run ORDER BY year DESC').map((r) => r.year);
    case 'seasonOverview': return overview(u, q.year);
    case 'seasonRace': return race(u, q.key);
    case 'pollList': return pollList(u, q.year, q.race, q.pollster, q.limit ?? 300);
    case 'pollster': return pollster(u, q.id);
    case 'forecastRun': return forecastDto(u, q.year, q.asOf);
    case 'forecastCalibration': return calibration(u, q.year);
    case 'primaries': return primaries(u, q.year);
  }
}

interface RunPayload { out: Omit<ForecastDto, 'races' | 'nominees'> & { races: { key: string; pD: number; mean: number; lo80: number; hi80: number }[] }; races: { key: string; label: string; kind: string; state: number; ev: number }[] }
/** Decoded forecast payloads, per universe (run ids repeat across universes). */
const runCaches = new WeakMap<Universe, Map<number, RunPayload>>();
async function payloadOf(u: Universe, runId: number, bytes?: Uint8Array): Promise<RunPayload> {
  let runCache = runCaches.get(u); if (!runCache) { runCache = new Map(); runCaches.set(u, runCache); }
  const hit = runCache.get(runId); if (hit) return hit;
  const b = bytes ?? u.db.get<{ payload: Uint8Array }>('SELECT payload FROM forecast_run WHERE run_id = ?', [runId])!.payload;
  const p = JSON.parse(new TextDecoder().decode(await gunzip(b))) as RunPayload;
  if (runCache.size > 400) runCache.clear();
  runCache.set(runId, p);
  return p;
}

const today = (u: Universe) => easternDay(u.world.time);

async function forecastDto(u: Universe, year: number, asOf?: number): Promise<ForecastDto | null> {
  const row = u.db.get<{ run_id: number; as_of: number; payload: Uint8Array }>('SELECT run_id, as_of, payload FROM forecast_run WHERE year = ? AND as_of <= ? ORDER BY as_of DESC, run_id DESC LIMIT 1', [year, asOf ?? today(u)]);
  if (!row) return null;
  const p = await payloadOf(u, row.run_id, row.payload);
  const meta = new Map(p.races.map((r) => [r.key, r]));
  const nominees = (u.db.all<{ person_id: number; party_id: number }>("SELECT k.person_id, k.party_id FROM contest c JOIN candidacy k ON k.candidacy_id = c.winner_candidacy WHERE c.kind = 'pres_nomination' AND c.year = ? AND c.status IN ('decided','certified')", [year]))
    .map((r) => ({ party: r.party_id, name: fullName(u.world.persons.get(r.person_id)!) }));
  return {
    asOf: row.as_of, national: p.out.national, president: p.out.president, senate: p.out.senate, house: p.out.house, governors: p.out.governors, nominees,
    races: p.out.races.map((r) => ({ ...r, label: meta.get(r.key)?.label ?? r.key, kind: meta.get(r.key)?.kind ?? '', state: meta.get(r.key)?.state ?? 0, ev: meta.get(r.key)?.ev ?? 0 })),
  };
}

async function overview(u: Universe, year: number): Promise<SeasonOverviewDto> {
  const now = u.world.time, day = today(u);
  const defs = u.db.all<{ race_key: string; kind: string; label: string; geo: string; contest_id: number | null; options_json: string }>('SELECT * FROM race_def WHERE year = ? ORDER BY race_key', [year]);
  const counts = new Map(u.db.all<{ race_key: string; n: number }>('SELECT race_key, COUNT(*) n FROM poll WHERE year = ? AND published <= ? GROUP BY race_key', [year, now]).map((r) => [r.race_key, r.n]));
  const avgs = new Map(u.db.all<{ race_key: string; payload_json: string }>(`SELECT a.race_key, a.payload_json FROM poll_average a WHERE a.method = 'kalman' AND a.race_key IN (SELECT race_key FROM race_def WHERE year = ?)
    AND a.as_of = (SELECT MAX(b.as_of) FROM poll_average b WHERE b.race_key = a.race_key AND b.method = 'kalman' AND b.as_of <= ?)`, [year, day]).map((r) => [r.race_key, JSON.parse(r.payload_json)]));
  const fc = await forecastDto(u, year);
  const fr = new Map(fc?.races.map((r) => [r.key, r]) ?? []);
  const races: RaceRowDto[] = defs.map((d) => {
    const extra = JSON.parse(d.options_json) as { options: { key: string; label: string; party: number }[]; office: string; day: number };
    const a = avgs.get(d.race_key) as { options: Record<string, { mean: number }>; margin: { a: string; b: string; mean: number; lo: number; hi: number } | null } | undefined;
    const lead = a ? Object.entries(a.options).sort((x, y) => y[1].mean - x[1].mean)[0] : undefined;
    const lo = lead ? extra.options.find((o) => o.key === lead[0]) : undefined;
    const f = fr.get(d.race_key);
    return { key: d.race_key, kind: d.kind, label: d.label, geo: d.geo, office: extra.office, day: extra.day, contestId: d.contest_id, polls: counts.get(d.race_key) ?? 0,
      avg: a?.margin ?? null, leader: lead && lo ? { label: lo.label, party: lo.party, share: lead[1].mean } : null, forecast: f ? { pD: f.pD, mean: f.mean, lo80: f.lo80, hi80: f.hi80 } : null };
  });
  // Races the forecast covers without polls yet still appear (from the forecast's own list).
  for (const r of fc?.races ?? []) if (!races.some((x) => x.key === r.key)) races.push({ key: r.key, kind: r.kind, label: r.label, geo: '', office: r.kind, day: 0, contestId: r.key.startsWith('C:') ? Number(r.key.slice(2)) : null, polls: 0, avg: null, leader: null, forecast: { pD: r.pD, mean: r.mean, lo80: r.lo80, hi80: r.hi80 } });
  const history = u.db.all<{ as_of: number; summary_json: string }>('SELECT as_of, summary_json FROM forecast_run WHERE year = ? AND as_of <= ? ORDER BY as_of, run_id', [year, day]).map((r) => {
    const s = JSON.parse(r.summary_json) as { president: { pD: number; evMean: number } | null; senate: { pD: number } | null; house: { pD: number } | null };
    return { asOf: r.as_of, president: s.president?.pD ?? null, ev: s.president?.evMean ?? null, senate: s.senate?.pD ?? null, house: s.house?.pD ?? null };
  });
  return { year, today: day, pollCount: [...counts.values()].reduce((a, b) => a + b, 0), pollsters: Number(u.db.value('SELECT COUNT(*) FROM pollster') ?? 0), races, forecast: fc, history };
}

function pollRows(u: Universe, where: string, args: (string | number)[], limit: number): PollDto[] {
  const rows = u.db.all<{ poll_id: number; pollster_id: number; name: string; race_key: string; label: string | null; field_start: number; field_end: number; published: number; population: string; n: number; moe: number; method: string; sponsor: string | null }>(
    `SELECT p.*, s.name, d.label FROM poll p JOIN pollster s ON s.pollster_id = p.pollster_id LEFT JOIN race_def d ON d.race_key = p.race_key WHERE p.published <= ? ${where} ORDER BY p.field_end DESC, p.poll_id DESC LIMIT ?`, [u.world.time, ...args, limit]);
  if (!rows.length) return [];
  const resp = new Map<number, PollDto['responses']>();
  for (const r of u.db.all<{ poll_id: number; option_key: string; label: string; party: number; pct: number }>(`SELECT * FROM poll_response WHERE poll_id IN (${rows.map((r) => r.poll_id).join(',')})`)) {
    const a = resp.get(r.poll_id) ?? []; a.push({ key: r.option_key, label: r.label, party: r.party, pct: r.pct }); resp.set(r.poll_id, a);
  }
  return rows.map((r) => ({ id: r.poll_id, pollster: r.pollster_id, pollsterName: r.name, race: r.race_key, raceLabel: r.label ?? r.race_key, start: r.field_start, end: r.field_end, published: r.published, population: r.population, n: r.n, moe: r.moe, method: r.method, sponsor: r.sponsor,
    responses: (resp.get(r.poll_id) ?? []).sort((a, b) => (a.key === 'und' ? 1 : b.key === 'und' ? -1 : b.pct - a.pct)) }));
}

function pollList(u: Universe, year: number, raceKey: string | undefined, pollsterId: number | undefined, limit: number): PollDto[] {
  const where: string[] = ["AND p.year = ?"]; const args: (string | number)[] = [year];
  if (raceKey) { where.push('AND p.race_key = ?'); args.push(raceKey); }
  if (pollsterId) { where.push('AND p.pollster_id = ?'); args.push(pollsterId); }
  return pollRows(u, where.join(' '), args, limit);
}

/** The certified (or decided) Democratic-minus-Republican margin of a race, if counting is over. */
function actualMargin(u: Universe, key: string): number | null {
  const contestFor = (): number[] => {
    if (key.startsWith('C:')) return [Number(key.slice(2))];
    const m = /^PS:(\d+):(\w+)$/.exec(key);
    if (m) { const s = u.world.pack.states.find((x) => x.usps === m[2]); const c = s ? u.db.value<number>("SELECT contest_id FROM contest WHERE kind = 'pres_state' AND year = ? AND state_idx = ?", [Number(m[1]), s.idx]) : undefined; return c ? [c] : []; }
    const n = /^PN:(\d+)$/.exec(key);
    if (n) return u.db.all<{ contest_id: number }>("SELECT contest_id FROM contest WHERE kind = 'pres_state' AND year = ?", [Number(n[1])]).map((r) => r.contest_id);
    return [];
  };
  const ids = contestFor(); if (!ids.length) return null;
  let d = 0, r = 0, all = 0;
  for (const id of ids) {
    const st = u.db.value<string>('SELECT status FROM contest WHERE contest_id = ?', [id]);
    if (st !== 'decided' && st !== 'certified') return null; // still being counted: no spoilers
    const rev = u.db.value<number>('SELECT MAX(rev) FROM result_revision WHERE contest_id = ?', [id]) ?? 0;
    for (const t of u.db.all<{ party_id: number; votes: number }>('SELECT k.party_id, t.votes FROM contest_total t JOIN candidacy k ON k.candidacy_id = t.candidacy_id WHERE t.contest_id = ? AND t.rev = ?', [id, rev])) {
      all += t.votes; if (t.party_id === PARTY_D) d += t.votes; else if (t.party_id === PARTY_R) r += t.votes;
    }
  }
  return all > 0 ? (100 * (d - r)) / all : null;
}

async function race(u: Universe, key: string): Promise<SeasonRaceDto | null> {
  const d = u.db.get<{ race_key: string; year: number; kind: string; label: string; geo: string; contest_id: number | null; options_json: string }>('SELECT * FROM race_def WHERE race_key = ?', [key]);
  if (!d) return null;
  const extra = JSON.parse(d.options_json) as { options: SeasonRaceDto['options']; day: number };
  const day = today(u);
  const averages = u.db.all<{ as_of: number; payload_json: string }>("SELECT as_of, payload_json FROM poll_average WHERE race_key = ? AND method = 'kalman' AND as_of <= ? ORDER BY as_of", [key, day])
    .map((r) => { const a = JSON.parse(r.payload_json); return { day: r.as_of, options: a.options, margin: a.margin, ...(a.lvGap !== undefined ? { lvGap: a.lvGap } : {}) }; });
  const runs = u.db.all<{ run_id: number; as_of: number }>('SELECT run_id, as_of FROM forecast_run WHERE year = ? AND as_of <= ? ORDER BY as_of', [d.year, day]);
  const forecast: SeasonRaceDto['forecast'] = [];
  for (const r of runs) { const p = await payloadOf(u, r.run_id); const x = p.out.races.find((y) => y.key === key); if (x) forecast.push({ asOf: r.as_of, pD: x.pD, mean: x.mean, lo80: x.lo80, hi80: x.hi80 }); }
  const margin = actualMargin(u, key);
  return { key, label: d.label, kind: d.kind, geo: d.geo, day: extra.day, options: extra.options, contestId: d.contest_id, polls: pollRows(u, 'AND p.race_key = ?', [key], 500), averages, forecast, result: margin === null ? null : { margin, shares: {} } };
}

async function pollster(u: Universe, id: number): Promise<PollsterDto | null> {
  const p = u.db.get<{ pollster_id: number; name: string; method: string; sponsor: string | null; scope: string; home_state: number | null; founded: number }>('SELECT * FROM pollster WHERE pollster_id = ?', [id]);
  if (!p) return null;
  const polls = pollRows(u, 'AND p.pollster_id = ?', [id], 2000);
  // House effect: each poll's D−R margin against its race's average when it was published.
  const res: number[] = [], err: number[] = [];
  for (const x of polls) {
    const d = x.responses.find((o) => o.party === PARTY_D), r = x.responses.find((o) => o.party === PARTY_R);
    if (!d || !r || x.race.startsWith('NN:') || x.race.startsWith('NS:')) continue;
    const a = u.db.get<{ payload_json: string }>("SELECT payload_json FROM poll_average WHERE race_key = ? AND method = 'kalman' AND as_of <= ? ORDER BY as_of DESC LIMIT 1", [x.race, x.end + 3]);
    const m = a ? (JSON.parse(a.payload_json) as { margin: { a: string; mean: number } | null }).margin : null;
    if (m) res.push(d.pct - r.pct - (m.a === d.key ? m.mean : -m.mean));
    const def = u.db.get<{ options_json: string }>('SELECT options_json FROM race_def WHERE race_key = ?', [x.race]);
    const eday = def ? (JSON.parse(def.options_json) as { day: number }).day : 0;
    if (eday - x.end <= 21) { const act = actualMargin(u, x.race); if (act !== null) err.push(d.pct - r.pct - act); }
  }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  return {
    id, name: p.name, method: p.method, sponsor: p.sponsor, scope: p.scope, homeState: p.home_state !== null ? u.world.pack.states[p.home_state]!.usps : null, founded: p.founded, polls: polls.length,
    house: res.length >= 3 ? mean(res) * (res.length / (res.length + 6)) : null,
    accuracy: err.length ? { polls: err.length, mae: mean(err.map(Math.abs)), bias: mean(err) } : null,
    recent: polls.slice(0, 60),
  };
}

async function calibration(u: Universe, year: number): Promise<CalibrationDto> {
  const gDay = u.db.value<number>("SELECT MIN(day) FROM election WHERE year = ? AND kind = 'general'", [year]);
  const row = gDay !== undefined ? u.db.get<{ run_id: number; as_of: number }>('SELECT run_id, as_of FROM forecast_run WHERE year = ? AND as_of <= ? ORDER BY as_of DESC, run_id DESC LIMIT 1', [year, gDay]) : undefined;
  if (!row) return { year, ready: false, asOf: null, races: [], brier: null, bins: [], president: null };
  const p = await payloadOf(u, row.run_id);
  const meta = new Map(p.races.map((r) => [r.key, r]));
  const races: CalibrationDto['races'] = [];
  let pres: { d: number; ev: number } | null = null;
  for (const r of p.out.races) {
    const act = actualMargin(u, r.key); if (act === null) continue;
    races.push({ key: r.key, label: meta.get(r.key)?.label ?? r.key, kind: meta.get(r.key)?.kind ?? '', pD: r.pD, mean: r.mean, lo80: r.lo80, hi80: r.hi80, actual: act, dWon: act > 0 });
    if (meta.get(r.key)?.kind === 'pres_state') { pres ??= { d: 0, ev: 0 }; if (act > 0) pres.ev += meta.get(r.key)!.ev; }
  }
  const brier = races.length ? races.reduce((a, r) => a + (r.pD - (r.dWon ? 1 : 0)) ** 2, 0) / races.length : null;
  const bins = Array.from({ length: 10 }, (_, i) => {
    const inBin = races.filter((r) => r.pD >= i / 10 && (r.pD < (i + 1) / 10 || (i === 9 && r.pD <= 1)));
    return { lo: i / 10, hi: (i + 1) / 10, n: inBin.length, predicted: inBin.length ? inBin.reduce((a, r) => a + r.pD, 0) / inBin.length : 0, observed: inBin.length ? inBin.filter((r) => r.dWon).length / inBin.length : 0 };
  });
  const totalPres = p.races.filter((r) => r.kind === 'pres_state').length;
  const allPresIn = totalPres > 0 && races.filter((r) => r.kind === 'pres_state').length === totalPres;
  return {
    year, ready: races.length > 0, asOf: row.as_of, races, brier, bins,
    president: p.out.president ? { pD: p.out.president.pD, evMean: p.out.president.evMean, ev80: p.out.president.ev80, actualEV: allPresIn && pres ? pres.ev : null, dWon: allPresIn && pres ? pres.ev >= 270 : null } : null,
  };
}

function primaries(u: Universe, year: number): PrimariesDto {
  const w = u.world;
  const parties: PrimaryPartyDto[] = [];
  for (const party of [PARTY_D, PARTY_R]) {
    const nom = u.db.get<{ contest_id: number; status: string; winner_candidacy: number | null; method: string }>("SELECT contest_id, status, winner_candidacy, method FROM contest WHERE kind = 'pres_nomination' AND year = ? AND party_id = ?", [year, party]);
    if (!nom) continue;
    const open = nom.method === 'delegates';
    const pledged = new Map(u.db.all<{ person_id: number; n: number }>('SELECT person_id, SUM(count) n FROM delegate WHERE year = ? AND party_id = ? GROUP BY person_id', [year, party]).map((r) => [r.person_id, r.n]));
    const supers = new Map(u.db.all<{ committed_to: number; n: number }>('SELECT committed_to, COUNT(*) n FROM superdelegate WHERE year = ? AND committed_to IS NOT NULL GROUP BY committed_to', [year]).map((r) => [r.committed_to, r.n]));
    const nSupers = party === PARTY_D ? Number(u.db.value('SELECT COUNT(*) FROM superdelegate WHERE year = ?', [year]) ?? 0) : 0;
    const total = w.pack.states.reduce((a, s) => a + (NOMINATING_2016[s.usps]?.[party === PARTY_D ? 'D' : 'R'].delegates ?? 0), 0) + nSupers;
    const contests = u.db.all<{ contest_id: number; state_idx: number; method: string; ev: number; status: string; winner_candidacy: number | null; day: number }>(
      "SELECT c.contest_id, c.state_idx, c.method, c.ev, c.status, c.winner_candidacy, e.day FROM contest c JOIN election e ON e.election_id = c.election_id WHERE c.kind = 'pres_primary' AND c.year = ? AND c.party_id = ? ORDER BY e.day, c.state_idx", [year, party]);
    const winnerPerson = (cand: number | null) => (cand === null ? null : u.db.value<number>('SELECT person_id FROM candidacy WHERE candidacy_id = ?', [cand]) ?? null);
    const wins = new Map<number, number>();
    const calendar = contests.map((c) => {
      const st = w.pack.states[c.state_idx]!;
      const decided = c.status === 'decided' || c.status === 'certified';
      const win = decided ? winnerPerson(c.winner_candidacy) : null;
      if (win !== null) wins.set(win, (wins.get(win) ?? 0) + 1);
      let results: { personId: number; share: number; delegates: number }[] = [];
      if (decided) {
        const rev = u.db.value<number>('SELECT MAX(rev) FROM result_revision WHERE contest_id = ?', [c.contest_id]) ?? 0;
        const del = new Map(u.db.all<{ person_id: number; count: number }>("SELECT person_id, count FROM delegate WHERE year = ? AND party_id = ? AND state_idx = ? AND kind = 'pledged'", [year, party, c.state_idx]).map((r) => [r.person_id, r.count]));
        results = u.db.all<{ person_id: number; share: number }>('SELECT k.person_id, t.share FROM contest_total t JOIN candidacy k ON k.candidacy_id = t.candidacy_id WHERE t.contest_id = ? AND t.rev = ? ORDER BY t.share DESC', [c.contest_id, rev])
          .map((r) => ({ personId: r.person_id, share: r.share, delegates: del.get(r.person_id) ?? 0 }));
      }
      return { day: c.day, state: st.name, usps: st.usps, event: c.method, delegates: c.ev, contestId: c.contest_id, status: c.status, winner: win, results };
    });
    const endorse = new Map(u.db.all<{ person_id: number; n: number }>('SELECT person_id, COUNT(*) n FROM endorsement WHERE race_key = ? AND sim_time <= ? GROUP BY person_id', [`NN:${year}:${party}`, u.world.time]).map((r) => [r.person_id, r.n]));
    const candidates = u.db.all<{ person_id: number; status: string }>('SELECT person_id, status FROM candidacy WHERE contest_id = ? ORDER BY ballot_order', [nom.contest_id]).map((r) => ({
      personId: r.person_id, name: fullName(w.persons.get(r.person_id)!), status: r.status, pledged: pledged.get(r.person_id) ?? 0, supers: supers.get(r.person_id) ?? 0, wins: wins.get(r.person_id) ?? 0, endorsements: endorse.get(r.person_id) ?? 0,
    })).sort((a, b) => b.pledged + b.supers - (a.pledged + a.supers) || a.personId - b.personId);
    const pres = (u.elections.state.season?.presumptive ?? {})[`${year}:${party}`] ?? null;
    parties.push({
      party, total, needed: needed(total), presumptive: pres, nominee: nom.status === 'decided' || nom.status === 'certified' ? winnerPerson(nom.winner_candidacy) : null, open,
      candidates, calendar, unbound: pledged.get(0) ?? 0,
      ballots: u.db.all<{ ballot: number; person_id: number; votes: number }>('SELECT ballot, person_id, votes FROM convention_ballot WHERE year = ? AND party_id = ? ORDER BY ballot, votes DESC', [year, party]).map((r) => ({ ballot: r.ballot, personId: r.person_id, votes: r.votes })),
    });
  }
  return { year, parties };
}
