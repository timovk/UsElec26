/**
 * The economy and presidential approval in the running universe (docs/architecture/04 §4.12).
 *
 * - The economy steps once a month (on the 1st). Its truth is recorded; the Public Record sees releases on a
 *   realistic calendar: the jobs report on the first Friday (last month's unemployment), CPI mid-month (last
 *   month's inflation), and the GDP advance estimate about four weeks after each quarter.
 * - Approval is computed from the electorate each month (`approvalShare`): partisanship, the economy as each
 *   voter perceives it, the President's standing and a honeymoon. National pollsters publish approval polls.
 * - The President's party feels the same forces at the ballot box: `voteTerm` (logit, positive favours
 *   Democrats) is added to every election's environment.
 */
import { Rng } from '../core/rng';
import { civilToDays, daysToCivil, easternDay, weekday, zonedToUtc, type DayNumber } from '../core/time';
import { economicIndex, initialEconomy, monthIndex, monthOf, stepEconomy, type EconomyState } from '../economy/macro';
import { approvalShare } from '../electorate/measure';
import { PARTY_D, PARTY_R, fullName } from '../institutions/model';
import type { Db } from '../persistence/db';
import type { World } from './world';

export interface EconomyEngineState {
  econ: EconomyState;
  /** Unemployment of the last 13 months (truth), for year-on-year changes. */
  unempHist: number[];
  /** The President's standing (logit): events, scandals and the legislative record; decays toward zero. */
  standing: number;
  /** Day the current President took office (for the honeymoon). */
  presidentSince: DayNumber | null; presidentId: number | null;
  approval: number;
  nextPollId: number;
}

