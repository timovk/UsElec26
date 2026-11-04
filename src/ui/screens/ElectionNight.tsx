/**
 * Election Night (functional view; the full broadcast presentation arrives in Phase 4). Plays the sealed
 * night record in the Broadcast Worker. Live viewing follows the universe clock: playing at the live edge
 * advances the universe; going back is a replay of the original record; skipping ahead asks first.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../state/engineClient';
import { BroadcastClient } from '../state/broadcastClient';
import { useApp } from '../state/store';
import type { GeoMeta, NightFrameDto, NightListItem, NightMarker, NightMetaDto, NightRaceFrame, NightTally } from '../../engine/protocol';
import { formatDate, formatTime } from '../../core/time';
import { MapRenderer, loadBasemap, type Basemap } from '../map/renderer';
import { PARTY_COLORS, PARTY_NAME, PartyBadge, fmtInt } from '../components/common';
import { useQuery } from './Desk';

const ET = 'America/New_York';
const SPEEDS = [1, 10, 30, 60, 120, 300, 600];
const ST = { NONE: 0, EARLY: 1, CLOSE: 2, CALLED: 3, WITHDRAWN: 4, RUNOFF: 5 };
const STATUS_LABEL = ['Polls open', 'Too early to call', 'Too close to call', 'Projected', 'Projection withdrawn', 'Runoff projected'];
const SHORT_STATUS = ['Polls open', 'Too early', 'Too close', 'Projected', 'Withdrawn', 'Runoff'];
const OFFICES: { id: string; label: string }[] = [{ id: 'president', label: 'President' }, { id: 'us_senator', label: 'Senate' }, { id: 'governor', label: 'Governor' }, { id: 'us_representative', label: 'House' }, { id: 'other', label: 'Other statewide' }];
const PALE: Record<number, string> = { 1: '#7ea3ea', 2: '#ec8a96', 3: '#e9c867', 4: '#7cc59a', 5: '#b3b7c2' };

let basemapPromise: Promise<Basemap> | null = null;
const getBasemap = () => (basemapPromise ??= loadBasemap(import.meta.env.BASE_URL));

const clock = (t: number) => formatTime(Math.floor(t), ET);
const leaderOf = (r: NightRaceFrame | undefined, k: number) => {
  if (!r) return -1;
  let best = -1, bv = 0; for (let j = 0; j < k - 1; j++) if ((r.v[j] ?? 0) > bv) { bv = r.v[j]!; best = j; }
  return best;
};

export function ElectionNight({ id }: { id?: number }) {
  const nights = useQuery<NightListItem[]>({ kind: 'nights' });
  const nightId = id ?? nights?.[0]?.id;
  const { time: edge, toast } = useApp();
  const [meta, setMeta] = useState<NightMetaDto | null>(null);
  const [geo, setGeo] = useState<GeoMeta | null>(null);
  const bc = useRef<BroadcastClient | null>(null);
  const [ready, setReady] = useState(false);
  const [markers, setMarkers] = useState<NightMarker[]>([]);
  const [userT, setT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [days, setDays] = useState(false);
  const [races, setRaces] = useState<NightRaceFrame[]>([]);
  const [tally, setTally] = useState<{ president: NightTally; senate: NightTally; house: NightTally; control: NightFrameDto['control'] } | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [byRj, setByRj] = useState<[number, number[]][] | null>(null);
  const [office, setOffice] = useState('president');
  const [filter, setFilter] = useState<'all' | 'open' | 'called'>('all');
  const [search, setSearch] = useState('');
  const advancing = useRef(false);

  // Load the record into the Broadcast Worker.
  useEffect(() => {
    if (!nightId) return;
    const c = new BroadcastClient(); bc.current = c;
    let live = true;
    Promise.all([engine.query<NightMetaDto>({ kind: 'nightMeta', id: nightId }), engine.query<GeoMeta>({ kind: 'geoMeta' }), engine.query<{ bytes: Uint8Array }>({ kind: 'nightPayload', id: nightId })])
      .then(async ([m, g, p]) => { if (!live) return; setMeta(m); setGeo(g); await c.load(p.bytes); setMarkers(await c.markers()); setReady(true); })
      .catch((e: Error) => toast(e.message, 'error'));
    return () => { live = false; c.terminate(); bc.current = null; };
  }, [nightId, toast]);

  // Start position (until the user moves): the live edge clamped to coverage, or the start of coverage for a replay.
  const start = meta && edge !== null ? (edge >= meta.feedEnd ? meta.coverageStart : Math.max(meta.coverageStart, Math.min(edge, meta.feedEnd))) : null;
  const pos = userT ?? start;
  const startRef = useRef(start);
  useEffect(() => { startRef.current = start; }, [start]);

  // Frames for the current position.
  const tMin = pos === null ? null : Math.floor(pos);
  const inFlight = useRef(false), wanted = useRef<{ t: number; focus: number | null } | null>(null);
  useEffect(() => {
    if (!ready || tMin === null || !bc.current) return;
    wanted.current = { t: Math.min(tMin, edge ?? tMin), focus };
    const pump = async () => {
      if (inFlight.current || !wanted.current || !bc.current) return;
      const w = wanted.current; wanted.current = null; inFlight.current = true;
      try {
        const f = await bc.current.frame(w.t, w.focus);
        setRaces((prev) => { const next = prev.length ? [...prev] : []; for (const r of f.races) next[r.i] = r; return next; });
        setTally({ president: f.president, senate: f.senate, house: f.house, control: f.control });
        setByRj(f.focus?.byRj ?? null);
      } catch { /* the worker was replaced */ } finally { inFlight.current = false; if (wanted.current) void pump(); }
    };
    void pump();
  }, [ready, tMin, focus, edge]);

  // Live playback: playing at the live edge advances the universe clock.
  useEffect(() => {
    if (!playing || !meta) return;
    const iv = setInterval(() => {
      setT((prev) => {
        const cur = prev ?? startRef.current;
        if (cur === null) return prev;
        const next = Math.min(cur + (speed * 0.1) / 60, meta.feedEnd);
        if (next >= meta.feedEnd) setPlaying(false);
        if (edge !== null && next > edge) {
          if (!advancing.current) {
            advancing.current = true;
            const target = Math.min(meta.feedEnd + 1, Math.ceil(next + (speed * 2) / 60));
            engine.request({ type: 'advance', target: { kind: 'until', time: target } }).catch((e: Error) => toast(e.message, 'error')).finally(() => { advancing.current = false; });
          }
          return Math.max(cur, Math.min(next, edge));
        }
        return next;
      });
    }, 100);
    return () => clearInterval(iv);
  }, [playing, speed, meta, edge, toast]);

  const seek = async (x: number) => {
    if (!meta) return;
    const target = Math.max(meta.coverageStart - 60, Math.min(meta.feedEnd, x));
    if (edge !== null && target > edge + 1) {
      if (!confirm(`Skip ahead to ${formatDate(target, ET)} ${clock(target)}? This advances the universe and reveals the count up to then.`)) return;
      setPlaying(false);
      try { await engine.request({ type: 'advance', target: { kind: 'until', time: Math.ceil(target) } }); } catch (e) { toast((e as Error).message, 'error'); return; }
    }
    setT(target);
  };

  if (!nights) return <p className="muted">Loading…</p>;
  if (!nights.length) return (
    <><h1 className="screen-title">Election Night</h1>
      <p className="muted">No election has been counted yet. Advance to Election Day (the <strong>Next election 🗳</strong> button stops at the ballot lock on the morning of Election Day), then return here at 5:00 pm ET to watch the count.</p></>
  );
  if (!meta || pos === null || edge === null) return <p className="muted">Loading the night record…</p>;
  const t = pos;

  // Live while following the universe clock (playback may trail the clock by the advance lookahead).
  const live = edge < meta.feedEnd && t >= edge - Math.max(2, (speed * 3) / 60);
  const beforeCoverage = edge < meta.coverageStart;
  const rangeEnd = days ? meta.feedEnd : meta.nightEnd;
  const r = (i: number) => races[i];
  const presByState = new Map<number, number>();
  meta.races.forEach((x) => { if (x.office === 'president' && x.cd < 0) presByState.set(x.stateIdx, x.i); });
  const ofOffice = (o: string) => (o === 'other' ? (x: NightMetaDto['races'][number]) => !['president', 'us_senator', 'governor', 'us_representative'].includes(x.office) : (x: NightMetaDto['races'][number]) => x.office === o);
  const list = meta.races.filter(ofOffice(office)).filter((x) => {
    const f = r(x.i); if (filter === 'called' && f?.s !== ST.CALLED) return false; if (filter === 'open' && f?.s === ST.CALLED) return false;
    return !search || `${x.short} ${x.label} ${x.candidates.map((c) => c.name).join(' ')}`.toLowerCase().includes(search.toLowerCase());
  });
  const next = (kind: NightMarker['kind']) => markers.find((m) => m.kind === kind && m.time > t + 0.5);
  const past = markers.filter((m) => m.time <= t && (m.kind !== 'call' || ['president', 'us_senator', 'governor'].includes(meta.races[m.race]?.office ?? ''))).slice(-40).reverse();
  const focused = focus !== null ? meta.races[focus] : undefined;

  return (
    <div className="night">
      <div className="night-head">
        <div>
          <div className="kicker">{meta.network} Election Night · {meta.label}</div>
          <div className="night-clock">{clock(t)} <span className="tiny muted">{formatDate(Math.floor(t), ET)}</span></div>
        </div>
        <span className={`badge ${live ? 'live' : 'replay'}`}>{live ? '● LIVE' : 'REPLAY'}</span>
        <div className="row wrap" style={{ marginLeft: 'auto', gap: 6 }}>
          <button className="btn small" onClick={() => void seek(meta.coverageStart)} title="Back to 5:00 pm ET">⏮</button>
          <button className="btn primary small" aria-label={playing ? "Pause the night" : "Play the night"} onClick={() => setPlaying(!playing)} disabled={beforeCoverage}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
          <select aria-label="Night playback speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}</select>
          <button className="btn small" disabled={!next('close')} onClick={() => { const m = next('close'); if (m) void seek(m.time); }}>Next poll closing ⇥</button>
          <button className="btn small" disabled={!next('call')} onClick={() => { const m = next('call'); if (m) void seek(m.time); }}>Next projection ⇥</button>
          <button className="btn small" onClick={() => void seek(meta.nightEnd)}>6 am ⇥</button>
          <label className="small muted"><input type="checkbox" checked={days} onChange={(e) => setDays(e.target.checked)} /> days after</label>
        </div>
      </div>
      <Timeline start={meta.coverageStart} end={rangeEnd} t={t} edge={edge} markers={markers} onSeek={(x) => void seek(x)} />
      {beforeCoverage && (
        <div className="card" style={{ margin: '10px 0' }}>
          <strong>Polls are open.</strong> <span className="muted">Coverage begins at 5:00 pm ET; the first polls close at {clock(Math.min(...meta.states.map((s) => s.closeFirst)))}.</span>{' '}
          <button className="btn primary small" onClick={() => { void engine.request({ type: 'advance', target: { kind: 'until', time: meta.coverageStart } }).then(() => setT(meta.coverageStart)); }}>Start coverage at 5:00 pm ET</button>
        </div>
      )}

      <div className="night-grid">
        <section className="card night-map">
          <NightMap geo={geo} meta={meta} races={races} presByState={presByState} onPick={(s) => { const i = presByState.get(s); if (i !== undefined) setFocus(i); }} />
          <Bars meta={meta} tally={tally} />
        </section>

        <section className="card night-board">
          {focused ? <RaceBoard m={focused} f={r(focused.i)} byRj={byRj} rjs={meta.rjs} onClose={() => setFocus(null)} />
            : <p className="muted small">Select a state on the map or a race in the list.</p>}
          <h3>Races</h3>
          <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
            <select value={office} onChange={(e) => setOffice(e.target.value)} aria-label="Office">{OFFICES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
            <div className="seg">{(['all', 'open', 'called'] as const).map((k) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{k === 'all' ? 'All' : k === 'open' ? 'Not projected' : 'Projected'}</button>)}</div>
            <input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 110 }} />
          </div>
          <div className="night-list">
            <table className="data"><tbody>{list.map((x) => {
              const f = r(x.i); const lead = f?.s === ST.CALLED ? f.o : leaderOf(f, x.k); const c = lead >= 0 ? x.candidates[lead] : undefined;
              const valid = f ? f.v.slice(0, x.k - 1).reduce((a, b) => a + b, 0) : 0;
              const sorted = f ? [...f.v.slice(0, x.k - 1)].sort((a, b) => b - a) : [];
              const margin = valid > 0 ? 100 * ((sorted[0] ?? 0) - (sorted[1] ?? 0)) / valid : 0;
              return (
                <tr key={x.i} className={`click${focus === x.i ? ' sel' : ''}`} onClick={() => setFocus(x.i)}>
                  <td className="small"><strong>{x.short}</strong></td>
                  <td>{c ? <span className="row"><PartyBadge party={c.party} /><span className="small">{c.name}</span></span> : <span className="muted small">—</span>}</td>
                  <td className="num small">{valid ? `+${margin.toFixed(1)}` : ''}</td>
                  <td className="num small muted">{f && f.e ? `${Math.min(99, Math.floor(100 * f.b / f.e))}%` : ''}</td>
                  <td><Status f={f} m={x} /></td>
                </tr>);
            })}</tbody></table>
          </div>
        </section>

        <section className="card night-log">
          <h3>On the desk</h3>
          {past.length === 0 && <p className="muted small">Nothing yet.</p>}
          {past.map((m, i) => (
            <div key={i} className="news-item">
              <div className="t">{clock(m.time)}</div>
              <div className="small">{m.kind === 'close' ? `Polls close: ${meta.states.filter((s) => s.closeLast === m.time).map((s) => s.usps).join(', ')}`
                : m.kind === 'control' ? controlText(tally?.control.find((c) => c.time === m.time), meta)
                : <a href="#" onClick={(e) => { e.preventDefault(); setFocus(m.race); }}>{callText(meta.races[m.race]!, r(m.race))}</a>}</div>
            </div>
          ))}
        </section>
      </div>
      <p className="tiny muted">Functional election-night view (Phase 3). Calls are made by the fictional MNN decision desk from the count, the voter survey and pre-election information; the full broadcast presentation, commentary and Key Race Alerts arrive in Phase 4.</p>
    </div>
  );
}

