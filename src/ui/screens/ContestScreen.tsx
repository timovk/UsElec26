import type { ContestDetail } from '../../engine/protocol';
import { surname } from '../../core/names';
import { useQuery } from './Desk';
import { CodeLinks, PARTY_COLORS, PartyBadge, districtHref, fmtInt } from '../components/common';
import { MiniMap } from '../components/MiniMap';

const COUNT_STATUS = ['Polls open', 'Too early to call', 'Too close to call', 'Projected', 'Projection withdrawn', 'Runoff projected'];
/** How a contest is decided (contest methods; Phase 7.1 adds ranked-choice voting and top-four primaries). */
const METHOD_LABEL: Record<string, string> = {
  rcv: 'Ranked-choice voting', top_two: 'Top-two primary', top_four: 'Top-four primary', majority: 'Majority required (runoff otherwise)',
  jungle: 'All-candidate ballot, majority required', top_two_general: 'General between the top-two finishers',
  np_majority: 'Nonpartisan primary (a majority wins outright)', np_final: 'Nonpartisan election, decided on primary day',
};

export function ContestScreen({ id }: { id: number }) {
  const c = useQuery<ContestDetail | null>({ kind: 'contest', id }, [id]);
  if (c === null) return <p className="muted">Loading…</p>;
  if (!c) return <p>No such contest.</p>;
  const valid = c.candidates.reduce((a, x) => a + (x.votes ?? 0), 0);
  // Short column labels: surnames, or Yes / No on a retention vote.
  const label = (x: { name: string; party: number }) => (c.retention ? (x.party === 0 ? 'No' : 'Yes') : surname(x.name));
  return (
    <>
      <a className="small" href={`#/results/${c.label.slice(0, 4)}`}>‹ {c.label.slice(0, 4)} results</a>
      <div className="kicker" style={{ marginTop: 8 }}>{c.electionLabel} · {c.date}</div>
      <h1 className="screen-title"><CodeLinks text={c.label.replace(/^\d{4} /, '')} style={{ color: 'inherit' }} /></h1>
      <p className="screen-sub">{c.office ?? 'President of the United States'}{c.districtLabel && <> · <a href={districtHref(c.districtLabel)}>{c.districtLabel} history</a></>}{c.stateIdx !== null && <> · <a href={`#/archive/${c.stateIdx}`}>{c.stateUsps} history</a></>}{c.ev ? ` · ${c.ev} electoral votes` : ''}
        {METHOD_LABEL[c.method] && <> · {METHOD_LABEL[c.method]}</>}{c.retention && <> · Retention vote: {Math.round(100 * c.retention.threshold)}% yes needed to keep the seat</>}{c.nonpartisan && !c.retention && <> · nonpartisan ballot</>}
        {c.nightId !== null && !c.counting && <> · <a href={`#/night/${c.nightId}`}>★ Watch this election night</a></>}
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
                <td>{c.retention && x.party === 0 ? <strong>{x.name}</strong> : <a href={`#/people/${x.personId}`} style={{ color: 'inherit', fontWeight: 600 }}>{x.name}</a>}{x.incumbent && <span className="badge" style={{ marginLeft: 6 }}>Incumbent</span>}{x.runningMate && <div className="tiny muted">with {x.runningMate}</div>}</td>
                <td>{c.retention && x.party === 0 ? '' : <PartyBadge party={x.party} />}</td>
                <td className="num">{x.votes !== null ? fmtInt(x.votes) : '—'}</td>
                <td className="num" style={{ width: 160 }}>{x.share !== null && <div className="row"><div style={{ flex: 1, height: 8, background: 'var(--bg-3)', borderRadius: 4 }}><div style={{ width: `${100 * x.share}%`, height: '100%', background: PARTY_COLORS[x.party], borderRadius: 4 }} /></div>{(100 * x.share).toFixed(1)}%</div>}</td>
                <td className="small">{c.retention ? (x.status === 'won' ? (x.party === 0 ? '✔ Not retained' : '✔ Retained') : '') : x.status === 'won' ? '✔ Won' : x.status === 'advanced' ? 'Advanced' : ''}</td>
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
          <p className="tiny muted">{c.note}{c.nonpartisan ? ' The ballot carried no party labels; parties shown are the candidates’ affiliations.' : ''}</p>
        </section>
        {c.method === 'rcv' && (
          <section className="card">
            <h2>Ranked-choice count</h2>
            {!c.rcv ? <p className="muted small">{c.counting || c.status === 'counting' ? 'The first choices are being counted. If nobody wins a majority of them, the ranked-choice count follows certification: the last-placed candidate is eliminated and those ballots move to their next choice, round by round.' : 'Not tabulated.'}</p> : (
              <>
                <table className="data">
                  <thead><tr><th>Candidate</th>{c.rcv.map((r) => <th key={r.round} className="num">Round {r.round}</th>)}</tr></thead>
                  <tbody>
                    {c.candidates.map((x) => (
                      <tr key={x.candidacyId}>
                        <td><span className="row">{!(c.retention && x.party === 0) && <PartyBadge party={x.party} />}{label(x)}</span></td>
                        {c.rcv!.map((r) => { const e = r.candidates.find((k) => k.candidacyId === x.candidacyId); const tot = r.candidates.reduce((a, k) => a + k.votes, 0);
                          return <td key={r.round} className="num small">{e ? <>{fmtInt(e.votes)} <span className="muted tiny">{tot ? `${(100 * e.votes / tot).toFixed(1)}%` : ''}</span>{e.status === 'elected' ? ' ✔' : e.status === 'eliminated' ? ' ✕' : ''}</> : <span className="muted">—</span>}</td>; })}
                      </tr>
                    ))}
                    <tr><td className="muted">Exhausted ballots</td>{c.rcv.map((r) => <td key={r.round} className="num small muted">{fmtInt(r.exhausted)}</td>)}</tr>
                  </tbody>
                </table>
                <p className="tiny muted">Shares are of the continuing ballots in each round. ✕: eliminated at the end of the round; their ballots moved to each voter’s next ranked candidate still in the count, or were exhausted (no further choice). ✔: the winner, with a majority of the continuing ballots.</p>
              </>
            )}
          </section>
        )}
        <section className="card">
          <h2>By method of voting</h2>
          {c.modes.length === 0 ? <p className="muted small">Not recorded for this contest.</p> : (
            <table className="data"><thead><tr><th>Method</th>{c.candidates.map((x) => <th key={x.candidacyId}>{label(x)}</th>)}</tr></thead>
              <tbody>{c.modes.map((m) => { const t = m.votes.reduce((a, b) => a + b, 0); return <tr key={m.mode}><td>{m.mode}</td>{m.votes.map((v, i) => <td key={i} className="num">{fmtInt(v)} <span className="muted tiny">{t ? `${(100 * v / t).toFixed(0)}%` : ''}</span></td>)}</tr>; })}</tbody></table>
          )}
          <p className="tiny muted">How these ballots were cast{c.counting ? ' (counted so far)' : ''}. On election night some states release early and mail ballots first, others count them last.</p>
        </section>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>By county <span className="muted small">{c.counties.length}</span>{c.nightId !== null && <a className="small" href={`#/night/${c.nightId}/analyst`}>Analyze the night ›</a>}</h2>
        {c.counties.length > 1 && <MiniMap counties={c.counties} parties={c.candidates.map((x) => x.party)} label={c.label} />}
        <div style={{ maxHeight: 520, overflow: 'auto', marginTop: 10 }}>
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
