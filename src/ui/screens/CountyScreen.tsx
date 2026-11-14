import { useMemo, useState } from 'react';
import type { CountyHistoryDto, GeoMeta, StateHistoryDto, TownHistoryDto } from '../../engine/protocol';
import { useQuery } from './Desk';
import { PartyBadge, districtHref, fmtLean } from '../components/common';
import { HISTORY_OFFICES, HistoryTable, PresidentialTable } from './DistrictScreen';
import { CountyGovernmentSection } from './CountyGovernment';

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
      <CountyGovernmentSection county={idx} />
      {h.towns.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Towns</h2>
          <p className="small muted">New England reports its results by town: each has its own election history.</p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6, marginTop: 8 }}>
            {h.towns.map((t) => <a key={t.rj} href={`#/town/${t.rj}`}>{t.name}</a>)}
          </div>
        </section>
      )}
    </>
  );
}

/** A New England town or an Alaska State House district (Phase 7.5): the units these states report results by. */
export function TownScreen({ rj }: { rj: number }) {
  const h = useQuery<TownHistoryDto>({ kind: 'townHistory', rj }, [rj]);
  const [office, setOffice] = useState('');
  const rows = useMemo(() => (h ? h.rows.filter((r) => (HISTORY_OFFICES.find((o) => o[0] === office) ?? HISTORY_OFFICES[0]!)[2](r.officeKind)) : []), [h, office]);
  if (!h) return <p className="muted">Loading…</p>;
  if (!h.found) return <p>No such town or district.</p>;
  const town = h.kind === 'town';
  return (
    <>
      <a className="small" href={h.county ? `#/county/${h.county.idx}` : `#/archive/${h.stateIdx}`}>‹ {h.county ? h.county.name : h.state}</a>
      <div className="kicker" style={{ marginTop: 8 }}>{town ? 'Town election history' : 'Alaska House district election history'}</div>
      <h1 className="screen-title">{town ? `${h.name}, ${h.state}` : `Alaska ${h.name}`}</h1>
      <p className="screen-sub">
        {town ? <>A town in {h.county?.name ?? h.state}. New England reports its results town by town; </> : <>Alaska reports its results by State House district (as drawn for 2016, the districts the count uses); </>}
        these are this {town ? 'town' : 'district'}'s votes in every simulated election on its ballots. Population (2010): {h.pop2010.toLocaleString('en-US')}.
        {h.districts.length > 0 && <> Congressional district{h.districts.length > 1 ? 's' : ''} today: {h.districts.map((d, i) => <span key={d}>{i > 0 && ', '}<a href={districtHref(d)}>{d}</a></span>)}.</>}</p>
      <PresidentialTable rows={h.rows} where="here" />
      <section className="card">
        <div className="row between"><h2>All contests</h2><select aria-label="Office" value={office} onChange={(e) => setOffice(e.target.value)}>{HISTORY_OFFICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <HistoryTable rows={rows} empty={`No archived elections yet${office ? ' for this office' : ''}.`} />
        <p className="tiny muted">✔ marks the overall winner of the contest (not necessarily this {town ? "town's" : "district's"} leader).</p>
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
      {h.units.length > 0 && <UnitsTable h={h} />}
      <section className="card">
        <div className="row between"><h2>Counties</h2><input type="search" placeholder="Filter counties…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 240 }} /></div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, marginTop: 8 }}>
          {counties.map((c) => <a key={c.idx} href={`#/county/${c.idx}`}>{c.name}</a>)}
        </div>
      </section>
    </>
  );
}

/** A state's towns (New England) or Alaska's House districts, with the last presidential result in each (Phase 7.5). */
function UnitsTable({ h }: { h: StateHistoryDto }) {
  const [filter, setFilter] = useState('');
  const town = h.units[0]?.kind === 'town';
  const list = h.units.filter((x) => `${x.name} ${x.county ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  const year = h.units.find((x) => x.year !== null)?.year ?? null;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row between"><h2>{town ? 'Towns' : 'House districts'}</h2><input type="search" placeholder={town ? 'Filter towns…' : 'Filter districts…'} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 240 }} /></div>
      <p className="small muted">{town ? `${h.name} reports its results by town` : 'Alaska reports its results by State House district (as drawn for 2016)'}; each has its own history.{year !== null && ` Margin: the ${year} presidential result there.`}</p>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="data"><thead><tr><th>{town ? 'Town' : 'District'}</th>{town && <th>County</th>}<th className="num">Population (2010)</th><th className="num">Margin</th></tr></thead>
          <tbody>{list.map((x) => (
            <tr key={x.rj} className="click" onClick={() => { location.hash = `#/town/${x.rj}`; }}>
              <td><a href={`#/town/${x.rj}`} style={{ color: 'inherit' }}>{x.name}</a></td>{town && <td className="small muted">{x.county}</td>}
              <td className="num">{x.pop.toLocaleString('en-US')}</td><td className="num">{x.dMargin !== null ? fmtLean(x.dMargin) : '—'}</td>
            </tr>
          ))}</tbody></table>
      </div>
    </section>
  );
}