function controlText(c: NightFrameDto['control'][number] | undefined, meta: NightMetaDto): string {
  void meta;
  if (!c) return 'Control projection';
  const who = PARTY_NAME[c.party] ?? 'Independent';
  if (c.kind === 'president') return c.status === 1 ? `MNN projects the ${who} ticket wins the presidency (${c.detail})` : 'Presidential projection withdrawn';
  return `MNN projects ${who}s control the ${c.kind === 'senate' ? 'Senate' : 'House'} (${c.detail})`;
}

function callText(m: NightMetaDto['races'][number], f: NightRaceFrame | undefined): string {
  const c = f && f.o >= 0 ? m.candidates[f.o] : undefined;
  return `MNN projects ${c ? `${c.name} (${c.party === 1 ? 'D' : c.party === 2 ? 'R' : 'I'})` : 'a winner'} — ${m.label}`;
}

function Status({ f, m }: { f: NightRaceFrame | undefined; m: NightMetaDto['races'][number] }) {
  if (!f || f.s === ST.NONE) return <span className="tiny muted">Polls open</span>;
  if (f.s === ST.CALLED) { const c = m.candidates[f.o]; return <span className="badge" title={f.pc ? 'Projected as polls closed' : 'Projected from the count'} style={{ background: PARTY_COLORS[c?.party ?? 5], color: 'white' }}>✓ {f.pc ? 'At close' : 'Projected'}</span>; }
  if (f.s === ST.RUNOFF) return <span className="badge">Runoff</span>;
  return <span className={`tiny ${f.s === ST.CLOSE ? '' : 'muted'}`} title={STATUS_LABEL[f.s]} style={{ whiteSpace: 'nowrap' }}>{SHORT_STATUS[f.s]}</span>;
}

