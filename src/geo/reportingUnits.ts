/**
 * Reporting units shown in place of counties (Phase 7.5): New England reports by town and Alaska by State House
 * district, and the count already runs on these reporting jurisdictions (RJs). Maps, pages and the night's
 * tables show them where a state reports that way; everywhere else they show counties.
 *
 * Areas share one index space on the maps: counties first (their index), then each such unit at
 * `counties.length + rj index`.
 */
import type { GeoPack, RjRec } from './pack';

/** Towns whose Census code changed between the 2010 blocks and the 2016 boundaries; their pack name is "unknown". */
const RENAMED: Record<string, string> = {
  '2301957937': 'Penobscot Indian Island', '2303165760': 'Sanford', '5001123875': 'Enosburgh', '5001300700': 'Alburgh',
};

/** Whether a reporting jurisdiction is shown in place of its county (a New England town or an Alaska district with residents). */
export const isUnit = (r: RjRec): boolean => r.kind !== 'county' && (r.pop2010 > 0 || r.kind === 'ak_house_district');

const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
const cache = new WeakMap<GeoPack, string[]>();

/**
 * Display names of every reporting jurisdiction (index = rj index): "Bethel", "Rutland City" beside "Rutland Town",
 * "Monhegan Plantation", "Central Aroostook Unorganized Territory", "House District 12"; counties keep their name.
 */
export function unitNames(pack: Pick<GeoPack, 'rj'>): string[] {
  let hit = cache.get(pack as GeoPack); if (hit) return hit;
  const base = (n: string) => n.replace(/ (town|city)$/, '');
  const count = new Map<string, number>();
  for (const r of pack.rj) if (r.kind === 'town') { const k = `${r.stateIdx}|${base(r.name)}`; count.set(k, (count.get(k) ?? 0) + 1); }
  hit = pack.rj.map((r) => {
    if (r.kind !== 'town') return r.name;
    const name = RENAMED[r.code] ?? r.name;
    const b = base(name);
    if (b !== name && (count.get(`${r.stateIdx}|${b}`) ?? 0) <= 1) return b;
    return titleCase(name);
  });
  cache.set(pack as GeoPack, hit);
  return hit;
}

/** States that report by these units (New England's six, Alaska). */
export function unitStates(pack: Pick<GeoPack, 'rj'>): Set<number> {
  return new Set(pack.rj.filter(isUnit).map((r) => r.stateIdx));
}

/** The map area index of a reporting jurisdiction shown in place of its county. */
export const unitArea = (pack: Pick<GeoPack, 'counties'>, rj: number): number => pack.counties.length + rj;
