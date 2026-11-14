/**
 * Mapping between the in-memory World and the universe database. All writes for a simulated interval
 * happen in one transaction; compressed blobs are prepared before the transaction starts.
 */
import { decodeBundle, decodeJson, encodeBundle, encodeJson, crc32 } from '../core/codec';
import type { Db } from '../persistence/db';
import type { Chamber, CareerEvent, NewsItem, Office, Person, Term, Vacancy } from '../institutions/model';
import type { ElectorateFields, ElectorateParams } from '../electorate/model';
import type { World } from './world';

export interface ScheduledEvent { id: number; time: number; priority: number; kind: string; data: Record<string, unknown> }

/** Small, frequently rewritten state as uncompressed JSON (synchronous, so it commits with the events that change it). */
export function rawJsonBlob(key: string, value: unknown): { key: string; codec: string; payload: Uint8Array } {
  return { key, codec: 'rawjson', payload: new TextEncoder().encode(JSON.stringify(value)) };
}

export async function readJsonState<T>(db: Db, key: string): Promise<T | null> {
  const row = db.get<{ codec: string }>('SELECT codec FROM state_blob WHERE key = ?', [key]);
  if (!row) return null;
  const b = await readStateBlob(db, key);
  if (!b) return null;
  return row.codec === 'rawjson' ? JSON.parse(new TextDecoder().decode(b)) as T : decodeJson<T>(b);
}

export async function prepareStateBlobs(w: World, full: boolean): Promise<{ key: string; codec: string; payload: Uint8Array }[]> {
  const blobs: { key: string; codec: string; payload: Uint8Array }[] = [];
  blobs.push(rawJsonBlob('world.meta', { history: w.history, ids: w.ids }));
  if (full) {
    blobs.push({ key: 'electorate.params', codec: 'json', payload: await encodeJson(w.electorate.params) });
    const f = w.electorate.fields;
    blobs.push({ key: 'electorate.fields', codec: 'bundle', payload: await encodeBundle({ division: f.division, state: f.state, county: f.county, countyIid: f.countyIid, bu: f.bu }) });
    blobs.push({ key: 'lean.bu', codec: 'bundle', payload: await encodeBundle({ d: Float32Array.from(w.lean.bu.dVotes), t: Float32Array.from(w.lean.bu.votes) }) });
  }
  return blobs;
}

export function writeStateBlobs(db: Db, time: number, blobs: { key: string; codec: string; payload: Uint8Array }[]): void {
  for (const b of blobs) {
    db.run('INSERT INTO state_blob(key, sim_time, codec, payload, crc32) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET sim_time=excluded.sim_time, codec=excluded.codec, payload=excluded.payload, crc32=excluded.crc32',
      [b.key, time, b.codec, b.payload, crc32(b.payload)]);
  }
}

const personRow = (p: Person) => [p.id, p.given, p.middle, p.surname, p.suffix, p.nickname, p.sex, p.race, p.birthDay, p.deathDay, p.homeState, p.homeCounty, p.tier, p.createdTime, p.provenance, p.bio];
const traitsRow = (p: Person) => [p.id, p.traits.asOf, ...p.traits.ideology, p.traits.charisma, p.traits.campaign, p.traits.fundraising, p.traits.leadership, p.traits.integrity, p.traits.ambition, p.traits.recognition];
const termRow = (t: Term) => [t.id, t.officeId, t.personId, t.partyId, t.start, t.end, t.acquired, t.endReason, t.provenance];
const careerRow = (c: CareerEvent) => [c.id, c.personId, c.yearFrom, c.yearTo, c.simTime, c.kind, c.text, c.provenance];
const newsRow = (n: NewsItem) => [n.id, n.time, n.kind, n.headline, n.body, JSON.stringify(n.refs), n.refs.local ? 1 : 0];

export function insertPersons(db: Db, persons: Iterable<Person>): void {
  const list = [...persons];
  db.insertMany('INSERT INTO person VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', list.map(personRow));
  db.insertMany('INSERT INTO person_traits VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', list.map(traitsRow));
  db.insertMany('INSERT INTO party_affiliation VALUES (?,?,?,?)', list.map((p) => [p.id, p.partyId, null, null]));
}

