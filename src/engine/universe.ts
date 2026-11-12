/**
 * The Universe: authoritative simulation state plus its database. Lives in the Engine Worker.
 * Time advances by discrete events: a daily tick (06:00 Eastern) and one-off scheduled events.
 */
import { Rng } from '../core/rng';
import { MINUTES_PER_DAY, easternDay, zonedToUtc, utcToZoned, daysToCivil, ageOn, type SimTime } from '../core/time';
import { sha256Hex } from '../core/codec';
import type { Db } from '../persistence/db';
import { migrate, SCHEMA_VERSION } from '../persistence/schema';
import type { Storage } from '../persistence/storage';
import { UNIVERSE_DIR } from '../persistence/storage';
import { loadGeoPack, SEMANTIC_FILES, type GeoPack } from '../geo/pack';
import { buildPopulation } from '../population/population';
import { rebuildElectorate } from '../electorate/model';
import { BASE_PARTIES, PARTY_D, PARTY_R, PRE_SIM, SIMULATED, fullName, type NewsItem, type Office, type Person, type Term } from '../institutions/model';
import { STATES_2016 } from '../rules/states2016';
import { NameGenerator, type NameData } from '../politicians/names';
import { generatePerson } from '../politicians/generate';
import { genesis, type Progress } from './genesis';
import { aggregateLean, emptyPending, type World } from './world';
import { loadRows, prepareStateBlobs, rawJsonBlob, readJsonState, writeChamberCompositions, writeGenesis, writePending, writeStateBlobs, type ScheduledEvent } from './save';
import { ElectionEngine, emptyElectionState, type ElectionHost, type ElectionState, type PersonOptions } from './elections';
import { InlineRunner, type ShardRunner } from './computePool';
import { Evolution, type StateBlob } from './evolution';
import { Districts } from './districts';
import { loadElectionLaw } from './lawStore';
import { CensusEngine } from './census';
import { CareersEngine, emptyCareersState, type CareersState } from './careersEngine';
import { GovernmentEngine, emptyGovernmentState, type GovernmentState } from './governmentEngine';
import { materializeLegislatures, reseatChamber } from './legislatures';
import { courtsMonthly, courtsYearStart, fillSeat, materializeDownballot, seatVacancyResolution, type CourtHost } from './downballot';
import { EconomyEngine, emptyEconomyEngineState, type EconomyEngineState } from './economyEngine';
import { SIM_START } from '../core/time';

const ELECTION_EVENTS = new Set(['general', 'primary', 'runoff', 'special', 'pres_nomination']);
export const ENGINE_VERSION = '0.7.4';
/**
 * The phase in which the engine (the simulation itself) last changed, shown with ENGINE_VERSION in Settings → About.
 * Change both together. A phase that changes only screens, maps or pages (7.5) leaves both as they are.
 */
export const ENGINE_UPDATED_IN = '7.4';
/** How often (wall time) a long advance commits its batched writes to storage. */
const COMMIT_INTERVAL_MS = 10000;

export type AdvanceTarget = { kind: 'days'; days: number } | { kind: 'until'; time: SimTime } | { kind: 'nextEvent'; maxDays?: number } | { kind: 'nextElection' };

export interface CreateOptions { name: string; seed?: string }

function randomSeed(): string {
  const b = new Uint8Array(8); crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12).toUpperCase();
}

export class Universe {
  private queue: ScheduledEvent[] = [];
  private names: NameGenerator | null = null;
  private dirtyChambers = false;
  /** Kernel shard executor: inline by default; the Engine Worker installs a Compute Worker pool. */
  runner: ShardRunner = new InlineRunner();
  onProgress: (step: string, fraction: number) => void = () => {};
  readonly elections: ElectionEngine;
  private electionStateJson = '';
  /** Demography and the electorate's long-run evolution (stepped each January 1). */
  evolution!: Evolution;
  /** Compressed state blobs prepared outside a transaction, written by the next commit. */
  private pendingBlobs: StateBlob[] = [];
  /** The economy and presidential approval. */
  readonly economy: EconomyEngine;
  /** Census, apportionment and redistricting. */
  readonly census: CensusEngine;
  /** Scandals, resignations, cabinet turnover, party switches and leadership elections. */
  readonly careers: CareersEngine;
  private careersStateJson = '';
  /** Congress (major bills and roll calls), vetoes, and state legislative sessions. */
  readonly government: GovernmentEngine;
  private governmentStateJson = '';
  private economyStateJson = '';

  private constructor(readonly storage: Storage, readonly fileName: string, readonly db: Db, readonly world: World, private readonly nameData: NameData | null, electionState: ElectionState, economyState: EconomyEngineState, careersState: CareersState, governmentState: GovernmentState | null) {
    const getRunner = () => this.runner;
    this.economy = new EconomyEngine({ world, db, news: (k, h, b, r, tm) => this.news(k, h, b, r, tm) }, economyState);
    this.careers = new CareersEngine({
      world, db, news: (k, h, b, r, tm) => this.news(k, h, b, r, tm),
      endTerm: (o, r) => this.endTerm(o, r), startTerm: (o, p, a) => this.startTerm(o, p, a), vacate: (o, r) => this.vacate(o, r),
      succession: (o, p, c) => this.succession(o, p, c), shockPresident: (x) => this.economy.shock(x),
      career: (personId, kind, text) => { const y = daysToCivil(easternDay(world.time)).y; world.pending.careers.push({ id: world.ids.career++, personId, yearFrom: y, yearTo: null, simTime: world.time, kind, text, provenance: SIMULATED }); },
      setParty: (person, party) => this.setParty(person, party),
    }, careersState);
    this.careersStateJson = JSON.stringify(careersState);
    const gs = governmentState ?? emptyGovernmentState(world.electorate.params.platforms);
    this.government = new GovernmentEngine({ world, db, news: (k, h, b, r, tm) => this.news(k, h, b, r, tm), shockPresident: (x) => this.economy.shock(x) }, gs);
    this.governmentStateJson = JSON.stringify(gs);
    this.census = new CensusEngine({
      world, db, evolution: () => this.evolution,
      schedule: (t, k, d, p) => this.schedule(t, k, d, p), news: (k, h, b, r, tm) => this.news(k, h, b, r, tm),
      commit: (extra) => this.commit(null, extra), progress: (st, f) => this.onProgress(st, f),
      endTerm: (o, r) => { this.endTerm(o, r); },
      officeAbolished: (o, y) => { world.districts.markAbolished(o, y); db.run('INSERT OR REPLACE INTO office_abolished VALUES (?,?,?)', [o, y, 'reapportionment']); },
    });
    this.economyStateJson = JSON.stringify(economyState);
    const host: ElectionHost = {
      world, db, get runner() { return getRunner(); },
      schedule: (t, k, d, p) => this.schedule(t, k, d, p), news: (k, h, b, r, tm) => this.news(k, h, b, r, tm),
      newPerson: (r, tier, party, st, opts) => this.newPerson(r, tier, party, st, opts),
      startTerm: (o, p, a, pr) => this.startTerm(o, p, a, pr), endTerm: (o, r) => this.endTerm(o, r),
      succession: (o, p, c) => this.succession(o, p, c), vacate: (o, r, res) => this.vacate(o, r, res),
      commit: (extra) => this.commit(null, extra), progress: (st, f) => this.onProgress(st, f),
      voteTerm: () => this.economy.voteTerm(),
      deferSql: (sql, params) => { this.pendingSql.push([sql, params]); },
      scandalOf: (personId) => this.careers.scandalOf(personId, easternDay(this.world.time)),
      publicFundamentals: (day) => ({ approval: this.economy.publishedApproval(day), ...this.economy.publishedEconomy(day) }),
    };
    this.elections = new ElectionEngine(host, electionState);
    this.electionStateJson = JSON.stringify(electionState);
  }

