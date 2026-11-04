/**
 * Polls & Forecasts (docs/architecture/09 §9.2): the forecast (win probabilities, electoral-vote distribution,
 * the snake of states, tipping points, chamber seat distributions and their history), polling averages by race,
 * every published poll, pollster pages and — after the election — the forecast against the results.
 */
import { useMemo, useState } from 'react';
import type { CalibrationDto, PollDto, PollsterDto, RaceRowDto, SeasonOverviewDto, SeasonRaceDto } from '../../engine/protocol';
import { useQuery } from './Desk';
import { go } from '../app/router';
import { PARTY_COLORS, PartyBadge, fmtInt } from '../components/common';
import { CANDIDATE_COLORS, Histogram, Snake, TimeChart, type Dot, type Series } from '../components/charts';
import { marginColor } from '../map/renderer';
import { formatDay } from '../../core/time';

const TABS = [{ id: 'forecast', label: 'Forecast' }, { id: 'races', label: 'Races' }, { id: 'polls', label: 'Polls' }, { id: 'pollsters', label: 'Pollsters' }, { id: 'result', label: 'Forecast vs result' }] as const;
export const pctTxt = (p: number) => (p > 0.99 ? '>99%' : p < 0.01 ? '<1%' : `${Math.round(100 * p)}%`);
const mtxt = (m: number) => `${m >= 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(1)}`;
const KIND_LABEL: Record<string, string> = { pres_national: 'President (national)', pres_state: 'President', generic: 'Generic ballot', general: 'General', primary: 'Primary', nom_national: 'Nomination (national)', nom_state: 'Nomination (state)' };

export function PollsScreen({ year: yearParam, tab: tabParam, arg }: { year?: number; tab?: string; arg?: string }) {
  const years = useQuery<number[]>({ kind: 'seasonYears' });
  const year = yearParam ?? years?.[0];
  const tab = (TABS.find((t) => t.id === tabParam)?.id ?? (tabParam === 'race' || tabParam === 'pollster' ? tabParam : 'forecast')) as string;
  const ov = useQuery<SeasonOverviewDto>(year ? { kind: 'seasonOverview', year } : { kind: 'seasonYears' }, [year]);
  if (!years) return <p className="muted">Loading…</p>;
  if (!years.length || !year) return <><h1 className="screen-title">Polls & Forecasts</h1><p className="muted">No campaign season has started yet. Polls begin with the first election year's campaigns (the nominating contests from January of a presidential year), and forecasts from June.</p></>;
  const o = ov && 'races' in (ov as object) ? ov : null;
  return (
    <>
      <div className="row between wrap">
        <div><div className="kicker">Pre-election information · Public Record</div><h1 className="screen-title">{year} polls & forecasts</h1></div>
        <div className="row"><label className="small muted">Year</label><select value={year} onChange={(e) => go(`polls/${e.target.value}`)} aria-label="Year">{years.map((y) => <option key={y}>{y}</option>)}</select></div>
      </div>
      <div className="seg" role="tablist" aria-label="Polls and forecasts" style={{ margin: '8px 0 12px' }}>{TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(`polls/${year}/${t.id}`)}>{t.label}</button>)}</div>
      {!o ? <p className="muted">Loading…</p>
        : tab === 'forecast' ? <ForecastPanel o={o} year={year} />
        : tab === 'races' ? <RacesPanel o={o} year={year} />
        : tab === 'polls' ? <PollsPanel year={year} />
        : tab === 'pollsters' ? <PollstersPanel year={year} />
        : tab === 'result' ? <CalibrationPanel year={year} />
        : tab === 'race' && arg ? <RaceView raceKey={decodeURIComponent(arg)} year={year} />
        : tab === 'pollster' && arg ? <PollsterView id={Number(arg)} year={year} />
        : null}
      <p className="tiny muted" style={{ marginTop: 14 }}>Polls are fictional organizations' published surveys: samples of the simulated electorate with house effects, coverage biases and shared, correlated misses. Averages adjust for house effects; the forecast uses only published information (past results, fundamentals, polls) and reports probabilities, never certainty.</p>
    </>
  );
}

