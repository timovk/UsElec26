/**
 * Analyst Mode v1: the data behind the night for one race — the count over time with the desk's status
 * changes, outstanding vote by reporting jurisdiction, the batch log, votes by voting mode, the county swing
 * scatter, turnout, the voter survey's crosstabs, and (on request, with a spoiler warning) simulation truth.
 */
import { surname } from '../../core/names';
import { useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../state/engineClient';
import type { BaselineCountiesDto, NightContextDto, RaceDetailDto, SurveyDto } from '../../engine/protocol';
import { PARTY_COLORS, Truth, fmtInt } from '../components/common';
import { ST, clock, leaderOf, marginOf, pctIn, validOf, type NightState, type RaceMeta } from './useNight';

const MODE = ['Election Day', 'Early in person', 'Mail', 'Provisional'];
const STATUS = ['Polls open', 'Too early', 'Too close', 'Projected', 'Withdrawn', 'Runoff'];
const ABBR: Record<number, string> = { 1: 'D', 2: 'R', 3: 'L', 4: 'G', 5: 'I' };
const pctS = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;

export function Analyst({ n }: { n: NightState }) {
  const { meta, races, t } = n;
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<RaceDetailDto | null>(null);
  const [truth, setTruth] = useState(false);
  const [ctx, setCtx] = useState<NightContextDto | null>(null);
  const [base, setBase] = useState<{ race: number; data: BaselineCountiesDto } | null>(null);
  const [survey, setSurvey] = useState<{ race: number; data: SurveyDto | null } | null>(null);
  // The analyst works on one race: the focused one, or the closest key race.
  const keyRaces = useMemo(() => meta.races.filter((x) => ['president', 'us_senator', 'governor'].includes(x.office) && x.cd < 0), [meta]);
  // Default: the closest key race that is too close to call, else the first key race.
  const closest = keyRaces.map((x) => ({ x, f: races[x.i] })).filter(({ f }) => f && f.s === ST.CLOSE && f.b > 0).sort((a, b) => marginOf(a.f, a.x.k) - marginOf(b.f, b.x.k))[0]?.x ?? keyRaces[0];
  const race = n.focus ?? closest?.i ?? 0;
  const m = meta.races[race]!;
  useEffect(() => { if (n.focus === null && closest) n.setFocus(closest.i); }, [n, closest]);
  useEffect(() => { let alive = true; engine.query<NightContextDto>({ kind: 'nightContext', id: meta.id }).then((c) => { if (alive) setCtx(c); }).catch(() => {}); return () => { alive = false; }; }, [meta.id]);
  useEffect(() => {
    let alive = true;
    engine.query<BaselineCountiesDto>({ kind: 'nightBaseline', id: meta.id, race }).then((d) => { if (alive) setBase({ race, data: d }); }).catch(() => {});
    engine.query<SurveyDto | null>({ kind: 'nightSurvey', id: meta.id, race }).then((d) => { if (alive) setSurvey({ race, data: d }); }).catch(() => {});
    return () => { alive = false; };
  }, [meta.id, race]);
  // Race detail from the worker, refreshed at most twice a second of real time.
  const tMin = Math.floor(t);
  const last = useRef(0);
  useEffect(() => {
    let alive = true;
    const wait = Math.max(0, 500 - (performance.now() - last.current));
    const id = setTimeout(() => { last.current = performance.now(); void n.raceDetail(race, tMin, truth).then((d) => { if (alive) setDetail(d); }); }, wait);
    return () => { alive = false; clearTimeout(id); };
  }, [race, tMin, truth, n]);

  const f = races[race];
  const list = meta.races.filter((x) => x.office !== 'us_representative' || search).filter((x) => !search || `${x.short} ${x.label} ${x.candidates.map((c) => c.name).join(' ')}`.toLowerCase().includes(search.toLowerCase())).slice(0, 200);
  const d = detail;
  const baseCounties = base?.race === race ? base.data : null;
  const surveyData = survey?.race === race ? survey.data : null;
  return (
    <div className="an">
      <aside className="card an-list">
        <input type="search" placeholder="Find a race" aria-label="Find a race" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%' }} />
        <div className="an-races">{list.map((x) => { const g = races[x.i]; const l = g?.s === ST.CALLED ? g.o : leaderOf(g, x.k); const c = l >= 0 ? x.candidates[l] : undefined; return (
          <button key={x.i} className={`an-race${x.i === race ? ' on' : ''}`} onClick={() => n.setFocus(x.i)}>
            <span className="small"><strong>{x.short}</strong></span>
            <span className="tiny" style={{ color: c ? PARTY_COLORS[c.party] : undefined }}>{g?.s === ST.CALLED ? '✓ ' : ''}{c ? `${ABBR[c.party] ?? 'I'}${g && g.b > 0 ? ` +${marginOf(g, x.k).toFixed(1)}` : ''}` : STATUS[g?.s ?? 0]}</span>
          </button>); })}</div>
      </aside>
      <div className="an-main">
        <section className="card an-head">
          <div><div className="kicker">{m.state} · {clock(t)}</div><h2 style={{ margin: '2px 0' }}>{m.label}</h2></div>
          <div className="row wrap" style={{ gap: 18 }}>
            <Stat label="Desk status" value={STATUS[f?.s ?? 0]!} />
            <Stat label="Counted" value={`${Math.floor(100 * pctIn(f))}% of expected`} />
            <Stat label="Ballots counted" value={fmtInt(f?.b ?? 0)} />
            <Stat label="Expected ballots" value={f?.e ? fmtInt(f.e) : '—'} />
            <Stat label="Desk confidence" value={f && f.s !== ST.NONE ? pctS(f.p) : '—'} />
          </div>
        </section>
        <div className="an-grid">
          <section className="card an-wide"><h2>The count over time</h2>{d ? <CountChart m={m} d={d} /> : <p className="muted small">Loading…</p>}</section>
          <section className="card"><h2>Outstanding vote</h2><Outstanding m={m} n={n} /></section>
          <section className="card"><h2>Votes by mode</h2>{d ? <Modes m={m} d={d} /> : null}</section>
          <section className="card"><h2>County swing</h2><Swing m={m} n={n} base={baseCounties} /></section>
          <section className="card"><h2>Turnout</h2><Turnout m={m} n={n} ctx={ctx} /></section>
          <section className="card"><h2>Voter survey</h2><Survey m={m} s={surveyData} /></section>
          <section className="card"><h2>Desk calls</h2>{d ? <Calls m={m} d={d} /> : null}</section>
          <section className="card an-wide"><h2>Batch log <span className="muted small">latest {d?.batches.length ?? 0}</span></h2>{d ? <Batches m={m} d={d} rjs={meta.rjs} /> : null}</section>
          <section className="card an-wide"><h2>Simulation truth <Truth /></h2><TruthPanel m={m} n={n} d={d} on={truth} setOn={setTruth} /></section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="tiny muted">{label}</div><div className="an-stat num">{value}</div></div>;
}

/** Top two options by current votes (ballot order indices). */
function topTwo(m: RaceMeta, v: ArrayLike<number> | undefined): [number, number] {
  const o = Array.from({ length: m.k - 1 }, (_, j) => j).sort((a, b) => (v?.[b] ?? 0) - (v?.[a] ?? 0) || a - b);
  return [o[0] ?? 0, o[1] ?? 1];
}

function CountChart({ m, d }: { m: RaceMeta; d: RaceDetailDto }) {
  const [hover, setHover] = useState<number | null>(null);
  const h = d.history;
  if (h.length < 2) return <p className="muted small">The count has not started.</p>;
  const lastV = h[h.length - 1]!.votes;
  const [a, b] = topTwo(m, lastV);
  const pts = h.map((x) => { const valid = x.votes.slice(0, m.k - 1).reduce((s, y) => s + y, 0); return { t: x.time, m: valid > 0 ? (100 * (x.votes[a]! - x.votes[b]!)) / valid : 0, b: x.ballots }; });
  const W = 640, H = 200, L = 40, R = 10, T = 10, B = 24;
  const t0 = pts[0]!.t, t1 = Math.max(t0 + 1, pts[pts.length - 1]!.t);
  const ext = Math.max(2, ...pts.map((p) => Math.abs(p.m))) * 1.1;
  const x = (tt: number) => L + ((tt - t0) / (t1 - t0)) * (W - L - R), y = (mm: number) => T + ((ext - mm) / (2 * ext)) * (H - T - B);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.m).toFixed(1)}`).join('');
  const ca = m.candidates[a]!, cb = m.candidates[b]!;
  const ticks = [-ext, -ext / 2, 0, ext / 2, ext].map((v) => Math.round(v));
  const hp = hover !== null ? pts[hover] : null;
  return (
    <div className="an-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Lead of ${ca.name} over ${cb.name} as the count proceeds`}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const tt = t0 + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * (t1 - t0); let best = 0; pts.forEach((p, i) => { if (Math.abs(p.t - tt) < Math.abs(pts[best]!.t - tt)) best = i; }); setHover(best); }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" strokeWidth={v === 0 ? 1.5 : 1} /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="an-ax">{v > 0 ? `+${v}` : v}</text></g>)}
        {d.events.filter((e) => e.status === ST.CALLED || e.status === ST.CLOSE || e.status === ST.WITHDRAWN).map((e, i) => e.time >= t0 && (
          <g key={i}><line x1={x(e.time)} x2={x(e.time)} y1={T} y2={H - B} stroke={e.status === ST.CALLED ? 'var(--ok)' : e.status === ST.WITHDRAWN ? 'var(--bad)' : 'var(--warn)'} strokeDasharray="3 3" strokeWidth={1.5} />
            <text x={x(e.time) + 3} y={T + 10 + (i % 3) * 11} className="an-ax">{STATUS[e.status]}</text></g>))}
        <path d={path} fill="none" stroke="var(--text-0)" strokeWidth={2} strokeLinejoin="round" />
        {hp && <><line x1={x(hp.t)} x2={x(hp.t)} y1={T} y2={H - B} stroke="var(--text-2)" /><circle cx={x(hp.t)} cy={y(hp.m)} r={4} fill="var(--text-0)" stroke="var(--bg-1)" strokeWidth={2} /></>}
        <text x={L} y={H - 6} className="an-ax">{clock(t0)}</text><text x={W - R} y={H - 6} textAnchor="end" className="an-ax">{clock(t1)}</text>
      </svg>
      <div className="tiny muted">Lead of {ca.name} ({ABBR[ca.party]}) over {cb.name} ({ABBR[cb.party]}), points of the counted vote; dashed lines mark the desk's status changes.{hp && <> · <span className="an-tip">{clock(hp.t)}: {hp.m >= 0 ? '+' : ''}{hp.m.toFixed(1)} pts, {fmtInt(hp.b)} ballots</span></>}</div>
    </div>
  );
}

