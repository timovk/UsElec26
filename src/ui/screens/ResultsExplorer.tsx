/**
 * Results Explorer v1: every contest of a year with faceted search (stage, office, state, status, winning
 * party, flips, incumbents defeated, close races, text), a sortable virtualized table, and the election
 * night's calls timeline.
 */
import { useMemo, useRef, useState } from 'react';
import type { ElectionListItem, NightCallDto } from '../../engine/protocol';
import { CodeLinks, PARTY_COLORS, PartyBadge } from '../components/common';
import { go } from '../app/router';
import { useQuery } from './Desk';
import { formatTime } from '../../core/time';
import { OFFICE_LABEL } from '../../engine/protocol';

type Row = ElectionListItem['contests'][number] & { election: ElectionListItem };
type SortKey = 'date' | 'contest' | 'winner' | 'margin';

const KIND_LABEL: Record<string, string> = { general: 'General', special: 'Special', pres_state: 'Presidential', primary: 'Primary', top_two: 'Top-two primary', pres_nomination: 'Nomination', runoff: 'Runoff', retention: 'Retention' };
const STAGES = { general: ['general', 'special', 'pres_state', 'runoff', 'retention'], primary: ['primary', 'top_two', 'pres_nomination'] } as const;

export function ResultsExplorer({ list }: { list: ElectionListItem[] }) {
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<'general' | 'primary' | 'all'>('general');
  const [office, setOffice] = useState('');
  const [state, setState] = useState('');
  const [party, setParty] = useState(0);
  const [flags, setFlags] = useState({ flip: false, incumbent: false, close: false });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: 1 });
  const all: Row[] = useMemo(() => list.flatMap((e) => e.contests.map((c) => ({ ...c, election: e }))), [list]);
  const inStage = (c: Row) => (stage === 'all' ? true : (STAGES[stage] as readonly string[]).includes(c.kind));
  // Each facet counts the contests that match every other facet (so counts show what a click would give).
  const match = (c: Row, skip?: string) =>
    inStage(c) && (skip === 'office' || !office || c.office === office) && (skip === 'state' || !state || c.state === state)
    && (skip === 'party' || !party || c.winner?.party === party) && (!flags.flip || c.flip === true) && (!flags.incumbent || c.incumbentLost)
    && (!flags.close || (c.margin !== null && c.margin < 5 && c.winner !== null))
    && (!q || `${c.label} ${c.winner?.name ?? ''} ${c.state ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const count = (skip: string, key: (c: Row) => string | number | null) => { const m = new Map<string | number, number>(); for (const c of all) if (match(c, skip)) { const k = key(c); if (k !== null && k !== '') m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const officeCounts = count('office', (c) => c.office), stateCounts = count('state', (c) => c.state), partyCounts = count('party', (c) => c.winner?.party ?? null);
  const rows = all.filter((c) => match(c)).sort((a, b) => {
    const d = sort.key === 'date' ? a.election.day - b.election.day || a.id - b.id : sort.key === 'contest' ? a.label.localeCompare(b.label)
      : sort.key === 'winner' ? (a.winner?.name ?? '~').localeCompare(b.winner?.name ?? '~') : (a.margin ?? 999) - (b.margin ?? 999);
    return d * sort.dir;
  });
  const th = (key: SortKey, label: string) => <th aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}><button className="an-sort" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}>{label}{sort.key === key ? (sort.dir === 1 ? ' ▴' : ' ▾') : ''}</button></th>;
  const nightId = list.find((e) => e.nightId !== null)?.nightId ?? null;
  return (
    <>
      {nightId !== null && <CallsTimeline nightId={nightId} />}
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Results Explorer <span className="muted small">{rows.length.toLocaleString()} of {all.length.toLocaleString()} contests</span></h2>
        <div className="rx">
          <div className="rx-facets">
            <input type="search" placeholder="Search contests and winners" aria-label="Search contests and winners" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} />
            <div className="seg" style={{ marginTop: 8 }}>{(['general', 'primary', 'all'] as const).map((k) => <button key={k} className={stage === k ? 'on' : ''} onClick={() => setStage(k)}>{k === 'general' ? 'General' : k === 'primary' ? 'Primaries' : 'All'}</button>)}</div>
            <Facet title="Office" value={office} set={setOffice} options={[...officeCounts].map(([k, n]) => ({ k: String(k), label: OFFICE_LABEL[String(k)] ?? String(k), n }))} />
            <Facet title="Winning party" value={party ? String(party) : ''} set={(v) => setParty(Number(v) || 0)} options={[...partyCounts].map(([k, n]) => ({ k: String(k), label: ({ 1: 'Democratic', 2: 'Republican', 3: 'Libertarian', 4: 'Green', 5: 'Independent' } as Record<string, string>)[String(k)] ?? String(k), n, color: PARTY_COLORS[Number(k)] }))} />
            <div className="rx-facet"><div className="kicker">Show only</div>
              {([['flip', 'Seats that changed party'], ['incumbent', 'Incumbents defeated'], ['close', 'Margin under 5 points']] as const).map(([k, label]) => (
                <label key={k} className="small row" style={{ gap: 6 }}><input type="checkbox" checked={flags[k]} onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))} />{label}</label>))}
            </div>
            <Facet title="State" value={state} set={setState} options={[...stateCounts].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([k, n]) => ({ k: String(k), label: String(k), n }))} compact />
          </div>
          <VirtualTable rows={rows} head={<tr>{th('date', 'Date')}{th('contest', 'Contest')}<th>Type</th>{th('winner', 'Winner')}{th('margin', 'Margin')}<th>Status</th></tr>} />
        </div>
      </section>
    </>
  );
}

function Facet({ title, value, set, options, compact }: { title: string; value: string; set: (v: string) => void; options: { k: string; label: string; n: number; color?: string }[]; compact?: boolean }) {
  return (
    <div className="rx-facet"><div className="kicker">{title}{value && <button className="an-sort tiny" style={{ marginLeft: 6 }} onClick={() => set('')}>clear</button>}</div>
      <div className={compact ? 'rx-chips' : ''}>{options.map((o) => (
        <button key={o.k} className={`rx-opt${value === o.k ? ' on' : ''}`} onClick={() => set(value === o.k ? '' : o.k)} aria-pressed={value === o.k}>
          {o.color && <span className="party-dot" style={{ background: o.color }} />}<span>{o.label}</span><span className="muted tiny">{o.n}</span>
        </button>))}</div>
    </div>
  );
}

/** A fixed-row-height table that renders only the rows in view. */
function VirtualTable({ rows, head }: { rows: Row[]; head: React.ReactNode }) {
  const ROW = 34, H = 560;
  const [top, setTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const first = Math.max(0, Math.floor(top / ROW) - 8), last = Math.min(rows.length, first + Math.ceil(H / ROW) + 16);
  return (
    <div className="rx-table" ref={ref} style={{ maxHeight: H }} onScroll={(e) => setTop((e.target as HTMLDivElement).scrollTop)}>
      <table className="data">
        <thead>{head}</thead>
        <tbody>
          {first > 0 && <tr style={{ height: first * ROW }} aria-hidden><td colSpan={6} /></tr>}
          {rows.slice(first, last).map((c) => (
            <tr key={c.id} className="click" style={{ height: ROW }} onClick={() => go(`contest/${c.id}`)}>
              <td className="num muted small">{c.election.date}</td>
              <td className="small"><CodeLinks text={c.label.replace(/^\d{4} /, '')} href={`#/contest/${c.id}`} style={{ color: 'inherit' }} />{c.flip && <span className="badge" style={{ marginLeft: 6 }}>flip</span>}</td>
              <td className="muted small">{KIND_LABEL[c.kind] ?? c.kind}</td>
              <td className="small">{c.winner ? <span className="row"><PartyBadge party={c.winner.party} />{c.winner.name}</span> : <span className="muted">{c.status === 'runoff' ? 'Runoff' : '—'}</span>}</td>
              <td className="num small">{c.margin !== null && c.winner ? `${c.margin.toFixed(1)} pts` : ''}</td>
              <td className="muted small">{c.status}{c.election.nightId !== null && <> · <a href={`#/night/${c.election.nightId}`} onClick={(e) => e.stopPropagation()} title="Watch this election night">★ night</a></>}</td>
            </tr>
          ))}
          {last < rows.length && <tr style={{ height: (rows.length - last) * ROW }} aria-hidden><td colSpan={6} /></tr>}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted small">No contest matches these filters.</p>}
    </div>
  );
}

