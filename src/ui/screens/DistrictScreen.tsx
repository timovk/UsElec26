/**
 * Election history of a congressional district, by its code (TX-15): who holds it, the counties it covers today,
 * its House elections, and every federal and statewide contest's result within the district as it was drawn at
 * the time (after redistricting, the same number is a different area).
 */
import { useMemo, useState } from 'react';
import type { DistrictHistoryDto, HistoryRow } from '../../engine/protocol';
import { COUNTY_OFFICE_KINDS } from '../../engine/protocol';
import { useQuery } from './Desk';
import { PARTY_COLORS, PartyBadge, fmtInt, fmtLean } from '../components/common';
import { go } from '../app/router';
import { formatDate } from '../../core/time';

/** Presidential results by year, with the shift from the previous election (positive: toward the Democrats). */
export function PresidentialTable({ rows, where }: { rows: HistoryRow[]; where: string }) {
  const pres = rows.filter((r) => r.officeKind === 'president' && r.dMargin !== null).sort((a, b) => a.year - b.year);
  if (!pres.length) return null;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2>Presidential elections</h2>
      <table className="data"><thead><tr><th>Year</th><th>Winner {where}</th><th>Two-party margin</th><th>Shift vs previous</th><th>Votes cast</th></tr></thead>
        <tbody>{pres.map((r, i) => { const prev = pres[i - 1]; const w = r.candidates[0]!; return (
          <tr key={r.contestId} className="click" onClick={() => go(`contest/${r.contestId}`)}>
            <td className="num">{r.year}</td><td><PartyBadge party={w.party} /> {w.name}</td>
            <td className="num" style={{ color: (r.dMargin ?? 0) >= 0 ? 'var(--dem-2)' : 'var(--rep-2)' }}>{fmtLean(r.dMargin!)}</td>
            <td className="num">{prev ? `${(r.dMargin! - prev.dMargin!) >= 0 ? '→ D' : '→ R'} ${Math.abs(r.dMargin! - prev.dMargin!).toFixed(1)}` : '—'}</td>
            <td className="num">{fmtInt(r.total)}</td>
          </tr>); })}</tbody></table>
      <p className="tiny muted">Shift = change in (D − R)/(D + R) from the previous presidential election, in points.</p>
    </section>
  );
}