/** Write a freshly generated world (inside the caller's transaction). */
export function writeGenesis(db: Db, w: World, careers: CareerEvent[], scheduled: ScheduledEvent[], meta: { createdReal: string; geoPack: string; geoSha: string; engineVersion: string; options: unknown }): void {
  db.run('INSERT INTO universe VALUES (1,?,?,?,?,?,?,?,?,?)', [w.name, w.seed, meta.createdReal, w.startTime, w.time, meta.geoPack, meta.geoSha, JSON.stringify(meta.options), meta.engineVersion]);
  db.insertMany('INSERT INTO party VALUES (?,?,?,?,?,?,?)', w.parties.map((p) => [p.id, p.name, p.short, p.abbrev, p.color, p.major ? 1 : 0, p.status]));
  insertPersons(db, w.persons.values());
  db.insertMany('INSERT INTO chamber VALUES (?,?,?,?,?,?)', w.chambers.map((c) => [c.id, c.kind, c.stateIdx, c.name, c.seats, c.termYears]));
  db.insertMany('INSERT INTO chamber_composition VALUES (?,?,?,?,?)', w.chambers.flatMap((c) => [...c.composition].map(([party, seats]) => [c.id, c.compositionAsOf, party, seats, c.compositionProvenance])));
  db.insertMany('INSERT INTO office VALUES (?,?,?,?,?,?,?,?,?)', w.offices.map((o) => [o.id, o.kind, o.title, o.stateIdx, o.districtIdx, o.senateClass, o.chamberId, o.dept, o.rank]));
  db.insertMany('INSERT INTO office_term VALUES (?,?,?,?,?,?,?,?,?)', [...w.current.values()].sort((a, b) => a.id - b.id).map(termRow));
  db.insertMany('INSERT INTO career_event VALUES (?,?,?,?,?,?,?,?)', careers.map(careerRow));
  db.insertMany('INSERT INTO scheduled_event VALUES (?,?,?,?,?)', scheduled.map((e) => [e.id, e.time, e.priority, e.kind, JSON.stringify(e.data)]));
}

/** Apply the World's pending writes (inside the caller's transaction) and clear them. */
export function writePending(db: Db, w: World): void {
  const p = w.pending;
  if (p.persons.length) insertPersons(db, p.persons);
  for (const t of p.terms) db.run('INSERT INTO office_term VALUES (?,?,?,?,?,?,?,?,?)', termRow(t));
  for (const e of p.termEnds) db.run('UPDATE office_term SET end_time = ?, end_reason = ? WHERE term_id = ?', [e.end, e.reason, e.id]);
  for (const d of p.deaths) db.run('UPDATE person SET death_day = ? WHERE person_id = ?', [d.day, d.id]);
  if (p.careers.length) db.insertMany('INSERT INTO career_event VALUES (?,?,?,?,?,?,?,?)', p.careers.map(careerRow));
  if (p.news.length) db.insertMany('INSERT INTO news VALUES (?,?,?,?,?,?,?)', p.news.map(newsRow));
  // A vacancy can be set and cleared several times between commits; persist each touched office's final state.
  const touched = new Set([...p.vacanciesSet.map((v) => v.officeId), ...p.vacanciesCleared]);
  for (const id of touched) {
    const v = w.vacancies.get(id);
    if (v) db.run('INSERT OR REPLACE INTO vacancy VALUES (?,?,?,?)', [v.officeId, v.since, v.reason, v.resolution]);
    else db.run('DELETE FROM vacancy WHERE office_id = ?', [id]);
  }
  w.pending = { persons: [], terms: [], termEnds: [], deaths: [], careers: [], news: [], vacanciesSet: [], vacanciesCleared: [], traits: [] };
}

export function writeChamberCompositions(db: Db, chambers: Chamber[], time: number): void {
  for (const c of chambers) {
    db.run('DELETE FROM chamber_composition WHERE chamber_id = ? AND as_of = ?', [c.id, time]);
    for (const [party, seats] of c.composition) db.run('INSERT INTO chamber_composition VALUES (?,?,?,?,?)', [c.id, time, party, seats, c.compositionProvenance]);
  }
}

// ---- Loading -----------------------------------------------------------------------------------

export async function readStateBlob(db: Db, key: string): Promise<Uint8Array | null> {
  const row = db.get<{ payload: Uint8Array; crc32: number }>('SELECT payload, crc32 FROM state_blob WHERE key = ?', [key]);
  if (!row) return null;
  if (crc32(row.payload) !== row.crc32) throw new Error(`Saved state "${key}" failed its checksum — the save may be corrupted.`);
  return row.payload;
}

export interface LoadedRows {
  universe: { name: string; seed: string; start_time: number; clock_time: number; geo_pack: string; geo_pack_sha256: string; options_json: string; engine_version: string };
  persons: Person[]; offices: Office[]; current: Term[]; chambers: Chamber[]; vacancies: Vacancy[]; scheduled: ScheduledEvent[];
  meta: { history: World['history']; ids: World['ids'] };
  params: ElectorateParams; fields: ElectorateFields; leanBu: { d: Float32Array; t: Float32Array };
}