function ForecastPanel({ o, year }: { o: SeasonOverviewDto; year: number }) {
  const f = o.forecast;
  if (!f) return <p className="muted">The first forecast of {year} is published in June (weekly, then daily in the final 100 days). {o.pollCount ? `${fmtInt(o.pollCount)} polls are already out.` : ''}</p>;
  const name = (p: number) => f.nominees.find((n) => n.party === p)?.name ?? (p === 1 ? 'Democratic candidate' : 'Republican candidate');
  const states = f.races.filter((r) => r.kind === 'pres_state');
  const close = f.races.filter((r) => r.pD > 0.1 && r.pD < 0.9 && r.kind !== 'pres_state').sort((a, b) => Math.abs(a.pD - 0.5) - Math.abs(b.pD - 0.5)).slice(0, 14);
  const usps = (key: string) => key.split(':')[2] ?? key;
  const hist = o.history;
  const histSeries: Series[] = [
    ...(hist.some((h) => h.president !== null) ? [{ key: 'p', label: 'President (D)', color: PARTY_COLORS[1]!, points: hist.filter((h) => h.president !== null).map((h) => ({ x: h.asOf, y: 100 * h.president! })) }] : []),
    ...(hist.some((h) => h.senate !== null) ? [{ key: 's', label: 'Senate (D)', color: CANDIDATE_COLORS[2]!, points: hist.filter((h) => h.senate !== null).map((h) => ({ x: h.asOf, y: 100 * h.senate! })) }] : []),
    ...(hist.some((h) => h.house !== null) ? [{ key: 'h', label: 'House (D)', color: CANDIDATE_COLORS[6]!, points: hist.filter((h) => h.house !== null).map((h) => ({ x: h.asOf, y: 100 * h.house! })) }] : []),
  ];
  return (
    <>
      <div className="grid cols-3">
        {f.president && <section className="card fc-card">
          <h2>President</h2>
          <ProbRow dLabel={name(1)} rLabel={name(2)} pD={f.president.pD} pR={f.president.pR} />
          <div className="small muted">Expected electoral votes for {name(1)}: <strong className="num" style={{ color: 'var(--text-0)' }}>{Math.round(f.president.evMean)}</strong> (80% range {f.president.ev80[0]}–{f.president.ev80[1]}){f.president.pTie > 0.005 ? ` · no majority ${pctTxt(f.president.pTie)}` : ''}</div>
        </section>}
        {f.senate && <section className="card fc-card"><h2>Senate control</h2><ProbRow dLabel="Democrats" rLabel="Republicans" pD={f.senate.pD} pR={1 - f.senate.pD} /><div className="small muted">Expected Democratic seats: <strong className="num" style={{ color: 'var(--text-0)' }}>{f.senate.mean.toFixed(1)}</strong> of 100 (incl. seats not up)</div></section>}
        {f.house && <section className="card fc-card"><h2>House control</h2><ProbRow dLabel="Democrats" rLabel="Republicans" pD={f.house.pD} pR={1 - f.house.pD} /><div className="small muted">Expected Democratic seats: <strong className="num" style={{ color: 'var(--text-0)' }}>{f.house.mean.toFixed(0)}</strong> of 435</div></section>}
      </div>
      <p className="tiny muted">Forecast of {formatDay(f.asOf, true)} · national environment {mtxt(f.national.mean)} (±{f.national.sd.toFixed(1)}).</p>
      {f.president && <section className="card" style={{ marginTop: 12 }}>
        <h2>Electoral votes for {name(1)}</h2>
        <Histogram counts={f.president.evHist} threshold={270} colorAbove={PARTY_COLORS[1]!} colorBelow={PARTY_COLORS[2]!} label="Distribution of simulated electoral votes; the gold line is 270." />
        <h3>The path to 270</h3>
        <Snake states={states.map((s) => ({ key: s.key, label: usps(s.key), ev: s.ev, mean: s.mean, pD: s.pD, tipping: f.president!.tipping[s.key] ?? 0 }))} colorOf={(m) => marginColor(m) ?? '#3a4166'} />
        <h3>Tipping-point states</h3>
        <table className="data"><thead><tr><th>State</th><th>Tipping-point chance</th><th>Forecast margin</th><th>Democratic win</th><th>EV</th></tr></thead><tbody>
          {Object.entries(f.president.tipping).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, p]) => { const s = states.find((x) => x.key === k); return s ? <tr key={k} className="click" onClick={() => go(`polls/${year}/race/${encodeURIComponent(k)}`)}><td>{s.label.replace(/^\d{4} President — /, '')}</td><td className="num">{pctTxt(p)}</td><td className="num">{mtxt(s.mean)}</td><td className="num">{pctTxt(s.pD)}</td><td className="num">{s.ev}</td></tr> : null; })}
        </tbody></table>
      </section>}
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        {f.senate && <section className="card"><h2>Senate seats (Democrats)</h2><Histogram counts={f.senate.hist} threshold={51} colorAbove={PARTY_COLORS[1]!} colorBelow={PARTY_COLORS[2]!} from={Math.max(0, Math.round(f.senate.mean) - 14)} to={Math.min(100, Math.round(f.senate.mean) + 14)} label="Simulated Democratic Senate seats; 51 for a majority (50 with the Vice President)." /></section>}
        {f.house && <section className="card"><h2>House seats (Democrats)</h2><Histogram counts={f.house.hist} threshold={218} colorAbove={PARTY_COLORS[1]!} colorBelow={PARTY_COLORS[2]!} from={Math.max(0, Math.round(f.house.mean) - 45)} to={Math.min(435, Math.round(f.house.mean) + 45)} label="Simulated Democratic House seats; 218 for a majority." /></section>}
      </div>
      {histSeries.length > 0 && <section className="card" style={{ marginTop: 12 }}><h2>Forecast history</h2><TimeChart series={histSeries} yDomain={[0, 100]} fmt={(v) => `${Math.round(v)}%`} yLabel="Chance of Democratic control, by forecast date" /></section>}
      {close.length > 0 && <section className="card" style={{ marginTop: 12 }}><h2>Most competitive races</h2>
        <table className="data"><thead><tr><th>Race</th><th>Democratic win</th><th>Forecast margin</th><th>80% range</th></tr></thead><tbody>
          {close.map((r) => <tr key={r.key} className="click" onClick={() => go(`polls/${year}/race/${encodeURIComponent(r.key)}`)}><td className="small">{r.label.replace(/^\d{4} /, '')}</td><td className="num">{pctTxt(r.pD)}</td><td className="num">{mtxt(r.mean)}</td><td className="num small muted">{mtxt(r.lo80)} to {mtxt(r.hi80)}</td></tr>)}
        </tbody></table></section>}
    </>
  );
}

