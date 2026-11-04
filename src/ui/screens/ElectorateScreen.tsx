import type { ElectorateSummary } from '../../engine/protocol';
import { useQuery } from './Desk';
import { Truth, fmtLean } from '../components/common';

const LABELS: Record<string, string> = {
  national: 'National two-party Democratic share (%)', stateSd: 'Spread of state margins (SD, points; 50 states)', countySd: 'Spread of county margins (SD, points)',
  lopsidedCounties: 'Counties with > 60% for one party (share)', closeStates: 'States within 5 points', moransI: "Geographic clustering (Moran's I)",
};

export function ElectorateScreen() {
  const e = useQuery<ElectorateSummary>({ kind: 'electorate' });
  if (!e) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="kicker">Simulation inspector</div>
      <h1 className="screen-title">The electorate <Truth /></h1>
      <p className="screen-sub">How this universe's fictional coalitions were generated. Inside the universe nobody can see these numbers — polls (Phase 5) will measure them with error.</p>
      <div className="grid cols-2">
        <section className="card">
          <h2>Calibration to the shape of American elections</h2>
          <p className="small muted">The generator draws random coalitions, then calibrates their strength so the political geography has realistic dispersion and clustering. It never copies real partisan patterns.</p>
          <table className="data">
            <thead><tr><th>Statistic</th><th>Target</th><th>Achieved</th><th>Plausible range</th></tr></thead>
            <tbody>{Object.keys(LABELS).map((k) => (
              <tr key={k}><td>{LABELS[k]}</td><td className="num">{e.targets[k] !== undefined ? e.targets[k]!.toFixed(1) : '—'}</td><td className="num"><strong>{e.achieved[k]!.toFixed(2)}</strong></td><td className="num muted">{e.ranges[k]?.join(' – ')}</td></tr>
            ))}</tbody>
          </table>
          <p className="tiny muted">Generator attempt #{e.attempt + 1}. Lean is measured for a neutral generic two-candidate presidential contest with baseline turnout.</p>
        </section>
        <section className="card">
          <h2>Party platforms</h2>
          <table className="data"><thead><tr><th>Issue axis</th><th>Democratic</th><th>Republican</th></tr></thead>
            <tbody>{e.axes.map((a, i) => <tr key={a}><td>{a}</td><td className="num">{e.platforms.D[i]!.toFixed(2)}</td><td className="num">{e.platforms.R[i]!.toFixed(2)}</td></tr>)}</tbody></table>
          <p className="tiny muted">Positions in a standardized latent issue space. Groups whose positions are closer to a party lean toward it; party positions will move in later phases, producing realignments.</p>
        </section>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>How demographic groups lean in this universe</h2>
        <table className="data">
          <thead><tr><th>Group (share of the eligible electorate)</th><th>Share</th><th>Underlying lean</th><th style={{ width: '40%' }} /></tr></thead>
          <tbody>{e.cohortLean.slice(0, 40).map((c) => (
            <tr key={c.label}><td>{c.label}</td><td className="num">{(c.share * 100).toFixed(1)}%</td><td className="num" style={{ color: c.margin >= 0 ? 'var(--dem-2)' : 'var(--rep-2)' }}>{fmtLean(c.margin)}</td>
              <td><div className="seatbar" style={{ height: 10 }}><div style={{ width: `${50 + c.margin / 2}%`, background: 'var(--dem)' }} /><div style={{ width: `${50 - c.margin / 2}%`, background: 'var(--rep)' }} /></div></td></tr>
          ))}</tbody>
        </table>
        <p className="tiny muted">Showing the 40 largest of 64 cohorts (age × sex × education × race/ethnicity). Individuals within a group vary widely; these are group averages.</p>
      </section>
    </>
  );
}