/** A table of contests and their results in one area. */
export function HistoryTable({ rows, empty }: { rows: HistoryRow[]; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <table className="data">
      <thead><tr><th>Date</th><th>Contest</th><th>Result here</th><th>Margin</th><th>Votes</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.contestId} className="click" onClick={() => go(`contest/${r.contestId}`)}>
          <td className="num muted">{r.date}</td><td>{r.label.replace(/^\d{4} /, '')}</td>
          <td>{r.candidates.slice(0, 3).map((c) => <span key={c.name} style={{ marginRight: 12 }}><span style={{ color: PARTY_COLORS[c.party], fontWeight: c.winner ? 700 : 400 }}>{c.name}</span> <span className="muted tiny">{(100 * c.share).toFixed(1)}%{c.winner ? ' ✔' : ''}</span></span>)}</td>
          <td className="num">{r.dMargin !== null ? fmtLean(r.dMargin) : '—'}</td><td className="num muted">{fmtInt(r.total)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/** Office filter options for history tables. */
export const HISTORY_OFFICES: [string, string, (k: string) => boolean][] = [
  ['', 'All offices', () => true], ['president', 'President', (k) => k === 'president'], ['us_senator', 'U.S. Senate', (k) => k === 'us_senator'],
  ['us_representative', 'U.S. House', (k) => k === 'us_representative'], ['governor', 'Governor', (k) => k === 'governor'],
  ['statewide', 'Other statewide offices', (k) => ['lt_governor', 'attorney_general', 'secretary_of_state', 'treasurer', 'auditor', 'superintendent', 'insurance_commissioner', 'agriculture_commissioner', 'labor_commissioner', 'land_commissioner', 'other_statewide'].includes(k)],
  ['boards', 'Commissions and boards', (k) => ['commissioner', 'education_board', 'regent'].includes(k)],
  ['courts', 'Courts', (k) => k === 'justice' || k === 'appellate_judge'],
  ['legislature', 'State legislature', (k) => k === 'state_senator' || k === 'state_representative'],
  ['measures', 'Ballot measures', (k) => k === 'ballot_measure'],
  ['county', 'County offices', (k) => (COUNTY_OFFICE_KINDS as readonly string[]).includes(k)],
];

const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };

export function DistrictScreen({ code }: { code: string }) {
  const h = useQuery<DistrictHistoryDto>({ kind: 'districtHistory', code }, [code]);
  const [office, setOffice] = useState('');
  const rows = useMemo(() => (h ? h.rows.filter((r) => (HISTORY_OFFICES.find((o) => o[0] === office) ?? HISTORY_OFFICES[0]!)[2](r.officeKind)) : []), [h, office]);
  if (!h) return <p className="muted">Loading…</p>;
  if (!h.found) return <p>No congressional district “{code}”. District codes look like TX-15, or WY-AL for an at-large seat.</p>;
  const house = h.rows.filter((r) => r.officeKind === 'us_representative');
  return (
    <>
      <a className="small" href={`#/archive/${h.stateIdx}`}>‹ {h.state}</a>
      <div className="kicker" style={{ marginTop: 8 }}>Congressional district history</div>
      <h1 className="screen-title">{h.code}</h1>
      <p className="screen-sub">{h.state}’s {h.number === 0 ? 'at-large district' : `${ordinal(h.number)} district`}: every simulated election on its ballots, with results within the district as it was drawn at the time.</p>
      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Today</h2>
          {h.now ? (
            <table className="data"><tbody>
              <tr><td className="muted">Representative</td><td>{h.now.holder ? <><a href={`#/people/${h.now.holder.personId}`}>{h.now.holder.name}</a> <PartyBadge party={h.now.holder.party} /> <span className="tiny muted">since {formatDate(h.now.holder.since)}</span></> : <span className="muted">vacant</span>}</td></tr>
              <tr><td className="muted">Underlying lean</td><td>{fmtLean(h.now.lean)} <span className="tiny muted">(simulation truth)</span></td></tr>
              <tr><td className="muted">Boundaries</td><td className="small">{h.now.plan}</td></tr>
              <tr><td className="muted">Counties</td><td className="small">{h.now.counties.map((c, i) => <span key={c.idx}>{i > 0 && ', '}<a href={`#/county/${c.idx}`}>{c.name}</a>{c.share < 0.995 && <span className="tiny muted"> {(100 * c.share).toFixed(0)}%</span>}</span>)}</td></tr>
            </tbody></table>
          ) : <p className="muted small">{h.state} no longer has a district numbered {h.number}; its elections are below.</p>}
          {h.plans.length > 1 && <p className="tiny muted">Drawn {h.plans.length} times: {h.plans.map((p) => p.label).join('; ')}. Each election below uses the district as drawn for it.</p>}
        </section>
        <section className="card">
          <h2>House elections</h2>
          {house.length === 0 ? <p className="muted small">No House election archived yet.</p> : (
            <table className="data"><thead><tr><th>Year</th><th>Winner</th><th>Margin</th></tr></thead>
              <tbody>{house.map((r) => { const w = r.candidates.find((c) => c.winner) ?? r.candidates[0]!; const second = r.candidates.find((c) => c !== w); return (
                <tr key={r.contestId} className="click" onClick={() => go(`contest/${r.contestId}`)}>
                  <td className="num">{r.year}{/special/i.test(r.label) ? ' (special)' : ''}</td><td><PartyBadge party={w.party} /> {w.name} <span className="tiny muted">{(100 * w.share).toFixed(1)}%</span></td>
                  <td className="num">{second ? `${(100 * (w.share - second.share)).toFixed(1)} pts` : 'unopposed'}</td>
                </tr>); })}</tbody></table>
          )}
        </section>
      </div>
      <PresidentialTable rows={h.rows} where="in the district" />
      <section className="card">
        <div className="row between"><h2>Every contest in the district</h2><select aria-label="Office" value={office} onChange={(e) => setOffice(e.target.value)}>{HISTORY_OFFICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <HistoryTable rows={rows} empty={`No archived elections yet${office ? ' for this office' : ''}.`} />
        <p className="tiny muted">Results within the district as it was drawn for each election (ballots as cast). ✔ marks the overall winner of the contest, not necessarily the district's leader. Statewide contests are included; state legislative seats and board districts, which cross district lines, are not.</p>
      </section>
    </>
  );
}