function ProbRow({ dLabel, rLabel, pD, pR }: { dLabel: string; rLabel: string; pD: number; pR: number }) {
  return (
    <div className="fc-prob">
      <div className="row between"><span className="small">{dLabel}</span><span className="small">{rLabel}</span></div>
      <div className="row between"><span className="fc-big num" style={{ color: '#6f9cf3' }}>{pctTxt(pD)}</span><span className="fc-big num" style={{ color: '#ef7d8b' }}>{pctTxt(pR)}</span></div>
      <div className="seatbar" style={{ height: 10 }} role="img" aria-label={`${dLabel} ${pctTxt(pD)}, ${rLabel} ${pctTxt(pR)}`}><div style={{ width: `${100 * pD}%`, background: PARTY_COLORS[1] }} /><div style={{ flex: 1 }} /><div style={{ width: `${100 * pR}%`, background: PARTY_COLORS[2] }} /><div className="majority" /></div>
    </div>
  );
}

function RacesPanel({ o, year }: { o: SeasonOverviewDto; year: number }) {
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const rows = o.races.filter((r) => (!kind || r.kind === kind) && (!q || r.label.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.polls - a.polls || a.label.localeCompare(b.label));
  const kinds = [...new Set(o.races.map((r) => r.kind))];
  return (
    <section className="card">
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Race type"><option value="">All races</option>{kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}</select>
        <input type="search" placeholder="Search races" aria-label="Search races" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="small muted">{rows.length} races · {fmtInt(o.pollCount)} polls from {o.pollsters} pollsters</span>
      </div>
      <div className="rx-table" style={{ maxHeight: 620 }}><table className="data"><thead><tr><th>Race</th><th>Type</th><th>Polls</th><th>Average</th><th>Leader</th><th>Forecast</th></tr></thead><tbody>
        {rows.slice(0, 400).map((r) => <RaceRow key={r.key} r={r} year={year} />)}
      </tbody></table></div>
    </section>
  );
}

function RaceRow({ r, year }: { r: RaceRowDto; year: number }) {
  return (
    <tr className="click" onClick={() => go(`polls/${year}/race/${encodeURIComponent(r.key)}`)}>
      <td className="small"><a href={`#/polls/${year}/race/${encodeURIComponent(r.key)}`} style={{ color: 'inherit' }}>{r.label.replace(/^\d{4} /, '')}</a></td>
      <td className="small muted">{KIND_LABEL[r.kind] ?? r.kind}</td>
      <td className="num small">{r.polls}</td>
      <td className="num small">{r.avg ? `${r.avg.mean >= 0 ? '+' : '−'}${Math.abs(r.avg.mean).toFixed(1)}` : '—'}</td>
      <td className="small">{r.leader ? <><span className="party-dot" style={{ background: PARTY_COLORS[r.leader.party] }} /> {r.leader.label} {r.leader.share.toFixed(0)}%</> : '—'}</td>
      <td className="num small">{r.forecast ? `D ${pctTxt(r.forecast.pD)}` : ''}</td>
    </tr>
  );
}

function colorsFor(options: { key: string; party: number }[]): Map<string, string> {
  const sameParty = new Set(options.map((o) => o.party)).size === 1 && options.length > 1;
  return new Map(options.map((o, i) => [o.key, sameParty ? CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]! : PARTY_COLORS[o.party] ?? '#8A8F9E']));
}

