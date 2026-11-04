/** The presidential nominating contests: delegate tracker, calendar with results, candidates and conventions. */
import type { PrimariesDto, PrimaryPartyDto } from '../../engine/protocol';
import { useQuery } from './Desk';
import { go } from '../app/router';
import { PARTY_NAME, fmtInt } from '../components/common';
import { CANDIDATE_COLORS } from '../components/charts';
import { formatDay } from '../../core/time';

const EVENT: Record<string, string> = { primary: 'Primary', caucus: 'Caucuses', convention: 'State convention' };

export function PrimariesScreen({ year: yearParam }: { year?: number }) {
  const years = useQuery<number[]>({ kind: 'electionYears' });
  const presYears = (years ?? []).filter((y) => y % 4 === 0);
  const year = yearParam ?? presYears[0];
  const d = useQuery<PrimariesDto>(year ? { kind: 'primaries', year } : { kind: 'electionYears' }, [year]);
  if (!years) return <p className="muted">Loading…</p>;
  if (!year) return <><h1 className="screen-title">Presidential primaries</h1><p className="muted">The nominating contests begin in January of a presidential election year.</p></>;
  const data = d && 'parties' in (d as object) ? d : null;
  return (
    <>
      <div className="row between wrap">
        <div><div className="kicker">The road to the nominations</div><h1 className="screen-title">{year} presidential primaries</h1></div>
        <div className="row"><label className="small muted">Year</label><select value={year} onChange={(e) => go(`primaries/${e.target.value}`)} aria-label="Year">{presYears.map((y) => <option key={y}>{y}</option>)}</select><a className="btn small" href={`#/polls/${year}/races`}>Primary polls</a></div>
      </div>
      {!data ? <p className="muted">Loading…</p> : data.parties.length === 0 ? <p className="muted">No nominating contests in {year}.</p> : data.parties.map((p) => <PartyPanel key={p.party} p={p} />)}
      <p className="tiny muted">Delegate rules and the calendar follow each party's 2016 plans (approximate; territories and Democrats Abroad are outside the universe). Democratic superdelegates are the party's governors, members of Congress and DNC members; they may commit at any time and vote at the convention.</p>
    </>
  );
}

function PartyPanel({ p }: { p: PrimaryPartyDto }) {
  const color = new Map(p.candidates.map((c, i) => [c.personId, CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]!]));
  const name = (id: number | null) => p.candidates.find((c) => c.personId === id)?.name ?? '—';
  const done = p.calendar.filter((c) => c.status === 'decided' || c.status === 'certified');
  const next = p.calendar.find((c) => c.status === 'set');
  if (!p.open) return <section className="card" style={{ marginTop: 12 }}><h2>{PARTY_NAME[p.party]} nomination</h2><p className="small">{p.candidates[0]?.name ?? 'The incumbent'} was renominated without a contest.</p></section>;
  return (
    <section className="card" style={{ marginTop: 12 }}>
      <h2>{PARTY_NAME[p.party]} nomination{p.nominee !== null ? <span className="badge record">Nominee: {name(p.nominee)}</span> : p.presumptive !== null ? <span className="badge">Presumptive: {name(p.presumptive)}</span> : null}</h2>
      <div className="small muted">{fmtInt(p.total)} delegates · {fmtInt(p.needed)} needed{p.unbound ? ` · ${p.unbound} unbound so far` : ''} · {done.length} of {p.calendar.length} contests held{next ? ` · next: ${next.state}, ${formatDay(next.day)}` : ''}</div>
      <div className="pr-tracker" role="img" aria-label="Delegates by candidate against the majority">
        {p.candidates.filter((c) => c.pledged + c.supers > 0).map((c) => (
          <div key={c.personId} className="pr-row">
            <span className="pr-name small">{c.name}{c.status === 'withdrew' && <span className="tiny muted"> · withdrew</span>}</span>
            <div className="pr-bar"><div style={{ width: `${(100 * c.pledged) / p.total}%`, background: color.get(c.personId) }} /><div style={{ width: `${(100 * c.supers) / p.total}%`, background: color.get(c.personId), opacity: 0.45 }} /><span className="pr-need" style={{ left: `${(100 * p.needed) / p.total}%` }} /></div>
            <span className="num small">{fmtInt(c.pledged)}{c.supers ? <span className="muted"> +{c.supers}</span> : null}</span>
          </div>
        ))}
      </div>
      <div className="tiny muted">Solid: pledged delegates won; light: superdelegates committed. The gold line is the majority.</div>
      <h3>Candidates</h3>
      <table className="data"><thead><tr><th>Candidate</th><th>Status</th><th>Delegates</th><th>States won</th><th>Endorsements</th></tr></thead><tbody>
        {p.candidates.map((c) => <tr key={c.personId} className="click" onClick={() => go(`people/${c.personId}`)}><td className="small"><span className="party-dot" style={{ background: color.get(c.personId) }} /> {c.name}</td><td className="small muted">{c.status === 'running' ? 'running' : c.status === 'won' ? 'nominee' : c.status}</td><td className="num small">{fmtInt(c.pledged + c.supers)}</td><td className="num small">{c.wins}</td><td className="num small">{c.endorsements}</td></tr>)}
      </tbody></table>
      {p.ballots.length > 0 && <><h3>Convention {Math.max(...p.ballots.map((b) => b.ballot)) > 1 ? `· ${Math.max(...p.ballots.map((b) => b.ballot))} ballots` : '· first ballot'}</h3>
        <table className="data"><thead><tr><th>Ballot</th>{[...new Set(p.ballots.map((b) => b.personId))].map((id) => <th key={id}>{name(id).split(' ').slice(-1)[0]}</th>)}</tr></thead><tbody>
          {[...new Set(p.ballots.map((b) => b.ballot))].map((k) => <tr key={k}><td className="num">{k}</td>{[...new Set(p.ballots.map((b) => b.personId))].map((id) => <td key={id} className="num small">{fmtInt(p.ballots.find((b) => b.ballot === k && b.personId === id)?.votes ?? 0)}</td>)}</tr>)}
        </tbody></table></>}
      <h3>Calendar and results</h3>
      <div className="rx-table" style={{ maxHeight: 480 }}><table className="data"><thead><tr><th>Date</th><th>State</th><th>Contest</th><th>Delegates</th><th>Winner</th><th>Results</th></tr></thead><tbody>
        {p.calendar.map((c) => (
          <tr key={c.contestId} className="click" onClick={() => go(`contest/${c.contestId}`)}>
            <td className="small num muted">{formatDay(c.day).replace(/, \d{4}$/, '')}</td><td className="small">{c.state}</td><td className="small muted">{EVENT[c.event] ?? c.event}</td><td className="num small">{c.delegates}</td>
            <td className="small">{c.winner !== null ? <><span className="party-dot" style={{ background: color.get(c.winner) }} /> {name(c.winner)}</> : <span className="muted">{c.status === 'set' ? 'upcoming' : '—'}</span>}</td>
            <td className="small">{c.results.slice(0, 3).map((r) => <span key={r.personId} style={{ marginRight: 8, whiteSpace: 'nowrap' }}>{name(r.personId).split(' ').slice(-1)[0]} {(100 * r.share).toFixed(0)}%{r.delegates ? ` (${r.delegates})` : ''}</span>)}</td>
          </tr>
        ))}
      </tbody></table></div>
    </section>
  );
}
