import type { PersonDetail } from '../../engine/protocol';
import { formatDate } from '../../core/time';
import { useQuery } from './Desk';
import { Avatar, CodeLinks, PARTY_NAME, PartyBadge, PreSim, Truth } from '../components/common';

export function PersonScreen({ id }: { id: number }) {
  const p = useQuery<PersonDetail | null>({ kind: 'person', id }, [id]);
  if (p === null) return <p className="muted">Loading…</p>;
  if (!p) return <p>No such person.</p>;
  const current = p.terms.filter((t) => t.end === null);
  return (
    <>
      <a href="#/people" className="small">‹ All people</a>
      <div className="row" style={{ gap: 16, margin: '10px 0 16px' }}>
        <Avatar name={p.name} party={p.party} size={64} />
        <div>
          <h1 className="screen-title" style={{ margin: 0 }}>{p.fullName}</h1>
          <div className="row small"><PartyBadge party={p.party} /> <span>{PARTY_NAME[p.party]}</span><span className="muted">· {current[0]?.title ? <CodeLinks text={current[0].title} /> : (p.death ? 'Deceased' : 'No current office')}</span></div>
        </div>
      </div>
      <div className="grid cols-3">
        <section className="card">
          <h2>Profile</h2>
          <table className="data"><tbody>
            <tr><td className="muted">Born</td><td>{p.birth} {p.death ? `· died ${p.death}` : `(age ${p.age})`}</td></tr>
            <tr><td className="muted">Home</td><td>{[p.homeCounty, p.homeState].filter(Boolean).join(', ')}</td></tr>
            <tr><td className="muted">Sex</td><td>{p.sex}</td></tr>
            <tr><td className="muted">Race/ethnicity</td><td>{p.race}</td></tr>
            <tr><td className="muted">Detail tier</td><td>{p.tier} <span className="tiny muted">(A = national figure, B = major officeholder, C = local)</span></td></tr>
          </tbody></table>
          <p className="small">{p.bio}</p>
        </section>
        <section className="card">
          <h2>Offices</h2>
          {p.terms.length === 0 && <p className="muted">No offices held.</p>}
          {[...p.terms].reverse().map((t, i) => (
            <div key={i} className="news-item">
              <div className="h"><CodeLinks text={t.title} /></div>
              <div className="t">{formatDate(t.start)} – {t.end === null ? 'present' : formatDate(t.end)}{t.endReason ? ` (${t.endReason})` : ''}</div>
              <div className="small muted">{t.acquired} {t.provenance !== 'simulated' && <PreSim />}</div>
            </div>
          ))}
          {p.elections.length > 0 && <><h3>Electoral history</h3>
            <table className="data"><tbody>{p.elections.map((e) => (
              <tr key={e.contestId} className="click" onClick={() => { location.hash = `#/contest/${e.contestId}`; }}>
                <td className="num muted">{e.year}</td><td><a href={`#/contest/${e.contestId}`} style={{ color: 'inherit' }}>{e.label.replace(/^\d{4} /, '')}</a></td>
                <td className="num">{e.share !== null ? `${(100 * e.share).toFixed(1)}%` : ''}</td>
                <td className="small" style={{ color: e.result === 'won' ? 'var(--ok)' : e.result === 'lost' || e.result === 'eliminated' ? 'var(--text-2)' : undefined }}>{e.result}</td>
              </tr>))}</tbody></table></>}
          <h3>Career</h3>
          {p.career.map((c, i) => <div key={i} className="small" style={{ padding: '3px 0' }}><span className="muted num">{c.years}</span> {c.text}</div>)}
          <p className="tiny muted">Pre-simulation career facts are biographical background generated with the universe; the election archive begins with the first simulated election.</p>
        </section>
        <section className="card">
          <h2>Attributes <Truth>Hidden attributes</Truth></h2>
          {p.traits.map((t) => (
            <div key={t.label} className="trait"><span className="muted">{t.label}</span><div className="bar"><div style={{ width: `${Math.round(t.value * 100)}%` }} /></div><span className="num">{Math.round(t.value * 100)}</span></div>
          ))}
          <h3>Ideology (latent issue space)</h3>
          {p.ideology.map((t) => (
            <div key={t.axis} className="trait"><span className="muted">{t.axis}</span>
              <div className="bar" style={{ position: 'relative' }}><div style={{ position: 'absolute', left: `${50 + Math.max(-48, Math.min(48, t.value * 25))}%`, width: 4, background: 'var(--gold)' }} /></div>
              <span className="num">{t.value.toFixed(2)}</span></div>
          ))}
          <p className="tiny muted">These model attributes drive future behaviour (campaigns, careers) and are not public knowledge inside the universe.</p>
        </section>
      </div>
    </>
  );
}