function RaceBoard({ m, f, byRj, rjs, onClose }: { m: NightMetaDto['races'][number]; f: NightRaceFrame | undefined; byRj: [number, number[]][] | null; rjs: Record<number, string>; onClose: () => void }) {
  const ballots = f?.b ?? 0, valid = f ? f.v.slice(0, m.k - 1).reduce((a, b) => a + b, 0) : 0;
  const order = m.candidates.map((c, j) => ({ c, j, v: f?.v[j] ?? 0 })).sort((a, b) => b.v - a.v || a.j - b.j);
  const lead = order.length > 1 ? order[0]!.v - order[1]!.v : 0;
  const rows = (byRj ?? []).map(([rj, v]) => ({ rj, v, tot: v.reduce((a, b) => a + b, 0) })).sort((a, b) => b.tot - a.tot);
  return (
    <div className="race-board">
      <div className="row between"><div><div className="kicker">{m.state}{m.ev ? ` · ${m.ev} electoral vote${m.ev === 1 ? '' : 's'}` : ''}</div><h2 style={{ margin: '2px 0' }}>{m.label}</h2></div><button className="btn ghost small" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="small"><Status f={f} m={m} />{f && f.s === ST.CALLED && f.ca >= 0 && <span className="muted"> {clock(f.ca)}</span>}</div>
      <table className="data" style={{ marginTop: 6 }}><tbody>{order.map(({ c, j, v }) => (
        <tr key={c.candidacyId}><td><span className="row"><PartyBadge party={c.party} /> <strong>{c.name}</strong>{c.incumbent && <span className="tiny muted"> (inc.)</span>}{f?.s === ST.CALLED && f.o === j && <span style={{ color: 'var(--ok)' }}> ✓</span>}</span></td>
          <td className="num">{fmtInt(v)}</td><td className="num"><strong style={{ color: PARTY_COLORS[c.party] }}>{valid ? (100 * v / valid).toFixed(1) : '0.0'}%</strong></td></tr>
      ))}</tbody></table>
      <div className="small muted" style={{ marginTop: 4 }}>
        {valid ? <>Lead {fmtInt(lead)} · </> : null}≈ {f && f.e ? Math.min(100, Math.floor(100 * ballots / f.e)) : 0}% of expected vote counted · {fmtInt(f?.pr ?? 0)} of {fmtInt(m.precincts)} precincts reporting
      </div>
      {rows.length > 0 && <div className="night-rj"><table className="data"><thead><tr><th>Reporting</th>{order.slice(0, 2).map((o) => <th key={o.j}>{o.c.name.split(' ').slice(-1)[0]}</th>)}<th>Votes</th></tr></thead><tbody>
        {rows.slice(0, 60).map((x) => { const tv = x.v.slice(0, m.k - 1).reduce((a, b) => a + b, 0); return <tr key={x.rj}><td className="small">{rjs[x.rj] ?? x.rj}</td>{order.slice(0, 2).map((o) => <td key={o.j} className="num small">{tv ? (100 * (x.v[o.j] ?? 0) / tv).toFixed(1) : '–'}%</td>)}<td className="num small muted">{fmtInt(x.tot)}</td></tr>; })}
      </tbody></table></div>}
    </div>
  );
}

