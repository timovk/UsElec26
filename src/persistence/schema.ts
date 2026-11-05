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

const V2 = `
CREATE TABLE election (election_id INTEGER PRIMARY KEY, day INTEGER NOT NULL, kind TEXT NOT NULL, state_idx INTEGER, party_id INTEGER,
  year INTEGER NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL, held_time INTEGER, env_json TEXT);
CREATE INDEX election_day ON election(day);
CREATE TABLE contest (contest_id INTEGER PRIMARY KEY, election_id INTEGER NOT NULL, office_id INTEGER, kind TEXT NOT NULL, party_id INTEGER,
  state_idx INTEGER, district_idx INTEGER, method TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL, winner_candidacy INTEGER,
  runner_up_candidacy INTEGER, term_start INTEGER, parent_contest INTEGER, next_contest INTEGER, ev INTEGER, year INTEGER NOT NULL);
CREATE INDEX contest_election ON contest(election_id);
CREATE INDEX contest_office ON contest(office_id, year);
CREATE TABLE candidacy (candidacy_id INTEGER PRIMARY KEY, contest_id INTEGER NOT NULL, person_id INTEGER NOT NULL, party_id INTEGER NOT NULL,
  ballot_order INTEGER NOT NULL, incumbent INTEGER NOT NULL, running_mate INTEGER, status TEXT NOT NULL, quality REAL NOT NULL);
CREATE INDEX candidacy_contest ON candidacy(contest_id);
CREATE INDEX candidacy_person ON candidacy(person_id);
CREATE TABLE contest_total (contest_id INTEGER NOT NULL, rev INTEGER NOT NULL, candidacy_id INTEGER NOT NULL, votes INTEGER NOT NULL,
  share REAL NOT NULL, rank INTEGER NOT NULL, PRIMARY KEY (contest_id, rev, candidacy_id));
CREATE TABLE contest_turnout (contest_id INTEGER NOT NULL, rev INTEGER NOT NULL, ballots INTEGER NOT NULL, votes INTEGER NOT NULL,
  undervotes INTEGER NOT NULL, eligible INTEGER NOT NULL, PRIMARY KEY (contest_id, rev));
CREATE TABLE result_revision (contest_id INTEGER NOT NULL, rev INTEGER NOT NULL, kind TEXT NOT NULL, created_time INTEGER NOT NULL,
  reason TEXT, sha256 TEXT NOT NULL, PRIMARY KEY (contest_id, rev));
CREATE TABLE result_blob (contest_id INTEGER NOT NULL, rev INTEGER NOT NULL, grain TEXT NOT NULL, payload BLOB NOT NULL, crc32 INTEGER NOT NULL,
  PRIMARY KEY (contest_id, rev, grain));
CREATE TABLE contest_geo (county_idx INTEGER NOT NULL, contest_id INTEGER NOT NULL, PRIMARY KEY (county_idx, contest_id)) WITHOUT ROWID;
CREATE TABLE county_rollup (election_id INTEGER NOT NULL, state_idx INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (election_id, state_idx));
CREATE TABLE election_turnout (election_id INTEGER NOT NULL, state_idx INTEGER NOT NULL, ballots INTEGER NOT NULL, eligible INTEGER NOT NULL,
  payload BLOB NOT NULL, PRIMARY KEY (election_id, state_idx));
CREATE TABLE electoral_vote (election_id INTEGER NOT NULL, state_idx INTEGER NOT NULL, candidacy_id INTEGER NOT NULL, person_id INTEGER NOT NULL,
  party_id INTEGER NOT NULL, ev INTEGER NOT NULL, unit TEXT NOT NULL);
CREATE TABLE pending_special (office_id INTEGER PRIMARY KEY, since INTEGER NOT NULL, reason TEXT NOT NULL);
`;

const V3 = `
CREATE TABLE night (night_id INTEGER PRIMARY KEY, day INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, lock_time INTEGER NOT NULL,
  coverage_start INTEGER NOT NULL, night_end INTEGER NOT NULL, feed_end INTEGER NOT NULL, created_time INTEGER NOT NULL, sha256 TEXT NOT NULL, payload BLOB NOT NULL);
CREATE INDEX night_day ON night(day);
CREATE TABLE night_election (night_id INTEGER NOT NULL, election_id INTEGER NOT NULL, PRIMARY KEY (night_id, election_id));
CREATE TABLE county_rollup_rev (election_id INTEGER NOT NULL, state_idx INTEGER NOT NULL, rev INTEGER NOT NULL, payload BLOB NOT NULL,
  PRIMARY KEY (election_id, state_idx, rev));
`;

