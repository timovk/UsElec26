/**
 * The universe's yearly evolution, run each January 1 before the year's elections are planned:
 * demography (population growth, aging, migration, composition), then the electorate (platforms,
 * attachments, partisanship). The world's population, electorate and neutral lean are rebuilt from the
 * result; the new state is saved with the next commit.
 */
import { decodeBundle, encodeBundle } from '../core/codec';
import type { Db } from '../persistence/db';
import type { Electorate } from '../electorate/model';
import { buLean } from '../electorate/model';
import { electorateAt, initialDynamics, stepElectorate, type DynamicsContext, type ElectorateDynamics } from '../electorate/dynamics';
import { applyDemography, demographySummary, initialDemography, stepDemography, BASE_YEAR, type DemographyFlows, type DemographyState } from '../population/evolution';
import type { Population } from '../population/population';
import { readStateBlob } from './save';
import { aggregateLean, leanMargin, type World } from './world';

export interface StateBlob { key: string; codec: string; payload: Uint8Array }

export class Evolution {
  private constructor(
    private readonly w: World, readonly basePop: Population, readonly baseElectorate: Electorate, readonly baseDemo: DemographyState,
    public demo: DemographyState, public dyn: ElectorateDynamics,
  ) {}

  /** A universe at its founding (or one saved before Phase 6, which starts evolving from its next January 1). */
  static fresh(w: World): Evolution {
    const d0 = initialDemography(w.pack, w.pop);
    return new Evolution(w, w.pop, w.electorate, d0, d0, initialDynamics(w.electorate, BASE_YEAR));
  }

  /** Restore the saved evolution state and rebuild the world's population, electorate and lean from it. */
  static async load(db: Db, w: World): Promise<Evolution> {
    const ev = Evolution.fresh(w);
    const d = await readStateBlob(db, 'demography.state'), e = await readStateBlob(db, 'electorate.dynamics');
    if (d) {
      const { arrays, meta } = await decodeBundle(d);
      ev.demo = { year: (meta as { year: number }).year, age: arrays.age as Float64Array, race: arrays.race as Float64Array, college: arrays.college as Float64Array, total: arrays.total as Float64Array, trend: arrays.trend as Float64Array, divTrend: arrays.divTrend as Float64Array };
      w.pop = applyDemography(w.seed, w.pack, ev.basePop, ev.baseDemo, ev.demo);
    }
    if (e) {
      const { arrays, meta } = await decodeBundle(e);
      const m = meta as { year: number; platforms: { D: number[]; R: number[] }; attach: number[] };
      ev.dyn = { year: m.year, platforms: m.platforms, attach: m.attach, mu: arrays.mu as Float32Array };
      w.electorate = electorateAt(ev.baseElectorate, ev.dyn, w.pack, w.pop);
    }
    return ev;
  }

  /**
   * Bring the universe to January 1 of `year`: one demographic and electoral step per year since the state's
   * year. Returns the state blobs to save and a summary for the news.
   */
  async yearStart(year: number, context: (y: number) => Omit<DynamicsContext, 'flows'>, db: Db): Promise<{ blobs: StateBlob[]; summary: string } | null> {
    if (this.demo.year >= year) return null;
    const w = this.w;
    let flows: DemographyFlows | null = null;
    while (this.demo.year < year) {
      const step = stepDemography(w.seed, w.pack, this.demo);
      this.demo = step.next; flows = step.flows;
      w.pop = applyDemography(w.seed, w.pack, this.basePop, this.baseDemo, this.demo);
      this.dyn = stepElectorate(w.seed, this.demo.year, this.baseElectorate, this.dyn, w.pack, w.pop, this.basePop, { ...context(this.demo.year), flows });
    }
    w.electorate = electorateAt(this.baseElectorate, this.dyn, w.pack, w.pop);
    // Rounded to the stored precision (Float32) so the universe behaves identically before and after a reload.
    const raw = buLean(w.electorate, w.pack, w.pop);
    const bu = { dVotes: Float64Array.from(Float32Array.from(raw.dVotes)), votes: Float64Array.from(Float32Array.from(raw.votes)) };
    w.lean = { bu, ...aggregateLean(bu, w.pack, w.districts) };
    // The record: a demographic and political summary of the year.
    const sum = demographySummary(w.pack, this.demo);
    const national = leanMargin({ dVotes: Float64Array.of(w.lean.national.d), votes: Float64Array.of(w.lean.national.t) }, 0);
    db.run('INSERT OR REPLACE INTO demography_year VALUES (?,?)', [year, JSON.stringify({ ...sum, state: sum.state.map((x) => ({ adults: Math.round(x.adults), total: Math.round(x.total) })), flows: flows ? { deaths: Math.round(flows.deaths), entrants: Math.round(flows.entrants), migration: Math.round(flows.migration) } : null })]);
    db.run('INSERT OR REPLACE INTO electorate_year VALUES (?,?,?,?)', [year, JSON.stringify(this.dyn.platforms), national, JSON.stringify({ attach: this.dyn.attach.map((x) => Math.round(1000 * x) / 1000), stateLean: w.pack.states.map((_, s) => Math.round(10 * leanMargin(w.lean.state, s)) / 10) })]);
    const d = this.demo;
    const blobs: StateBlob[] = [
      { key: 'demography.state', codec: 'bundle', payload: await encodeBundle({ age: d.age, race: d.race, college: d.college, total: d.total, trend: d.trend, divTrend: d.divTrend }, { year: d.year }) },
      { key: 'electorate.dynamics', codec: 'bundle', payload: await encodeBundle({ mu: this.dyn.mu }, { year: this.dyn.year, platforms: this.dyn.platforms, attach: this.dyn.attach }) },
      { key: 'lean.bu', codec: 'bundle', payload: await encodeBundle({ d: Float32Array.from(bu.dVotes), t: Float32Array.from(bu.votes) }) },
    ];
    const growth = 100 * (sum.adults / (demographySummary(w.pack, this.baseDemo).adults) - 1);
    return { blobs, summary: `${(sum.total / 1e6).toFixed(1)} million residents and ${(sum.adults / 1e6).toFixed(1)} million eligible voters (${growth >= 0 ? '+' : ''}${growth.toFixed(1)}% since 2016); ${(100 * sum.age[3]!).toFixed(0)}% of eligible voters are 65 or older.` };
  }
}
