/**
 * Reporting geography of one state on the night: parts (reporting jurisdiction × congressional district)
 * and synthetic precincts. Precincts are groups of whole Base Units inside one part, calibrated to the
 * 2010 voting-district count of the jurisdiction, so "precincts reporting" is exact and a precinct never
 * straddles a district line.
 */
export interface Parts { of: Int32Array; count: number; rj: Int32Array; cd: Int32Array }

/** Parts from each unit's reporting jurisdiction and district, numbered in (rj, cd) order. */
export function buildParts(rj: ArrayLike<number>, cd: ArrayLike<number>): Parts {
  const n = rj.length;
  const keys = new Set<number>();
  for (let i = 0; i < n; i++) keys.add(rj[i]! * 65536 + cd[i]!);
  const sorted = [...keys].sort((a, b) => a - b);
  const idx = new Map(sorted.map((k, i) => [k, i]));
  const of = new Int32Array(n);
  for (let i = 0; i < n; i++) of[i] = idx.get(rj[i]! * 65536 + cd[i]!)!;
  return { of, count: sorted.length, rj: Int32Array.from(sorted, (k) => Math.floor(k / 65536)), cd: Int32Array.from(sorted, (k) => k % 65536) };
}

export interface Precincts { of: Int32Array; count: number; part: Int32Array; perPart: Int32Array }

/**
 * Group the units of each part into precincts with roughly equal eligible voters. `rjTarget` is the target
 * number of precincts per reporting jurisdiction (indexed by rj − rjFirst); a part receives its share by
 * eligible population, at least one precinct and at most one per unit.
 */
export function buildPrecincts(parts: Parts, rjFirst: number, rjTarget: ArrayLike<number>, vep: ArrayLike<number>): Precincts {
  const n = parts.of.length;
  const partVep = new Float64Array(parts.count), rjVep = new Map<number, number>(), partUnits: number[][] = Array.from({ length: parts.count }, () => []);
  for (let i = 0; i < n; i++) { const p = parts.of[i]!; partVep[p]! += vep[i]!; partUnits[p]!.push(i); const r = parts.rj[p]!; rjVep.set(r, (rjVep.get(r) ?? 0) + vep[i]!); }
  const of = new Int32Array(n).fill(-1), partOf: number[] = [], perPart = new Int32Array(parts.count);
  let next = 0;
  for (let p = 0; p < parts.count; p++) {
    const units = partUnits[p]!; if (!units.length) continue;
    const r = parts.rj[p]!, share = (rjVep.get(r) ?? 0) > 0 ? partVep[p]! / rjVep.get(r)! : 1 / units.length;
    const target = Math.max(1, Math.min(units.length, Math.round((rjTarget[r - rjFirst] ?? 1) * share)));
    const total = partVep[p]!;
    let k = 0, acc = 0;
    for (const i of units) {
      // Start a new precinct when the cumulative electorate passes the next boundary.
      if (k < target - 1 && total > 0 && acc >= ((k + 1) * total) / target) k++;
      of[i] = next + k; acc += vep[i]!;
    }
    const used = k + 1;
    for (let q = 0; q < used; q++) partOf.push(p);
    perPart[p] = used; next += used;
  }
  return { of, count: next, part: Int32Array.from(partOf), perPart };
}