export async function loadRows(db: Db): Promise<LoadedRows> {
  const universe = db.get<LoadedRows['universe']>('SELECT * FROM universe WHERE id = 1');
  if (!universe) throw new Error('Not a universe database (missing universe row).');
  const traits = new Map(db.all<Record<string, number>>('SELECT * FROM person_traits').map((t) => [t.person_id!, t]));
  const aff = new Map(db.all<{ person_id: number; party_id: number }>('SELECT person_id, party_id FROM party_affiliation WHERE to_time IS NULL').map((a) => [a.person_id, a.party_id]));
  const persons: Person[] = db.all<Record<string, never>>('SELECT * FROM person ORDER BY person_id').map((r: Record<string, unknown>) => {
    const t = traits.get(r.person_id as number)!;
    return {
      id: r.person_id as number, given: r.given as string, middle: r.middle as string | null, surname: r.surname as string, suffix: r.suffix as string | null,
      nickname: r.nickname as string | null, sex: r.sex as 'M' | 'F', race: r.race as string, birthDay: r.birth_day as number, deathDay: r.death_day as number | null,
      homeState: r.home_state as number, homeCounty: r.home_county as number | null, tier: r.tier as Person['tier'], createdTime: r.created_time as number,
      provenance: r.provenance as string, bio: (r.bio as string) ?? '', partyId: aff.get(r.person_id as number) ?? 5,
      traits: { asOf: t.as_of!, ideology: [t.ideo_econ!, t.ideo_social!, t.ideo_orient!], charisma: t.charisma!, campaign: t.campaign!, fundraising: t.fundraising!,
        leadership: t.leadership!, integrity: t.integrity!, ambition: t.ambition!, recognition: t.recognition! },
    };
  });
  const offices: Office[] = db.all<Record<string, unknown>>('SELECT * FROM office ORDER BY office_id').map((r) => ({
    id: r.office_id as number, kind: r.kind as Office['kind'], title: r.title as string, stateIdx: r.state_idx as number | null, districtIdx: r.district_idx as number | null,
    senateClass: r.senate_class as number | null, chamberId: r.chamber_id as number | null, dept: r.dept as string | null, rank: r.rank as number,
  }));
  // Seats of down-ballot offices, boards and courts (schema 8).
  const byId = new Map(offices.map((o) => [o.id, o]));
  for (const r of db.all<{ office_id: number; body: string; seat: number; district: number; cycle_year: number; term_years: number; county_idx?: number | null }>('SELECT * FROM office_seat')) {
    const o = byId.get(r.office_id);
    if (o) o.seat = { body: r.body, number: r.seat, district: r.district, cycle: r.cycle_year, termYears: r.term_years, ...(r.county_idx !== null && r.county_idx !== undefined ? { county: r.county_idx } : {}) };
  }
  const current: Term[] = db.all<Record<string, unknown>>('SELECT * FROM office_term WHERE end_time IS NULL ORDER BY term_id').map((r) => ({
    id: r.term_id as number, officeId: r.office_id as number, personId: r.person_id as number, partyId: r.party_id as number | null, start: r.start_time as number,
    end: null, acquired: r.acquired as string, endReason: null, provenance: r.provenance as string,
  }));
  const chambers: Chamber[] = db.all<Record<string, unknown>>('SELECT * FROM chamber ORDER BY chamber_id').map((r) => {
    const latest = db.value<number>('SELECT MAX(as_of) FROM chamber_composition WHERE chamber_id = ?', [r.chamber_id as number]) ?? 0;
    const comp = db.all<{ party_id: number; seats: number; provenance: string }>('SELECT party_id, seats, provenance FROM chamber_composition WHERE chamber_id = ? AND as_of = ? ORDER BY party_id', [r.chamber_id as number, latest]);
    return { id: r.chamber_id as number, kind: r.kind as Chamber['kind'], stateIdx: r.state_idx as number | null, name: r.name as string, seats: r.seats as number,
      termYears: r.term_years as number, composition: new Map(comp.map((c) => [c.party_id, c.seats])), compositionAsOf: latest, compositionProvenance: comp[0]?.provenance ?? 'unknown' };
  });
  const vacancies = db.all<{ office_id: number; since: number; reason: string; resolution: string }>('SELECT * FROM vacancy').map((v) => ({ officeId: v.office_id, since: v.since, reason: v.reason, resolution: v.resolution }));
  const scheduled = db.all<{ event_id: number; sim_time: number; priority: number; kind: string; data_json: string }>('SELECT * FROM scheduled_event ORDER BY sim_time, priority, event_id')
    .map((e) => ({ id: e.event_id, time: e.sim_time, priority: e.priority, kind: e.kind, data: JSON.parse(e.data_json) as Record<string, unknown> }));
  const need = async (k: string) => { const b = await readStateBlob(db, k); if (!b) throw new Error(`Saved state is missing "${k}".`); return b; };
  const meta = (await readJsonState<LoadedRows['meta']>(db, 'world.meta')) ?? (() => { throw new Error('Saved state is missing "world.meta".'); })();
  const params = await decodeJson<ElectorateParams>(await need('electorate.params'));
  const fb = (await decodeBundle(await need('electorate.fields'))).arrays;
  const lb = (await decodeBundle(await need('lean.bu'))).arrays;
  return {
    universe, persons, offices, current, chambers, vacancies, scheduled, meta, params,
    fields: { division: fb.division as Float32Array, state: fb.state as Float32Array, county: fb.county as Float32Array, countyIid: fb.countyIid as Float32Array, bu: fb.bu as Float32Array },
    leanBu: { d: lb.d as Float32Array, t: lb.t as Float32Array },
  };
}