function Outstanding({ m, n }: { m: RaceMeta; n: NightState }) {
  const [sort, setSort] = useState<'out' | 'pct' | 'name'>('out');
  const fd = n.focusData && n.focusData.race === m.i ? n.focusData : null;
  if (!fd) return <p className="muted small">Loading…</p>;
  const rows = [...new Set([...fd.byRj.keys(), ...fd.expected.keys()])].map((rj) => {
    const v = fd.byRj.get(rj) ?? [], tot = v.reduce((a, b) => a + b, 0), e = fd.expected.get(rj) ?? 0;
    const [a, b] = topTwo(m, v); const valid = v.slice(0, m.k - 1).reduce((x, y) => x + y, 0);
    return { rj, name: n.meta.rjs[rj] ?? `#${rj}`, tot, e, out: Math.max(0, e - tot), pct: e > 0 ? Math.min(1, tot / e) : 0, lead: valid > 0 ? { p: m.candidates[a]?.party ?? 5, mg: (100 * ((v[a] ?? 0) - (v[b] ?? 0))) / valid } : null };
  }).sort((x, y) => (sort === 'out' ? y.out - x.out : sort === 'pct' ? x.pct - y.pct : x.name.localeCompare(y.name)));
  const totalOut = rows.reduce((a, r) => a + r.out, 0);
  if (!rows.length) return <p className="muted small">No votes or expected-vote estimates yet.</p>;
  return (
    <>
      <div className="small">About <strong>{fmtInt(totalOut)}</strong> ballots still expected across {rows.filter((r) => r.out > 0).length} jurisdictions.</div>
      <div className="an-scroll"><table className="data"><thead><tr>
        <th><button className="an-sort" onClick={() => setSort('name')}>Jurisdiction</button></th><th>Lead</th><th><button className="an-sort" onClick={() => setSort('pct')}>In</button></th><th><button className="an-sort" onClick={() => setSort('out')}>Outstanding ▾</button></th></tr></thead>
        <tbody>{rows.slice(0, 80).map((r) => <tr key={r.rj}><td className="small">{r.name}</td><td className="small num">{r.lead ? <><span className="party-dot" style={{ background: PARTY_COLORS[r.lead.p] }} /> {ABBR[r.lead.p] ?? 'I'} +{r.lead.mg.toFixed(1)}</> : '—'}</td><td className="small num">{Math.floor(100 * r.pct)}%</td><td className="small num">{fmtInt(r.out)}</td></tr>)}</tbody></table></div>
    </>
  );
}

