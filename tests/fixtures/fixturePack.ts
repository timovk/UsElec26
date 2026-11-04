/**
 * Synthetic geography pack for tests: real state identities and 2010 apportionment, fake counties and
 * Base Units. It exercises every engine code path quickly; it is never shipped or shown to users.
 */
import { Rng } from '../../src/core/rng';
import type { BaseUnits, CountyRec, DistrictRec, GeoPack, RjRec, StateRec } from '../../src/geo/pack';
import { validatePack } from '../../src/geo/pack';

// usps, fips, name, region, division, 2010 population (millions), House seats (2010 apportionment)
export const STATE_TABLE: [string, string, string, number, number, number, number][] = [
  ['AL', '01', 'Alabama', 3, 6, 4.78, 7], ['AK', '02', 'Alaska', 4, 9, 0.71, 1], ['AZ', '04', 'Arizona', 4, 8, 6.39, 9],
  ['AR', '05', 'Arkansas', 3, 7, 2.92, 4], ['CA', '06', 'California', 4, 9, 37.25, 53], ['CO', '08', 'Colorado', 4, 8, 5.03, 7],
  ['CT', '09', 'Connecticut', 1, 1, 3.57, 5], ['DE', '10', 'Delaware', 3, 5, 0.9, 1], ['DC', '11', 'District of Columbia', 3, 5, 0.6, 0],
  ['FL', '12', 'Florida', 3, 5, 18.8, 27], ['GA', '13', 'Georgia', 3, 5, 9.69, 14], ['HI', '15', 'Hawaii', 4, 9, 1.36, 2],
  ['ID', '16', 'Idaho', 4, 8, 1.57, 2], ['IL', '17', 'Illinois', 2, 3, 12.83, 18], ['IN', '18', 'Indiana', 2, 3, 6.48, 9],
  ['IA', '19', 'Iowa', 2, 4, 3.05, 4], ['KS', '20', 'Kansas', 2, 4, 2.85, 4], ['KY', '21', 'Kentucky', 3, 6, 4.34, 6],
  ['LA', '22', 'Louisiana', 3, 7, 4.53, 6], ['ME', '23', 'Maine', 1, 1, 1.33, 2], ['MD', '24', 'Maryland', 3, 5, 5.77, 8],
  ['MA', '25', 'Massachusetts', 1, 1, 6.55, 9], ['MI', '26', 'Michigan', 2, 3, 9.88, 14], ['MN', '27', 'Minnesota', 2, 4, 5.3, 8],
  ['MS', '28', 'Mississippi', 3, 6, 2.97, 4], ['MO', '29', 'Missouri', 2, 4, 5.99, 8], ['MT', '30', 'Montana', 4, 8, 0.99, 1],
  ['NE', '31', 'Nebraska', 2, 4, 1.83, 3], ['NV', '32', 'Nevada', 4, 8, 2.7, 4], ['NH', '33', 'New Hampshire', 1, 1, 1.32, 2],
  ['NJ', '34', 'New Jersey', 1, 2, 8.79, 12], ['NM', '35', 'New Mexico', 4, 8, 2.06, 3], ['NY', '36', 'New York', 1, 2, 19.38, 27],
  ['NC', '37', 'North Carolina', 3, 5, 9.54, 13], ['ND', '38', 'North Dakota', 2, 4, 0.67, 1], ['OH', '39', 'Ohio', 2, 3, 11.54, 16],
  ['OK', '40', 'Oklahoma', 3, 7, 3.75, 5], ['OR', '41', 'Oregon', 4, 9, 3.83, 5], ['PA', '42', 'Pennsylvania', 1, 2, 12.7, 18],
  ['RI', '44', 'Rhode Island', 1, 1, 1.05, 2], ['SC', '45', 'South Carolina', 3, 5, 4.63, 7], ['SD', '46', 'South Dakota', 2, 4, 0.81, 1],
  ['TN', '47', 'Tennessee', 3, 6, 6.35, 9], ['TX', '48', 'Texas', 3, 7, 25.15, 36], ['UT', '49', 'Utah', 4, 8, 2.76, 4],
  ['VT', '50', 'Vermont', 1, 1, 0.63, 1], ['VA', '51', 'Virginia', 3, 5, 8.0, 11], ['WA', '53', 'Washington', 4, 9, 6.72, 10],
  ['WV', '54', 'West Virginia', 3, 5, 1.85, 3], ['WI', '55', 'Wisconsin', 2, 3, 5.69, 8], ['WY', '56', 'Wyoming', 4, 8, 0.56, 1],
];

