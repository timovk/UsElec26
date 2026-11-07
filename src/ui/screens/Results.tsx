import { useState } from 'react';
import type { ElectionListItem, YearSummary } from '../../engine/protocol';
import { useQuery } from './Desk';
import { CodeLinks, PARTY_COLORS, PARTY_NAME, PartyBadge, SeatBar, fmtInt } from '../components/common';
import { go } from '../app/router';
import { ResultsExplorer } from './ResultsExplorer';
import { engine } from '../state/engineClient';

type AuditRow = { election: string; ok: boolean; findings: { check: string; ok: boolean; detail: string }[] };


export function Results({ year: yearParam }: { year?: number }) {
  const years = useQuery<number[]>({ kind: 'electionYears' });
  const year = yearParam ?? years?.[0];
  const summary = useQuery<YearSummary>(year ? { kind: 'yearSummary', year } : { kind: 'electionYears' }, [year]);
  const list = useQuery<ElectionListItem[]>(year ? { kind: 'elections', year } : { kind: 'electionYears' }, [year]);
  if (!years) return <p className="muted">Loading…</p>;
  if (!years.length) return <><h1 className="screen-title">Results</h1><p className="muted">No elections have been held yet. The calendar of upcoming elections is on the Desk.</p></>;
  const s = summary && 'chambers' in (summary as object) ? summary : null;
  return (
    <>
      <div className="row between wrap">
        <div><div className="kicker">Election results</div><h1 className="screen-title">{year} elections</h1></div>
        <div className="row"><label className="small muted">Year</label>
          <select value={year} onChange={(e) => go(`results/${e.target.value}`)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <a className="btn small" href={`#/map/results/${year}`}>View on the map</a><a className="btn small" href={`#/government/measures/${year}`}>Ballot measures</a></div>
      </div>
      {s && (s.hasPresident || s.chambers.length > 0) && (
        <div className="grid cols-3" style={{ marginTop: 10 }}>
          {s.hasPresident && (
            <section className="card">
              <h2>President {s.projected && <span className="badge live">Projected</span>}</h2>
              {s.president.map((p) => (
                <div key={p.name} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  <span className="row"><PartyBadge party={p.party} /> <strong>{p.name}</strong></span>
                  <span className="num"><span className="bignum" style={{ fontSize: 22, color: PARTY_COLORS[p.party] }}>{p.ev}</span> EV{!s.projected && ` · ${(100 * p.share).toFixed(1)}%`}</span>
                </div>
              ))}
              <p className="tiny muted">{s.projected ? 'Electoral votes as projected by the MNN decision desk; the count continues until each state certifies and the electors meet.' : "Electoral votes as cast by the electors; popular vote summed from every state's archived result."}</p>
            </section>
          )}
          <section className="card">
            <h2>Balance of power</h2>
            {s.chambers.map((c) => (
              <div key={c.label} style={{ marginBottom: 12 }}>
                <div className="row between small"><strong>{c.label}</strong><span className="muted">{c.after.map((x) => `${PARTY_NAME[x.party] ?? 'Vacant'} ${x.seats}`).join(' · ')}</span></div>
                <SeatBar composition={c.after} seats={c.after.reduce((a, x) => a + x.seats, 0)} />
                <div className="tiny muted">Before: {c.before.map((x) => `${PARTY_NAME[x.party] ?? 'Vacant'} ${x.seats}`).join(' · ')}</div>
              </div>
            ))}
            {s.turnout && <div className="small">Turnout: <strong>{(100 * s.turnout.ballots / s.turnout.eligible).toFixed(1)}%</strong> of eligible voters ({fmtInt(s.turnout.ballots)} ballots)</div>}
          </section>
          <section className="card">
            <h2>Seats that changed party <span className="muted small">{s.flips.length}</span></h2>
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              {s.flips.length === 0 ? <p className="muted small">None.</p> : s.flips.map((f) => (
                <div key={f.contestId} className="row between small" style={{ padding: '3px 0' }}>
                  <span><CodeLinks text={f.label.replace(/^\d{4} /, '')} href={`#/contest/${f.contestId}`} /></span><span><PartyBadge party={f.from} /> → <PartyBadge party={f.to} /></span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      {Array.isArray(list) && list.length > 0 && typeof list[0] === 'object' && <ResultsExplorer list={list} key={year} />}
      {year !== undefined && <AuditPanel year={year} />}
    </>
  );
}

function AuditPanel({ year }: { year: number }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { setRows(await engine.query<AuditRow[]>({ kind: 'audit', year })); } finally { setBusy(false); } };
  const bad = rows?.filter((r) => !r.ok) ?? [];
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Archive audit</h2>
      <p className="small muted">Re-reads every sealed {year} result from the database and checks it: the SHA-256 seals still match, every Base Unit's votes plus undervotes equal its ballots, ballots never exceed eligible voters, and the unit results sum to the county rollups and the certified totals.</p>
      <button className="btn" disabled={busy} onClick={() => void run()}>{busy ? 'Auditing…' : `Audit the ${year} archive`}</button>
      {rows && <p className="small" style={{ color: bad.length ? 'var(--bad)' : 'var(--ok)' }}>{bad.length ? `${bad.length} of ${rows.length} elections failed the audit.` : `All ${rows.length} elections passed (${rows.reduce((a, r) => a + r.findings.length, 0)} checks).`}</p>}
      {bad.length > 0 && <table className="data"><tbody>{bad.flatMap((r) => r.findings.filter((f) => !f.ok).map((f, i) => <tr key={`${r.election}-${i}`}><td>{r.election}</td><td>{f.check}</td><td className="small">{f.detail}</td></tr>))}</tbody></table>}
    </section>
  );
}