function RaceView({ raceKey, year }: { raceKey: string; year: number }) {
  const r = useQuery<SeasonRaceDto | null>({ kind: 'seasonRace', key: raceKey }, [raceKey]);
  const [mode, setMode] = useState<'shares' | 'margin'>('shares');
  if (r === null) return <p className="muted">Loading…</p>;
  if (!r) return <p className="muted">No such race.</p>;
  const colors = colorsFor(r.options);
  const top = r.options.filter((o) => r.averages.length && r.averages[r.averages.length - 1]!.options[o.key]).sort((a, b) => (r.averages[r.averages.length - 1]!.options[b.key]?.mean ?? 0) - (r.averages[r.averages.length - 1]!.options[a.key]?.mean ?? 0)).slice(0, 8);
  const series: Series[] = mode === 'shares'
    ? top.map((o) => ({ key: o.key, label: o.label.split(' ').slice(-1)[0]!, color: colors.get(o.key)!, points: r.averages.filter((a) => a.options[o.key]).map((a) => ({ x: a.day, y: a.options[o.key]!.mean, lo: a.options[o.key]!.lo, hi: a.options[o.key]!.hi })) }))
    : r.averages.some((a) => a.margin) ? [{ key: 'm', label: 'Margin', color: '#c3cbe6', points: r.averages.filter((a) => a.margin).map((a) => ({ x: a.day, y: a.margin!.mean, lo: a.margin!.lo, hi: a.margin!.hi })) }] : [];
  const marginPair = r.averages.find((a) => a.margin)?.margin;
  const dots: Dot[] = mode === 'shares'
    ? r.polls.flatMap((p) => p.responses.filter((x) => colors.has(x.key) && top.some((o) => o.key === x.key)).map((x) => ({ x: (p.start + p.end) / 2, y: x.pct, color: colors.get(x.key)!, title: `${p.pollsterName} (${formatDay(p.end)}): ${x.label} ${x.pct}%` })))
    : marginPair ? r.polls.map((p) => { const a = p.responses.find((x) => x.key === marginPair.a)?.pct ?? 0, b = p.responses.find((x) => x.key === marginPair.b)?.pct ?? 0; return { x: (p.start + p.end) / 2, y: a - b, color: '#c3cbe6', title: `${p.pollsterName} (${formatDay(p.end)}): ${a - b >= 0 ? '+' : ''}${a - b}` }; }) : [];
  const fc = r.forecast;
  return (
    <>
      <a className="small" href={`#/polls/${year}/races`}>‹ All races</a>
      <h2 className="screen-title" style={{ fontSize: 24, marginTop: 6 }}>{r.label}</h2>
      <p className="screen-sub">{KIND_LABEL[r.kind] ?? r.kind} · election {formatDay(r.day, true)}{r.contestId ? <> · <a href={`#/contest/${r.contestId}`}>contest page</a></> : null}{r.result ? ` · result ${mtxt(r.result.margin ?? 0)}` : ''}</p>
      <section className="card">
        <div className="row between wrap"><h2 style={{ margin: 0 }}>Polling average</h2>{marginPair && <div className="seg">{(['shares', 'margin'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'shares' ? 'Shares' : 'Margin'}</button>)}</div>}</div>
        {r.averages.length ? <TimeChart series={series} dots={dots} zero={mode === 'margin'} yLabel={mode === 'shares' ? 'Each candidate\'s share (points): line = adjusted average, band = 80%, dots = polls as published' : 'Margin of the first candidate over the second (points)'} markers={[{ x: r.day, label: 'Election' }].filter((m) => m.x <= Math.max(...r.averages.map((a) => a.day)) + 30)} /> : <p className="muted small">No published polls yet.</p>}
        {(() => { const g = r.averages[r.averages.length - 1]?.lvGap; return g !== undefined && r.polls.some((p) => p.population === 'RV') ? <p className="tiny muted" style={{ margin: '6px 0 0' }}>The average adjusts each pollster for its house effect, and moves registered-voter polls {Math.abs(g).toFixed(1)} points toward the {g >= 0 ? 'Republican' : 'Democratic'} candidate (the gap between registered- and likely-voter polls this year).</p> : null; })()}
      </section>
      {fc.length > 0 && <section className="card" style={{ marginTop: 12 }}><h2>Forecast</h2>
        <div className="row wrap" style={{ gap: 24 }}><div><div className="tiny muted">Democratic win</div><div className="fc-big num">{pctTxt(fc[fc.length - 1]!.pD)}</div></div><div><div className="tiny muted">Forecast margin (80% range)</div><div className="fc-mid num">{mtxt(fc[fc.length - 1]!.mean)} <span className="small muted">({mtxt(fc[fc.length - 1]!.lo80)} to {mtxt(fc[fc.length - 1]!.hi80)})</span></div></div></div>
        <TimeChart series={[{ key: 'f', label: 'Margin', color: '#c3cbe6', points: fc.map((x) => ({ x: x.asOf, y: x.mean, lo: x.lo80, hi: x.hi80 })) }]} zero yLabel="Forecast margin (D+ positive) with its 80% range, by forecast date" height={180} />
      </section>}
      <section className="card" style={{ marginTop: 12 }}><h2>Polls <span className="muted small">{r.polls.length}</span></h2><PollTable polls={r.polls} year={year} showRace={false} /></section>
    </>
  );
}