const TZ: Record<number, string> = { 1: 'America/New_York', 2: 'America/New_York', 3: 'America/Chicago', 4: 'America/Chicago', 5: 'America/New_York', 6: 'America/Chicago', 7: 'America/Chicago', 8: 'America/Denver', 9: 'America/Los_Angeles' };

export function makeFixturePack(opts: { countiesPerMillion?: number; busPerCounty?: number; seed?: string } = {}): GeoPack {
  const r = Rng.stream(opts.seed ?? 'fixture', 'pack');
  const cpm = opts.countiesPerMillion ?? 2.5, bpc = opts.busPerCounty ?? 16;
  const states: StateRec[] = []; const counties: CountyRec[] = []; const cds: DistrictRec[] = [];
  const sldu: DistrictRec[] = []; const sldl: DistrictRec[] = []; const rj: RjRec[] = [];
  const cols: Record<string, number[]> = {};
  const push = (k: string, v: number) => (cols[k] ??= []).push(v);
  const adjacency: number[][] = [];
  let bu = 0;
  const firstCountyOfState: number[] = [];
  for (const [si, [usps, fips, name, region, division, popM, seats]] of STATE_TABLE.entries()) {
    const pop2010 = Math.round(popM * 1e6);
    states.push({ idx: si, fips, usps, name, region, division, pop2010, vap2010: Math.round(pop2010 * 0.76), pop2016: Math.round(pop2010 * 1.04) });
    const nC = Math.max(1, Math.min(14, Math.round(popM * cpm)));
    const weights = Array.from({ length: nC }, () => Math.exp(r.normal(0, 1.1)));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const cdBase = cds.length, nCd = Math.max(1, seats);
    if (seats > 0) for (let d = 0; d < nCd; d++) cds.push({ idx: cds.length, geoid: `${fips}${String(seats === 1 ? 0 : d + 1).padStart(2, '0')}`, stateIdx: si, district: seats === 1 ? 0 : d + 1, pop2010: 0, vap2010: 0 });
    const nU = Math.max(1, Math.round(popM * 3)), nL = Math.max(1, Math.round(popM * 7));
    const uBase = sldu.length, lBase = sldl.length;
    if (usps !== 'DC') {
      for (let d = 0; d < nU; d++) sldu.push({ idx: sldu.length, geoid: `${fips}${String(d + 1).padStart(3, '0')}`, stateIdx: si, code: String(d + 1), name: `District ${d + 1}`, pop2010: 0, vap2010: 0 });
      if (usps !== 'NE') for (let d = 0; d < nL; d++) sldl.push({ idx: sldl.length, geoid: `${fips}${String(d + 1).padStart(3, '0')}`, stateIdx: si, code: String(d + 1), name: `District ${d + 1}`, pop2010: 0, vap2010: 0 });
    }
    firstCountyOfState.push(counties.length);
    const stateBuStart = bu; const stateBuTotal = nC * bpc;
    for (let ci = 0; ci < nC; ci++) {
      const cIdx = counties.length;
      const cPop = Math.round(pop2010 * weights[ci]! / wsum);
      const geoid = `${fips}${String(2 * ci + 1).padStart(3, '0')}`;
      const buStart = bu;
      const density = r.normal(0, 1);
      for (let k = 0; k < bpc; k++) {
        const p = Math.max(50, Math.round(cPop / bpc * Math.exp(r.normal(0, 0.3))));
        const vap = Math.round(p * r.range(0.7, 0.82));
        const black = r.beta(1, 7), hisp = r.beta(1, 6), white = Math.max(0, 1 - black - hisp - r.beta(1, 12));
        const a = [r.range(0.15, 0.3), r.range(0.2, 0.3), r.range(0.28, 0.38)]; a.push(Math.max(0.05, 1 - a[0]! - a[1]! - a[2]!));
        const at = a.reduce((x, y) => x + y, 0);
        const pos = (bu - stateBuStart) / stateBuTotal;
        push('county', cIdx); push('cd', seats > 0 ? cdBase + Math.min(nCd - 1, Math.floor(pos * nCd)) : 65535);
        push('sldu', usps === 'DC' ? 65535 : uBase + Math.min(nU - 1, Math.floor(pos * nU)));
        push('sldl', usps === 'DC' || usps === 'NE' ? 65535 : lBase + Math.min(nL - 1, Math.floor(pos * nL)));
        push('cousub', 65535); push('rj', cIdx); push('tract', 100 + Math.floor(k / 3)); push('bg', 1 + (k % 3)); push('part', 0); push('blocks', 20);
        push('pop2010', p); push('vap2010', vap); push('vapHisp', Math.round(vap * hisp)); push('vapWhiteNH', Math.round(vap * white)); push('vapBlackNH', Math.round(vap * black));
        push('landM2', p / Math.exp(4 + 2 * density + r.normal(0, 0.5)) * 1e6); push('x', ci); push('y', k); push('lon', -90); push('lat', 38);
        push('cvap', vap * r.range(0.8, 0.98));
        for (const [i, key] of ['a18_29', 'a30_44', 'a45_64', 'a65p'].entries()) push(key, Math.round(65535 * a[i]! / at));
        push('male18', Math.round(65535 * r.range(0.46, 0.5))); push('college25', Math.round(65535 * r.beta(3, 7)));
        push('medInc', 55000 * Math.exp(r.normal(0, 0.35))); push('flags', 0);
        bu++;
      }
      counties.push({ idx: cIdx, geoid, stateIdx: si, name: `${name} ${ci + 1}`, fullName: `${name} ${ci + 1} County`, legalType: 'County',
        pop2010: cPop, vap2010: Math.round(cPop * 0.76), pop2016: Math.round(cPop * r.range(0.95, 1.12)), landM2: cPop / Math.exp(4 + 2 * density) * 1e6,
        tz: TZ[division]!, tzSplit: false, centroid: [ci, si], lonlat: [-90, 38], vtdCount2010: bpc, buStart, buCount: bpc });
      rj.push({ idx: cIdx, kind: 'county', stateIdx: si, code: geoid, name: `${name} ${ci + 1}`, countyIdx: cIdx, pop2010: cPop });
      adjacency.push([]);
    }
    // Within-state chain + ring adjacency.
    const f = firstCountyOfState[si]!;
    for (let ci = 0; ci < nC; ci++) {
      const a = f + ci;
      for (const d of [1, 2]) if (ci + d < nC) { adjacency[a]!.push(a + d); adjacency[a + d]!.push(a); }
    }
  }
  // Cross-state links between consecutive states in the same division.
  for (let si = 1; si < STATE_TABLE.length; si++) {
    if (STATE_TABLE[si]![4] !== STATE_TABLE[si - 1]![4]) continue;
    const a = firstCountyOfState[si - 1]!, b = firstCountyOfState[si]!;
    adjacency[a]!.push(b); adjacency[b]!.push(a);
  }
  adjacency.forEach((n) => n.sort((x, y) => x - y));
  const typed = (k: string, T: new (n: number[]) => ArrayLike<number>) => new T(cols[k]!);
  const buOut = {
    rows: bu,
    county: typed('county', Uint16Array as never), cd: typed('cd', Uint16Array as never), sldu: typed('sldu', Uint16Array as never), sldl: typed('sldl', Uint16Array as never),
    cousub: typed('cousub', Uint16Array as never), rj: typed('rj', Uint16Array as never), tract: typed('tract', Uint32Array as never), bg: typed('bg', Uint8Array as never),
    part: typed('part', Uint8Array as never), blocks: typed('blocks', Uint16Array as never), pop2010: typed('pop2010', Uint32Array as never), vap2010: typed('vap2010', Uint32Array as never),
    vapHisp: typed('vapHisp', Uint32Array as never), vapWhiteNH: typed('vapWhiteNH', Uint32Array as never), vapBlackNH: typed('vapBlackNH', Uint32Array as never),
    landM2: typed('landM2', Float32Array as never), x: typed('x', Float32Array as never), y: typed('y', Float32Array as never), lon: typed('lon', Float32Array as never),
    lat: typed('lat', Float32Array as never), cvap: typed('cvap', Float32Array as never), a18_29: typed('a18_29', Uint16Array as never), a30_44: typed('a30_44', Uint16Array as never),
    a45_64: typed('a45_64', Uint16Array as never), a65p: typed('a65p', Uint16Array as never), male18: typed('male18', Uint16Array as never), college25: typed('college25', Uint16Array as never),
    medInc: typed('medInc', Float32Array as never), flags: typed('flags', Uint8Array as never),
  } as unknown as BaseUnits;
  for (let b = 0; b < bu; b++) {
    const cd = buOut.cd[b]!; if (cd !== 65535) { cds[cd]!.pop2010 += buOut.pop2010[b]!; cds[cd]!.vap2010 += buOut.vap2010[b]!; }
  }
  const pack: GeoPack = {
    version: 'fixture', manifest: { packVersion: 'fixture', counts: { bu, counties: counties.length }, files: {} },
    states, counties, cds, sldu, sldl, cousub: [], rj, bu: buOut, countyAdjacency: adjacency,
  };
  validatePack(pack);
  return pack;
}