  get id(): string { return this.fileName.slice(UNIVERSE_DIR.length, -'.sqlite3'.length); }

  // ---- Lifecycle -------------------------------------------------------------------------------

  static async create(storage: Storage, opts: CreateOptions, packFiles: Map<string, Uint8Array>, names: NameData, progress: Progress = () => {}): Promise<Universe> {
    const seed = (opts.seed?.trim() || randomSeed()).slice(0, 64);
    const pack = await loadGeoPack(async (f) => { const b = packFiles.get(f); if (!b) throw new Error(`geo pack file missing: ${f}`); return b; });
    const { world, careers, scheduled } = genesis({ seed, name: opts.name || 'Untitled universe', pack, names }, progress);
    progress('Saving the universe', 0.9);
    const id = `${randomSeed().toLowerCase()}-${seed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)}`;
    const fileName = `${UNIVERSE_DIR}u-${id}.sqlite3`;
    const events: ScheduledEvent[] = scheduled.map((s, i) => ({ id: i + 1, time: s.time, priority: 10, kind: 'assume_office', data: { ...s } }));
    events.push({ id: events.length + 1, time: SIM_START + 5, priority: 1, kind: 'plan_year', data: { year: 2016 } });
    world.ids.event = events.length + 1;
    const db = storage.open(fileName);
    try {
      db.exec('PRAGMA page_size = 8192');
      migrate(db);
      progress('Saving the universe: compressing state', 0.91);
      const blobs = await prepareStateBlobs(world, true);
      progress('Saving the universe: hashing geography', 0.93);
      const packRows: [string, string, Uint8Array][] = [];
      for (const f of SEMANTIC_FILES) { const b = packFiles.get(f)!; packRows.push([f, await sha256Hex(b), b]); }
      const packSha = await sha256Hex(packFiles.get('manifest.json')!);
      progress('Saving the universe: writing database', 0.95);
      db.tx(() => {
        writeGenesis(db, world, careers, events, { createdReal: new Date().toISOString(), geoPack: pack.version, geoSha: packSha, engineVersion: ENGINE_VERSION, options: { seed } });
        writePending(db, world);
        writeStateBlobs(db, world.time, [...blobs, rawJsonBlob('elections.state', emptyElectionState())]);
        db.insertMany('INSERT INTO geo_pack_file VALUES (?,?,?)', packRows);
        db.run('INSERT INTO engine_ledger(from_time, to_time, engine_version, schema_version) VALUES (?,?,?,?)', [world.startTime, null, ENGINE_VERSION, SCHEMA_VERSION]);
        db.run('INSERT INTO command_log(sim_time, command_json) VALUES (?,?)', [world.time, JSON.stringify({ kind: 'universe.create', name: world.name, seed })]);
        db.run("INSERT INTO meta VALUES ('created_real', ?), ('last_export_real', '')", [new Date().toISOString()]);
      });
      storage.flush(fileName, db);
    } catch (e) { db.close(); storage.remove(fileName); throw e; }
    const u = new Universe(storage, fileName, db, world, names, emptyElectionState(), emptyEconomyEngineState(seed, pack.states.length), emptyCareersState(), null);
    u.evolution = Evolution.fresh(world);
    db.tx(() => u.evolution.recordBaseline(db));
    u.queue = scheduledFromDb(db);
    await u.ensureLegislatures();
    u.ensureDownballot();
    u.ensureMeasureOffices();
    for (const t of world.current.values()) if (t.partyId !== null) u.lastParty.set(t.officeId, t.partyId);
    return u;
  }

  /** Open a saved universe. Semantic geography is read from the universe's own copy of the pack. */
  static async open(storage: Storage, fileName: string, names: NameData | null): Promise<Universe> {
    const db = storage.open(fileName);
    try {
      const qc = db.value<string>('PRAGMA quick_check');
      if (qc !== 'ok') throw new Error(`Database integrity check failed: ${qc}`);
      migrate(db);
      const files = new Map(db.all<{ name: string; payload: Uint8Array }>('SELECT name, payload FROM geo_pack_file').map((r) => [r.name, r.payload]));
      const pack = await loadGeoPack(async (f) => { const b = files.get(f); if (!b) throw new Error(`universe is missing its geography (${f})`); return b; });
      const rows = await loadRows(db);
      const pop = buildPopulation(pack);
      const electorate = rebuildElectorate(rows.params, rows.fields, pack, pop);
      const bu = { dVotes: Float64Array.from(rows.leanBu.d), votes: Float64Array.from(rows.leanBu.t) };
      const districts = await Districts.load(db, pack);
      const world: World = {
        seed: rows.universe.seed, name: rows.universe.name, startTime: rows.universe.start_time, time: rows.universe.clock_time,
        pack, pop, electorate, lean: { bu, ...aggregateLean(bu, pack, districts) }, districts, law: loadElectionLaw(db, pack),
        parties: BASE_PARTIES.map((p) => ({ ...p })), persons: new Map(rows.persons.map((p) => [p.id, p])), offices: rows.offices,
        officeById: new Map(rows.offices.map((o) => [o.id, o])), current: new Map(rows.current.map((t) => [t.officeId, t])),
        vacancies: new Map(rows.vacancies.map((v) => [v.officeId, v])), chambers: rows.chambers, history: rows.meta.history, ids: rows.meta.ids, pending: emptyPending(),
      };
      const last = db.get<{ seq: number; engine_version: string }>('SELECT seq, engine_version FROM engine_ledger WHERE to_time IS NULL ORDER BY seq DESC LIMIT 1');
      if (last && last.engine_version !== ENGINE_VERSION) {
        db.tx(() => {
          db.run('UPDATE engine_ledger SET to_time = ? WHERE seq = ?', [world.time, last.seq]);
          db.run('INSERT INTO engine_ledger(from_time, to_time, engine_version, schema_version) VALUES (?,?,?,?)', [world.time, null, ENGINE_VERSION, SCHEMA_VERSION]);
        });
      }
      const evolution = await Evolution.load(db, world);
      const es = await readJsonState<ElectionState>(db, 'elections.state');
      const ecs = await readJsonState<EconomyEngineState>(db, 'economy.state');
      const cas = await readJsonState<CareersState>(db, 'careers.state');
      const gvs = await readJsonState<GovernmentState>(db, 'government.state');
      const u = new Universe(storage, fileName, db, world, names, es ?? emptyElectionState(), ecs ?? emptyEconomyEngineState(world.seed, pack.states.length), cas ?? emptyCareersState(), gvs);
      u.evolution = evolution;
      u.queue = rows.scheduled;
      if (!es) { // Universe saved by Phase 1: plan the current year's elections from now on.
        u.schedule(world.time + 1, 'plan_year', { year: daysToCivil(easternDay(world.time)).y }, 1);
        u.commit(null);
      }
      for (const r of db.all<{ office_id: number; party_id: number }>('SELECT office_id, party_id FROM office_term t WHERE party_id IS NOT NULL AND term_id = (SELECT term_id FROM office_term x WHERE x.office_id = t.office_id ORDER BY start_time DESC, term_id DESC LIMIT 1)')) u.lastParty.set(r.office_id, r.party_id);
      for (const t of world.current.values()) if (t.partyId !== null) u.lastParty.set(t.officeId, t.partyId);
      if (names) { await u.ensureLegislatures(); u.ensureDownballot(); }
      u.ensureMeasureOffices();
      return u;
    } catch (e) { db.close(); throw e; }
  }

