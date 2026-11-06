/** Persistence of election law changes (Phase 7.1): the `election_law` table, loaded into `World.law` on open. */
import { ElectionLaw, type LawChange } from '../rules/electionLaw';
import type { GeoPack } from '../geo/pack';
import type { Db } from '../persistence/db';

export function loadElectionLaw(db: Db, pack: GeoPack): ElectionLaw {
  const rows = db.all<{ law_id: number; state_idx: number; enacted: number; effective_day: number; source: LawChange['source']; change_json: string; summary: string }>('SELECT * FROM election_law ORDER BY law_id');
  return new ElectionLaw(pack.states.map((s) => s.usps), rows.map((r) => ({ id: r.law_id, stateIdx: r.state_idx, enacted: r.enacted, effective: r.effective_day, source: r.source, change: JSON.parse(r.change_json) as LawChange['change'], summary: r.summary })));
}

/** Record an enacted change (inside the caller's transaction) and apply it in memory. */
export function enactLaw(db: Db, law: ElectionLaw, c: Omit<LawChange, 'id'>): LawChange {
  const full: LawChange = { ...c, id: law.nextId };
  db.run('INSERT INTO election_law(law_id, state_idx, enacted, effective_day, source, change_json, summary) VALUES (?,?,?,?,?,?,?)', [full.id, full.stateIdx, full.enacted, full.effective, full.source, JSON.stringify(full.change), full.summary]);
  law.add(full);
  return full;
}