function PollTable({ polls, year, showRace = true }: { polls: PollDto[]; year: number; showRace?: boolean }) {
  if (!polls.length) return <p className="muted small">No published polls.</p>;
  return (
    <div className="rx-table" style={{ maxHeight: 560 }}><table className="data"><thead><tr><th>Dates</th><th>Pollster</th>{showRace && <th>Race</th>}<th>Sample</th><th>Result</th><th>MoE</th></tr></thead><tbody>
      {polls.map((p) => (
        <tr key={p.id}>
          <td className="small num muted">{formatDay(p.start).replace(/, \d{4}$/, '')}–{formatDay(p.end).replace(/, \d{4}$/, '')}</td>
          <td className="small"><a href={`#/polls/${year}/pollster/${p.pollster}`}>{p.pollsterName}</a>{p.sponsor ? <div className="tiny muted">for {p.sponsor}</div> : null}</td>
          {showRace && <td className="small"><a href={`#/polls/${year}/race/${encodeURIComponent(p.race)}`} style={{ color: 'inherit' }}>{p.raceLabel.replace(/^\d{4} /, '')}</a></td>}
          <td className="small num">{fmtInt(p.n)} {p.population}</td>
          <td className="small">{p.responses.filter((x) => x.key !== 'und').slice(0, 4).map((x) => <span key={x.key} style={{ marginRight: 8, whiteSpace: 'nowrap' }}><span className="party-dot" style={{ background: PARTY_COLORS[x.party] }} /> {x.label.split(' ').slice(-1)[0]} {x.pct}</span>)}</td>
          <td className="small num muted">±{(100 * p.moe).toFixed(1)}</td>
        </tr>
      ))}
    </tbody></table></div>
  );
}

