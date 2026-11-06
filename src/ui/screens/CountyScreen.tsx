import { useMemo, useState } from 'react';
import type { CountyHistoryDto, GeoMeta, StateHistoryDto } from '../../engine/protocol';
import { useQuery } from './Desk';
import { PartyBadge, districtHref, fmtLean } from '../components/common';
import { HISTORY_OFFICES, HistoryTable, PresidentialTable } from './DistrictScreen';

export function CountyScreen({ idx }: { idx: number }) {
  const h = useQuery<CountyHistoryDto>({ kind: 'countyHistory', county: idx }, [idx]);
  const [office, setOffice] = useState('');
  const rows = useMemo(() => (h ? h.rows.filter((r) => (HISTORY_OFFICES.find((o) => o[0] === office) ?? HISTORY_OFFICES[0]!)[2](r.officeKind)) : []), [h, office]);
  if (!h) return <p className="muted">Loading…</p>;
  return (
    <>
      <a className="small" href={`#/archive/${h.stateIdx}`}>‹ {h.state}</a>
      <div className="kicker" style={{ marginTop: 8 }}>County election history</div>
      <h1 className="screen-title">{h.name}, {h.state}</h1>
      <p className="screen-sub">Every simulated election on this county's ballots. Figures are exact sums of the archived Census block-group results.
        {h.districts.length > 0 && <> Congressional district{h.districts.length > 1 ? 's' : ''} today: {h.districts.map((d, i) => <span key={d}>{i > 0 && ', '}<a href={districtHref(d)}>{d}</a></span>)}.</>}</p>
      <PresidentialTable rows={h.rows} where="here" />
      <section className="card">
        <div className="row between"><h2>All contests</h2><select aria-label="Office" value={office} onChange={(e) => setOffice(e.target.value)}>{HISTORY_OFFICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <HistoryTable rows={rows} empty={`No archived elections yet${office ? ' for this office' : ''}.`} />
        <p className="tiny muted">✔ marks the overall winner of the contest (not necessarily this county's leader).</p>
      </section>
    </>
  );
}

export function ArchiveScreen({ stateIdx }: { stateIdx?: number }) {
  const meta = useQuery<GeoMeta>({ kind: 'geoMeta' });
  if (!meta) return <p className="muted">Loading…</p>;
  if (stateIdx === undefined) return (
    <>
      <div className="kicker">Historical archive</div>
      <h1 className="screen-title">Archive</h1>
      <p className="screen-sub">Choose a state for its election history, its congressional districts and its counties; each district and county has its own history. Results by contest are on the <a href="#/results">Results</a> screen.</p>
      <section className="card"><div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 6 }}>
        {meta.states.map((s) => <a key={s.idx} className="btn small" href={`#/archive/${s.idx}`}>{s.name}</a>)}
      </div></section>
    </>
  );
  return <StateHistory stateIdx={stateIdx} />;
}

function StateHistory({ stateIdx }: { stateIdx: number }) {
  const h = useQuery<StateHistoryDto>({ kind: 'stateHistory', state: stateIdx }, [stateIdx]);
  const [filter, setFilter] = useState('');
  const [office, setOffice] = useState('');
  const rows = useMemo(() => (h ? h.rows.filter((r) => (HISTORY_OFFICES.find((o) => o[0] === office) ?? HISTORY_OFFICES[0]!)[2](r.officeKind)) : []), [h, office]);
  if (!h) return <p className="muted">Loading…</p>;
  const counties = h.counties.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <a className="small" href="#/archive">‹ All states</a>
      <div className="kicker" style={{ marginTop: 8 }}>State election history</div>
      <h1 className="screen-title">{h.name}</h1>
      <p className="screen-sub">Statewide results of every simulated election, the state’s congressional districts and its counties. Click a district or a county for its own history.</p>
      <PresidentialTable rows={h.rows} where="statewide" />
      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Congressional districts</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6 }}>
          {h.districts.map((d) => (
            <a key={d.code} className="btn small" href={districtHref(d.code)} style={{ justifyContent: 'flex-start', gap: 6 }}>
              <strong>{d.code}</strong>{d.holder && <PartyBadge party={d.holder.party} />}<span className="tiny muted">{fmtLean(d.lean)}</span>
            </a>
          ))}
        </div>
        <p className="tiny muted">Today’s districts, the party holding each seat and its underlying lean (simulation truth).</p>
      </section>
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="row between"><h2>Statewide contests</h2><select aria-label="Office" value={office} onChange={(e) => setOffice(e.target.value)}>{HISTORY_OFFICES.filter(([v]) => v !== 'us_representative' && v !== 'legislature').map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <HistoryTable rows={rows} empty={`No archived statewide elections yet${office ? ' for this office' : ''}.`} />
      </section>
      <section className="card">
        <div className="row between"><h2>Counties</h2><input type="search" placeholder="Filter counties…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 240 }} /></div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, marginTop: 8 }}>
          {counties.map((c) => <a key={c.idx} href={`#/county/${c.idx}`}>{c.name}</a>)}
        </div>
      </section>
    </>
  );
}
