import { useState } from 'react';
import type { PersonRow } from '../../engine/protocol';
import { useQuery } from './Desk';
import { CodeLinks, PartyBadge } from '../components/common';
import { go } from '../app/router';

const OFFICE_FILTERS: [string, string][] = [
  ['', 'All people'], ['president,vice_president,cabinet', 'Executive branch'], ['us_senator', 'U.S. Senators'], ['us_representative', 'U.S. Representatives'],
  ['governor', 'Governors'], ['lt_governor,attorney_general,secretary_of_state,treasurer,auditor,superintendent,insurance_commissioner,agriculture_commissioner,labor_commissioner,land_commissioner,other_statewide', 'Statewide officers'],
  ['commissioner,education_board,regent', 'Commissions and boards'], ['justice,appellate_judge', 'Judges'],
  ['congress_leader,state_leg_leader', 'Legislative leaders'], ['state_senator', 'State senators'], ['state_representative', 'State representatives'],
];

export function People() {
  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [party, setParty] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE = 100;
  const data = useQuery<{ total: number; rows: PersonRow[] }>({ kind: 'people', search, office: office || undefined, party: party || undefined, limit: PAGE, offset: page * PAGE });
  return (
    <>
      <div className="kicker">Politicians</div>
      <h1 className="screen-title">People</h1>
      <p className="screen-sub">Every person in this universe has a persistent identity and career. All are fictional.</p>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <input type="search" placeholder="Search name or office…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} style={{ width: 280 }} aria-label="Search people" />
        <select value={office} onChange={(e) => { setOffice(e.target.value); setPage(0); }} aria-label="Office">{OFFICE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select value={party} onChange={(e) => { setParty(Number(e.target.value)); setPage(0); }} aria-label="Party"><option value={0}>All parties</option><option value={1}>Democratic</option><option value={2}>Republican</option></select>
        <span className="muted small">{data ? `${data.total.toLocaleString()} people` : ''}</span>
      </div>
      <section className="card">
        <table className="data">
          <thead><tr><th>Name</th><th>Party</th><th>Current office</th><th>Home</th><th>Age</th><th>Tier</th></tr></thead>
          <tbody>
            {data?.rows.map((p) => (
              <tr key={p.id} className="click" onClick={() => go(`people/${p.id}`)}>
                <td><a href={`#/people/${p.id}`} style={{ color: 'inherit', fontWeight: 600 }}>{p.name}</a>{p.dead && <span className="muted small"> (deceased)</span>}</td>
                <td><PartyBadge party={p.party} /></td><td>{p.office ? <CodeLinks text={p.office} /> : <span className="muted">—</span>}</td><td>{p.stateUsps}</td><td className="num">{p.age}</td><td className="muted">{p.tier}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.total > PAGE && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Previous</button>
            <span className="small muted">Page {page + 1} of {Math.ceil(data.total / PAGE)}</span>
            <button className="btn small" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Next ›</button>
          </div>
        )}
      </section>
    </>
  );
}
