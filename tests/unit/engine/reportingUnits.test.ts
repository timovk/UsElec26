/**
 * Reporting by town and Alaska district (Phase 7.5): the real pack's towns and districts (names, outlines in
 * rj.topo.json), and the archive's queries — town pages, the results map's unit areas, a state's table of units,
 * the night's baseline by unit — on a fixture whose Vermont reports by town and Alaska by House district.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeFixturePack } from '../../fixtures/fixturePack';
import { fixtureNames, packToFiles } from '../../fixtures/packFiles';
import { initSqlite, MemoryStorage } from '../../../src/persistence/storage';
import { Universe } from '../../../src/engine/universe';
import { zonedToUtc } from '../../../src/core/time';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { GeoPack, RjRec } from '../../../src/geo/pack';
import { isUnit, unitNames, unitStates } from '../../../src/geo/reportingUnits';
import { runQuery } from '../../../src/engine/queries';
import type { CountyHistoryDto, GeoMeta, MapLayerDto, ResultsMapDto, StateHistoryDto, TownHistoryDto } from '../../../src/engine/protocol';

const DIR = 'public/geo-packs/2016.1/';
const real = existsSync(`${DIR}rj.json`);

describe('reporting units of the real pack', () => {
  it.runIf(real)('names every town and district, and outlines each one', () => {
    const rj = JSON.parse(readFileSync(`${DIR}rj.json`, 'utf8')) as RjRec[];
    const states = JSON.parse(readFileSync(`${DIR}states.json`, 'utf8')) as { usps: string; idx: number }[];
    const usps = (i: number) => states.find((s) => s.idx === i)!.usps;
    const pack = { rj } as Pick<GeoPack, 'rj'>;
    const units = rj.filter(isUnit);
    expect(units.filter((r) => r.kind === 'town').length).toBe(1582);
    expect(units.filter((r) => r.kind === 'ak_house_district').length).toBe(40);
    expect([...unitStates(pack)].map(usps).sort()).toEqual(['AK', 'CT', 'MA', 'ME', 'NH', 'RI', 'VT']);
    const names = unitNames(pack);
    const named = (code: string) => names[rj.find((r) => r.code === code)!.idx];
    expect(named('0900104720')).toBe('Bethel');
    expect(named('2303165760')).toBe('Sanford'); // a 2010 code the 2016 files renumbered
    expect(units.every((r) => !/unknown/.test(names[r.idx]!))).toBe(true);
    const vt = units.filter((r) => usps(r.stateIdx) === 'VT').map((r) => names[r.idx]!);
    expect(vt).toContain('Rutland City'); expect(vt).toContain('Rutland Town'); expect(vt).toContain('Burlington');
    expect(new Set(units.map((r) => `${r.stateIdx}|${names[r.idx]}`)).size).toBe(units.length);
    // Every unit has its outline in the map topology.
    const topo = JSON.parse(readFileSync(`${DIR}topo/rj.topo.json`, 'utf8')) as { objects: Record<string, { geometries: { id: number }[] }> };
    const drawn = new Set([...topo.objects.towns!.geometries, ...topo.objects.akhd!.geometries].map((g) => g.id));
    expect(units.filter((r) => !drawn.has(r.idx))).toEqual([]);
    const manifest = JSON.parse(readFileSync(`${DIR}manifest.json`, 'utf8')) as { files: Record<string, { bytes: number }> };
    expect(manifest.files['topo/rj.topo.json']?.bytes).toBe(readFileSync(`${DIR}topo/rj.topo.json`).length);
  });
});

/**
 * The fixture pack with Vermont reporting by town (two per county) and Alaska by House district (four per
 * borough), numbered state by state as in the real pack (count plans take each state's reporting
 * jurisdictions as one contiguous range).
 */
function unitPack(): GeoPack {
  const p = makeFixturePack();
  const vt = p.states.find((s) => s.usps === 'VT')!.idx, ak = p.states.find((s) => s.usps === 'AK')!.idx;
  const rj: RjRec[] = [];
  for (const st of p.states) for (const c of p.counties.filter((x) => x.stateIdx === st.idx)) {
    if (st.idx !== vt && st.idx !== ak) {
      const old = p.rj.find((r) => r.countyIdx === c.idx)!; const idx = rj.length; rj.push({ ...old, idx });
      for (let b = c.buStart; b < c.buStart + c.buCount; b++) p.bu.rj[b] = idx;
      continue;
    }
    const pieces = st.idx === vt ? 2 : 4, first = rj.length;
    for (let k = 0; k < pieces; k++) rj.push(st.idx === vt
      ? { idx: rj.length, kind: 'town', stateIdx: vt, code: `${c.geoid}${String(k + 1).padStart(5, '0')}`, name: `${c.name.split(' ')[0]}${k ? 'ville' : 'ton'} town`, countyIdx: c.idx, pop2010: 1000 }
      : { idx: rj.length, kind: 'ak_house_district', stateIdx: ak, code: `02${String(rj.length).padStart(3, '0')}`, name: `House District ${rj.length - first + 1}`, countyIdx: null, pop2010: 1000 });
    for (let b = c.buStart; b < c.buStart + c.buCount; b++) p.bu.rj[b] = first + Math.floor(((b - c.buStart) * pieces) / Math.max(1, c.buCount));
  }
  return { ...p, rj };
}

