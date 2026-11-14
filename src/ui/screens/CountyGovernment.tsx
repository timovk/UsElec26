/**
 * County government (Phase 7.6): a county's elected boards and offices, the prosecutors' districts covering it and
 * its local news (on the county page), and every state's county government at a glance (on the Government screen).
 */
import { useState } from 'react';
import type { CountyGovernmentDto, CountyOverviewDto, CountySeatDto } from '../../engine/protocol';
import { useQuery } from './Desk';
import { go } from '../app/router';
import { PARTY_ABBR, PARTY_COLORS, PartyBadge, SeatBar } from '../components/common';
import { formatDate } from '../../core/time';

const SCOPE_TEXT: Record<CountyGovernmentDto['scope'], string> = {
  all: 'every county', major: 'counties of 250,000 people or more', off: 'no county',
};

function Holder({ s }: { s: CountySeatDto }) {
  if (!s.holder) return <span className="muted">vacant</span>;
  return <><a href={`#/people/${s.holder.id}`}>{s.holder.name}</a> <PartyBadge party={s.holder.party} /></>;
}

const BY_TEXT: Record<string, string> = { district: 'by district', at_large: 'at large', residency: 'countywide, each living in their district', single: 'countywide' };

/** A board seat under its board's heading: "District 3", "Seat 2" (the title's last part), or the whole title. */
const seatLabel = (title: string): string => {
  const last = title.split(', ').pop() ?? title;
  return /^(District|seat) /i.test(last) ? last[0]!.toUpperCase() + last.slice(1) : title;
};

const since = (s: CountySeatDto) => (s.since !== null ? formatDate(s.since) : '—');

