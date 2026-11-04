/** Database-level audits: content hashing (determinism tests, seals) and integrity checks. */
import { sha256Hex } from '../core/codec';
import type { Db } from './db';

/** Tables/columns holding wall-clock metadata, excluded from simulation content hashes. */
const WALL_CLOCK: Record<string, string[] | 'all'> = { meta: 'all', universe: ['created_real'] };

export async function contentHash(db: Db): Promise<string> {
  const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((t) => t.name);
  const parts: string[] = [];
  for (const t of tables) {
    const excl = WALL_CLOCK[t];
    if (excl === 'all') continue;
    const rows = db.all(`SELECT * FROM "${t}" ORDER BY rowid`);
    parts.push(t);
    for (const r of rows) {
      const vals = Object.entries(r).filter(([k]) => !(excl ?? []).includes(k)).map(([, v]) => (v instanceof Uint8Array ? `b:${Array.from(v, (x) => x.toString(16).padStart(2, '0')).join('')}` : JSON.stringify(v)));
      parts.push(vals.join('\u001f'));
    }
  }
  return sha256Hex(new TextEncoder().encode(parts.join('\n')));
}

export interface IntegrityReport { ok: boolean; sqlite: string; checks: { name: string; ok: boolean; detail: string }[] }

export function integrityReport(db: Db): IntegrityReport {
  const sqlite = String(db.value('PRAGMA integrity_check') ?? 'unknown');
  const checks: IntegrityReport['checks'] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const multi = db.value<number>('SELECT COUNT(*) FROM (SELECT office_id FROM office_term WHERE end_time IS NULL GROUP BY office_id HAVING COUNT(*) > 1)') ?? 0;
  add('One current holder per office', multi === 0, multi ? `${multi} offices have more than one current holder` : 'ok');
  const dead = db.value<number>('SELECT COUNT(*) FROM office_term t JOIN person p ON p.person_id = t.person_id WHERE t.end_time IS NULL AND p.death_day IS NOT NULL') ?? 0;
  add('No deceased officeholders', dead === 0, dead ? `${dead} current terms held by deceased people` : 'ok');
  const orphan = db.value<number>('SELECT COUNT(*) FROM office_term t LEFT JOIN person p ON p.person_id = t.person_id WHERE p.person_id IS NULL') ?? 0;
  add('Every term references a person', orphan === 0, orphan ? `${orphan} orphaned terms` : 'ok');
  const both = db.value<number>('SELECT COUNT(*) FROM vacancy v JOIN office_term t ON t.office_id = v.office_id AND t.end_time IS NULL') ?? 0;
  add('Vacant offices have no current holder', both === 0, both ? `${both} offices are both vacant and filled` : 'ok');
  return { ok: sqlite === 'ok' && checks.every((c) => c.ok), sqlite, checks };
}
