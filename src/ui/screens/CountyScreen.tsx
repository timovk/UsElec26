import { useMemo, useState } from 'react';
import type { CountyHistoryDto, GeoMeta } from '../../engine/protocol';
import { useQuery } from './Desk';
import { PARTY_COLORS, PartyBadge, fmtInt, fmtLean } from '../components/common';
import { go } from '../app/router';

const OFFICES: [string, string][] = [['', 'All offices'], ['president', 'President'], ['us_senator', 'U.S. Senate'], ['us_representative', 'U.S. House'], ['governor', 'Governor']];

export function CountyScreen({ idx }: { idx: number }) {
  const h = useQuery<CountyHistoryDto>({ kind: 'countyHistory', county: idx }, [idx]);
  const [office, setOffice] = useState('');
  const rows = useMemo(() => (h ? h.rows.filter((r) => !office || r.officeKind === office) : []), [h, office]);
  if (!h) return <p className="muted">Loading…</p>;
  // Swing between consecutive presidential elections (two-party margin shift; positive = toward D).
  const pres = h.rows.filter((r) => r.officeKind === 'president' && r.dMargin !== null).sort((a, b) => a.year - b.year);
  return (
    <>
      <a className="small" href={`#/archive/${h.stateIdx}`}>‹ {h.state}</a>
      <div className="kicker" style={{ marginTop: 8 }}>County election history</div>
      <h1 className="screen-title">{h.name}, {h.state}</h1>
      <p className="screen-sub">Every simulated election on this county's ballots. Figures are exact sums of the archived Census block-group results.</p>
      {pres.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>Presidential elections</h2>
          <table className="data"><thead><tr><th>Year</th><th>Winner here</th><th>Two-party margin</th><th>Shift vs previous</th><th>Votes cast</th></tr></thead>
            <tbody>{pres.map((r, i) => { const prev = pres[i - 1]; const w = r.candidates[0]!; return (
              <tr key={r.contestId} className="click" onClick={() => go(`contest/${r.contestId}`)}>
                <td className="num">{r.year}</td><td><PartyBadge party={w.party} /> {w.name}</td>
                <td className="num" style={{ color: (r.dMargin ?? 0) >= 0 ? 'var(--dem-2)' : 'var(--rep-2)' }}>{fmtLean(r.dMargin!)}</td>
                <td className="num">{prev ? `${(r.dMargin! - prev.dMargin!) >= 0 ? '→ D' : '→ R'} ${Math.abs(r.dMargin! - prev.dMargin!).toFixed(1)}` : '—'}</td>
                <td className="num">{fmtInt(r.total)}</td>
              </tr>); })}</tbody></table>
          <p className="tiny muted">Shift = change in (D − R)/(D + R) from the previous presidential election, in points.</p>
        </section>
      )}
      <section className="card">
        <div className="row between"><h2>All contests</h2><select value={office} onChange={(e) => setOffice(e.target.value)}>{OFFICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        {rows.length === 0 ? <p className="muted">No archived elections yet{office ? ' for this office' : ''}.</p> : (
          <table className="data">
            <thead><tr><th>Date</th><th>Office</th><th>Result in this county</th><th>Margin</th><th>Votes</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.contestId} className="click" onClick={() => go(`contest/${r.contestId}`)}>
                <td className="num muted">{r.date}</td><td>{r.label.replace(/^\d{4} /, '')}</td>
                <td>{r.candidates.slice(0, 3).map((c) => <span key={c.name} style={{ marginRight: 12 }}><span style={{ color: PARTY_COLORS[c.party], fontWeight: c.winner ? 700 : 400 }}>{c.name}</span> <span className="muted tiny">{(100 * c.share).toFixed(1)}%{c.winner ? ' ✔' : ''}</span></span>)}</td>
                <td className="num">{r.dMargin !== null ? fmtLean(r.dMargin) : '—'}</td><td className="num muted">{fmtInt(r.total)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="tiny muted">✔ marks the overall winner of the contest (not necessarily this county's leader).</p>
      </section>
    </>
  );
}

export function ArchiveScreen({ stateIdx }: { stateIdx?: number }) {
  const meta = useQuery<GeoMeta>({ kind: 'geoMeta' });
  const [filter, setFilter] = useState('');
  if (!meta) return <p className="muted">Loading…</p>;
  if (stateIdx === undefined) return (
    <>
      <div className="kicker">Historical archive</div>
      <h1 className="screen-title">Archive</h1>
      <p className="screen-sub">Choose a state, then a county, to see every election it has voted in. Results by contest are on the <a href="#/results">Results</a> screen.</p>
      <section className="card"><div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 6 }}>
        {meta.states.map((s) => <a key={s.idx} className="btn small" href={`#/archive/${s.idx}`}>{s.name}</a>)}
      </div></section>
    </>
  );
  const st = meta.states[stateIdx]!;
  const counties = meta.counties.filter((c) => c.stateIdx === stateIdx && c.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <a className="small" href="#/archive">‹ All states</a>
      <h1 className="screen-title">{st.name}</h1>
      <input type="search" placeholder="Filter counties…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ margin: '8px 0 12px', width: 260 }} />
      <section className="card"><div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
        {counties.map((c) => <a key={c.idx} href={`#/county/${c.idx}`}>{c.name}</a>)}
      </div></section>
    </>
  );
}