function Modes({ m, d }: { m: RaceMeta; d: RaceDetailDto }) {
  const tot = d.byMode.map((v) => v.reduce((a, b) => a + b, 0)), all = tot.reduce((a, b) => a + b, 0);
  const [a, b] = topTwo(m, d.byMode.reduce((acc, v) => acc.map((x, j) => x + (v[j] ?? 0)), new Array<number>(m.k).fill(0)));
  const ca = m.candidates[a]!, cb = m.candidates[b]!;
  return (
    <table className="data"><thead><tr><th>Mode</th><th>Ballots</th><th>{surname(ca.name)}</th><th>{surname(cb.name)}</th></tr></thead><tbody>
      {d.byMode.map((v, i) => { const valid = v.slice(0, m.k - 1).reduce((x, y) => x + y, 0); return (
        <tr key={i}><td className="small">{MODE[i]}</td><td className="small num">{fmtInt(tot[i]!)} <span className="muted">{all ? `(${pctS(tot[i]! / all, 0)})` : ''}</span></td>
          <td className="small num">{valid ? pctS(v[a]! / valid) : '—'}</td><td className="small num">{valid ? pctS(v[b]! / valid) : '—'}</td></tr>); })}
    </tbody></table>
  );
}

function countyVotes(m: RaceMeta, n: NightState): Map<number, number[]> {
  const out = new Map<number, number[]>(); const fd = n.focusData; if (!fd || fd.race !== m.i) return out;
  for (const [rj, v] of fd.byRj) { const c = n.meta.rjCounty[rj]; if (c === undefined) continue; const a = out.get(c) ?? new Array<number>(m.k).fill(0); v.forEach((x, j) => { a[j]! += x; }); out.set(c, a); }
  return out;
}

