/**
 * Stylized-fact checks for long headless runs (the 50-year fixture run and the 2016 → 2040 acceptance run on
 * real geography). Each check names the fact, the tolerance and what was measured; the tests print them all
 * and assert every one. Tolerances are wide on purpose: they catch a broken or runaway simulation, not a
 * universe that merely differs from American history.
 */
import { zonedToUtc } from '../../../src/core/time';
import { integrityReport } from '../../../src/persistence/audit';
import type { Universe } from '../../../src/engine/universe';

const ET = 'America/New_York';
export interface Check { name: string; ok: boolean; detail: string }
export interface YearRow {
  year: number; seconds: number; president: number | null; houseD: number; houseR: number; senateD: number; senateR: number; govD: number; govR: number;
  legD: number; legR: number; lean: number | null; approval: number | null; unemployment: number | null; adults: number | null; age65: number | null; gap: number | null; persons: number;
}

const PARTY = (p: number | null) => (p === 1 ? 'D' : p === 2 ? 'R' : p === null ? '—' : String(p));

function heldBy(u: Universe, kind: string, t: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of u.db.all<{ p: number | null; n: number }>('SELECT t.party_id p, COUNT(*) n FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE o.kind = ? AND t.start_time <= ? AND (t.end_time IS NULL OR t.end_time > ?) GROUP BY t.party_id', [kind, t, t])) m.set(r.p ?? 0, r.n);
  return m;
}

/** The state of the universe on January 1 of `year` (call right after advancing to it). */
export function yearRow(u: Universe, year: number, seconds: number): YearRow {
  const t = u.world.time, w = u.world;
  const house = heldBy(u, 'us_representative', t), senate = heldBy(u, 'us_senator', t), gov = heldBy(u, 'governor', t);
  const pres = u.db.get<{ p: number | null }>("SELECT t.party_id p FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE o.kind = 'president' AND t.end_time IS NULL");
  let legD = 0, legR = 0;
  for (const c of w.chambers) if (c.kind === 'state_upper' || c.kind === 'state_lower') { const d = c.composition.get(1) ?? 0, r = c.composition.get(2) ?? 0; if (2 * d > c.seats) legD++; else if (2 * r > c.seats) legR++; }
  const el = u.db.get<{ national_lean: number; platforms_json: string }>('SELECT national_lean, platforms_json FROM electorate_year WHERE year = ?', [year]);
  const pl = el ? JSON.parse(el.platforms_json) as { D: number[]; R: number[] } : null;
  const em = u.db.get<{ truth_json: string; approval_json: string }>('SELECT truth_json, approval_json FROM economy_month ORDER BY month DESC LIMIT 1');
  const dm = u.db.get<{ summary_json: string }>('SELECT summary_json FROM demography_year WHERE year = ?', [year]);
  const ds = dm ? JSON.parse(dm.summary_json) as { adults: number; age: number[] } : null;
  return {
    year, seconds, president: pres?.p ?? null, houseD: house.get(1) ?? 0, houseR: house.get(2) ?? 0, senateD: senate.get(1) ?? 0, senateR: senate.get(2) ?? 0, govD: gov.get(1) ?? 0, govR: gov.get(2) ?? 0,
    legD, legR, lean: el?.national_lean ?? null, approval: em ? (JSON.parse(em.approval_json) as { approve: number }).approve : null, unemployment: em ? (JSON.parse(em.truth_json) as { unemployment: number }).unemployment : null,
    adults: ds?.adults ?? null, age65: ds?.age[3] ?? null, gap: pl ? Math.hypot(...pl.D.map((x, i) => x - pl.R[i]!)) : null, persons: w.persons.size,
  };
}

