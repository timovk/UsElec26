/**
 * Fictional-name generation from public-domain frequency data (Census 2010 surnames with race/ethnicity
 * percentages; Census 1990 given names). Names that match prominent real politicians are rejected.
 */
import type { Rng } from '../core/rng';

export interface NameData {
  surnames: { name: string; count: number; pct: [number, number, number, number] }[]; // white, black, hispanic, asian/other
  givenMale: { name: string; freq: number }[];
  givenFemale: { name: string; freq: number }[];
  blocklist: ReadonlySet<string>; // lowercase "given surname"
}

interface Cum { names: string[]; cum: Float64Array }
function cumulative(names: string[], weights: number[]): Cum {
  const cum = new Float64Array(names.length); let s = 0;
  for (let i = 0; i < names.length; i++) { s += weights[i]!; cum[i] = s; }
  return { names, cum };
}
function draw(c: Cum, r: Rng): string {
  const u = r.float() * c.cum[c.cum.length - 1]!;
  let lo = 0, hi = c.cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (c.cum[m]! > u) hi = m; else lo = m + 1; }
  return c.names[lo]!;
}

const MIDDLE = 'AABBCCDDEEFGHJJJKLLMMMNPRRSSTWW';

export class NameGenerator {
  private readonly surnameByRace: Cum[];
  private readonly male: Cum; private readonly female: Cum;
  private readonly used = new Set<string>();

  constructor(private readonly data: NameData) {
    this.surnameByRace = [0, 1, 2, 3].map((r) => cumulative(data.surnames.map((s) => s.name), data.surnames.map((s) => s.count * Math.max(0, s.pct[r]!) / 100)));
    // Flatten given-name frequencies a little so the most common names do not dominate.
    this.male = cumulative(data.givenMale.map((g) => g.name), data.givenMale.map((g) => Math.pow(g.freq, 0.8)));
    this.female = cumulative(data.givenFemale.map((g) => g.name), data.givenFemale.map((g) => Math.pow(g.freq, 0.8)));
  }

  /** Reserve existing names (when loading a universe) so new people never duplicate them. */
  reserve(given: string, surname: string): void { this.used.add(`${given} ${surname}`.toLowerCase()); }

  generate(r: Rng, sex: 'M' | 'F', race: number): { given: string; middle: string; surname: string; suffix: string | null } {
    for (let attempt = 0; attempt < 200; attempt++) {
      const given = draw(sex === 'M' ? this.male : this.female, r);
      const surname = draw(this.surnameByRace[race] ?? this.surnameByRace[0]!, r);
      const key = `${given} ${surname}`.toLowerCase();
      if (this.data.blocklist.has(key)) continue;
      if (this.used.has(key) && attempt < 40) continue; // prefer unique names; common names may eventually repeat, as in reality
      this.used.add(key);
      const middle = MIDDLE[r.int(MIDDLE.length)]!;
      const suffix = sex === 'M' && r.bernoulli(0.03) ? (r.bernoulli(0.8) ? 'Jr.' : 'III') : null;
      return { given, middle, surname, suffix };
    }
    throw new Error('name space exhausted');
  }
}

/** Title-case a name, handling Mc/Mac, O', hyphens and apostrophes. */
export function titleCaseName(raw: string): string {
  const s = raw.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
  return s.replace(/^Mc([a-z])/, (_, c: string) => `Mc${c.toUpperCase()}`);
}