function Swing({ m, n, base }: { m: RaceMeta; n: NightState; base: BaselineCountiesDto }) {
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  if (m.cd >= 0 || m.office === 'us_representative') return <p className="muted small">County swing is shown for statewide races.</p>;
  if (!base) return <p className="muted small">No previous comparable election in the archive yet (the first simulated cycle has none).</p>;
  const di = m.candidates.findIndex((c) => c.party === 1), ri = m.candidates.findIndex((c) => c.party === 2);
  if (di < 0 || ri < 0) return <p className="muted small">Swing compares the Democratic and Republican margins; this race lacks one of them.</p>;
  const names = new Map(n.geo?.counties.map((c) => [c.idx, c.name]) ?? []);
  const pts = [...countyVotes(m, n)].flatMap(([c, v]) => { const b = base[c]; const valid = v.slice(0, m.k - 1).reduce((a, x) => a + x, 0); if (!b || valid < 50 || b[2] <= 0) return []; return [{ c, x: (100 * (b[0] - b[1])) / b[2], y: (100 * (v[di]! - v[ri]!)) / valid, w: valid }]; });
  if (!pts.length) return <p className="muted small">Waiting for county results.</p>;
  const S = 240, P = 28, ext = Math.min(100, Math.max(10, ...pts.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)])) * 1.05), maxW = Math.max(...pts.map((p) => p.w));
  const sx = (v: number) => P + ((v + ext) / (2 * ext)) * (S - 2 * P), sy = (v: number) => S - P - ((v + ext) / (2 * ext)) * (S - 2 * P);
  const avg = pts.reduce((a, p) => a + (p.y - p.x) * p.w, 0) / pts.reduce((a, p) => a + p.w, 0);
  return (
    <div className="an-chart">
      <svg viewBox={`0 0 ${S} ${S}`} style={{ maxWidth: 300 }} role="img" aria-label="County margins now against the previous comparable election">
        <line x1={sx(-ext)} y1={sy(-ext)} x2={sx(ext)} y2={sy(ext)} stroke="var(--line)" strokeDasharray="4 3" />
        <line x1={sx(0)} x2={sx(0)} y1={sy(-ext)} y2={sy(ext)} stroke="var(--line-soft)" /><line y1={sy(0)} y2={sy(0)} x1={sx(-ext)} x2={sx(ext)} stroke="var(--line-soft)" />
        {pts.map((p) => <circle key={p.c} cx={sx(p.x)} cy={sy(p.y)} r={Math.max(4, 9 * Math.sqrt(p.w / maxW))} fill={p.y - p.x >= 0 ? PARTY_COLORS[1] : PARTY_COLORS[2]} fillOpacity={0.75} stroke="var(--bg-1)" strokeWidth={1.5}
          onMouseEnter={() => setHover({ name: names.get(p.c) ?? `County ${p.c}`, x: p.x, y: p.y })} onMouseLeave={() => setHover(null)} />)}
        <text x={S - P} y={S - 6} textAnchor="end" className="an-ax">previous D−R margin →</text><text x={6} y={P - 10} className="an-ax">now ↑</text>
      </svg>
      <div className="tiny muted">Above the diagonal: counties moving toward the Democrat. Vote-weighted average swing: <strong>{avg >= 0 ? 'D' : 'R'} +{Math.abs(avg).toFixed(1)}</strong>.{hover && <> · <span className="an-tip">{hover.name}: {fmtM(hover.x)} → {fmtM(hover.y)}</span></>}</div>
    </div>
  );
}
const fmtM = (v: number) => `${v >= 0 ? 'D' : 'R'}+${Math.abs(v).toFixed(1)}`;