export function CountyGovernmentSection({ county }: { county: number }) {
  const d = useQuery<CountyGovernmentDto>({ kind: 'countyGovernment', county }, [county]);
  if (!d) return null;
  const elected = d.bodies.length + d.offices.length + d.districtOffices.length > 0;
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>County government</h2>
      {!d.inScope && (
        <p className="small muted">This universe simulates the elected government of {SCOPE_TEXT[d.scope]} (Settings, County offices){d.scope === 'off' ? '.' : `; ${d.name} is not one of them.`}
          {elected && ' The offices below are its 2016 holders, kept as they were.'}</p>
      )}
      {d.note && <p className="small">{d.note}</p>}
      {d.bodies.map((b) => (
        <div key={b.key} style={{ marginTop: 10 }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <strong>{b.name}</strong>
            <span>{b.byParty.map((x) => <span key={x.party} className="small" style={{ marginRight: 10 }}><span className="party-dot" style={{ background: PARTY_COLORS[x.party] }} /> {PARTY_ABBR[x.party] ?? '—'} {x.seats}</span>)}</span>
          </div>
          <div className="tiny muted" style={{ margin: '2px 0 6px' }}>{b.seats.length} seats, elected {BY_TEXT[b.by] ?? b.by} for {b.term}-year terms</div>
          <SeatBar composition={b.byParty} seats={b.seats.length} />
          <table className="data" style={{ marginTop: 6 }}>
            <thead><tr><th>Seat</th><th>Member</th><th>Since</th><th>How they got the seat</th><th className="num">Next election</th></tr></thead>
            <tbody>{b.seats.map((s) => (
              <tr key={s.officeId}><td className="small">{seatLabel(s.title)}</td><td><Holder s={s} /></td><td className="small">{since(s)}</td><td className="tiny">{s.acquired ?? '—'}</td><td className="num small">{s.nextElection ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      {d.offices.length > 0 && (
        <table className="data" style={{ marginTop: 12 }}>
          <thead><tr><th>Office</th><th>Holder</th><th>Since</th><th>How they got the office</th><th className="num">Next election</th></tr></thead>
          <tbody>{d.offices.map((s) => (
            <tr key={s.officeId}><td className="small">{s.title}</td><td><Holder s={s} /></td><td className="small">{since(s)}</td><td className="tiny">{s.acquired ?? '—'}</td><td className="num small">{s.nextElection ?? '—'}</td></tr>
          ))}</tbody>
        </table>
      )}
      {d.districtOffices.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Districts covering {d.name}</h3>
          <table className="data">
            <thead><tr><th>Office</th><th>District</th><th>Holder</th><th>Since</th><th className="num">Next election</th></tr></thead>
            <tbody>{d.districtOffices.map((s) => (
              <tr key={s.officeId}><td className="small">{s.title}</td><td className="small">{s.districtName}</td><td><Holder s={s} /></td><td className="small">{since(s)}</td><td className="num small">{s.nextElection ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
      {d.news.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Local news</h3>
          {d.news.map((n) => (
            <div key={n.id} className="news-item">
              <div className="tiny muted">{formatDate(n.time)}</div>
              <div className="small"><strong>{n.headline}</strong></div>
              {n.body && <div className="tiny muted">{n.body}</div>}
            </div>
          ))}
        </>
      )}
      <p className="tiny muted" style={{ marginTop: 10 }}>The 2016 baseline of the state’s county law (which offices are elected, terms, board sizes); board districts are drawn by the simulation and redrawn after each census.</p>
    </section>
  );
}

const tallyText = (t: { d: number; r: number; other: number }) => (
  <span className="small">{t.d + t.r + t.other === 0 ? <span className="muted">—</span> : <>
    <span style={{ color: PARTY_COLORS[1] }}>D {t.d}</span> · <span style={{ color: PARTY_COLORS[2] }}>R {t.r}</span>{t.other > 0 && <> · other {t.other}</>}</>}</span>
);

/** Every state's county government at a glance (Government screen). */
export function CountyOverviewPanel() {
  const d = useQuery<CountyOverviewDto>({ kind: 'countyOverview' });
  const [sort, setSort] = useState<'name' | 'seats'>('name');
  if (!d) return <p className="muted">Loading…</p>;
  if (d.scope === 'off') return <section className="card"><h2>County government</h2><p className="small muted">County offices are switched off in this universe (Settings, County offices).</p></section>;
  const rows = d.states.slice().sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b.seats - a.seats));
  const total = d.states.reduce((a, s) => ({ seats: a.seats + s.seats, d: a.d + s.boards.d, r: a.r + s.boards.r, split: a.split + s.boards.split }), { seats: 0, d: 0, r: 0, split: 0 });
  return (
    <section className="card">
      <div className="row between wrap"><h2>County government</h2>
        <div className="seg">{(['name', 'seats'] as const).map((k) => <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{k === 'name' ? 'By state' : 'Most seats'}</button>)}</div></div>
      <p className="small muted">Elected county offices in {SCOPE_TEXT[d.scope]}: {total.seats.toLocaleString('en-US')} seats. County boards by majority: <span style={{ color: PARTY_COLORS[1] }}>Democratic {total.d}</span>, <span style={{ color: PARTY_COLORS[2] }}>Republican {total.r}</span>, split or nonpartisan {total.split}. Choose a state for its counties; each county page lists its officeholders.</p>
      <table className="data">
        <thead><tr><th>State</th><th className="num">Counties</th><th className="num">Seats</th><th>Boards (majority)</th><th>Executives and judges</th><th>Sheriffs</th><th>Prosecutors</th></tr></thead>
        <tbody>{rows.map((s) => (
          <tr key={s.stateIdx} className="click" onClick={() => go(`archive/${s.stateIdx}`)}>
            <td>{s.name}</td><td className="num small">{s.counties}</td><td className="num small">{s.seats.toLocaleString('en-US')}</td>
            <td className="small">{s.boards.d + s.boards.r + s.boards.split === 0 ? <span className="muted">—</span> : <><span style={{ color: PARTY_COLORS[1] }}>D {s.boards.d}</span> · <span style={{ color: PARTY_COLORS[2] }}>R {s.boards.r}</span>{s.boards.split > 0 && <> · split {s.boards.split}</>}</>}</td>
            <td>{tallyText(s.executives)}</td><td>{tallyText(s.sheriffs)}</td><td>{tallyText(s.prosecutors)}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="tiny muted">Party of each officeholder, also where the ballot is nonpartisan (the party they belong to). A board is split when no party holds a majority of its seats.</p>
    </section>
  );
}