function Bars({ meta, tally }: { meta: NightMetaDto; tally: { president: NightTally; senate: NightTally; house: NightTally } | null }) {
  if (!tally) return null;
  const hasPres = meta.races.some((x) => x.office === 'president');
  const bar = (label: string, t: NightTally, total: number, need: number, base: Record<number, number> = {}) => {
    const d = (base[1] ?? 0) + (t.called[1] ?? 0), r = (base[2] ?? 0) + (t.called[2] ?? 0), dl = t.leading[1] ?? 0, rl = t.leading[2] ?? 0;
    const o = Object.entries(t.called).filter(([p]) => p !== '1' && p !== '2').reduce((a, [, v]) => a + v, 0) + Object.entries(base).filter(([p]) => p !== '1' && p !== '2').reduce((a, [, v]) => a + v, 0);
    const pct = (x: number) => `${(100 * x) / total}%`;
    return (
      <div style={{ marginTop: 10 }}>
        <div className="row between small"><span><strong style={{ color: PARTY_COLORS[1] }}>D {d}</strong>{dl ? <span className="muted"> +{dl} leading</span> : null}</span><strong>{label}</strong><span>{rl ? <span className="muted">{rl} leading + </span> : null}<strong style={{ color: PARTY_COLORS[2] }}>{r} R</strong></span></div>
        <div className="seatbar" style={{ height: 18 }} role="img" aria-label={`${label}: Democrats ${d}, Republicans ${r}, ${need} needed`}>
          <div style={{ width: pct(d), background: PARTY_COLORS[1] }} /><div style={{ width: pct(dl), background: PALE[1] }} />
          <div style={{ flex: 1 }} />
          {o > 0 && <div style={{ width: pct(o), background: PARTY_COLORS[5] }} />}
          <div style={{ width: pct(rl), background: PALE[2] }} /><div style={{ width: pct(r), background: PARTY_COLORS[2] }} />
          <div className="majority" style={{ left: pct(need) }} />
        </div>
        <div className="tiny muted">{need} to win · solid = projected{base[1] || base[2] ? ' (with seats not up)' : ''}, pale = leading</div>
      </div>
    );
  };
  return <>
    {hasPres && bar('Electoral votes', tally.president, 538, 270)}
    {meta.races.some((x) => x.office === 'us_senator') && bar('Senate', tally.senate, meta.chambers.senate.seats, meta.chambers.senate.majority, meta.chambers.senate.holdovers)}
    {meta.races.some((x) => x.office === 'us_representative') && bar('House', tally.house, meta.chambers.house.seats, meta.chambers.house.majority, meta.chambers.house.holdovers)}
  </>;
}

