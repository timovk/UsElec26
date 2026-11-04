/**
 * Broadcast Mode (docs/architecture/12): the night as a fictional network presents it — brand bar and
 * clock, electoral and seat counters, the magic-wall map, projection and Key Race Alert banners with sound,
 * the lower-third commentary, a ticker and playback controls with markers. Everything shown is computed
 * from the sealed night record (counts, desk calls, alerts and commentary written at the ballot lock).
 */
import { surname } from '../../core/names';
import { useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../state/engineClient';
import type { BaselineCountiesDto, NightContextDto, StoryAlert, StoryLine } from '../../engine/protocol';
import { formatDate } from '../../core/time';
import { PARTY_COLORS, fmtInt } from '../components/common';
import { NightMap } from './NightMap';
import { MODES, legendOf, PALE, type MapMode } from './mapModes';
import { ET, SPEEDS, ST, clock, leaderOf, marginOf, pctIn, validOf, type NightState, type RaceMeta } from './useNight';
import { isMuted, playCue, setMuted, unlockAudio, type Cue } from './audio';
import './broadcast.css';

const OFFICE_TABS = [{ id: 'president', label: 'President' }, { id: 'us_senator', label: 'Senate' }, { id: 'governor', label: 'Governor' }, { id: 'us_representative', label: 'House' }];
const KEY_OFFICES = ['president', 'us_senator', 'governor'];
const ABBR: Record<number, string> = { 1: 'D', 2: 'R', 3: 'L', 4: 'G', 5: 'I' };

function useReducedMotion(): [boolean, (v: boolean) => void] {
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [user, setUser] = useState<boolean | null>(() => { try { const v = localStorage.getItem('ena.motion'); return v === null ? null : v === 'reduced'; } catch { return null; } });
  const [sys, setSys] = useState(media?.matches ?? false);
  useEffect(() => { if (!media) return; const f = () => setSys(media.matches); media.addEventListener('change', f); return () => media.removeEventListener('change', f); }, [media]);
  return [user ?? sys, (v) => { setUser(v); try { localStorage.setItem('ena.motion', v ? 'reduced' : 'full'); } catch { /* storage unavailable */ } }];
}

/** A number that counts up to its target (immediately with reduced motion). */
function useTween(target: number, reduced: boolean): number {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (reduced) { cur.current = target; return; }
    const from = cur.current, t0 = performance.now(); let raf = 0;
    const step = (now: number) => { const u = Math.min(1, (now - t0) / 700), e = 1 - Math.pow(1 - u, 3); cur.current = from + (target - from) * e; setV(cur.current); if (u < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return reduced ? target : Math.round(v);
}

const cueOf = (a: StoryAlert): Cue => (a.kind === 'projection' || a.kind === 'runoff' ? 'projection' : a.kind === 'key_race' || a.kind === 'major_county' || a.kind === 'too_close' || a.kind === 'recount' ? 'key_race' : a.kind === 'president' || a.kind === 'control' || a.kind === 'electoral' ? 'major' : a.kind === 'withdrawn' ? 'withdrawn' : 'polls_closed');

/** The banner queue: alerts crossed by the playhead, filtered by importance for the playback speed. */
function useBanners(alerts: StoryAlert[], t: number, speed: number, reduced: boolean): StoryAlert | null {
  const prev = useRef(t);
  const [queue, setQueue] = useState<StoryAlert[]>([]);
  useEffect(() => {
    const a = prev.current; prev.current = t;
    if (t < a || t - a > 20) { setQueue([]); return; } // a seek: do not replay a flood of alerts
    const min = speed <= 30 ? 5 : speed <= 120 ? 6.5 : speed <= 300 ? 8 : 9;
    const fresh = alerts.filter((x) => x.time > a && x.time <= t && x.importance >= min);
    if (fresh.length) setQueue((q) => [...q, ...fresh].sort((x, y) => y.importance - x.importance || x.time - y.time).slice(0, 4));
  }, [t, alerts, speed]);
  const current = queue[0] ?? null;
  useEffect(() => {
    if (!current) return;
    playCue(cueOf(current));
    const ms = (current.importance >= 9 ? 6500 : 4200) * (queue.length > 2 ? 0.6 : 1);
    const id = setTimeout(() => setQueue((q) => q.slice(1)), reduced ? ms * 1.2 : ms);
    return () => clearTimeout(id);
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  return current;
}

export function Broadcast({ n, picker, tabs }: { n: NightState; picker: React.ReactNode; tabs: React.ReactNode }) {
  const { meta, t, races } = n;
  const [reduced, setReduced] = useReducedMotion();
  const [muted, setMute] = useState(isMuted());
  const [level, setLevel] = useState<number | null>(null);
  const [mode, setMode] = useState<MapMode>('winner');
  const [ctx, setCtx] = useState<NightContextDto | null>(null);
  const [base, setBase] = useState<{ race: number | null; data: BaselineCountiesDto }>({ race: null, data: null });
  const story = meta.story;
  const available = OFFICE_TABS.filter((o) => meta.races.some((x) => x.office === o.id));
  const [officeSel, setOffice] = useState<string>(available[0]?.id ?? 'president');
  const office = available.some((o) => o.id === officeSel) ? officeSel : available[0]?.id ?? 'president';
  const banner = useBanners(story.alerts, t, n.speed, reduced);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { let alive = true; engine.query<NightContextDto>({ kind: 'nightContext', id: meta.id }).then((c) => { if (alive) setCtx(c); }).catch(() => {}); return () => { alive = false; }; }, [meta.id]);

  // The race the map shows in each state, and House races by district.
  const byState = stateRaces(meta, office);
  const byDistrict = office === 'us_representative' ? new Map(meta.races.filter((x) => x.district !== null).map((x) => [x.district!, x.i])) : null;

  // Zooming into a state focuses its race for the office (the county map and the race card follow it).
  const zoom = (s: number | null, off = office) => {
    setLevel(s);
    if (s === null) { n.setFocus(null); return; }
    const r = meta.races.find((x) => x.stateIdx === s && x.office === off && x.cd < 0 && x.office !== 'us_representative') ?? meta.races.find((x) => x.stateIdx === s && x.office === off)
      ?? meta.races.find((x) => x.stateIdx === s && x.cd < 0 && x.office !== 'us_representative') ?? meta.races.find((x) => x.stateIdx === s);
    if (r) n.setFocus(r.i);
  };
  const focusRace = n.focus;
  const needBase = focusRace !== null && (mode === 'swing' || mode === 'turnoutChange');
  useEffect(() => {
    if (!needBase || focusRace === null) return;
    let alive = true; engine.query<BaselineCountiesDto>({ kind: 'nightBaseline', id: meta.id, race: focusRace }).then((b) => { if (alive) setBase({ race: focusRace, data: b }); }).catch(() => {});
    return () => { alive = false; };
  }, [needBase, focusRace, meta.id]);
  const baseCounties = needBase && base.race === focusRace ? base.data : null;

  const line = useMemo(() => latestLine(story.lines, t), [story.lines, t]);
  const lineIdx = line ? story.lines.indexOf(line) : -1;
  const focused = focusRace !== null ? meta.races[focusRace] : undefined;
  const modeInfo = MODES.find((m) => m.id === mode)!;
  const modeUnavailable = (modeInfo.needs === 'baseline' && ctx && Object.keys(ctx.baselines).length === 0) ? 'No previous comparable election in the archive yet' : null;

  return (
    <div className={`bc${reduced ? ' reduced' : ''}`} ref={root}>
      <header className="bc-brand">
        <div className="bc-logo" aria-label="MNN"><span>MNN</span></div>
        <div className="bc-title"><div className="bc-kicker">Election Night in America</div><div className="bc-night">{picker}</div></div>
        <div className="bc-tabs">{tabs}</div>
        <div className="bc-clock" aria-live="off"><span className="num">{clock(t).replace(/ E[SD]T$/, '')}</span><span className="tz">ET · {formatDate(Math.floor(t), ET)}</span></div>
        <span className={`bc-live ${n.live ? 'on' : ''}`}>{n.live ? '● LIVE' : 'REPLAY'}</span>
        <EvCounter n={n} reduced={reduced} />
      </header>

      <div className="bc-counters">
        <Chamber label="Senate" office="us_senator" n={n} reduced={reduced} />
        <Chamber label="House" office="us_representative" n={n} reduced={reduced} />
        <Governors n={n} />
      </div>

      <div className="bc-main">
        <section className="bc-wall">
          <div className="bc-wall-head">
            <div className="seg" role="tablist" aria-label="Map office">{available.map((o) => <button key={o.id} role="tab" aria-selected={office === o.id} className={office === o.id ? 'on' : ''} onClick={() => { setOffice(o.id); if (level !== null) zoom(level, o.id); }}>{o.label}</button>)}</div>
            <select aria-label="Map mode" value={mode} onChange={(e) => setMode(e.target.value as MapMode)}>{MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            {level !== null && <button className="btn small" onClick={() => zoom(null)}>◀ National</button>}
            <div className="legend" aria-label="Legend">{legendOf(mode).map((l, i) => <span key={i} className="row" style={{ gap: 3 }}><span className="sw" style={{ background: l.color }} />{l.label}</span>)}</div>
          </div>
          <div className="bc-mapbox">
            <NightMap meta={meta} geo={n.geo} races={races} byState={byState} byDistrict={byDistrict} level={level} onLevel={(s) => zoom(s)} onPickRace={(r) => n.setFocus(r)}
              focus={n.focusData} focusRace={focusRace} mode={mode} shareParty={1} ctx={ctx} baseCounties={baseCounties} reduced={reduced} className="bc-map" />
            {modeUnavailable && <div className="bc-note">{modeUnavailable}</div>}
            {banner && <Banner a={banner} key={`${banner.time}:${banner.headline}`} />}
          </div>
        </section>
        <aside className="bc-side">
          {focused ? <RaceCard m={focused} n={n} onClose={() => zoom(null)} /> : <KeyRaces n={n} onPick={(r) => { const m = meta.races[r]!; setLevel(m.stateIdx); n.setFocus(r); }} />}
        </aside>
      </div>

      <LowerThird line={line} idx={lineIdx} speakers={story.speakers} />
      <Ticker n={n} reduced={reduced} />

      <div className="bc-controls">
        <button className="btn small" onClick={() => void n.seek(meta.coverageStart)} title="Back to 5:00 pm ET" aria-label="Back to the start of coverage">⏮</button>
        <button className="btn primary small" aria-label={n.playing ? 'Pause the night' : 'Play the night'} onClick={() => { unlockAudio(); n.setPlaying(!n.playing); }} disabled={n.beforeCoverage}>{n.playing ? '❚❚ Pause' : '▶ Play'}</button>
        <select aria-label="Night playback speed" value={n.speed} onChange={(e) => n.setSpeed(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}</select>
        <BcTimeline n={n} />
        <select aria-label="Jump to" value="" onChange={(e) => { const x = jumpTarget(e.target.value, n); if (x !== null) void n.seek(x); }}>
          <option value="">Jump to ⇥</option>
          <option value="close">Next poll closing</option>
          <option value="projection">Next projection</option>
          <option value="kra">Next Key Race Alert</option>
          <option value="major">Next major moment</option>
          {focusRace !== null && <option value="lead">Next lead change in {meta.races[focusRace]!.short}</option>}
        </select>
        <button className="btn small" onClick={() => void n.seek(meta.nightEnd)}>6 am ⇥</button>
        <button className="btn small ghost" aria-pressed={muted} aria-label={muted ? 'Unmute sound' : 'Mute sound'} onClick={() => { unlockAudio(); setMuted(!muted); setMute(!muted); }}>{muted ? '🔇' : '🔈'}</button>
        <button className="btn small ghost" aria-pressed={reduced} aria-label="Reduced motion" title="Reduced motion" onClick={() => setReduced(!reduced)}>{reduced ? '◼ Still' : '◆ Motion'}</button>
        <button className="btn small ghost" aria-label="Full screen" onClick={() => { const el = root.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.().catch(() => {}); }}>⛶</button>
      </div>
      {n.beforeCoverage && <div className="bc-pre"><strong>Polls are open.</strong> Coverage begins at 5:00 pm ET; the first polls close at {clock(Math.min(...meta.states.map((s) => s.closeFirst)))}. <button className="btn primary small" onClick={n.startCoverage}>Start coverage at 5:00 pm ET</button></div>}
    </div>
  );
}

/** The time of the next moment of a kind after the playhead (null if none). */
function jumpTarget(kind: string, n: NightState): number | null {
  const t = n.t + 0.5, a = n.meta.story.alerts;
  switch (kind) {
    case 'close': return n.markers.find((m) => m.kind === 'close' && m.time > t)?.time ?? null;
    case 'projection': return a.find((x) => x.kind === 'projection' && x.time > t && x.importance >= 6)?.time ?? null;
    case 'kra': return a.find((x) => x.kind === 'key_race' && x.time > t)?.time ?? null;
    case 'major': return a.find((x) => x.time > t && x.importance >= 8.5)?.time ?? null;
    case 'lead': return a.find((x) => x.kind === 'key_race' && x.race === n.focus && x.time > t && x.detail.startsWith('Lead change'))?.time ?? null;
    default: return null;
  }
}

/** The race the national map shows in each state for an office (falling back to the state's top statewide race). */
function stateRaces(meta: NightState['meta'], office: string): Map<number, number> {
  const m = new Map<number, number>();
  const off = office === 'us_representative' ? 'president' : office;
  meta.races.forEach((x) => { if (x.office === off && x.cd < 0 && !m.has(x.stateIdx)) m.set(x.stateIdx, x.i); });
  meta.races.forEach((x) => { if (!m.has(x.stateIdx) && x.cd < 0 && x.office !== 'us_representative') m.set(x.stateIdx, x.i); });
  return m;
}

function latestLine(lines: StoryLine[], t: number): StoryLine | null {
  let lo = 0, hi = lines.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (lines[m]!.time <= t) lo = m + 1; else hi = m; }
  const l = lines[lo - 1];
  return l && t - l.time <= 25 ? l : null;
}

function nominees(meta: NightState['meta']): { party: number; name: string }[] {
  const seen = new Map<number, string>();
  for (const r of meta.races) if (r.office === 'president') for (const c of r.candidates) if (!seen.has(c.party)) seen.set(c.party, c.name);
  return [...seen].map(([party, name]) => ({ party, name }));
}

function EvCounter({ n, reduced }: { n: NightState; reduced: boolean }) {
  const has = n.meta.races.some((x) => x.office === 'president');
  const noms = useMemo(() => nominees(n.meta), [n.meta]);
  const d = n.tally?.president.called[1] ?? 0, r = n.tally?.president.called[2] ?? 0;
  const dv = useTween(d, reduced), rv = useTween(r, reduced);
  if (!has) return null;
  const name = (p: number) => { const x = noms.find((y) => y.party === p); return x ? surname(x.name) : p === 1 ? 'Democrat' : 'Republican'; };
  const winner = n.tally?.control.find((c) => c.kind === 'president' && c.status === 1);
  return (
    <div className="bc-ev" role="group" aria-label={`Electoral votes: ${name(1)} ${d}, ${name(2)} ${r}; 270 to win`}>
      <div className="side d"><span className="nm">{name(1)}{winner?.party === 1 && ' ✓'}</span><span className="big num">{dv}</span></div>
      <div className="mid"><div className="evbar"><div style={{ width: `${(100 * d) / 538}%`, background: PARTY_COLORS[1] }} /><div style={{ flex: 1 }} /><div style={{ width: `${(100 * r) / 538}%`, background: PARTY_COLORS[2] }} /><span className="m270" /></div><span className="tiny">270 to win</span></div>
      <div className="side r"><span className="big num">{rv}</span><span className="nm">{winner?.party === 2 && '✓ '}{name(2)}</span></div>
    </div>
  );
}

function Chamber({ label, office, n, reduced }: { label: string; office: string; n: NightState; reduced: boolean }) {
  const has = n.meta.races.some((x) => x.office === office && x.cd < 0);
  const base = office === 'us_senator' ? n.meta.chambers.senate : n.meta.chambers.house;
  const tl = office === 'us_senator' ? n.tally?.senate : n.tally?.house;
  const d = (base.holdovers[1] ?? 0) + (tl?.called[1] ?? 0), r = (base.holdovers[2] ?? 0) + (tl?.called[2] ?? 0);
  const dl = tl?.leading[1] ?? 0, rl = tl?.leading[2] ?? 0;
  const other = Object.entries(base.holdovers).filter(([p]) => p !== '1' && p !== '2').reduce((a, [, v]) => a + v, 0) + Object.entries(tl?.called ?? {}).filter(([p]) => p !== '1' && p !== '2').reduce((a, [, v]) => a + v, 0);
  const dv = useTween(d, reduced), rv = useTween(r, reduced);
  if (!has) return <div className="bc-chamber off"><span className="lbl">{label}</span><span className="tiny muted">not on the ballot</span></div>;
  const ctl = n.tally?.control.filter((c) => c.kind === (office === 'us_senator' ? 'senate' : 'house')).slice(-1)[0];
  const pct = (x: number) => `${(100 * x) / base.seats}%`;
  return (
    <div className="bc-chamber" role="group" aria-label={`${label}: Democrats ${d}, Republicans ${r}, ${base.majority} for a majority`}>
      <div className="row between"><span className="num d">{dv}{ctl?.status === 1 && ctl.party === 1 && ' ✓'}</span><span className="lbl">{label}{ctl?.status === 1 ? ` · ${ctl.party === 1 ? 'D' : 'R'} control` : ''}</span><span className="num r">{ctl?.status === 1 && ctl.party === 2 && '✓ '}{rv}</span></div>
      <div className="seatbar" style={{ height: 12 }}>
        <div style={{ width: pct(d), background: PARTY_COLORS[1] }} /><div style={{ width: pct(dl), background: PALE[1] }} /><div style={{ flex: 1 }} />
        {other > 0 && <div style={{ width: pct(other), background: PARTY_COLORS[5] }} />}
        <div style={{ width: pct(rl), background: PALE[2] }} /><div style={{ width: pct(r), background: PARTY_COLORS[2] }} />
        <div className="majority" style={{ left: pct(base.majority) }} />
      </div>
      <div className="tiny muted">{base.majority} for a majority{office === 'us_senator' ? ' · incl. seats not up' : ''}</div>
    </div>
  );
}

function Governors({ n }: { n: NightState }) {
  const g = n.meta.races.filter((x) => x.office === 'governor' && x.cd < 0);
  if (!g.length) return null;
  const won: Record<number, number> = {};
  for (const x of g) { const f = n.races[x.i]; if (f?.s === ST.CALLED) { const p = x.candidates[f.o]?.party ?? 5; won[p] = (won[p] ?? 0) + 1; } }
  return (
    <div className="bc-chamber gov" role="group" aria-label="Governors' races">
      <div className="row between"><span className="num d">{won[1] ?? 0}</span><span className="lbl">Governors · {g.length} races</span><span className="num r">{won[2] ?? 0}</span></div>
      <div className="tiny muted">{g.length - Object.values(won).reduce((a, b) => a + b, 0)} not yet projected</div>
    </div>
  );
}

function Banner({ a }: { a: StoryAlert }) {
  const cls = a.kind === 'key_race' || a.kind === 'major_county' || a.kind === 'too_close' || a.kind === 'recount' ? 'kra' : a.kind === 'president' || a.kind === 'control' ? 'major' : a.kind === 'polls_closed' ? 'closed' : a.kind === 'withdrawn' ? 'withdrawn' : 'proj';
  const kicker = cls === 'kra' ? (a.kind === 'recount' ? 'RECOUNT WATCH' : 'KEY RACE ALERT') : cls === 'major' ? 'MAJOR PROJECTION' : cls === 'closed' ? 'POLLS CLOSED' : cls === 'withdrawn' ? 'PROJECTION WITHDRAWN' : a.kind === 'electoral' ? 'ELECTORAL VOTES' : a.kind === 'runoff' ? 'RUNOFF' : 'MNN PROJECTION';
  const head = a.headline.replace(/^(MNN projection|Key Race Alert|Polls closed|Projection withdrawn|Runoff projected|Recount watch|Too close to call|Major report|Electoral votes) · /, '');
  return (
    <div className={`bc-banner ${cls}`} role="status" aria-live="polite" style={{ ['--pc' as string]: PARTY_COLORS[a.party] ?? '#3a4166' }}>
      <div className="k">{kicker}{a.flip ? ' · FLIP' : ''}</div>
      <div className="h">{head}</div>
      <div className="d">{a.detail}</div>
    </div>
  );
}

function LowerThird({ line, idx, speakers }: { line: StoryLine | null; idx: number; speakers: { name: string; role: string }[] }) {
  if (!line) return <div className="bc-l3 empty" aria-hidden />;
  const sp = speakers[line.speaker];
  return (
    <div className="bc-l3" key={idx} aria-live="polite">
      <div className="who"><span className="name">{sp?.name}</span><span className="role">{sp?.role}</span></div>
      <div className="text">{line.text}</div>
    </div>
  );
}

function Ticker({ n, reduced }: { n: NightState; reduced: boolean }) {
  const { meta, races, t } = n;
  const items = useMemo(() => {
    const out: { key: string; text: string; party: number }[] = [];
    // Uncalled key races with votes, then the latest projections.
    for (const x of meta.races) {
      if (!KEY_OFFICES.includes(x.office) || x.cd >= 0) continue;
      const f = races[x.i]; if (!f || f.s === ST.CALLED || f.s === ST.NONE || f.s === ST.RUNOFF || f.b <= 0) continue;
      const l = leaderOf(f, x.k); if (l < 0) continue;
      const c = x.candidates[l]!;
      out.push({ key: `k${x.i}`, text: `${x.short}: ${surname(c.name)} (${ABBR[c.party] ?? 'I'}) +${marginOf(f, x.k).toFixed(1)} · ${Math.floor(100 * pctIn(f))}% in`, party: c.party });
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    const proj = meta.story.alerts.filter((a) => a.kind === 'projection' && a.time <= t).slice(-14).reverse();
    for (const a of proj) out.push({ key: `p${a.time}${a.race}`, text: `✓ ${a.headline.replace('MNN projection · ', '')}: ${a.detail}`, party: a.party });
    return out.slice(0, 30);
  }, [meta, races, t]);
  if (!items.length) return <div className="bc-ticker"><span className="lab">MNN</span><span className="tiny muted">Results will appear here as polls close.</span></div>;
  const content = items.map((i) => <span key={i.key} className="it"><span className="dot" style={{ background: PARTY_COLORS[i.party] ?? '#888' }} />{i.text}</span>);
  return (
    <div className="bc-ticker" aria-label="Ticker">
      <span className="lab">MNN</span>
      <div className="track-wrap">{reduced ? <div className="track still">{content}</div>
        : <div className="track" style={{ animationDuration: `${Math.max(30, items.length * 6)}s` }}>{content}<span aria-hidden>{content}</span></div>}</div>
    </div>
  );
}

function RaceCard({ m, n, onClose }: { m: RaceMeta; n: NightState; onClose: () => void }) {
  const f = n.races[m.i];
  const valid = validOf(f, m.k);
  const order = m.candidates.map((c, j) => ({ c, j, v: f?.v[j] ?? 0 })).sort((a, b) => b.v - a.v || a.j - b.j);
  const rows = n.focusData && n.focusData.race === m.i ? [...n.focusData.byRj].map(([rj, v]) => {
    const tot = v.reduce((a, b) => a + b, 0), e = n.focusData!.expected.get(rj) ?? 0;
    return { rj, v, tot, out: Math.max(0, e - tot) };
  }).sort((a, b) => b.out - a.out || b.tot - a.tot) : [];
  const status = !f || f.s === ST.NONE ? 'Polls open' : f.s === ST.CALLED ? (f.pc ? 'Projected at poll closing' : `Projected ${clock(f.ca)}`) : f.s === ST.CLOSE ? 'Too close to call' : f.s === ST.EARLY ? 'Too early to call' : f.s === ST.RUNOFF ? 'Runoff projected' : 'Projection withdrawn';
  return (
    <div className="bc-card">
      <div className="row between"><div><div className="kicker">{m.state}{m.ev ? ` · ${m.ev} electoral vote${m.ev === 1 ? '' : 's'}` : ''}</div><h2>{m.label}</h2></div><button className="btn ghost small" onClick={onClose} aria-label="Close race">✕</button></div>
      <div className={`bc-status s${f?.s ?? 0}`}>{status}</div>
      {order.slice(0, 4).map(({ c, j, v }) => (
        <div key={c.candidacyId} className={`bc-cand${f?.s === ST.CALLED && f.o === j ? ' won' : ''}`} style={{ ['--pc' as string]: PARTY_COLORS[c.party] ?? '#888' }}>
          <div className="nm"><strong>{c.name}</strong> <span className="tiny muted">{ABBR[c.party] ?? 'I'}{c.incumbent ? ' · inc.' : ''}</span>{f?.s === ST.CALLED && f.o === j && <span className="chk"> ✓</span>}</div>
          <div className="pct num">{valid ? ((100 * v) / valid).toFixed(1) : '0.0'}%</div>
          <div className="votes num tiny">{fmtInt(v)}</div>
          <div className="bar"><div style={{ width: `${valid ? (100 * v) / valid : 0}%` }} /></div>
        </div>
      ))}
      <div className="tiny muted" style={{ marginTop: 6 }}>≈ {Math.floor(100 * pctIn(f))}% of expected vote counted · {fmtInt(f?.pr ?? 0)} of {fmtInt(m.precincts)} precincts</div>
      {rows.length > 0 && <>
        <h3>Where the vote is still out</h3>
        <table className="data"><tbody>{rows.slice(0, 8).map((x) => {
          const vv = x.v.slice(0, m.k - 1), tv = vv.reduce((a, b) => a + b, 0), s = [...vv].sort((a, b) => b - a), l = vv.indexOf(s[0] ?? 0), p = m.candidates[l]?.party ?? 5;
          return (
            <tr key={x.rj}><td className="small">{n.meta.rjs[x.rj] ?? x.rj}</td><td className="num small" style={{ color: PARTY_COLORS[p] }}>{tv ? `${ABBR[p] ?? 'I'} +${((100 * ((s[0] ?? 0) - (s[1] ?? 0))) / tv).toFixed(0)}` : '–'}</td><td className="num small muted">{x.out ? `${fmtInt(x.out)} out` : 'done'}</td></tr>); })}</tbody></table>
      </>}
    </div>
  );
}

function KeyRaces({ n, onPick }: { n: NightState; onPick: (r: number) => void }) {
  const { meta, races } = n;
  const list = meta.races.filter((x) => KEY_OFFICES.includes(x.office) && x.cd < 0).map((x) => ({ x, f: races[x.i] }))
    .filter(({ f }) => f && f.s !== ST.NONE && f.s !== ST.CALLED)
    .sort((a, b) => (a.f!.s === ST.CLOSE ? 0 : 1) - (b.f!.s === ST.CLOSE ? 0 : 1) || marginOf(a.f, a.x.k) - marginOf(b.f, b.x.k)).slice(0, 14);
  const recent = meta.story.alerts.filter((a) => a.kind === 'projection' && a.time <= n.t && a.importance >= 7).slice(-6).reverse();
  return (
    <div className="bc-card">
      <h2>Key races</h2>
      {list.length === 0 && <p className="muted small">{n.t < Math.min(...meta.states.map((s) => s.closeFirst)) ? 'Waiting for the first polls to close.' : 'No key race is uncalled right now.'}</p>}
      <table className="data"><tbody>{list.map(({ x, f }) => { const l = leaderOf(f, x.k), c = l >= 0 ? x.candidates[l] : undefined; return (
        <tr key={x.i} className="click" onClick={() => onPick(x.i)}><td className="small"><strong>{x.short}</strong></td><td className="small">{c ? <span style={{ color: PARTY_COLORS[c.party] }}>{surname(c.name)} +{marginOf(f, x.k).toFixed(1)}</span> : '—'}</td><td className="num tiny muted">{Math.floor(100 * pctIn(f))}%</td><td className="tiny">{f!.s === ST.CLOSE ? 'Too close' : 'Too early'}</td></tr>); })}</tbody></table>
      {recent.length > 0 && <><h3>Latest projections</h3>{recent.map((a, i) => <div key={i} className="small bc-recent"><span className="tiny muted">{clock(a.time)}</span> <span style={{ color: PARTY_COLORS[a.party] }}>●</span> {a.headline.replace('MNN projection · ', '')} — {a.detail}</div>)}</>}
    </div>
  );
}

function BcTimeline({ n }: { n: NightState }) {
  const { meta, markers, t, edge } = n;
  const start = meta.coverageStart, end = meta.nightEnd, span = end - start;
  const pos = (x: number) => `${Math.max(0, Math.min(100, (100 * (x - start)) / span))}%`;
  const ref = useRef<HTMLDivElement>(null);
  const big = useMemo(() => meta.story.alerts.filter((a) => a.importance >= 8.5 && a.kind !== 'polls_closed'), [meta]);
  return (
    <div className="bc-timeline" ref={ref} role="slider" tabIndex={0} aria-label="Night timeline" aria-valuemin={start} aria-valuemax={end} aria-valuenow={Math.floor(t)} aria-valuetext={clock(t)}
      onClick={(e) => { const b = ref.current!.getBoundingClientRect(); void n.seek(start + ((e.clientX - b.left) / b.width) * span); }}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') void n.seek(t + 15); if (e.key === 'ArrowLeft') void n.seek(t - 15); }}>
      <div className="watched" style={{ width: pos(Math.min(edge, end)) }} />
      {markers.filter((m) => m.kind === 'close' && m.time >= start && m.time <= end).map((m, i) => <div key={`c${i}`} className="mk close" style={{ left: pos(m.time) }} title={`Polls close ${clock(m.time)}`} />)}
      {big.map((a, i) => <div key={`a${i}`} className={`mk alert ${a.kind}`} style={{ left: pos(a.time), background: a.kind === 'president' || a.kind === 'control' ? 'var(--gold)' : PARTY_COLORS[a.party] }} title={`${clock(a.time)} ${a.headline}`} />)}
      <div className="head" style={{ left: pos(t) }} />
    </div>
  );
}