export function formatRows(rows: YearRow[]): string {
  const head = 'year   s   pres  House D–R  Senate D–R  Gov D–R  Leg D–R  lean    approve unemp  adults(M) 65+   gap   persons';
  return [head, ...rows.map((r) => [
    r.year, String(Math.round(r.seconds)).padStart(4), PARTY(r.president).padStart(4), `${r.houseD}–${r.houseR}`.padStart(10), `${r.senateD}–${r.senateR}`.padStart(11), `${r.govD}–${r.govR}`.padStart(8), `${r.legD}–${r.legR}`.padStart(8),
    (r.lean === null ? '—' : `${r.lean >= 0 ? 'D' : 'R'}+${Math.abs(r.lean).toFixed(1)}`).padStart(7), (r.approval === null ? '—' : `${(100 * r.approval).toFixed(0)}%`).padStart(7),
    (r.unemployment === null ? '—' : r.unemployment.toFixed(1)).padStart(6), (r.adults === null ? '—' : (r.adults / 1e6).toFixed(1)).padStart(9), (r.age65 === null ? '—' : `${(100 * r.age65).toFixed(1)}%`).padStart(6),
    (r.gap === null ? '—' : r.gap.toFixed(2)).padStart(6), String(r.persons).padStart(8),
  ].join(' '))].join('\n');
}

export interface CheckOptions { from: number; to: number; real: boolean }

