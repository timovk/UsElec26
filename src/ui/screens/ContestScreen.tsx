import type { ContestDetail } from '../../engine/protocol';
import { useQuery } from './Desk';
import { PARTY_COLORS, PartyBadge, fmtInt } from '../components/common';

const COUNT_STATUS = ['Polls open', 'Too early to call', 'Too close to call', 'Projected', 'Projection withdrawn', 'Runoff projected'];

export function ContestScreen({ id }: { id: number }) {
  const c = useQuery<ContestDetail | null>({ kind: 'contest', id }, [id]);
  if (c === null) return <p className="muted">Loading…</p>;
  if (!c) return <p>No such contest.</p>;
  const valid = c.candidates.reduce((a, x) => a + (x.votes ?? 0), 0);
  return (
    <>
      <a className="small" href={`#/results/${c.label.slice(0, 4)}`}>‹ {c.label.slice(0, 4)} results</a>
      <div className="kicker" style={{ marginTop: 8 }}>{c.electionLabel} · {c.date}</div>
      <h1 className="screen-title">{c.label.replace(/^\d{4} /, '')}</h1>
      <p className="screen-sub">{c.office ?? 'President of the United States'}{c.districtLabel ? ` · ${c.districtLabel}` : ''}{c.ev ? ` · ${c.ev} electoral votes` : ''}
        {c.parent && <> · <a href={`#/contest/${c.parent}`}>first round</a></>}{c.next && <> · <a href={`#/contest/${c.next}`}>{c.status === 'runoff' ? 'runoff' : 'next round'}</a></>}</p>
      <div className="grid cols-2">
        <section className="card">
          <h2>Result <span className={`badge ${c.counting ? 'live' : 'record'}`}>{c.counting ? 'Counting · unofficial' : c.status}</span></h2>
          {c.counting && (
            <p className="small" style={{ marginTop: -4 }}>
              ≈ {c.counting.expected ? Math.min(100, Math.floor(100 * (c.ballots ?? 0) / c.counting.expected)) : 0}% of expected vote counted · {fmtInt(c.counting.precincts)} of {fmtInt(c.counting.totalPrecincts)} precincts reporting ·{' '}
              <strong>{c.counting.called !== null ? `MNN projects ${c.candidates.find((x) => x.candidacyId === c.counting!.called)?.name ?? 'a winner'}` : COUNT_STATUS[c.counting.status] ?? 'Counting'}</strong>{' '}
              <a href={`#/night/${c.counting.nightId}`}>Watch on Election Night ›</a>
            </p>
          )}
          <table className="data">
            <thead><tr><th>Candidate</th><th>Party</th><th>Votes</th><th>Share</th><th /></tr></thead>
            <tbody>{c.candidates.map((x) => (
              <tr key={x.candidacyId}>
                <td><a href={`#/people/${x.personId}`} style={{ color: 'inherit', fontWeight: 600 }}>{x.name}</a>{x.incumbent && <span className="badge" style={{ marginLeft: 6 }}>Incumbent</span>}{x.runningMate && <div className="tiny muted">with {x.runningMate}</div>}</td>
                <td><PartyBadge party={x.party} /></td>
                <td className="num">{x.votes !== null ? fmtInt(x.votes) : '—'}</td>
                <td className="num" style={{ width: 160 }}>{x.share !== null && <div className="row"><div style={{ flex: 1, height: 8, background: 'var(--bg-3)', borderRadius: 4 }}><div style={{ width: `${100 * x.share}%`, height: '100%', background: PARTY_COLORS[x.party], borderRadius: 4 }} /></div>{(100 * x.share).toFixed(1)}%</div>}</td>
                <td className="small">{x.status === 'won' ? '✔ Won' : x.status === 'advanced' ? 'Advanced' : ''}</td>
              </tr>
            ))}</tbody>
          </table>
          {c.ballots !== null && (
            <table className="data" style={{ marginTop: 10 }}><tbody>
              <tr><td className="muted">Ballots in this contest</td><td className="num">{fmtInt(c.ballots)}</td></tr>
              <tr><td className="muted">Valid votes / undervotes</td><td className="num">{fmtInt(valid)} / {fmtInt(c.undervotes ?? 0)} ({(100 * (c.undervotes ?? 0) / Math.max(1, c.ballots)).toFixed(1)}%)</td></tr>
              <tr><td className="muted">Eligible voters</td><td className="num">{fmtInt(c.eligible ?? 0)} · turnout {(100 * c.ballots / Math.max(1, c.eligible ?? 0)).toFixed(1)}%</td></tr>
              {c.counting ? <tr><td className="muted">Archive</td><td className="tiny">The cast ballots are sealed; this is the count so far. The certified result follows each state's canvass.</td></tr>
                : <tr><td className="muted">Archive</td><td className="tiny">{c.revisionKind} · grain {c.grain} · seal <code>{c.seal?.slice(0, 16)}…</code>{c.revisions.length > 1 && <div>Revisions: {c.revisions.map((r) => `${r.rev} ${r.kind}`).join(' · ')}</div>}</td></tr>}
            </tbody></table>
          )}
          <p className="tiny muted">{c.note}</p>
        </section>
        <section className="card">
          <h2>By method of voting</h2>
          {c.modes.length === 0 ? <p className="muted small">Not recorded for this contest.</p> : (
            <table className="data"><thead><tr><th>Method</th>{c.candidates.map((x) => <th key={x.candidacyId}>{x.name.split(' ').slice(-1)[0]}</th>)}</tr></thead>
              <tbody>{c.modes.map((m) => { const t = m.votes.reduce((a, b) => a + b, 0); return <tr key={m.mode}><td>{m.mode}</td>{m.votes.map((v, i) => <td key={i} className="num">{fmtInt(v)} <span className="muted tiny">{t ? `${(100 * v / t).toFixed(0)}%` : ''}</span></td>)}</tr>; })}</tbody></table>
          )}
          <p className="tiny muted">How these ballots were cast{c.counting ? ' (counted so far)' : ''}. On election night some states release early and mail ballots first, others count them last.</p>
        </section>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>By county <span className="muted small">{c.counties.length}</span></h2>
        <div style={{ maxHeight: 520, overflow: 'auto' }}>
          <table className="data">
            <thead><tr><th>County</th>{c.candidates.map((x) => <th key={x.candidacyId}>{x.name}</th>)}<th>Total</th></tr></thead>
            <tbody>{c.counties.map((k) => (
              <tr key={k.county} className="click" onClick={() => { location.hash = `#/county/${k.county}`; }}>
                <td><a href={`#/county/${k.county}`} style={{ color: 'inherit' }}>{k.name}</a></td>
                {k.votes.map((v, i) => { const share = k.total ? v / k.total : 0; const lead = v === Math.max(...k.votes); return <td key={i} className="num" style={lead ? { color: PARTY_COLORS[c.candidates[i]!.party], fontWeight: 600 } : undefined}>{fmtInt(v)} <span className="tiny muted">{(100 * share).toFixed(1)}%</span></td>; })}
                <td className="num muted">{fmtInt(k.total)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