let sqlite3: Sqlite3Static;
beforeAll(async () => { sqlite3 = await initSqlite(); });

describe('town and district results (fixture)', () => {
  it('pages, maps and tables by town and Alaska district, 2016', async () => {
    const files = await packToFiles(unitPack());
    const u = await Universe.create(new MemoryStorage(sqlite3), { name: 'Towns', seed: 'TOWNS-1' }, files, fixtureNames());
    await u.advance({ kind: 'until', time: zonedToUtc(2016, 12, 20, 0, 0, 'America/New_York') });
    const meta = await runQuery(u, { kind: 'geoMeta' }) as GeoMeta;
    const vt = meta.states.find((s) => s.usps === 'VT')!.idx, ak = meta.states.find((s) => s.usps === 'AK')!.idx;
    expect(meta.unitStates.sort()).toEqual([vt, ak].sort((a, b) => a - b));
    expect(meta.unitOffset).toBe(meta.counties.length);
    const town = meta.units.find((x) => x.kind === 'town')!, district = meta.units.find((x) => x.kind === 'ak_house_district')!;
    // A town's page: the presidential race and the rest, its county, the state's districts.
    const t = await runQuery(u, { kind: 'townHistory', rj: town.idx }) as TownHistoryDto;
    expect(t.found).toBe(true); expect(t.county?.idx).toBe(town.countyIdx);
    expect(t.rows.some((r) => r.officeKind === 'president' && r.year === 2016)).toBe(true);
    expect(t.rows.length).toBeGreaterThan(3);
    // The town's votes are part of its county's: never more.
    const c = await runQuery(u, { kind: 'countyHistory', county: town.countyIdx! }) as CountyHistoryDto;
    expect(c.towns.map((x) => x.rj)).toContain(town.idx);
    const presT = t.rows.find((r) => r.officeKind === 'president')!, presC = c.rows.find((r) => r.contestId === presT.contestId)!;
    expect(presT.total).toBeGreaterThan(0); expect(presT.total).toBeLessThanOrEqual(presC.total);
    // An Alaska district's page: no county, the state's contests.
    const d = await runQuery(u, { kind: 'townHistory', rj: district.idx }) as TownHistoryDto;
    expect(d.found).toBe(true); expect(d.kind).toBe('ak_house_district'); expect(d.county).toBeNull();
    expect(d.rows.some((r) => r.officeKind === 'president')).toBe(true);
    // The state's table of units, with the presidential margin in each.
    const s = await runQuery(u, { kind: 'stateHistory', state: vt }) as StateHistoryDto;
    expect(s.units.length).toBe(meta.units.filter((x) => x.stateIdx === vt).length);
    expect(s.units.every((x) => x.year === 2016 && x.dMargin !== null)).toBe(true);
    // The results map's county layer: every unit has a result, and Vermont's towns add up to its counties.
    const m = await runQuery(u, { kind: 'resultsMap', year: 2016, office: 'president', layer: 'county' }) as ResultsMapDto;
    expect(m.values.length).toBe(meta.unitOffset + unitPack().rj.length);
    for (const x of meta.units) expect(m.cells!.has[meta.unitOffset + x.idx]).toBe(1);
    const sum = (idxs: number[]) => idxs.reduce((a, i) => a + m.cells!.valid[i]!, 0);
    const vtCounties = meta.counties.filter((x) => x.stateIdx === vt).map((x) => x.idx), vtTowns = meta.units.filter((x) => x.stateIdx === vt).map((x) => meta.unitOffset + x.idx);
    expect(sum(vtTowns)).toBe(sum(vtCounties));
    expect(m.cells!.eligible![vtTowns[0]!]).toBeGreaterThan(0);
    // Today's map: the lean of every unit.
    const l = await runQuery(u, { kind: 'mapLayer', layer: 'county', metric: 'lean' }) as MapLayerDto;
    for (const x of meta.units) expect(l.values[meta.unitOffset + x.idx]).not.toBeNull();
    // A unit's details on the map.
    const e = await runQuery(u, { kind: 'entity', layer: 'county', idx: meta.unitOffset + town.idx }) as { title: string; subtitle: string };
    expect(e.title).toContain(town.name); expect(e.subtitle).toContain('Town');
    u.close();
  }, 900_000);
});