const ET = 'America/New_York';
const at = (day: DayNumber, hour: number, minute = 0) => { const c = daysToCivil(day); return zonedToUtc(c.y, c.m, c.d, hour, minute, ET); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const Q = ['first', 'second', 'third', 'fourth'];

export function emptyEconomyEngineState(seed: string, states: number): EconomyEngineState {
  const econ = initialEconomy(seed, states);
  return { econ, unempHist: [econ.unemployment], standing: 0, presidentSince: null, presidentId: null, approval: 0.47, nextPollId: 1 };
}

interface Host { world: World; db: Db; news: (kind: string, headline: string, body: string, refs: Record<string, unknown>, time?: number) => void }

export class EconomyEngine {
  constructor(private readonly h: Host, public st: EconomyEngineState) {}

  private get w() { return this.h.world; }

  /** The President's party (D/R) and the sign of shifts that help it (+1 Democrats). */
  private president(): { party: number; sign: number; personId: number | null } {
    const o = this.w.offices.find((x) => x.kind === 'president')!;
    const t = this.w.current.get(o.id);
    const party = t?.partyId ?? PARTY_D;
    return { party, sign: party === PARTY_R ? -1 : 1, personId: t?.personId ?? null };
  }

  /** Economic perception index (smoothed over the last quarter of truth). */
  econIndex(): number {
    const h = this.st.unempHist;
    return economicIndex(this.st.econ, h[Math.max(0, h.length - 13)] ?? this.st.econ.unemployment);
  }

  /** The economy and the President's standing, as felt at the ballot box (logit; positive favours Democrats). */
  voteTerm(): number {
    const p = this.president();
    return p.sign * (0.035 * Math.max(-3, Math.min(2, this.econIndex())) + 0.6 * this.st.standing);
  }

  private honeymoon(day: DayNumber): number {
    const since = this.st.presidentSince; if (since === null) return 0;
    const months = (day - since) / 30.4;
    return months < 0 ? 0 : 0.45 * Math.exp(-months / 5);
  }

  /** A shock to the President's standing (scandal −, rally or legislative win +), in logit units. */
  shock(x: number): void { this.st.standing = Math.max(-1, Math.min(1, this.st.standing + x)); }

  async daily(day: DayNumber): Promise<void> {
    const c = daysToCivil(day), st = this.st, db = this.h.db;
    const p = this.president();
    if (p.personId !== st.presidentId) { st.presidentId = p.personId; st.presidentSince = day; }
    // Month start: one month of the economy, standing decays and gets its random month, approval truth.
    if (c.d === 1) {
      const target = monthIndex(c.y, c.m);
      while (st.econ.month < target) {
        st.econ = stepEconomy(this.w.seed, st.econ);
        st.unempHist.push(st.econ.unemployment); if (st.unempHist.length > 13) st.unempHist.shift();
      }
      const r = Rng.stream(this.w.seed, 'standing', target);
      st.standing = 0.8 * st.standing + r.normal(0, 0.06);
      const ap = approvalShare(this.w.electorate, this.w.pop, p.sign, { econ: this.econIndex(), standing: st.standing, honeymoon: this.honeymoon(day) });
      st.approval = ap.approve;
      const e = st.econ;
      db.run('INSERT OR REPLACE INTO economy_month VALUES (?,?,?)', [target, JSON.stringify({ recession: e.recession, gdp: round(e.gdp, 2), unemployment: round(e.unemployment, 2), inflation: round(e.inflation, 2), income: round(e.income, 2), index: round(this.econIndex(), 3), stateUnemp: e.stateUnemp.map((u) => round(u, 1)) }),
        JSON.stringify({ approve: round(ap.approve, 4), copartisans: round(ap.copartisans, 4), opponents: round(ap.opponents, 4), standing: round(st.standing, 3), presidentId: p.personId })]);
    }
    this.releases(day);
    this.approvalPolls(day);
  }

  /** Scheduled releases of the Public Record (each from the month's truth already recorded). */
  private releases(day: DayNumber): void {
    const c = daysToCivil(day), db = this.h.db, wd = weekday(day);
    const rec = (m: number) => { const row = db.get<{ truth_json: string }>('SELECT truth_json FROM economy_month WHERE month = ?', [m]); return row ? JSON.parse(row.truth_json) as { gdp: number; unemployment: number; inflation: number; recession: boolean } : null; };
    const prevMonth = monthIndex(c.y, c.m) - 1;
    const put = (kind: string, period: string, value: number, prev: number | null, headline: string, body: string) => {
      db.run('INSERT INTO economic_release(sim_time, kind, period, value, previous) VALUES (?,?,?,?,?)', [at(day, 8, 30), kind, period, value, prev]);
      this.h.news('economy', headline, body, { kind }, at(day, 8, 30));
    };
    // Jobs report: the first Friday of the month.
    if (wd === 5 && c.d <= 7 && prevMonth >= 0) {
      const m = rec(prevMonth); const before = rec(prevMonth - 1);
      if (m) {
        const u = round(m.unemployment, 1), pu = before ? round(before.unemployment, 1) : null;
        const { m: pm } = monthOf(prevMonth);
        const verb = pu === null || u === pu ? 'holds at' : u < pu ? 'falls to' : 'rises to';
        put('unemployment', `${MONTHS[pm - 1]} ${monthOf(prevMonth).y}`, u, pu, `Unemployment ${verb} ${u.toFixed(1)}% in ${MONTHS[pm - 1]}`, `The monthly jobs report put the unemployment rate at ${u.toFixed(1)}%${pu !== null ? `, from ${pu.toFixed(1)}%` : ''}.`);
      }
    }
    // CPI: the second Wednesday.
    if (wd === 3 && c.d >= 8 && c.d <= 14 && prevMonth >= 0) {
      const m = rec(prevMonth); const before = rec(prevMonth - 1);
      if (m) {
        const v = round(m.inflation, 1), pv = before ? round(before.inflation, 1) : null;
        const { m: pm } = monthOf(prevMonth);
        if (pv === null || Math.abs(v - pv) >= 0.3 || v >= 4) put('inflation', `${MONTHS[pm - 1]} ${monthOf(prevMonth).y}`, v, pv, `Consumer prices up ${v.toFixed(1)}% over the past year`, `Annual inflation was ${v.toFixed(1)}% in ${MONTHS[pm - 1]}${pv !== null ? `, from ${pv.toFixed(1)}% the month before` : ''}.`);
        else db.run('INSERT INTO economic_release(sim_time, kind, period, value, previous) VALUES (?,?,?,?,?)', [at(day, 8, 30), 'inflation', `${MONTHS[pm - 1]} ${monthOf(prevMonth).y}`, v, pv]);
      }
    }
    // GDP advance estimate: the last Thursday of January, April, July and October (the previous quarter).
    if (wd === 4 && [1, 4, 7, 10].includes(c.m) && c.d + 7 > daysInMonth(c.y, c.m)) {
      const qEnd = monthIndex(c.y, c.m) - 1, ms = [qEnd - 2, qEnd - 1, qEnd].map(rec);
      if (ms.every(Boolean)) {
        const g = round(ms.reduce((a, m) => a + m!.gdp, 0) / 3, 1);
        const { y, m } = monthOf(qEnd); const q = Math.floor((m - 1) / 3);
        put('gdp', `Q${q + 1} ${y}`, g, null, g < 0 ? `The economy shrank at a ${Math.abs(g).toFixed(1)}% rate in the ${Q[q]} quarter` : `The economy grew at a ${g.toFixed(1)}% rate in the ${Q[q]} quarter`,
          `The first estimate of ${y} ${Q[q]}-quarter growth, adjusted for inflation, at an annual rate.`);
        // Two quarters of decline in the advance estimates: the word appears in the news.
        const prevQ = db.get<{ value: number }>("SELECT value FROM economic_release WHERE kind = 'gdp' ORDER BY release_id DESC LIMIT 1 OFFSET 1");
        if (g < 0 && prevQ && prevQ.value < 0) this.h.news('economy', 'Economists warn the economy is in recession', 'A second straight quarter of contraction.', {}, at(day, 10));
      }
    }
  }

  /** National pollsters' approval polls: each poll measures true approval with its house effect and sampling noise. */
  private approvalPolls(day: DayNumber): void {
    const db = this.h.db, st = this.st, p = this.president();
    if (p.personId === null) return;
    const pollsters = db.all<{ pollster_id: number; scope: string; params_json: string }>("SELECT pollster_id, scope, params_json FROM pollster WHERE scope = 'national' ORDER BY pollster_id");
    for (const pz of pollsters) {
      const r = Rng.stream(this.w.seed, 'approval-poll', pz.pollster_id, day);
      if (!r.bernoulli(0.06)) continue;
      const params = JSON.parse(pz.params_json) as { house: number; deff: number };
      const n = 900 + r.int(800);
      const house = 0.02 * Math.sign(params.house) * Math.min(2, Math.abs(params.house) / 0.02) * p.sign; // a Democratic-leaning house rates a Democratic President higher
      const und = 0.03 + 0.05 * r.float();
      const trueA = Math.min(0.98, Math.max(0.02, st.approval + house));
      const nEff = Math.max(100, Math.round(n / (params.deff || 1.5)));
      let a = 0; for (let i = 0; i < nEff; i++) if (r.float() < trueA) a++;
      const approve = round(100 * (a / nEff) * (1 - und), 0), disapprove = round(100 * (1 - a / nEff) * (1 - und), 0);
      db.run('INSERT INTO approval_poll(poll_id, pollster_id, subject, person_id, field_start, field_end, published, n, approve, disapprove) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [st.nextPollId++, pz.pollster_id, 'president', p.personId, day - 2 - r.int(3), day, at(day + 1, 7 + r.int(8)), n, approve, disapprove]);
    }
  }

  /** The latest published approval average (Public Record), for the forecast's fundamentals. */
  publishedApproval(day: DayNumber): number | null {
    const rows = this.h.db.all<{ field_end: number; approve: number; disapprove: number; n: number }>('SELECT field_end, approve, disapprove, n FROM approval_poll WHERE published < ? AND field_end >= ? ORDER BY field_end', [at(day, 0), day - 60]);
    if (rows.length < 3) return null;
    let s = 0, w = 0; for (const r of rows) { const ww = Math.exp(-(day - r.field_end) / 14) * Math.sqrt(r.n); s += ww * (100 * r.approve / Math.max(1, r.approve + r.disapprove)); w += ww; }
    return s / w;
  }

  /** Released economic figures (Public Record): the latest unemployment and its change over a year, the latest GDP estimate. */
  publishedEconomy(day: DayNumber): { unemployment: number | null; unempChange: number | null; gdp: number | null } {
    const t = at(day, 23);
    const u = this.h.db.all<{ value: number }>("SELECT value FROM economic_release WHERE kind = 'unemployment' AND sim_time <= ? ORDER BY sim_time DESC LIMIT 13", [t]);
    const g = this.h.db.value<number>("SELECT value FROM economic_release WHERE kind = 'gdp' AND sim_time <= ? ORDER BY sim_time DESC LIMIT 1", [t]);
    return { unemployment: u[0]?.value ?? null, unempChange: u.length >= 13 ? u[0]!.value - u[12]!.value : null, gdp: g ?? null };
  }

  /** A headline-worthy approval milestone, for the news (checked monthly by the caller). */
  describe(): string {
    const p = this.president(); const person = p.personId !== null ? this.w.persons.get(p.personId) : null;
    return person ? `${fullName(person)}: ${Math.round(100 * this.st.approval)}% approve` : '';
  }
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
function daysInMonth(y: number, m: number): number { return civilToDays(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - civilToDays(y, m, 1); }
export { easternDay };