function PollsPanel({ year }: { year: number }) {
  const polls = useQuery<PollDto[]>({ kind: 'pollList', year, limit: 400 }, [year]);
  return <section className="card"><h2>Latest polls <span className="muted small">{Array.isArray(polls) ? polls.length : ''}</span></h2>{Array.isArray(polls) ? <PollTable polls={polls} year={year} /> : <p className="muted">Loading…</p>}</section>;
}

function PollstersPanel({ year }: { year: number }) {
  const polls = useQuery<PollDto[]>({ kind: 'pollList', year, limit: 5000 }, [year]);
  const rows = useMemo(() => {
    if (!Array.isArray(polls)) return [];
    const m = new Map<number, { id: number; name: string; method: string; n: number; last: number }>();
    for (const p of polls) { const x = m.get(p.pollster) ?? { id: p.pollster, name: p.pollsterName, method: p.method, n: 0, last: 0 }; x.n++; x.last = Math.max(x.last, p.end); m.set(p.pollster, x); }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [polls]);
  return (
    <section className="card"><h2>Pollsters</h2>
      <table className="data"><thead><tr><th>Pollster</th><th>Method</th><th>Polls in {year}</th><th>Latest</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id} className="click" onClick={() => go(`polls/${year}/pollster/${r.id}`)}><td className="small"><a href={`#/polls/${year}/pollster/${r.id}`}>{r.name}</a></td><td className="small muted">{r.method}</td><td className="num small">{r.n}</td><td className="small muted">{formatDay(r.last)}</td></tr>)}
      </tbody></table>
    </section>
  );
}

function PollsterView({ id, year }: { id: number; year: number }) {
  const p = useQuery<PollsterDto | null>({ kind: 'pollster', id }, [id]);
  if (p === null) return <p className="muted">Loading…</p>;
  if (!p) return <p className="muted">No such pollster.</p>;
  return (
    <>
      <a className="small" href={`#/polls/${year}/pollsters`}>‹ All pollsters</a>
      <h2 className="screen-title" style={{ fontSize: 24, marginTop: 6 }}>{p.name}</h2>
      <p className="screen-sub">{p.method} · {p.scope === 'state' ? `polls ${p.homeState ?? 'one state'}` : p.scope === 'national' ? 'national and occasional state polls' : 'state polls nationwide'} · since {p.founded}{p.sponsor ? ` · often for ${p.sponsor}` : ''}</p>
      <div className="grid cols-3">
        <section className="card"><h2>Polls</h2><div className="fc-big num">{fmtInt(p.polls)}</div></section>
        <section className="card"><h2>House effect</h2>{p.house !== null ? <><div className="fc-big num" style={{ color: p.house >= 0 ? '#6f9cf3' : '#ef7d8b' }}>{mtxt(p.house)}</div><div className="tiny muted">Average lean of its margins against the polling average (shrunk toward zero).</div></> : <p className="muted small">Not enough polls yet.</p>}</section>
        <section className="card"><h2>Track record</h2>{p.accuracy ? <><div className="fc-big num">{p.accuracy.mae.toFixed(1)} pts</div><div className="tiny muted">Average error of the margin in its final-three-weeks polls ({p.accuracy.polls}), bias {mtxt(p.accuracy.bias)}.</div></> : <p className="muted small">Available once the races it polled are decided.</p>}</section>
      </div>
      <section className="card" style={{ marginTop: 12 }}><h2>Recent polls</h2><PollTable polls={p.recent} year={year} /></section>
    </>
  );
}