const V4 = `
CREATE TABLE pollster (pollster_id INTEGER PRIMARY KEY, name TEXT NOT NULL, short TEXT NOT NULL, method TEXT NOT NULL, sponsor TEXT,
  scope TEXT NOT NULL, home_state INTEGER, founded INTEGER NOT NULL, params_json TEXT NOT NULL);
CREATE TABLE poll (poll_id INTEGER PRIMARY KEY, pollster_id INTEGER NOT NULL, race_key TEXT NOT NULL, contest_id INTEGER, year INTEGER NOT NULL,
  geo TEXT NOT NULL, field_start INTEGER NOT NULL, field_end INTEGER NOT NULL, published INTEGER NOT NULL, population TEXT NOT NULL,
  n INTEGER NOT NULL, moe REAL NOT NULL, method TEXT NOT NULL, sponsor TEXT);
CREATE INDEX poll_race ON poll(race_key, published);
CREATE INDEX poll_published ON poll(published);
CREATE TABLE poll_response (poll_id INTEGER NOT NULL, option_key TEXT NOT NULL, label TEXT NOT NULL, party INTEGER, person_id INTEGER, pct REAL NOT NULL,
  PRIMARY KEY (poll_id, option_key)) WITHOUT ROWID;
CREATE TABLE poll_average (race_key TEXT NOT NULL, as_of INTEGER NOT NULL, method TEXT NOT NULL, payload_json TEXT NOT NULL,
  PRIMARY KEY (race_key, as_of, method)) WITHOUT ROWID;
CREATE TABLE race_def (race_key TEXT PRIMARY KEY, year INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, geo TEXT NOT NULL, contest_id INTEGER,
  options_json TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE forecast_run (run_id INTEGER PRIMARY KEY, year INTEGER NOT NULL, as_of INTEGER NOT NULL, model_version TEXT NOT NULL,
  summary_json TEXT NOT NULL, payload BLOB NOT NULL);
CREATE INDEX forecast_year ON forecast_run(year, as_of);
CREATE TABLE finance_report (candidacy_id INTEGER NOT NULL, period_end INTEGER NOT NULL, raised REAL NOT NULL, spent REAL NOT NULL, cash REAL NOT NULL,
  PRIMARY KEY (candidacy_id, period_end)) WITHOUT ROWID;
CREATE TABLE endorsement (endorsement_id INTEGER PRIMARY KEY, sim_time INTEGER NOT NULL, endorser_person INTEGER, endorser_label TEXT NOT NULL,
  person_id INTEGER NOT NULL, race_key TEXT NOT NULL, kind TEXT NOT NULL);
CREATE INDEX endorsement_race ON endorsement(race_key, sim_time);
CREATE TABLE campaign_event (event_id INTEGER PRIMARY KEY, sim_time INTEGER NOT NULL, kind TEXT NOT NULL, race_key TEXT, person_id INTEGER,
  magnitude REAL NOT NULL, headline TEXT NOT NULL, data_json TEXT);
CREATE INDEX campaign_event_time ON campaign_event(sim_time);
CREATE TABLE debate (debate_id INTEGER PRIMARY KEY, sim_time INTEGER NOT NULL, race_key TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
  participants_json TEXT NOT NULL, result_json TEXT);
CREATE TABLE delegate (year INTEGER NOT NULL, party_id INTEGER NOT NULL, state_idx INTEGER NOT NULL, person_id INTEGER NOT NULL, kind TEXT NOT NULL,
  count INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (year, party_id, state_idx, person_id, kind)) WITHOUT ROWID;
CREATE TABLE superdelegate (year INTEGER NOT NULL, person_id INTEGER NOT NULL, state_idx INTEGER, role TEXT NOT NULL, committed_to INTEGER, since INTEGER,
  PRIMARY KEY (year, person_id)) WITHOUT ROWID;
CREATE TABLE convention_ballot (year INTEGER NOT NULL, party_id INTEGER NOT NULL, ballot INTEGER NOT NULL, person_id INTEGER NOT NULL, votes INTEGER NOT NULL,
  PRIMARY KEY (year, party_id, ballot, person_id)) WITHOUT ROWID;
`;

const V5 = `
CREATE TABLE demography_year (year INTEGER PRIMARY KEY, summary_json TEXT NOT NULL);
CREATE TABLE electorate_year (year INTEGER PRIMARY KEY, platforms_json TEXT NOT NULL, national_lean REAL NOT NULL, summary_json TEXT NOT NULL);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, description: 'Phase 1 foundational universe schema', up: (db) => db.exec(V1) },
  { version: 2, description: 'Phase 2 elections, contests, candidacies and the results archive', up: (db) => db.exec(V2) },
  { version: 3, description: 'Phase 3 election nights (sealed count records) and certified rollups', up: (db) => db.exec(V3) },
  { version: 4, description: 'Phase 5 polls, averages, forecasts, campaigns, endorsements, debates and delegates', up: (db) => db.exec(V4) },
  { version: 5, description: 'Phase 6 political evolution: demography, the evolving electorate, economy, careers, Congress, census and districts', up: (db) => db.exec(V5) },
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