/** Every check over a run from January 1 of `from` to January 1 of `to`. */
export function longRunChecks(u: Universe, rows: YearRow[], o: CheckOptions): Check[] {
  const db = u.db, w = u.world, pack = w.pack, out: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail });
  const span = o.to - o.from;

  // ---- Integrity, succession and career continuity -------------------------------------------------------
  const rep = integrityReport(db);
  add('Database integrity', rep.ok, rep.checks.filter((c) => !c.ok).map((c) => c.detail).join('; ') || 'ok');
  const overlap = Number(db.value('SELECT COUNT(*) FROM office_term a JOIN office_term b ON a.office_id = b.office_id AND a.term_id < b.term_id AND b.start_time < COALESCE(a.end_time, 9e15) AND a.start_time < COALESCE(b.end_time, 9e15)'));
  add('Office succession: no office ever has two holders at once', overlap === 0, `${overlap} overlapping pairs of terms`);
  const backwards = Number(db.value('SELECT COUNT(*) FROM office_term WHERE end_time IS NOT NULL AND end_time < start_time'));
  add('Career continuity: every term ends after it starts', backwards === 0, `${backwards} terms end before they start`);
  const seats = "('president','vice_president','us_senator','us_representative','governor','state_senator','state_representative')";
  const two = db.all<{ person_id: number; a: string; b: string; as: number; ae: number | null; bs: number; be: number | null; ar: string | null; acq: string }>(`SELECT a.person_id, oa.title a, ob.title b, a.start_time "as", a.end_time ae, b.start_time bs, b.end_time be, a.end_reason ar, b.acquired acq
    FROM office_term a JOIN office oa ON oa.office_id = a.office_id JOIN office_term b ON b.person_id = a.person_id AND b.term_id > a.term_id JOIN office ob ON ob.office_id = b.office_id
    WHERE oa.kind IN ${seats} AND ob.kind IN ${seats} AND b.start_time < COALESCE(a.end_time, 9e15) AND a.start_time < COALESCE(b.end_time, 9e15)
    -- Where the state senate's presiding officer is first in line (West Virginia, Tennessee), they act as governor while keeping the seat.
    AND NOT (oa.kind IN ('state_senator','state_representative') AND ob.kind = 'governor' AND b.acquired LIKE 'succeeded%')`);
  add('Career continuity: nobody holds two elected seats at once (except a senate president acting as governor)', two.length === 0, `${two.length} overlapping pairs${two.slice(0, 4).map((r) => `; person ${r.person_id}: ${r.a} [${r.as}–${r.ae ?? 'now'}, ${r.ar ?? ''}] and ${r.b} [${r.bs}–${r.be ?? 'now'}, ${r.acq}]`).join('')}`);
  const afterDeath = Number(db.value('SELECT COUNT(*) FROM office_term t JOIN person p ON p.person_id = t.person_id WHERE p.death_day IS NOT NULL AND t.start_time > p.death_day * 1440 + 1440'));
  add('Career continuity: no term starts after its holder died', afterDeath === 0, `${afterDeath} terms`);
  // The presidency is never empty for more than a day (succession is immediate).
  const pres = db.all<{ start_time: number; end_time: number | null }>("SELECT t.start_time, t.end_time FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE o.kind = 'president' ORDER BY t.start_time");
  let maxGap = 0; for (let i = 1; i < pres.length; i++) maxGap = Math.max(maxGap, pres[i]!.start_time - (pres[i - 1]!.end_time ?? pres[i]!.start_time));
  add('Succession: the presidency is never vacant', maxGap <= 1440 && pres[pres.length - 1]!.end_time === null, `longest gap ${maxGap} minutes over ${pres.length} terms`);
  const stale = Number(db.value('SELECT COUNT(*) FROM vacancy WHERE since < ?', [w.time - 800 * 1440]));
  add('Succession: no vacancy lasts more than about two years', stale === 0, `${stale} vacancies older than 800 days; ${db.value('SELECT COUNT(*) FROM vacancy')} open now`);
  const specials = Number(db.value("SELECT COUNT(*) FROM contest WHERE kind = 'special' AND parent_contest IS NULL"));
  add('Special elections are held', specials >= Math.max(1, Math.floor(span / 4)), `${specials} special elections`);
  const ladder = Number(db.value("SELECT COUNT(DISTINCT a.person_id) FROM office_term a JOIN office oa ON oa.office_id = a.office_id JOIN office_term b ON b.person_id = a.person_id AND b.start_time > a.start_time JOIN office ob ON ob.office_id = b.office_id WHERE oa.kind IN ('state_senator','state_representative') AND ob.kind IN ('us_representative','us_senator','governor')"));
  add('Career ladders: state legislators move up to Congress or governorships', ladder >= Math.max(3, span), `${ladder} people`);

  // ---- Elections and politics --------------------------------------------------------------------------
  const presParties = rows.map((r) => r.president);
  let presChanges = 0; for (let i = 1; i < presParties.length; i++) if (presParties[i] !== presParties[i - 1]) presChanges++;
  add('The presidency changes hands', presChanges >= Math.floor(span / 12), `${presChanges} changes of party: ${presParties.map(PARTY).join('')}`);
  // Longest run of one party in the White House (years): at most 24 (FDR–Truman was 20).
  let run = 1, longest = 1; for (let i = 1; i < presParties.length; i++) { run = presParties[i] === presParties[i - 1] ? run + 1 : 1; longest = Math.max(longest, run); }
  add('No party holds the presidency for more than 24 years in a row', longest <= 24, `longest run ${longest} years`);
  const houseMaj = rows.map((r) => (r.houseD > r.houseR ? 1 : 2));
  let houseChanges = 0; for (let i = 1; i < houseMaj.length; i++) if (houseMaj[i] !== houseMaj[i - 1]) houseChanges++;
  add('House control changes', houseChanges >= Math.floor(span / 15), `${houseChanges} changes: ${houseMaj.map(PARTY).join('')}`);
  add('The House always has 435 members (or vacancies)', rows.every((r) => r.houseD + r.houseR <= 435) && Number(db.value("SELECT COUNT(*) FROM office o WHERE o.kind = 'us_representative' AND o.office_id NOT IN (SELECT office_id FROM office_abolished WHERE last_year < ?)", [o.to])) === 435,
    `${Number(db.value("SELECT COUNT(*) FROM office o WHERE o.kind = 'us_representative' AND o.office_id NOT IN (SELECT office_id FROM office_abolished WHERE last_year < ?)", [o.to]))} seats in effect`);
  // No chamber beyond historical extremes (the records: 76 Democratic senators and 334 Democratic representatives, both 1937).
  const maxSen = Math.max(...rows.map((r) => Math.max(r.senateD, r.senateR))), maxHouse = Math.max(...rows.map((r) => Math.max(r.houseD, r.houseR)));
  add('No one-party majority beyond historical extremes (Senate ≤ 80, House ≤ 345)', maxSen <= 80 && maxHouse <= 345, `largest Senate majority ${maxSen}, largest House majority ${maxHouse}`);
  // The midterm penalty: the President's party loses House seats in most midterms.
  let midterms = 0, losses = 0; const mtDetail: string[] = [];
  for (let y = o.from; y < o.to; y++) {
    if (y % 4 !== 2) continue;
    const before = zonedToUtc(y + 1, 1, 2, 12, 0, ET), after = zonedToUtc(y + 1, 1, 4, 12, 0, ET);
    if (after > w.time) continue;
    const pp = db.get<{ p: number | null }>("SELECT t.party_id p FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE o.kind = 'president' AND t.start_time <= ? AND (t.end_time IS NULL OR t.end_time > ?)", [before, before])?.p ?? null;
    if (pp === null) continue;
    const b = heldBy(u, 'us_representative', before).get(pp) ?? 0, a = heldBy(u, 'us_representative', after).get(pp) ?? 0;
    midterms++; if (a < b) losses++; mtDetail.push(`${y} ${PARTY(pp)} ${a - b >= 0 ? '+' : ''}${a - b}`);
  }
  add("The President's party usually loses House seats at midterms", midterms === 0 || losses / midterms >= 0.6, `${losses} of ${midterms}: ${mtDetail.join(', ')}`);
  const inc = db.all<{ year: number; won: number; n: number }>("SELECT c.year, SUM(k.status = 'won') won, COUNT(*) n FROM candidacy k JOIN contest c ON c.contest_id = k.contest_id JOIN office o ON o.office_id = c.office_id WHERE c.kind = 'general' AND o.kind = 'us_representative' AND k.incumbent = 1 AND c.year < ? GROUP BY c.year ORDER BY c.year", [o.to]);
  add('House incumbents are usually re-elected (80–99%)', inc.length > 0 && inc.every((r) => r.won / r.n >= 0.8 && r.won / r.n <= 0.995), inc.map((r) => `${r.year} ${(100 * r.won / r.n).toFixed(0)}%`).join(', '));
  const open = db.all<{ year: number; n: number }>("SELECT c.year, COUNT(*) n FROM contest c JOIN office o ON o.office_id = c.office_id WHERE c.kind = 'general' AND o.kind = 'us_representative' AND c.parent_contest IS NULL AND c.year < ? AND NOT EXISTS (SELECT 1 FROM candidacy k WHERE k.contest_id = c.contest_id AND k.incumbent = 1) GROUP BY c.year ORDER BY c.year", [o.to]);
  add('Open House seats every cycle (10–90)', open.length > 0 && open.every((r) => r.n >= 10 && r.n <= 90), open.map((r) => `${r.year} ${r.n}`).join(', '));
  const turnout = db.all<{ year: number; b: number; e: number }>("SELECT x.year, SUM(t.ballots) b, SUM(t.eligible) e FROM election_turnout t JOIN election x ON x.election_id = t.election_id WHERE x.kind = 'general' GROUP BY x.year ORDER BY x.year");
  const tp = turnout.filter((r) => r.year % 4 === 0), tm = turnout.filter((r) => r.year % 4 === 2);
  add('Turnout: presidential years 48–72% of eligible voters, midterms lower', tp.every((r) => r.b / r.e >= 0.48 && r.b / r.e <= 0.72) && tm.every((r) => tp.some((p) => Math.abs(p.year - r.year) === 2 && r.b / r.e < p.b / p.e)),
    turnout.map((r) => `${r.year} ${(100 * r.b / r.e).toFixed(0)}%`).join(', '));
  // State chambers change hands now and then.
  const comp = db.all<{ chamber_id: number; as_of: number; party_id: number; seats: number }>("SELECT c.chamber_id, c.as_of, c.party_id, c.seats FROM chamber_composition c JOIN chamber h ON h.chamber_id = c.chamber_id WHERE h.kind IN ('state_upper','state_lower') ORDER BY c.chamber_id, c.as_of");
  const byChamber = new Map<number, Map<number, Map<number, number>>>();
  for (const r of comp) { const m = byChamber.get(r.chamber_id) ?? new Map(); const s = m.get(r.as_of) ?? new Map(); s.set(r.party_id, r.seats); m.set(r.as_of, s); byChamber.set(r.chamber_id, m); }
  let flips = 0;
  for (const [id, snaps] of byChamber) {
    const ch = w.chambers.find((c) => c.id === id)!; let prev: number | null = null;
    for (const s of snaps.values()) { const d = s.get(1) ?? 0, r = s.get(2) ?? 0; const m = 2 * d > ch.seats ? 1 : 2 * r > ch.seats ? 2 : null; if (m !== null && prev !== null && m !== prev) flips++; if (m !== null) prev = m; }
  }
  add('State legislative chambers change hands', flips >= Math.max(3, span), `${flips} changes of control across 99 chambers`);
  const legSeats = w.chambers.filter((c) => c.kind === 'state_upper' || c.kind === 'state_lower').reduce((a, c) => a + c.seats, 0);
  const legHeld = Number(db.value("SELECT COUNT(*) FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE t.end_time IS NULL AND o.kind IN ('state_senator','state_representative')"));
  add('State legislative seats are filled (≥ 97%)', legHeld >= 0.97 * legSeats, `${legHeld} of ${legSeats}`);

  // ---- The electorate and the economy ------------------------------------------------------------------
  const leans = rows.map((r) => r.lean).filter((x): x is number => x !== null);
  let jump = 0; for (let i = 1; i < leans.length; i++) jump = Math.max(jump, Math.abs(leans[i]! - leans[i - 1]!));
  add('The national lean stays competitive (within ±12) and moves gradually (≤ 4 a year)', leans.every((x) => Math.abs(x) <= 12) && jump <= 4, `range ${Math.min(...leans).toFixed(1)} to ${Math.max(...leans).toFixed(1)}; largest yearly move ${jump.toFixed(1)}`);
  const gaps = rows.map((r) => r.gap).filter((x): x is number => x !== null);
  add('The parties stay distinct (platform distance ≥ 0.7) and bounded (≤ 4)', gaps.every((g) => g >= 0.7 && g <= 4), `distance ${Math.min(...gaps).toFixed(2)}–${Math.max(...gaps).toFixed(2)}`);
  const months = db.all<{ truth_json: string; approval_json: string }>('SELECT truth_json, approval_json FROM economy_month ORDER BY month');
  const ap = months.map((m) => (JSON.parse(m.approval_json) as { approve: number }).approve), un = months.map((m) => JSON.parse(m.truth_json) as { unemployment: number; recession: boolean });
  const mean = ap.reduce((a, b) => a + b, 0) / ap.length;
  add('Presidential approval: mean 38–58%, varying by more than 12 points', mean >= 0.38 && mean <= 0.58 && Math.max(...ap) - Math.min(...ap) > 0.12, `mean ${(100 * mean).toFixed(1)}%, range ${(100 * Math.min(...ap)).toFixed(0)}–${(100 * Math.max(...ap)).toFixed(0)}%`);
  const rec = un.filter((m) => m.recession).length / un.length;
  add('Economy: unemployment 2.5–12%, recessions in 5–35% of months', un.every((m) => m.unemployment >= 2.5 && m.unemployment <= 12) && rec >= 0.05 && rec <= 0.35 || (span < 12 && rec <= 0.35),
    `unemployment ${Math.min(...un.map((m) => m.unemployment)).toFixed(1)}–${Math.max(...un.map((m) => m.unemployment)).toFixed(1)}%, recession months ${(100 * rec).toFixed(0)}%`);

  // ---- Demography, the census, apportionment and maps ----------------------------------------------------
  const a0 = rows[0]!.adults!, a1 = rows[rows.length - 1]!.adults!;
  const growth = a1 / a0 - 1, lo = 0.004 * span, hi = 0.02 * span;
  add(`Adult population grows (${(100 * lo).toFixed(0)}–${(100 * hi).toFixed(0)}% over ${span} years)`, growth >= lo && growth <= hi, `${(a0 / 1e6).toFixed(1)}M → ${(a1 / 1e6).toFixed(1)}M (${(100 * growth).toFixed(1)}%)`);
  add('The electorate ages (65+ share rises)', rows[rows.length - 1]!.age65! > rows[0]!.age65!, `${(100 * rows[0]!.age65!).toFixed(1)}% → ${(100 * rows[rows.length - 1]!.age65!).toFixed(1)}%`);
  const censuses = db.all<{ census_year: number; seats: number; n: number; zero: number }>('SELECT census_year, SUM(seats) seats, COUNT(*) n, SUM(seats = 0) zero FROM census WHERE seats IS NOT NULL GROUP BY census_year ORDER BY census_year');
  const expectCensus = []; for (let y = 2020; y < o.to; y += 10) if (zonedToUtc(y, 12, 31, 12, 0, ET) <= w.time) expectCensus.push(y);
  add('Every decennial census apportions 435 seats (at least one per state)', censuses.map((c) => c.census_year).join(',') === expectCensus.join(',') && censuses.every((c) => c.seats === 435 && c.zero <= 1 /* DC */), censuses.map((c) => `${c.census_year}: ${c.seats}`).join(', ') || 'none yet');
  const plans = db.all<{ kind: string; state_idx: number; census_year: number; first_year: number; stats_json: string }>('SELECT kind, state_idx, census_year, first_year, stats_json FROM district_plan ORDER BY plan_id');
  const bad = plans.filter((p) => { const s = JSON.parse(p.stats_json) as { maxDeviation: number; contiguous: boolean }; return !s.contiguous || s.maxDeviation > (p.kind === 'cd' ? 0.01 : 0.1); });
  const devs = plans.map((p) => (JSON.parse(p.stats_json) as { maxDeviation: number }).maxDeviation).sort((a, b) => a - b);
  const med = devs.length ? devs[Math.floor(devs.length / 2)]! : 0;
  // The fixture has a handful of BUs per state, too coarse for equal-population districts: reported, not asserted.
  add(`Every new plan is contiguous, within 1% (House) or 10% (legislature) of equal population${o.real ? '' : ' (reported only: the fixture is too coarse)'}`, !o.real || bad.length === 0,
    `${plans.length} plans, median deviation ${(100 * med).toFixed(2)}%; failing: ${bad.length > 12 ? `${bad.length} plans` : bad.map((p) => `${pack.states[p.state_idx]!.usps} ${p.kind} ${p.first_year}`).join(', ') || 'none'}`);
  const cdPlans = plans.filter((p) => p.kind === 'cd');
  for (const c of censuses) {
    const multi = db.all<{ state_idx: number; seats: number }>('SELECT state_idx, seats FROM census WHERE census_year = ? AND seats > 1', [c.census_year]);
    const drawn = new Set(cdPlans.filter((p) => p.census_year === c.census_year).map((p) => p.state_idx));
    const firstYear = c.census_year + 2;
    if (zonedToUtc(firstYear, 1, 1, 0, 0, ET) > w.time) continue;
    const missing = multi.filter((s) => !drawn.has(s.state_idx));
    const wrongCount = multi.filter((s) => w.districts.districtsOf('cd', s.state_idx, firstYear).length !== s.seats);
    add(`New House maps after the ${c.census_year} census for every state with more than one seat`, missing.length === 0 && wrongCount.length === 0, `${drawn.size} plans; missing ${missing.map((s) => pack.states[s.state_idx]!.usps).join(',') || 'none'}; wrong district count ${wrongCount.map((s) => pack.states[s.state_idx]!.usps).join(',') || 'none'}`);
  }
  // Old maps stay intact: the 2016 plan still resolves to the pack's districts, and old contests to it.
  const a2016 = w.districts.assignment('cd', 2016);
  let same = a2016.length === pack.bu.cd.length; for (let b = 0; same && b < a2016.length; b++) if (a2016[b] !== pack.bu.cd[b]) same = false;
  const oldContests = Number(db.value("SELECT COUNT(*) FROM contest c JOIN office o ON o.office_id = c.office_id WHERE o.kind = 'us_representative' AND c.year <= 2020 AND c.district_idx >= ?", [pack.cds.length]));
  const newContests = Number(db.value("SELECT COUNT(*) FROM contest c JOIN office o ON o.office_id = c.office_id WHERE o.kind = 'us_representative' AND c.kind = 'general' AND c.year >= 2022 AND c.district_idx < ? AND c.state_idx IN (SELECT state_idx FROM district_plan WHERE kind = 'cd')", [pack.cds.length]));
  add('Old maps stay intact: the 2016 plan and pre-2022 contests keep the 2016 districts; later contests use the new plans', same && oldContests === 0 && newContests === 0, `2016 assignment ${same ? 'identical' : 'CHANGED'}; ${oldContests} pre-2022 House contests on new districts; ${newContests} later contests on old districts`);
  const nyears = db.all<{ year: number; n: number }>("SELECT c.year, COUNT(*) n FROM contest c JOIN office o ON o.office_id = c.office_id WHERE o.kind = 'us_representative' AND c.kind = 'general' AND c.parent_contest IS NULL AND c.year < ? GROUP BY c.year ORDER BY c.year", [o.to]);
  add('Every regular House election has 435 races', nyears.every((r) => r.n === 435), nyears.map((r) => `${r.year} ${r.n}`).join(', '));
  if (o.real) {
    const rs = rows.map((r) => r.seconds).filter((s) => s > 0);
    add('Speed (reported, not asserted)', true, `median ${Math.round([...rs].sort((a, b) => a - b)[Math.floor(rs.length / 2)] ?? 0)} s per year, max ${Math.round(Math.max(...rs))} s`);
  }
  return out;
}