function Turnout({ m, n, ctx }: { m: RaceMeta; n: NightState; ctx: NightContextDto | null }) {
  const f = n.races[m.i];
  if (!ctx) return <p className="muted small">Loading…</p>;
  if (m.office === 'us_representative' || m.cd >= 0) return <p className="muted small">Turnout is shown for statewide races.</p>;
  const el = ctx.eligibleState[m.stateIdx] ?? 0, b = ctx.baselines[m.i];
  const rows = [
    { k: 'Eligible voters', v: el ? fmtInt(el) : '—' },
    { k: 'Expected ballots (wire)', v: f?.e ? `${fmtInt(f.e)}${el ? ` · ${pctS(f.e / el)}` : ''}` : '—' },
    { k: 'Counted so far', v: `${fmtInt(f?.b ?? 0)}${el ? ` · ${pctS((f?.b ?? 0) / el)}` : ''}` },
    { k: 'Undervotes in this race', v: f ? fmtInt(Math.max(0, (f.v[m.k - 1] ?? 0))) : '—' },
    b ? { k: `Previous: ${b.label.replace(/^\d{4} /, '')} (${b.year})`, v: b.eligible ? pctS(b.ballots / b.eligible) : fmtInt(b.ballots) } : { k: 'Previous comparable election', v: 'none in the archive' },
  ];
  return <table className="data"><tbody>{rows.map((r) => <tr key={r.k}><td className="small muted">{r.k}</td><td className="small num">{r.v}</td></tr>)}</tbody></table>;
}