  close(): void { this.storage.flush(this.fileName, this.db); this.db.close(); }

  // ---- Time ------------------------------------------------------------------------------------

  private static nextDailyTick(t: SimTime): SimTime {
    const day = easternDay(t);
    const c = daysToCivil(day);
    let tick = zonedToUtc(c.y, c.m, c.d, 6, 0, 'America/New_York');
    if (tick <= t) { const n = daysToCivil(day + 1); tick = zonedToUtc(n.y, n.m, n.d, 6, 0, 'America/New_York'); }
    return tick;
  }

  /** Advance simulated time. Returns the news produced. Writes everything in one transaction per call. */
  async advance(target: AdvanceTarget, command = true): Promise<NewsItem[]> {
    const w = this.world;
    const start = w.time;
    let until = target.kind === 'days' ? start + Math.max(0, target.days) * MINUTES_PER_DAY
      : target.kind === 'until' ? Math.max(start, target.time) : target.kind === 'nextEvent' ? start + (target.maxDays ?? 366) * MINUTES_PER_DAY : start + 3 * 366 * MINUTES_PER_DAY;
    // Next election: run until the first election event (the calendar may not be planned yet, so this is decided
    // as events run), finish every other event at that same moment (all of a day's primaries), then stop.
    let stopAfter: number | null = null;
    const produced: NewsItem[] = [];
    this.newsSink = produced;
    // Storage writes are batched: one transaction is held across days and committed to storage at most every
    // COMMIT_INTERVAL_MS of wall time, between days (where today's per-day transactions would also have
    // committed), and at the end. The database content is the same; the browser writes each page once per
    // batch instead of once per simulated day (writes to OPFS were most of a simulated month's cost).
    this.db.begin();
    let lastCommit = performance.now(), ok = false;
    try {
      for (;;) {
        const tick = Universe.nextDailyTick(w.time);
        const ev = this.queue[0];
        const next = ev && ev.time <= tick ? ev.time : tick;
        if (next > until || (stopAfter !== null && next > stopAfter)) break;
        const n0 = produced.length;
        w.time = next;
        if (ev && ev.time === next) {
          this.queue.shift(); await this.runEvent(ev);
          if (target.kind === 'nextElection' && ELECTION_EVENTS.has(ev.kind)) stopAfter = ev.time;
        } else await this.dailyTick(easternDay(next));
        if (performance.now() - lastCommit > COMMIT_INTERVAL_MS) { this.db.end(); this.db.begin(); lastCommit = performance.now(); }
        if (target.kind === 'nextEvent' && produced.length > n0) break;
      }
      if (stopAfter !== null) until = w.time;
      if (target.kind !== 'nextEvent' || produced.length === 0) w.time = Math.max(w.time, until);
      if (target.kind === 'nextEvent' && produced.length === 0) w.time = until;
      await this.flush(command ? target : null);
      ok = true;
    } finally {
      this.newsSink = null;
      if (ok) this.db.end(); else this.db.abort();
    }
    return produced;
  }

  private async flush(command: AdvanceTarget | null): Promise<void> { this.commit(command); }

  /**
   * Write everything that changed since the last commit in ONE transaction: pending rows, scheduled-event
   * changes, chamber compositions, small state, the clock, and any extra rows (election results).
   */
  commit(command: AdvanceTarget | null, extra?: () => void): void {
    const w = this.world;
    const blobs = [rawJsonBlob('world.meta', { history: w.history, ids: w.ids })];
    const es = JSON.stringify(this.elections.state);
    if (es !== this.electionStateJson) { blobs.push(rawJsonBlob('elections.state', this.elections.state)); this.electionStateJson = es; }
    const ecs = JSON.stringify(this.economy.st);
    if (ecs !== this.economyStateJson) { blobs.push(rawJsonBlob('economy.state', this.economy.st)); this.economyStateJson = ecs; }
    const cas = JSON.stringify(this.careers.st);
    if (cas !== this.careersStateJson) { blobs.push(rawJsonBlob('careers.state', this.careers.st)); this.careersStateJson = cas; }
    const gvs = JSON.stringify(this.government.st);
    if (gvs !== this.governmentStateJson) { blobs.push(rawJsonBlob('government.state', this.government.st)); this.governmentStateJson = gvs; }
    const removedSet = new Set(this.removedEvents.splice(0));
    const addedAll = this.addedEvents.splice(0);
    const added = addedAll.filter((e) => !removedSet.has(e.id));          // created and consumed in this interval: never persisted
    const addedIds = new Set(addedAll.map((e) => e.id));
    const removed = [...removedSet].filter((id) => !addedIds.has(id));
    this.db.tx(() => {
      for (const o of this.pendingOffices.splice(0)) {
        this.db.run('INSERT INTO office VALUES (?,?,?,?,?,?,?,?,?)', [o.id, o.kind, o.title, o.stateIdx, o.districtIdx, o.senateClass, o.chamberId, o.dept, o.rank]);
        if (o.seat) this.db.run('INSERT INTO office_seat VALUES (?,?,?,?,?,?)', [o.id, o.seat.body, o.seat.number, o.seat.district, o.seat.cycle, o.seat.termYears]);
      }
      writePending(this.db, w);
      this.elections.season.flush();
      this.elections.season.invalidate();
      // One composition row set per chamber and moment (many seats can change hands at once).
      const snaps = new Map<string, (typeof this.compositionSnaps)[number]>();
      for (const snap of this.compositionSnaps.splice(0)) snaps.set(`${snap.id}|${snap.compositionAsOf}`, snap);
      for (const snap of snaps.values()) writeChamberCompositions(this.db, [snap], snap.compositionAsOf);
      for (const [q, p] of this.pendingSql.splice(0)) this.db.run(q, p);
      this.dirtyChambers = false;
      for (const id of removed) this.db.run('DELETE FROM scheduled_event WHERE event_id = ?', [id]);
      for (const e of added) this.db.run('INSERT INTO scheduled_event VALUES (?,?,?,?,?)', [e.id, e.time, e.priority, e.kind, JSON.stringify(e.data)]);
      extra?.();
      writeStateBlobs(this.db, w.time, [...blobs, ...this.pendingBlobs.splice(0)]);
      this.db.run('UPDATE universe SET clock_time = ? WHERE id = 1', [w.time]);
      if (command) this.db.run('INSERT INTO command_log(sim_time, command_json) VALUES (?,?)', [w.time, JSON.stringify({ kind: 'clock.advance', target: command })]);
    });
    this.storage.flush(this.fileName, this.db);
  }