function Timeline({ start, end, t, edge, markers, onSeek }: { start: number; end: number; t: number; edge: number; markers: NightMarker[]; onSeek: (x: number) => void }) {
  const span = Math.max(1, end - start);
  const pos = (x: number) => `${Math.max(0, Math.min(100, (100 * (x - start)) / span))}%`;
  const ref = useRef<HTMLDivElement>(null);
  const click = (e: React.MouseEvent) => { const b = ref.current!.getBoundingClientRect(); onSeek(start + ((e.clientX - b.left) / b.width) * span); };
  return (
    <div className="timeline" ref={ref} onClick={click} role="slider" aria-label="Night timeline" aria-valuemin={start} aria-valuemax={end} aria-valuenow={Math.floor(t)} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') onSeek(t + 15); if (e.key === 'ArrowLeft') onSeek(t - 15); }}>
      <div className="watched" style={{ width: pos(Math.min(edge, end)) }} />
      {markers.filter((m) => m.time >= start && m.time <= end && m.kind !== 'call').map((m, i) => <div key={i} className={`mk ${m.kind}`} style={{ left: pos(m.time) }} />)}
      <div className="head" style={{ left: pos(t) }} />
    </div>
  );
}

function NightMap({ geo, meta, races, presByState, onPick }: { geo: GeoMeta | null; meta: NightMetaDto; races: NightRaceFrame[]; presByState: Map<number, number>; onPick: (stateIdx: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rend = useRef<MapRenderer | null>(null);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  useEffect(() => { getBasemap().then(setBasemap).catch(() => {}); }, []);
  const fipsToIdx = useMemo(() => new Map(geo?.states.map((s) => [s.fips, s.idx]) ?? []), [geo]);
  useEffect(() => {
    const c = ref.current; if (!c || !basemap) return;
    const r = new MapRenderer(c, basemap); r.layer = basemap.states; rend.current = r; r.resize(); r.draw();
    const ro = new ResizeObserver(() => { r.resize(); r.draw(); }); ro.observe(c);
    return () => ro.disconnect();
  }, [basemap]);
  useEffect(() => {
    const r = rend.current; if (!r || !basemap) return;
    r.fills = basemap.states.ids.map((fips) => {
      const s = fipsToIdx.get(fips); if (s === undefined) return null;
      const i = presByState.get(s); if (i === undefined) return '#2a3156';
      const f = races[i], m = meta.races[i]!; if (!f) return '#2a3156';
      if (f.s === ST.CALLED && f.o >= 0) return PARTY_COLORS[m.candidates[f.o]?.party ?? 5]!;
      const l = leaderOf(f, m.k); if (l < 0) return f.s === ST.NONE ? '#232a4d' : '#3a4166';
      return PALE[m.candidates[l]?.party ?? 5] ?? '#3a4166';
    });
    r.draw();
  }, [races, basemap, meta, presByState, fipsToIdx]);
  return <canvas ref={ref} className="night-canvas" onClick={(e) => { const r = rend.current, c = ref.current; if (!r || !c || !basemap) return; const b = c.getBoundingClientRect(); const dpr = c.width / b.width; const i = r.hit((e.clientX - b.left) * dpr, (e.clientY - b.top) * dpr); const s = i >= 0 ? fipsToIdx.get(basemap.states.ids[i]!) : undefined; if (s !== undefined) onPick(s); }} />;
}