function CalibrationPanel({ year }: { year: number }) {
  const c = useQuery<CalibrationDto>({ kind: 'forecastCalibration', year }, [year]);
  if (!c || !('races' in (c as object))) return <p className="muted">Loading…</p>;
  if (!c.ready) return <p className="muted">The comparison appears once races are decided (the count must finish; no spoilers while it is under way).</p>;
  const W = 260, P = 30;
  const sx = (v: number) => P + v * (W - 2 * P), sy = (v: number) => W - P - v * (W - 2 * P);
  const misses = [...c.races].sort((a, b) => Math.abs(b.actual - b.mean) - Math.abs(a.actual - a.mean)).slice(0, 12);
  const wrong = c.races.filter((r) => (r.pD >= 0.5) !== r.dWon);
  return (
    <>
      <div className="grid cols-3">
        {c.president && <section className="card"><h2>President</h2><div className="small">Final forecast: Democratic win {pctTxt(c.president.pD)}, {Math.round(c.president.evMean)} expected EV (80%: {c.president.ev80[0]}–{c.president.ev80[1]}).</div>{c.president.actualEV !== null && <div className="small" style={{ marginTop: 6 }}>Result: <strong>{c.president.actualEV}</strong> EV for the Democratic ticket — {c.president.dWon ? 'Democratic' : 'Republican'} win.</div>}</section>}
        <section className="card"><h2>Brier score</h2><div className="fc-big num">{c.brier?.toFixed(3) ?? '—'}</div><div className="tiny muted">Mean squared error of the win probabilities over {c.races.length} decided races (0 is perfect; always guessing 50% scores 0.25).</div></section>
        <section className="card"><h2>Upsets</h2><div className="fc-big num">{wrong.length}</div><div className="tiny muted">Races won by the candidate the final forecast made the underdog.</div></section>
      </div>
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <section className="card"><h2>Reliability</h2>
          <svg viewBox={`0 0 ${W} ${W}`} style={{ maxWidth: 320 }} role="img" aria-label="Forecast probability against observed frequency">
            <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="var(--line)" strokeDasharray="4 3" />
            {[0, 0.5, 1].map((v) => <g key={v}><text x={sx(v)} y={W - 8} textAnchor="middle" className="an-ax">{Math.round(100 * v)}%</text><text x={8} y={sy(v) + 4} className="an-ax">{Math.round(100 * v)}%</text></g>)}
            {c.bins.filter((b) => b.n > 0).map((b, i) => <circle key={i} cx={sx(b.predicted)} cy={sy(b.observed)} r={Math.max(4, Math.min(12, 2 + Math.sqrt(b.n)))} fill={PARTY_COLORS[1]} fillOpacity={0.75} stroke="var(--bg-1)" strokeWidth={1.5}><title>{`${Math.round(100 * b.lo)}–${Math.round(100 * b.hi)}%: ${b.n} races, Democrats won ${Math.round(100 * b.observed)}%`}</title></circle>)}
          </svg>
          <p className="tiny muted">Each dot groups races by the forecast's Democratic win probability (x) against how often Democrats won them (y); on the diagonal is well calibrated. Dot size: number of races.</p>
        </section>
        <section className="card"><h2>Largest misses</h2><table className="data"><thead><tr><th>Race</th><th>Forecast</th><th>Result</th><th>Miss</th></tr></thead><tbody>
          {misses.map((r) => <tr key={r.key}><td className="small">{r.label.replace(/^\d{4} /, '')}</td><td className="num small">{mtxt(r.mean)}</td><td className="num small">{mtxt(r.actual)}</td><td className="num small">{(r.actual - r.mean).toFixed(1)}</td></tr>)}
        </tbody></table></section>
      </div>
    </>
  );
}

export { PartyBadge };