  private removedEvents: number[] = [];
  private compositionSnaps: import('../institutions/model').Chamber[] = [];
  private addedEvents: ScheduledEvent[] = [];

  schedule(time: SimTime, kind: string, data: Record<string, unknown>, priority = 10): void {
    const e: ScheduledEvent = { id: this.world.ids.event++, time, priority, kind, data };
    // Binary insertion (the queue stays sorted by time, priority, id).
    const before = (a: ScheduledEvent) => a.time < e.time || (a.time === e.time && (a.priority < e.priority || (a.priority === e.priority && a.id < e.id)));
    let lo = 0, hi = this.queue.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (before(this.queue[mid]!)) lo = mid + 1; else hi = mid; }
    this.queue.splice(lo, 0, e);
    this.addedEvents.push(e);
  }

  // ---- Processes -------------------------------------------------------------------------------

  private async dailyTick(day: number): Promise<void> {
    // One transaction for the day's writes (the economy, careers, Congress, the campaign season).
    this.db.begin();
    try { await this.dailyWork(day); this.db.end(); } catch (e) { this.db.abort(); throw e; }
  }

  private async dailyWork(day: number): Promise<void> {
    const w = this.world;
    await this.economy.daily(day);
    const cv = daysToCivil(day);
    if (cv.d === 1) { this.careers.monthly(day); courtsMonthly(this.courtHost, day); }
    if (cv.d === 15) await this.government.monthly(day);
    if (cv.m === 12 && cv.d === 31) this.government.yearEnd(cv.y);
    await this.elections.daily(day);
    const r = Rng.stream(w.seed, 'mortality', day);
    for (const p of w.persons.values()) { // Map iteration is insertion (id) order: deterministic
      if (p.deathDay !== null) continue;
      let b = this.birthCivil.get(p.birthDay);
      if (!b) { b = daysToCivil(p.birthDay); this.birthCivil.set(p.birthDay, b); }
      const age = cv.y - b.y - (cv.m < b.m || (cv.m === b.m && cv.d < b.d) ? 1 : 0); // ageOn(p.birthDay, day)
      const annual = Math.min(0.6, 0.55 * Math.exp(-10.4 + 0.094 * age));
      if (r.float() < annual / 365.25) this.death(p, day);
    }
  }

  /** Calendar dates of birthdays (the daily mortality step takes every tracked person's age). */
  private birthCivil = new Map<number, { y: number; m: number; d: number }>();

  private pendingOffices: Office[] = [];
  private pendingSql: [string, (string | number | null)[]][] = [];
  /** A new office (written with the next commit). */
  addOffice(o: Omit<Office, 'id'>): Office {
    const w = this.world;
    const off: Office = { ...o, id: (w.offices[w.offices.length - 1]?.id ?? 0) + 1 };
    w.offices.push(off); w.officeById.set(off.id, off); this.pendingOffices.push(off);
    if (off.chamberId !== null) this.chamberOffices.delete(off.chamberId);
    return off;
  }

  /**
   * State legislators (Phase 6): created once — at founding, or when a universe saved before Phase 6 is first
   * opened — to match each chamber's composition.
   */
  async ensureLegislatures(): Promise<void> {
    const w = this.world;
    const r0 = Rng.stream(w.seed, 'legislatures', 'install');
    void r0;
    // Phase 7.4: New Hampshire's floterial districts (stored once), before seats are laid out.
    const fl = w.districts.ensureFloterials();
    if (fl.added) this.commit(null, () => fl.write(this.db));
    const n = materializeLegislatures({
      world: w, newPerson: (r, tier, party, st, opts) => this.newPerson(r, tier, party, st, opts), addOffice: (o) => this.addOffice(o),
      installTerm: (officeId, person, start, acquired) => {
        const t: Term = { id: w.ids.term++, officeId, personId: person.id, partyId: person.partyId, start, end: null, acquired, endReason: null, provenance: w.time > SIM_START + 10 ? 'created when the universe gained state legislators (Phase 6)' : PRE_SIM };
        w.current.set(officeId, t); w.pending.terms.push(t); return t;
      },
    });
    if (!n) { await this.reseatLegislatures(); return; }
    for (const ch of w.chambers) if (ch.kind === 'state_upper' || ch.kind === 'state_lower') { const first = w.offices.find((o) => o.chamberId === ch.id && (o.kind === 'state_senator' || o.kind === 'state_representative')); if (first) this.markChamber(first.id); }
    this.commit(null);
  }

  /** Appointments, retirements and reappointments to down-ballot seats and the state courts. */
  private get courtHost(): CourtHost {
    return {
      world: this.world, newPerson: (r, tier, party, st, opts) => this.newPerson(r, tier, party, st, opts), startTerm: (id, p, a) => this.startTerm(id, p, a),
      endTerm: (id, reason) => this.endTerm(id, reason), vacate: (id, reason, res) => this.vacate(id, reason, res),
      news: (k, h, b, refs) => this.news(k, h, b, refs), deferSql: (q, p) => { this.pendingSql.push([q, p]); },
      career: (id, kind, text) => this.world.pending.careers.push({ id: this.world.ids.career++, personId: id, yearFrom: daysToCivil(easternDay(this.world.time)).y, yearTo: null, simTime: this.world.time, kind, text, provenance: SIMULATED }),
    };
  }

  /**
   * Down-ballot offices, elected boards and state courts (Phase 7.2): created once — at founding, or when a
   * universe saved before Phase 7.2 is first opened.
   */
  /**
   * Phase 7.4, for universes saved before it: each chamber's seats follow the 2016 law (members per district,
   * district names, positions). A later plan whose districts collapsed into one number (letter-coded districts,
   * Maryland and South Dakota) gives way to the 2016 lines until the next census.
   */
  async reseatLegislatures(): Promise<void> {
    const w = this.world, year = daysToCivil(easternDay(w.time)).y;
    for (const st of w.pack.states) for (const sld of ['sldu', 'sldl'] as const) {
      const ds = w.districts.districtsOf(sld, st.idx, year);
      if (!ds.length || ds[0]!.planId === 0 || new Set(ds.map((d) => d.number)).size === ds.length) continue;
      const base = w.districts.table(sld).filter((d) => d.stateIdx === st.idx && d.planId === 0 && !d.members).sort((a, b) => a.number - b.number);
      const counties = w.pack.counties.filter((c) => c.stateIdx === st.idx); if (!counties.length || !base.length) continue;
      const b0 = counties[0]!.buStart, nb = counties.reduce((a, c) => a + c.buCount, 0);
      const pos = new Map(base.map((d, i) => [d.idx, i])), col = w.pack.bu[sld];
      const local = Int32Array.from({ length: nb }, (_, i) => pos.get(col[b0 + i]!) ?? -1);
      const planId = (this.db.value<number>('SELECT MAX(plan_id) FROM district_plan') ?? 0) + 1;
      const adopted = await w.districts.adopt(sld, st.idx, w.districts.latestCensus() ?? 2010, year, w.time, local, base.map((d) => d.number), base.map((d) => d.seats), base.map((d) => d.pop2010),
        { maxDeviation: 0, contiguous: true, countiesSplit: 0, nested: false, repaired: 'the 2016 lines, replacing a plan whose districts had collapsed (Phase 7.4)' }, planId);
      this.commit(null, () => adopted.write(this.db));
    }
    const changed: Office[] = [];
    for (const st of w.pack.states) for (const kind of ['state_senator', 'state_representative'] as const) changed.push(...reseatChamber(w, st.idx, kind, year));
    if (changed.length) this.commit(null, () => { for (const o of changed) this.db.run('UPDATE office SET title = ?, district_idx = ? WHERE office_id = ?', [o.title, o.districtIdx, o.id]); });
  }

  ensureDownballot(): void {
    const w = this.world;
    const n = materializeDownballot({
      world: w, newPerson: (r, tier, party, st, opts) => this.newPerson(r, tier, party, st, opts), addOffice: (o) => this.addOffice(o),
      installTerm: (officeId, person, start, acquired) => {
        const t: Term = { id: w.ids.term++, officeId, personId: person.id, partyId: person.partyId, start, end: null, acquired, endReason: null,
          provenance: w.time > SIM_START + 10 ? 'created when the universe gained down-ballot offices and state courts (Phase 7.2)' : PRE_SIM };
        w.current.set(officeId, t); w.pending.terms.push(t); return t;
      },
    });
    if (!n) return;
    for (const t of w.current.values()) if (t.partyId !== null) this.lastParty.set(t.officeId, t.partyId);
    this.commit(null);
  }

  /** Ballot measures (Phase 7.3): one holderless office per state, under which the state's measures are filed. */
  ensureMeasureOffices(): void {
    const w = this.world;
    if (w.offices.some((o) => o.kind === 'ballot_measure')) return;
    for (const st of w.pack.states) this.addOffice({ kind: 'ballot_measure', title: `${st.name} ballot measures`, stateIdx: st.idx, districtIdx: null, senateClass: null, chamberId: null, dept: null, rank: 9000 + st.idx });
    this.commit(null);
  }

  /** Appoint a sitting officeholder (weighted by recognition and leadership); their old office falls vacant. */
  private appointSitting(o: Office, pool: Term[], r: Rng, how: string): boolean {
    const w = this.world;
    const pick = pool[r.weighted(pool.map((t) => { const p = w.persons.get(t.personId)!; return Math.exp(3 * p.traits.recognition + 2 * p.traits.leadership); }))];
    if (!pick) return false;
    const person = w.persons.get(pick.personId)!; const from = w.officeById.get(pick.officeId)!;
    this.endTerm(from.id, `resigned to become ${o.title}`);
    this.startTerm(o.id, person, how);
    this.news('appointment', `${fullName(person)} named ${o.title}`, `${from.title} ${fullName(person)} (${this.partyAbbrev(person.partyId)}) was ${how}.`, { personId: person.id, officeId: o.id });
    if (from.kind === 'governor') this.succession(from.id, person, 'resignation'); else this.vacate(from.id, `${fullName(person)} became ${o.title}`);
    return true;
  }

  /** A party switch: the person's affiliation, and the party of any office they hold. */
  private setParty(person: Person, party: number): void {
    const w = this.world, now = w.time;
    person.partyId = party;
    const held = [...w.current.values()].filter((t) => t.personId === person.id);
    for (const t of held) { t.partyId = party; this.markChamber(t.officeId); }
    this.commit(null, () => {
      this.db.run('UPDATE party_affiliation SET to_time = ? WHERE person_id = ? AND to_time IS NULL', [now, person.id]);
      this.db.run('INSERT INTO party_affiliation VALUES (?,?,?,?)', [person.id, party, now, null]);
      for (const t of held) this.db.run('UPDATE office_term SET party_id = ? WHERE term_id = ?', [party, t.id]);
    });
  }

  /** January 1: the population and the electorate move on a year (before the year's elections are planned). */
  private async yearStart(year: number): Promise<void> {
    const w = this.world;
    const presOffice = w.offices.find((o) => o.kind === 'president')!;
    const res = await this.evolution.yearStart(year, (y) => {
      // Who is out of the White House, and for how long; last year's presidential nominees.
      const inParty = w.current.get(presOffice.id)?.partyId ?? null;
      // The in-party's streak, in four-year terms, from the start of its earliest consecutive term.
      const terms = this.db.all<{ party_id: number | null; start_time: number }>('SELECT party_id, start_time FROM office_term WHERE office_id = ? AND start_time <= ? ORDER BY start_time DESC', [presOffice.id, zonedToUtc(y, 1, 1, 0, 0, 'America/New_York')]);
      let since: number | null = null; for (const t of terms) { if (t.party_id !== inParty) break; since = t.start_time; }
      const outTerms = since === null ? 0 : Math.max(1, Math.round((zonedToUtc(y, 1, 20, 12, 0, 'America/New_York') - since) / (4 * 365.25 * MINUTES_PER_DAY)));
      const nominees: { D: number[] | null; R: number[] | null } = { D: null, R: null };
      for (const row of this.db.all<{ party_id: number; person_id: number }>("SELECT c.party_id, k.person_id FROM contest c JOIN candidacy k ON k.candidacy_id = c.winner_candidacy WHERE c.kind = 'pres_nomination' AND c.year = ?", [y - 1])) {
        const p = w.persons.get(row.person_id); if (!p) continue;
        if (row.party_id === PARTY_D) nominees.D = [...p.traits.ideology]; else if (row.party_id === PARTY_R) nominees.R = [...p.traits.ideology];
      }
      return { outParty: inParty === PARTY_D ? PARTY_R : inParty === PARTY_R ? PARTY_D : null, outTerms, nominees };
    }, this.db);
    if (!res) return;
    this.pendingBlobs.push(...res.blobs);
    this.news('demography', `${year} population estimates`, `The United States begins ${year} with ${res.summary}`, {});
  }

  private async runEvent(ev: ScheduledEvent): Promise<void> {
    this.removedEvents.push(ev.id);
    const d = ev.data as Record<string, number | string>;
    const E = this.elections, n = (k: string) => Number(d[k]);
    switch (ev.kind) {
      case 'plan_year': {
        const y = n('year');
        await this.yearStart(y); this.census.planYear(y); courtsYearStart(this.courtHost, y);
        if (y % 2 === 1) this.schedule(zonedToUtc(y, 1, 3, 13, 0, 'America/New_York'), 'new_congress', { year: y }, 3);
        if (y > 2016) this.schedule(zonedToUtc(y, 1, 21, 12, 0, 'America/New_York'), 'new_legislatures', { year: y }, 3);
        E.planYear(y); return;
      }
      case 'new_congress': this.careers.newCongress(); return;
      case 'new_legislatures': this.careers.newCongress(true); return;
      case 'census_day': this.census.censusDay(n('year')); return;
      case 'apportionment': this.census.apportionment(n('year')); return;
      case 'redistrict': await this.census.redistrict(n('census'), n('state')); return;
      case 'new_congress_districts': this.census.newCongressDistricts(n('census'), n('firstYear')); return;
      case 'filing': E.filing(n('year'), n('state')); return;
      case 'spring_filing': E.springFiling(n('year'), n('state'), n('election'), n('primary')); return;
      case 'spring': await E.spring(n('election')); return;
      case 'seat_vacate': E.seatVacate(n('office'), String(d.reason ?? 'term ended')); return;
      case 'pres_filing': E.presFiling(n('year')); return;
      case 'primary': await E.primary(n('election')); return;
      case 'pres_nomination': await E.presNomination(n('election')); return;
      case 'convention': E.convention(n('year')); return;
      case 'nomination_convention': E.nominationConvention(n('year'), n('party')); return;
      case 'general': await E.general(n('year'), n('day')); return;
      case 'certify_state': await E.certifyState(n('election'), n('night')); return;
      case 'night_news': await E.nightNews(n('night'), n('from'), n('to'), !!d.summary); return;
      case 'runoff': await E.runoff(n('election')); return;
      case 'special': await E.special(n('election')); return;
      case 'certify': E.certify(n('year'), n('day')); return;
      case 'electors': await E.electors(n('year')); return;
      case 'ec_count': await E.ecCount(n('year')); return;
      case 'take_office': {
        const presOffice = this.world.offices.find((o) => o.kind === 'president')!;
        const before = this.world.current.get(presOffice.id)?.personId;
        E.takeOffice(n('office'), n('person'), (d.how as string | undefined) ?? null, d.contest !== undefined ? n('contest') : null);
        if (n('office') === presOffice.id && before !== n('person')) this.careers.newAdministration();
        return;
      }
      case 'assume_office': {
        const person = this.world.persons.get(d.personId as number);
        this.endTerm(d.officeId as number, 'term ended');
        if (!person || person.deathDay !== null) { this.vacate(d.officeId as number, 'officer-elect died before taking office'); return; }
        this.startTerm(d.officeId as number, person, d.acquired as string, PRE_SIM);
        const o = this.world.officeById.get(d.officeId as number)!;
        this.news('inauguration', `${fullName(person)} sworn in as ${o.title}`, `${fullName(person)} (${this.partyAbbrev(person.partyId)}) took the oath of office.`, { personId: person.id, officeId: o.id });
        return;
      }
      case 'fill': this.fill(d.officeId as number); return;
      default: throw new Error(`unknown scheduled event ${ev.kind}`);
    }
  }

  private news(kind: string, headline: string, body: string, refs: Record<string, unknown>, time?: SimTime): void {
    const w = this.world;
    const item = { id: w.ids.news++, time: time ?? w.time, kind, headline, body, refs };
    w.pending.news.push(item); this.newsSink?.push(item);
  }
  /** Collects news produced during an advance (pending writes may be flushed mid-event by election commits). */
  private newsSink: NewsItem[] | null = null;

  private partyAbbrev(id: number): string { return this.world.parties.find((p) => p.id === id)?.abbrev ?? '?'; }

  private termsOf(personId: number): Term[] {
    const out: Term[] = [];
    for (const t of this.world.current.values()) if (t.personId === personId) out.push(t);
    return out.sort((a, b) => (this.world.officeById.get(a.officeId)!.rank - this.world.officeById.get(b.officeId)!.rank));
  }

  private endTerm(officeId: number, reason: string): Term | null {
    const t = this.world.current.get(officeId); if (!t) return null;
    this.world.current.delete(officeId);
    if (t.partyId !== null) this.lastParty.set(officeId, t.partyId);
    this.world.pending.termEnds.push({ id: t.id, end: this.world.time, reason });
    t.end = this.world.time; t.endReason = reason;
    this.markChamber(officeId);
    return t;
  }

  private startTerm(officeId: number, person: Person, acquired: string, provenance = SIMULATED): Term {
    const t: Term = { id: this.world.ids.term++, officeId, personId: person.id, partyId: person.partyId, start: this.world.time, end: null, acquired, endReason: null, provenance };
    this.world.current.set(officeId, t); this.world.pending.terms.push(t);
    if (this.world.vacancies.delete(officeId)) this.world.pending.vacanciesCleared.push(officeId);
    this.markChamber(officeId);
    return t;
  }

  private chamberOffices = new Map<number, Office[]>();
  private markChamber(officeId: number): void {
    const o = this.world.officeById.get(officeId)!;
    if (o.kind !== 'us_senator' && o.kind !== 'us_representative' && o.kind !== 'state_senator' && o.kind !== 'state_representative') return;
    const chamber = this.world.chambers.find((c) => c.id === o.chamberId)!;
    const comp = new Map<number, number>();
    let filled = 0;
    let members = this.chamberOffices.get(chamber.id);
    if (!members) { members = this.world.offices.filter((x) => x.chamberId === chamber.id && x.kind !== 'congress_leader' && x.kind !== 'state_leg_leader'); this.chamberOffices.set(chamber.id, members); }
    for (const off of members) {
      if (off.chamberId !== chamber.id || off.kind === 'congress_leader') continue;
      const t = this.world.current.get(off.id);
      if (t) { comp.set(t.partyId ?? 5, (comp.get(t.partyId ?? 5) ?? 0) + 1); filled++; }
    }
    if (chamber.seats - filled > 0) comp.set(0, chamber.seats - filled);
    chamber.composition = comp; chamber.compositionAsOf = this.world.time; chamber.compositionProvenance = SIMULATED;
    this.dirtyChambers = true;
    this.compositionSnaps.push({ ...chamber, composition: new Map(comp) });
  }

  private vacate(officeId: number, reason: string, resolution?: string): void {
    const o = this.world.officeById.get(officeId)!;
    const res = resolution ?? this.vacancyResolution(o);
    const v = { officeId, since: this.world.time, reason, resolution: res };
    this.world.vacancies.set(officeId, v); this.world.pending.vacanciesSet.push(v);
    const delay = ({ president: 0, vice_president: 45, cabinet: 40, us_senator: 12, us_representative: -1, governor: 0, lt_governor: 30, attorney_general: 30,
      secretary_of_state: 30, congress_leader: 10, state_leg_leader: 10, state_senator: 30, state_representative: 30, justice: 60, appellate_judge: 50 } as Record<string, number>)[o.kind] ?? 30;
    if (o.kind === 'us_representative') { this.elections.houseSpecial(officeId); return; }
    if (o.kind === 'us_senator') this.elections.senateSpecialNeeded(officeId, reason);
    if (o.kind === 'us_senator' && STATES_2016[this.world.pack.states[o.stateIdx!]!.usps]?.senateVacancy === 'special_only') return;
    if (delay >= 0) this.schedule(this.world.time + Math.max(1, delay) * MINUTES_PER_DAY, 'fill', { officeId });
  }

  private vacancyResolution(o: Office): string {
    switch (o.kind) {
      case 'us_representative': return 'Special election to be scheduled';
      case 'us_senator': {
        const rule = STATES_2016[this.world.pack.states[o.stateIdx!]!.usps]?.senateVacancy;
        return rule === 'special_only' ? 'Special election at the next regular general election; state law allows no interim appointment' : 'Gubernatorial appointment pending; special election at the next regular general election';
      }
      case 'vice_president': return 'Presidential nomination and congressional confirmation (25th Amendment)';
      case 'cabinet': return 'Presidential nomination and Senate confirmation';
      case 'congress_leader': case 'state_leg_leader': return 'Election by the party caucus';
      case 'state_senator': case 'state_representative': return 'Interim appointment; the seat is filled at the next regular election';
      default: return o.seat ? seatVacancyResolution(this.world, o) : 'Appointment by the Governor';
    }
  }

  private death(p: Person, day: number): void {
    const w = this.world;
    p.deathDay = day;
    w.pending.deaths.push({ id: p.id, day });
    const held = this.termsOf(p.id);
    const age = ageOn(p.birthDay, day);
    const title = held.length ? w.officeById.get(held[0]!.officeId)!.title : null;
    // The news reports the deaths of officeholders and former officeholders, not of every candidate who ever ran
    // (since Phase 6 that is tens of thousands of people, mostly state legislative challengers).
    const last = title ? undefined : this.db.get<{ kind: string; title: string; state_idx: number | null }>('SELECT o.kind, o.title, o.state_idx FROM office_term t JOIN office o ON o.office_id = t.office_id WHERE t.person_id = ? ORDER BY t.start_time DESC LIMIT 1', [p.id]);
    const stateName = last?.state_idx !== null && last?.state_idx !== undefined ? w.pack.states[last.state_idx]?.name : undefined;
    const former = !last ? null : last.kind === 'state_senator' ? `${stateName} state senator` : last.kind === 'state_representative' ? `${stateName} state representative` : last.kind === 'us_representative' ? 'U.S. Representative' : last.title;
    if (title || former) {
      this.news('death', title ? `${title} ${fullName(p)} dies at ${age}` : `${fullName(p)}, former ${former}, dies at ${age}`,
        `${fullName(p)} (${this.partyAbbrev(p.partyId)}) died at age ${age}.${title ? ` The death leaves the office of ${title} vacant.` : ''}`, { personId: p.id });
    }
    w.pending.careers.push({ id: w.ids.career++, personId: p.id, yearFrom: daysToCivil(day).y, yearTo: null, simTime: w.time, kind: 'death', text: `Died in office at age ${age}`.replace(' in office', held.length ? ' in office' : ''), provenance: SIMULATED });
    for (const t of held) { this.endTerm(t.officeId, 'died'); this.succession(t.officeId, p); }
  }

  /** Immediate constitutional succession, otherwise a vacancy with a scheduled fill. */
  private succession(officeId: number, departed: Person, cause = 'death'): void {
    const on = cause === 'death' ? 'on the death of' : cause === 'resignation' ? 'on the resignation of' : `after ${cause} of`;
    const w = this.world;
    const o = w.officeById.get(officeId)!;
    if (o.kind === 'president') {
      const vpOffice = w.offices.find((x) => x.kind === 'vice_president')!;
      const vpTerm = w.current.get(vpOffice.id);
      if (vpTerm) {
        const vp = w.persons.get(vpTerm.personId)!;
        this.endTerm(vpOffice.id, 'succeeded to the presidency');
        this.startTerm(o.id, vp, `succeeded ${on} President ${fullName(departed)}`);
        this.news('succession', `${fullName(vp)} sworn in as President`, `Vice President ${fullName(vp)} became President under the 25th Amendment.`, { personId: vp.id });
        this.vacate(vpOffice.id, 'Vice President succeeded to the presidency');
        return;
      }
    }
    if (o.kind === 'governor') {
      const usps = w.pack.states[o.stateIdx!]!.usps;
      const rule = STATES_2016[usps]?.governor?.successor ?? 'lt_governor';
      const kind = rule === 'lt_governor' ? 'lt_governor' : rule === 'secretary_of_state' ? 'secretary_of_state' : 'state_leg_leader';
      const sOffice = w.offices.find((x) => x.stateIdx === o.stateIdx && x.kind === kind && (kind !== 'state_leg_leader' || x.title.includes('Senate') || x.title.includes('Legislature')));
      const st = sOffice ? w.current.get(sOffice.id) : undefined;
      if (sOffice && st) {
        const successor = w.persons.get(st.personId)!;
        this.endTerm(sOffice.id, 'succeeded to the governorship');
        this.startTerm(o.id, successor, `succeeded ${on} Governor ${fullName(departed)}`);
        this.news('succession', `${fullName(successor)} becomes Governor of ${w.pack.states[o.stateIdx!]!.name}`, `${sOffice.title} ${fullName(successor)} succeeded to the governorship.`, { personId: successor.id });
        this.vacate(sOffice.id, 'officeholder succeeded to the governorship');
        return;
      }
    }
    this.vacate(officeId, `${cause} of ${fullName(departed)}`);
  }

  /** Fill a vacancy by appointment or caucus election. */
  private fill(officeId: number): void {
    const w = this.world;
    if (w.current.has(officeId)) return;
    const o = w.officeById.get(officeId)!;
    const presTerm = w.current.get(w.offices.find((x) => x.kind === 'president')!.id);
    const presParty = presTerm?.partyId ?? PARTY_D;
    const govParty = (s: number) => { const g = w.offices.find((x) => x.kind === 'governor' && x.stateIdx === s); return (g && w.current.get(g.id)?.partyId) || PARTY_D; };
    const r = Rng.stream(w.seed, 'fill', officeId, w.time);
    if (o.seat) { fillSeat(this.courtHost, o, r); return; }
    let party = presParty, tier: Person['tier'] = 'B', stateIdx = o.stateIdx ?? 0, how: string;
    switch (o.kind) {
      case 'vice_president': case 'cabinet': {
        party = presParty; tier = 'A'; how = o.kind === 'vice_president' ? 'nominated by the President and confirmed by Congress' : 'nominated by the President and confirmed by the Senate';
        // A sitting senator or governor of the President's party is often chosen for Vice President.
        if (o.kind === 'vice_president') {
          const pool = w.offices.filter((x) => (x.kind === 'us_senator' || x.kind === 'governor') && w.current.get(x.id)?.partyId === party).map((x) => w.current.get(x.id)!);
          if (pool.length) {
            const pick = pool[r.weighted(pool.map((t) => { const p = w.persons.get(t.personId)!; return Math.exp(3 * p.traits.recognition + 2 * p.traits.leadership); }))]!;
            const person = w.persons.get(pick.personId)!;
            this.endTerm(pick.officeId, 'became Vice President');
            this.startTerm(o.id, person, how);
            this.news('appointment', `${fullName(person)} confirmed as Vice President`, `${fullName(person)}, previously ${w.officeById.get(pick.officeId)!.title}, was confirmed as Vice President.`, { personId: person.id });
            this.succession(pick.officeId, person);
            return;
          }
        }
        // A quarter of cabinet picks are sitting governors or members of Congress of the President's party.
        if (o.kind === 'cabinet' && r.bernoulli(0.25)) {
          const pool = w.offices.filter((x) => ['us_senator', 'us_representative', 'governor'].includes(x.kind) && w.current.get(x.id)?.partyId === party).map((x) => w.current.get(x.id)!);
          if (pool.length && this.appointSitting(o, pool, r, how)) return;
        }
        stateIdx = r.weighted(w.pack.states.map((_, s) => w.pop.stateVep[s]!));
        break;
      }
      case 'us_senator': {
        const usps = w.pack.states[o.stateIdx!]!.usps;
        const rule = STATES_2016[usps]?.senateVacancy;
        const lastParty = this.lastPartyOf(officeId);
        party = rule === 'appoint_same_party' && lastParty ? lastParty : govParty(o.stateIdx!); tier = 'A';
        how = 'appointed by the Governor; serves until a special election';
        // Governors often appoint a member of the state's House delegation.
        if (r.bernoulli(0.45)) {
          const pool = w.offices.filter((x) => x.kind === 'us_representative' && x.stateIdx === o.stateIdx && w.current.get(x.id)?.partyId === party).map((x) => w.current.get(x.id)!);
          if (pool.length && this.appointSitting(o, pool, r, how)) return;
        }
        break;
      }
      case 'congress_leader': {
        const chamberOffices = w.offices.filter((x) => x.chamberId === o.chamberId && x.kind !== 'congress_leader');
        const holders = new Set([...w.offices.filter((x) => x.kind === 'congress_leader').map((x) => w.current.get(x.id)?.personId)]);
        const lastParty = this.lastPartyOf(officeId) ?? PARTY_D;
        const pool = chamberOffices.map((x) => w.current.get(x.id)).filter((t): t is Term => !!t && t.partyId === lastParty && !holders.has(t.personId));
        if (!pool.length) return;
        const pick = pool[r.weighted(pool.map((t) => Math.exp(4 * w.persons.get(t.personId)!.traits.leadership)))]!;
        const person = w.persons.get(pick.personId)!;
        this.startTerm(o.id, person, 'elected by the party conference');
        this.news('leadership', `${fullName(person)} elected ${o.title}`, `${fullName(person)} (${this.partyAbbrev(person.partyId)}) was chosen to fill the vacancy.`, { personId: person.id });
        return;
      }
      case 'state_leg_leader': party = this.lastPartyOf(officeId) ?? PARTY_D; how = 'elected by the chamber'; break;
      case 'state_senator': case 'state_representative': party = this.lastPartyOf(officeId) ?? govParty(o.stateIdx ?? 0); tier = 'C'; how = 'appointed to fill the vacancy until the next election'; break;
      default: party = govParty(o.stateIdx ?? 0); how = 'appointed by the Governor';
    }
    const person = this.newPerson(r, tier, party, stateIdx);
    this.startTerm(o.id, person, how);
    this.news('appointment', `${fullName(person)} named ${o.title}`, `${fullName(person)} (${this.partyAbbrev(party)}) was ${how}.`, { personId: person.id, officeId: o.id });
  }

  private lastPartyOf(officeId: number): number | null { return this.lastParty.get(officeId) ?? null; }

  /** Party of the most recent holder of each office (in memory; rebuilt from the database on load). */
  private lastParty = new Map<number, number>();

  private newPerson(r: Rng, tier: Person['tier'], party: number, stateIdx: number, opts: PersonOptions = {}): Person {
    const w = this.world;
    if (!this.names) {
      if (!this.nameData) throw new Error('Name data unavailable; cannot create new people offline before first load.');
      this.names = new NameGenerator(this.nameData);
      for (const p of w.persons.values()) this.names.reserve(p.given, p.surname);
    }
    const plat = party === PARTY_R ? w.electorate.params.platforms.R : w.electorate.params.platforms.D;
    const homeCounty = opts.homeCounty !== undefined ? opts.homeCounty : w.pack.counties.find((c) => c.stateIdx === stateIdx)?.idx ?? null;
    // Race/ethnicity of the person follows the electorate of the home county.
    const race = [0.7, 0.12, 0.1, 0.08];
    if (homeCounty !== null) {
      const c = w.pack.counties[homeCounty]!; const acc = [0, 0, 0, 0];
      for (let b = c.buStart; b < c.buStart + c.buCount; b++) for (let q = 0; q < 4; q++) acc[q]! += w.pop.vep[b]! * w.pop.marg[b * 13 + 5 + q]!;
      const t = acc.reduce((a, x) => a + x, 0); if (t > 0) for (let q = 0; q < 4; q++) race[q] = acc[q]! / t;
    }
    const year = utcToZoned(w.time, 'America/New_York').y;
    const p = generatePerson({ id: w.ids.person++, tier, stateIdx, homeCounty, partyId: party,
      raceShares: race, femaleShare: 0.3, ageMean: opts.ageMean ?? 52, ageSd: 9, minAge: 30, asOfYear: year,
      platform: party > 2 ? plat.map((x) => x * 0.2) : plat, moderation: 0.15, prominence: opts.prominence ?? (tier === 'A' ? 0.3 : 0.1), createdTime: w.time }, r, this.names);
    p.provenance = SIMULATED;
    p.bio = opts.background ? `${fullName(p)} entered public life as a ${opts.background.text.split(' (')[0]!.toLowerCase()}.` : `${fullName(p)} entered the universe's public life in ${year}.`;
    w.persons.set(p.id, p); w.pending.persons.push(p);
    if (opts.background) w.pending.careers.push({ id: w.ids.career++, personId: p.id, yearFrom: null, yearTo: year, simTime: w.time, kind: 'background', text: opts.background.text, provenance: 'generated background' });
    return p;
  }

  // ---- Exports ---------------------------------------------------------------------------------
  exportBytes(): Uint8Array { this.storage.flush(this.fileName, this.db); return this.storage.exportFile(this.fileName); }
  markExported(): void { this.db.run("INSERT OR REPLACE INTO meta VALUES ('last_export_real', ?)", [new Date().toISOString()]); this.storage.flush(this.fileName, this.db); }

  get pack(): GeoPack { return this.world.pack; }
  static partyName(id: number): string { return BASE_PARTIES.find((p) => p.id === id)?.short ?? 'Vacant'; }
  static readonly PARTY_D = PARTY_D;
  static readonly PARTY_R = PARTY_R;
}

function scheduledFromDb(db: Db): ScheduledEvent[] {
  return db.all<{ event_id: number; sim_time: number; priority: number; kind: string; data_json: string }>('SELECT * FROM scheduled_event ORDER BY sim_time, priority, event_id')
    .map((e) => ({ id: e.event_id, time: e.sim_time, priority: e.priority, kind: e.kind, data: JSON.parse(e.data_json) as Record<string, unknown> }));
}