function Survey({ m, s }: { m: RaceMeta; s: SurveyDto | null }) {
  const [dim, setDim] = useState('age');
  if (!s) return <p className="muted small">This race was not covered by the voter survey.</p>;
  const [a, b] = topTwo(m, s.shares);
  const ca = m.candidates[a]!, cb = m.candidates[b]!;
  const tab = s.crosstabs.find((x) => x.dim === dim);
  return (
    <>
      <div className="small">Toplines (n = {fmtInt(s.n)}): <strong style={{ color: 'var(--text-0)' }}>{surname(ca.name)} {pctS(s.shares[a]!)}</strong> · {surname(cb.name)} {pctS(s.shares[b]!)}</div>
      {s.crosstabs.length > 0 && <>
        <div className="seg" style={{ margin: '6px 0' }}>{s.crosstabs.map((x) => <button key={x.dim} className={dim === x.dim ? 'on' : ''} onClick={() => setDim(x.dim)}>{({ age: 'Age', sex: 'Sex', race: 'Race', edu: 'Education' } as Record<string, string>)[x.dim] ?? x.dim}</button>)}</div>
        {tab && <table className="data"><thead><tr><th>Group</th><th>Share of voters</th><th>{surname(ca.name)}</th><th>{surname(cb.name)}</th></tr></thead><tbody>
          {tab.groups.map((g) => <tr key={g.label}><td className="small">{g.label}</td><td className="small num">{pctS(g.pct, 0)}</td>
            <td className="small num"><Bar v={g.shares[a] ?? 0} c={PARTY_COLORS[ca.party]!} /></td><td className="small num"><Bar v={g.shares[b] ?? 0} c={PARTY_COLORS[cb.party]!} /></td></tr>)}
        </tbody></table>}
        <p className="tiny muted">Estimates from the survey sample; groups with few respondents are noisy.</p>
      </>}
    </>
  );
}

function Bar({ v, c }: { v: number; c: string }) {
  return <span className="an-bar"><span style={{ width: `${Math.round(100 * v)}%`, background: c }} /><span className="v">{pctS(v, 0)}</span></span>;
}

function Calls({ m, d }: { m: RaceMeta; d: RaceDetailDto }) {
  if (!d.events.length) return <p className="muted small">No desk status yet (polls are open).</p>;
  return (
    <table className="data"><thead><tr><th>Time</th><th>Status</th><th>Confidence</th><th>Counted</th></tr></thead><tbody>
      {d.events.map((e, i) => { const c = e.option >= 0 ? m.candidates[e.option] : undefined; return (
        <tr key={i}><td className="small num">{clock(e.time)}</td><td className="small">{STATUS[e.status]}{e.status === ST.CALLED && c ? `: ${c.name}` : ''}</td><td className="small num">{pctS(e.prob)}</td><td className="small num">{e.expected ? `${Math.floor((100 * e.ballots) / e.expected)}%` : '—'}</td></tr>); })}
    </tbody></table>
  );
}