const LANES: { id: string; label: string }[] = [{ id: 'president', label: 'President' }, { id: 'us_senator', label: 'Senate' }, { id: 'governor', label: 'Governor' }, { id: 'us_representative', label: 'House' }];

/** When each race was called on election night: one dot per call, by office, coloured by the winner's party. */
function CallsTimeline({ nightId }: { nightId: number }) {
  const calls = useQuery<NightCallDto[]>({ kind: 'nightCalls', id: nightId }, [nightId]);
  const [hover, setHover] = useState<NightCallDto | null>(null);
  if (!calls || !Array.isArray(calls) || !calls.length) return null;
  const night = calls.filter((c) => c.status === 3 && LANES.some((l) => l.id === c.office));
  if (!night.length) return null;
  const t0 = Math.min(...night.map((c) => c.time)), tEnd = Math.max(...night.map((c) => c.time));
  const t1 = Math.max(t0 + 60, Math.min(tEnd, t0 + 14 * 60)); // the night itself; later calls collapse at the right edge
  const W = 1000, L = 90, R = 16, LH = 28, T = 8, H = T + LANES.length * LH + 22;
  const x = (t: number) => L + ((Math.min(t, t1) - t0) / (t1 - t0)) * (W - L - R);
  const ticks: number[] = []; for (let t = Math.ceil(t0 / 60) * 60; t <= t1; t += 60) ticks.push(t);
  const late = night.filter((c) => c.time > t1).length;
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Calls timeline <span className="muted small">{night.length} projections · <a href={`#/night/${nightId}`}>watch the night</a></span></h2>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Election-night projections by time and office">
        {ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={T} y2={H - 20} stroke="var(--line-soft)" /><text x={x(t)} y={H - 6} textAnchor="middle" className="an-ax">{formatTime(t, 'America/New_York').replace(/:00 /, ' ').replace(/ E[SD]T/, '')}</text></g>)}
        {LANES.map((l, i) => <text key={l.id} x={8} y={T + i * LH + LH / 2 + 4} className="an-ax">{l.label}</text>)}
        {night.map((c, i) => { const lane = LANES.findIndex((l) => l.id === c.office); const jitter = ((i * 37) % 9) - 4; return (
          <circle key={i} cx={x(c.time)} cy={T + lane * LH + LH / 2 + jitter} r={c.office === 'us_representative' ? 3 : 5} fill={PARTY_COLORS[c.party] ?? '#888'} stroke="var(--bg-1)" strokeWidth={1.5}
            onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }} onClick={() => go(`contest/${c.contestId}`)} />); })}
      </svg>
      <div className="tiny muted" style={{ minHeight: 18 }}>{hover ? <span className="an-tip">{formatTime(hover.time, 'America/New_York')} · {hover.short}: {hover.name} · {hover.pollClose ? 'projected at poll closing' : `${Math.floor(100 * hover.pct)}% of expected vote counted`}</span> : <>Each dot is a projection, coloured by the winner's party; larger dots are statewide races.{late ? ` ${late} call${late === 1 ? '' : 's'} came later and are shown at the right edge.` : ''}</>}</div>
    </section>
  );
}
