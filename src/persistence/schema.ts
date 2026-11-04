/**
 * Universe database schema and migrations. `PRAGMA user_version` holds the schema version.
 * Migrations are append-only: never edit a released migration; add a new one.
 */
import type { Db } from './db';

export interface Migration { version: number; description: string; up(db: Db): void }

const V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE universe (
  id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, seed TEXT NOT NULL, created_real TEXT NOT NULL,
  start_time INTEGER NOT NULL, clock_time INTEGER NOT NULL, geo_pack TEXT NOT NULL, geo_pack_sha256 TEXT NOT NULL,
  options_json TEXT NOT NULL, engine_version TEXT NOT NULL);
CREATE TABLE engine_ledger (seq INTEGER PRIMARY KEY, from_time INTEGER NOT NULL, to_time INTEGER,
  engine_version TEXT NOT NULL, schema_version INTEGER NOT NULL);
CREATE TABLE command_log (seq INTEGER PRIMARY KEY, sim_time INTEGER NOT NULL, command_json TEXT NOT NULL);
CREATE TABLE op_journal (op_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, data_json TEXT);
CREATE TABLE state_blob (key TEXT PRIMARY KEY, sim_time INTEGER NOT NULL, codec TEXT NOT NULL, payload BLOB NOT NULL, crc32 INTEGER NOT NULL);
CREATE TABLE geo_pack_file (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, payload BLOB NOT NULL);

CREATE TABLE party (party_id INTEGER PRIMARY KEY, name TEXT NOT NULL, short TEXT NOT NULL, abbrev TEXT NOT NULL,
  color TEXT NOT NULL, major INTEGER NOT NULL, status TEXT NOT NULL);

CREATE TABLE person (person_id INTEGER PRIMARY KEY, given TEXT NOT NULL, middle TEXT, surname TEXT NOT NULL,
  suffix TEXT, nickname TEXT, sex TEXT NOT NULL, race TEXT NOT NULL, birth_day INTEGER NOT NULL, death_day INTEGER,
  home_state INTEGER NOT NULL, home_county INTEGER, tier TEXT NOT NULL, created_time INTEGER NOT NULL,
  provenance TEXT NOT NULL, bio TEXT);
CREATE INDEX person_state ON person(home_state);
CREATE TABLE person_traits (person_id INTEGER PRIMARY KEY, as_of INTEGER NOT NULL,
  ideo_econ REAL NOT NULL, ideo_social REAL NOT NULL, ideo_orient REAL NOT NULL,
  charisma REAL NOT NULL, campaign REAL NOT NULL, fundraising REAL NOT NULL, leadership REAL NOT NULL,
  integrity REAL NOT NULL, ambition REAL NOT NULL, recognition REAL NOT NULL);
CREATE TABLE party_affiliation (person_id INTEGER NOT NULL, party_id INTEGER NOT NULL, from_time INTEGER, to_time INTEGER);
CREATE INDEX party_affiliation_person ON party_affiliation(person_id);

CREATE TABLE chamber (chamber_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, state_idx INTEGER, name TEXT NOT NULL,
  seats INTEGER NOT NULL, term_years INTEGER NOT NULL);
CREATE TABLE chamber_composition (chamber_id INTEGER NOT NULL, as_of INTEGER NOT NULL, party_id INTEGER NOT NULL,
  seats INTEGER NOT NULL, provenance TEXT NOT NULL, PRIMARY KEY (chamber_id, as_of, party_id));

CREATE TABLE office (office_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, state_idx INTEGER,
  district_idx INTEGER, senate_class INTEGER, chamber_id INTEGER, dept TEXT, rank INTEGER NOT NULL);
CREATE INDEX office_kind ON office(kind, state_idx);
CREATE TABLE office_term (term_id INTEGER PRIMARY KEY, office_id INTEGER NOT NULL, person_id INTEGER NOT NULL,
  party_id INTEGER, start_time INTEGER NOT NULL, end_time INTEGER, acquired TEXT NOT NULL, end_reason TEXT,
  provenance TEXT NOT NULL);
CREATE INDEX office_term_office ON office_term(office_id, start_time);
CREATE INDEX office_term_person ON office_term(person_id, start_time);
CREATE TABLE vacancy (office_id INTEGER PRIMARY KEY, since INTEGER NOT NULL, reason TEXT NOT NULL, resolution TEXT NOT NULL);

CREATE TABLE career_event (event_id INTEGER PRIMARY KEY, person_id INTEGER NOT NULL, year_from INTEGER, year_to INTEGER,
  sim_time INTEGER, kind TEXT NOT NULL, text TEXT NOT NULL, provenance TEXT NOT NULL);
CREATE INDEX career_event_person ON career_event(person_id);

CREATE TABLE news (news_id INTEGER PRIMARY KEY, sim_time INTEGER NOT NULL, kind TEXT NOT NULL, headline TEXT NOT NULL,
  body TEXT, refs_json TEXT);
CREATE INDEX news_time ON news(sim_time);
CREATE TABLE scheduled_event (event_id INTEGER PRIMARY KEY, sim_time INTEGER NOT NULL, priority INTEGER NOT NULL,
  kind TEXT NOT NULL, data_json TEXT NOT NULL);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, description: 'Phase 1 foundational universe schema', up: (db) => db.exec(V1) },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function schemaVersion(db: Db): number { return Number(db.value('PRAGMA user_version') ?? 0); }

/** Apply pending migrations, each in its own transaction. Returns the versions applied. */
export function migrate(db: Db): number[] {
  const current = schemaVersion(db);
  if (current > SCHEMA_VERSION) throw new Error(`Universe was saved by a newer version of the app (schema ${current} > ${SCHEMA_VERSION}).`);
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.tx(() => { m.up(db); db.exec(`PRAGMA user_version = ${m.version}`); });
    applied.push(m.version);
  }
  return applied;
}