function Batches({ m, d, rjs }: { m: RaceMeta; d: RaceDetailDto; rjs: Record<number, string> }) {
  // Virtualized list: rows are a fixed height, and only those in view are rendered.
  const ROW = 28, VIEW = 280;
  const [top, setTop] = useState(0);
  const first = Math.max(0, Math.floor(top / ROW) - 5), last = Math.min(d.batches.length, first + Math.ceil(VIEW / ROW) + 10);
  const [a, b] = topTwo(m, d.byMode.reduce((acc, v) => acc.map((x, j) => x + (v[j] ?? 0)), new Array<number>(m.k).fill(0)));
  if (!d.batches.length) return <p className="muted small">No votes reported yet.</p>;
  return (
    <div className="an-vlist" style={{ height: VIEW }} onScroll={(e) => setTop((e.target as HTMLDivElement).scrollTop)}>
      <div style={{ height: d.batches.length * ROW, position: 'relative' }}>
        {d.batches.slice(first, last).map((x, i) => { const valid = x.votes.slice(0, m.k - 1).reduce((s, y) => s + y, 0), tot = x.votes.reduce((s, y) => s + y, 0); const mg = valid ? (100 * (x.votes[a]! - x.votes[b]!)) / valid : 0; return (
          <div key={first + i} className="an-row" style={{ top: (first + i) * ROW, height: ROW }}>
            <span className="num">{clock(x.time)}</span><span className="nm">{rjs[x.rj] ?? x.rj}</span><span className="muted">{MODE[x.mode]}</span><span className="num">{fmtInt(tot)}</span>
            <span className="num" style={{ color: 'var(--text-1)' }}><span className="party-dot" style={{ background: PARTY_COLORS[(mg >= 0 ? m.candidates[a] : m.candidates[b])?.party ?? 5] }} /> {mg >= 0 ? ABBR[m.candidates[a]!.party] : ABBR[m.candidates[b]!.party]} +{Math.abs(mg).toFixed(1)}</span>
          </div>); })}
      </div>
    </div>
  );
}

function TruthPanel({ m, n, d, on, setOn }: { m: RaceMeta; n: NightState; d: RaceDetailDto | null; on: boolean; setOn: (v: boolean) => void }) {
  if (!on) return (
    <div className="small">
      <p className="muted">The end of the count — every ballot counted, as it will be certified — is simulation truth while the count is under way. Revealing it spoils the race.</p>
      <button className="btn small" onClick={() => { if (n.t >= n.meta.feedEnd || confirm(`Reveal how ${m.label} ends? This spoils the result.`)) setOn(true); }}>Reveal simulation truth</button>
    </div>
  );
  if (!d?.final) return <p className="muted small">Loading…</p>;
  const f = n.races[m.i];
  const fv = d.final, fValid = fv.slice(0, m.k - 1).reduce((a, b) => a + b, 0), cValid = validOf(f, m.k);
  const [a, b] = topTwo(m, fv);
  const finalM = fValid ? (100 * (fv[a]! - fv[b]!)) / fValid : 0, nowM = cValid && f ? (100 * (f.v[a]! - f.v[b]!)) / cValid : 0;
  return (
    <>
      <table className="data"><thead><tr><th>Candidate</th><th>Now</th><th>Final count</th></tr></thead><tbody>
        {m.candidates.map((c, j) => <tr key={c.candidacyId}><td className="small"><span className="party-dot" style={{ background: PARTY_COLORS[c.party] }} /> {c.name}</td><td className="small num">{cValid ? pctS((f?.v[j] ?? 0) / cValid) : '—'}</td><td className="small num">{pctS(fv[j]! / Math.max(1, fValid))} · {fmtInt(fv[j]!)}</td></tr>)}
      </tbody></table>
      <p className="small">Final margin {m.candidates[a]!.name} +{finalM.toFixed(2)} pts; the count now shows {nowM >= 0 ? '+' : ''}{nowM.toFixed(2)} ({(nowM - finalM >= 0 ? '+' : '') + (nowM - finalM).toFixed(2)} from the final).</p>
      <button className="btn small ghost" onClick={() => setOn(false)}>Hide</button>
    </>
  );
}
