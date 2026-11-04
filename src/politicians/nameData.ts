/** Runtime name-data format (public/data/names-v1.json, built by tools/build-names.mjs from Census files). */
import type { NameData } from './names';

export interface NameFileV1 {
  version: 1; source: string;
  surnames: [string, number, number, number, number, number][]; // name, count, %white, %black, %hispanic, %asian/other
  male: [string, number][]; female: [string, number][];
  blocklist: string[];
}

export function parseNameFile(f: NameFileV1): NameData {
  if (f.version !== 1) throw new Error(`unsupported name data version ${String(f.version)}`);
  return {
    surnames: f.surnames.map(([name, count, w, b, h, a]) => ({ name, count, pct: [w, b, h, a] })),
    givenMale: f.male.map(([name, freq]) => ({ name, freq })),
    givenFemale: f.female.map(([name, freq]) => ({ name, freq })),
    blocklist: new Set(f.blocklist),
  };
}
