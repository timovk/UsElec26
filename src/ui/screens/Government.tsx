/**
 * Government (Phase 6): presidential approval and the economy as published (with the simulation's truth set
 * apart), Congress (bills, roll calls and the yearly record), the state legislatures, the census and
 * apportionment, every district plan drawn in this universe, (Phase 7.1) each state's election law over time, and
 * (Phase 7.2) each state's down-ballot offices, elected boards and courts, and (Phase 7.3) every ballot measure.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BillDto, CensusDto, CongressDto, DistrictMapDto, EconomyDto, ElectionLawDto, GeoMeta, LegislaturesDto, MeasureListDto, StateOfficesDto } from '../../engine/protocol';
import { useQuery } from './Desk';
import { go } from '../app/router';
import { PARTY_ABBR, PARTY_COLORS, PARTY_NAME, PartyBadge, SeatBar, Truth, fmtInt, fmtLean } from '../components/common';
import { CANDIDATE_COLORS, TimeChart, type Dot, type Series } from '../components/charts';
import { marginColor } from '../map/renderer';
import { civilToDays, daysToCivil, easternDay, formatDate, formatDay } from '../../core/time';
import { useApp } from '../state/store';

const TABS = [
  { id: 'economy', label: 'Approval & economy' }, { id: 'congress', label: 'Congress' }, { id: 'legislatures', label: 'State legislatures' },
  { id: 'offices', label: 'State offices & courts' }, { id: 'census', label: 'Census & apportionment' }, { id: 'districts', label: 'District maps' }, { id: 'measures', label: 'Ballot measures' }, { id: 'law', label: 'Election law' },
] as const;

export function GovernmentScreen({ tab: tabParam, args }: { tab?: string; args: string[] }) {
  const tab = TABS.find((t) => t.id === tabParam)?.id ?? (tabParam === 'bill' ? 'bill' : 'economy');
  return (
    <>
      <div className="kicker">Between elections · Public Record</div>
      <h1 className="screen-title">Government</h1>
      <div className="seg" role="tablist" aria-label="Government" style={{ margin: '8px 0 12px' }}>
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id || (tab === 'bill' && t.id === 'congress')} className={tab === t.id || (tab === 'bill' && t.id === 'congress') ? 'on' : ''} onClick={() => go(`government/${t.id}`)}>{t.label}</button>)}
      </div>
      {tab === 'economy' ? <EconomyPanel />
        : tab === 'congress' ? <CongressPanel congress={args[0] ? Number(args[0]) : undefined} />
        : tab === 'bill' ? <BillView id={Number(args[0])} />
        : tab === 'legislatures' ? <LegislaturesPanel />
        : tab === 'census' ? <CensusPanel />
        : tab === 'law' ? <ElectionLawPanel />
        : tab === 'offices' ? <StateOfficesPanel state={args[0] !== undefined ? Number(args[0]) : undefined} />
        : tab === 'measures' ? <MeasuresPanel year={args[0] ? Number(args[0]) : undefined} />
        : <DistrictsPanel state={args[0] !== undefined ? Number(args[0]) : undefined} plan={(args[1] as 'cd' | 'sldu' | 'sldl' | undefined) ?? 'cd'} year={args[2] ? Number(args[2]) : undefined} />}
    </>
  );
}

// ---- Approval and the economy --------------------------------------------------------------------------------

const RELEASE: Record<string, { label: string; unit: string }> = { unemployment: { label: 'Unemployment rate', unit: '%' }, inflation: { label: 'Inflation (12 months)', unit: '%' }, gdp: { label: 'GDP growth (annual rate)', unit: '%' } };
const dayOf = (t: number) => easternDay(t);
const monthDay = (m: number) => civilToDays(2016 + Math.floor(m / 12), (m % 12) + 1, 15);

function EconomyPanel() {
  const e = useQuery<EconomyDto>({ kind: 'economy' });
  const [range, setRange] = useState<'term' | 'all'>('all');
  if (!e) return <p className="muted">Loading…</p>;
  const latest = (k: string) => [...e.releases].reverse().find((r) => r.kind === k);
  const sinceTerm = e.president ? dayOf(e.president.since) : 0;
  const from = range === 'term' ? sinceTerm : -Infinity;
  const avg = e.approvalAverage.filter((p) => p.day >= from);
  const polls = e.approvalPolls.filter((p) => p.day >= from);
  const lastAvg = e.approvalAverage[e.approvalAverage.length - 1];
  const approval: Series[] = [{ key: 'a', label: 'Approve', color: CANDIDATE_COLORS[3]!, points: avg.map((p) => ({ x: p.day, y: p.approve })) }];
  const dots: Dot[] = polls.map((p) => ({ x: p.day, y: p.approve, color: CANDIDATE_COLORS[3]!, title: `${p.pollster}, ${formatDay(p.day)}: approve ${p.approve}%, disapprove ${p.disapprove}% (n=${fmtInt(p.n)})`, r: 2.5 }));
  const series = (k: string, color: string): Series => ({ key: k, label: RELEASE[k]!.label.split(' (')[0]!, color, points: e.releases.filter((r) => r.kind === k && dayOf(r.time) >= from).map((r) => ({ x: dayOf(r.time), y: r.value })) });
  const truth = e.truth.filter((m) => monthDay(m.month) >= from);
  return (
    <>
      <div className="grid cols-4">
        <section className="card"><div className="kicker">President</div>{e.president ? <><div className="row" style={{ gap: 8, marginTop: 4 }}><strong>{e.president.name}</strong><PartyBadge party={e.president.party} /></div><div className="tiny muted">In office since {formatDate(e.president.since)}</div></> : <p className="muted small">Vacant</p>}</section>
        <section className="card"><div className="kicker">Approval (poll average)</div><div className="bignum">{lastAvg ? `${lastAvg.approve.toFixed(0)}%` : '—'}</div><div className="tiny muted">{e.approvalPolls.length ? `${fmtInt(e.approvalPolls.length)} published polls` : 'No polls published yet'}</div></section>
        {(['unemployment', 'inflation'] as const).map((k) => { const r = latest(k); return <section key={k} className="card"><div className="kicker">{RELEASE[k]!.label}</div><div className="bignum">{r ? `${r.value.toFixed(1)}%` : '—'}</div><div className="tiny muted">{r ? `${r.period} · released ${formatDay(dayOf(r.time))}` : 'First release in early February 2016'}</div></section>; })}
      </div>
      <div className="row between" style={{ marginTop: 12 }}>
        <h2 style={{ margin: 0 }}>Presidential approval</h2>
        <div className="seg" aria-label="Range"><button className={range === 'all' ? 'on' : ''} onClick={() => setRange('all')}>All years</button><button className={range === 'term' ? 'on' : ''} onClick={() => setRange('term')}>Current President</button></div>
      </div>
      <section className="card" style={{ marginTop: 8 }}>
        <TimeChart series={approval} dots={dots} yLabel="Approve (%) — the line is a recency- and size-weighted average of published polls; dots are individual polls" fmt={(v) => v.toFixed(0)} />
      </section>
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <section className="card"><h2>Jobs and prices</h2><TimeChart series={[series('unemployment', CANDIDATE_COLORS[0]!), series('inflation', CANDIDATE_COLORS[1]!)]} yLabel="Monthly releases (%)" zero /></section>
        <section className="card"><h2>Growth</h2><TimeChart series={[series('gdp', CANDIDATE_COLORS[2]!)]} yLabel="Real GDP growth, advance estimate (annual rate, %)" zero /></section>
      </div>
      <section className="card" style={{ marginTop: 12 }}>
        <h2>Latest releases</h2>
        <table className="data"><thead><tr><th>Released</th><th>Series</th><th>Period</th><th className="num">Value</th></tr></thead>
          <tbody>{[...e.releases].reverse().slice(0, 12).map((r, i) => <tr key={i}><td>{formatDay(dayOf(r.time))}</td><td>{RELEASE[r.kind]?.label ?? r.kind}</td><td>{r.period}</td><td className="num">{r.value.toFixed(1)}%</td></tr>)}</tbody></table>
      </section>
      <details className="card" style={{ marginTop: 12 }}>
        <summary><strong>Behind the numbers</strong> <Truth /></summary>
        <p className="small muted">The simulation's monthly state. Nobody inside the universe sees it: voters respond to it, and the polls and releases above measure it with error and delay. Approval comes from the simulated electorate (partisanship, how each group perceives the economy, the President's standing).</p>
        <TimeChart series={[
          { key: 't', label: 'All', color: CANDIDATE_COLORS[3]!, points: truth.map((m) => ({ x: monthDay(m.month), y: 100 * m.approve })) },
          { key: 'c', label: "President's party", color: CANDIDATE_COLORS[6]!, points: truth.map((m) => ({ x: monthDay(m.month), y: 100 * m.copartisans })) },
          { key: 'o', label: 'Other party', color: CANDIDATE_COLORS[4]!, points: truth.map((m) => ({ x: monthDay(m.month), y: 100 * m.opponents })) },
        ]} yLabel="True approval (%) among all adults and by party identification" fmt={(v) => v.toFixed(0)} markers={recessions(truth)} />
        <p className="tiny muted">Dashed markers: months the simulated economy entered recession.</p>
      </details>
    </>
  );
}
function recessions(t: EconomyDto['truth']): { x: number; label: string }[] {
  const out: { x: number; label: string }[] = [];
  t.forEach((m, i) => { if (m.recession && !t[i - 1]?.recession) out.push({ x: monthDay(m.month), label: 'recession' }); });
  return out;
}

// ---- Congress -------------------------------------------------------------------------------------------------

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const statusColor = (s: string) => (s.startsWith('signed') || s.startsWith('enacted') ? 'var(--ok, #2E9E5B)' : s === 'vetoed' ? 'var(--gold)' : 'var(--text-2)');

function CongressPanel({ congress }: { congress?: number }) {
  const c = useQuery<CongressDto>({ kind: 'congress', congress });
  if (!c) return <p className="muted">Loading…</p>;
  const yrs = c.years.filter((y) => y.congress === c.congress);
  return (
    <>
      <div className="row between wrap">
        <h2 style={{ margin: 0 }}>The {ordinal(c.congress)} Congress</h2>
        <div className="row"><label className="small muted">Congress</label><select value={c.congress} onChange={(e) => go(`government/congress/${e.target.value}`)} aria-label="Congress">{c.congresses.map((n) => <option key={n} value={n}>{ordinal(n)} ({1789 + 2 * (n - 1)}–{1789 + 2 * (n - 1) + 2})</option>)}</select></div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 10 }}>
        {c.chambers.map((ch) => <section key={ch.name} className="card"><div className="row between"><strong>{ch.name}</strong><span className="small muted">today</span></div><div className="small" style={{ margin: '6px 0' }}>{ch.composition.map((x) => <span key={x.party} style={{ marginRight: 12 }}><span className="party-dot" style={{ background: PARTY_COLORS[x.party] }} /> {PARTY_NAME[x.party]} {x.seats}</span>)}</div><SeatBar composition={ch.composition} seats={ch.seats} /></section>)}
      </div>
      {yrs.length > 0 && <section className="card" style={{ marginTop: 12 }}>
        <h2>Record by year</h2>
        <table className="data"><thead><tr><th>Year</th><th>Control</th><th className="num">Major laws</th><th className="num">Other laws</th><th className="num">Vetoes</th><th className="num">Overrides</th></tr></thead>
          <tbody>{yrs.map((y) => <tr key={y.year}><td>{y.year}</td><td>{y.unified ? `Unified (${PARTY_ABBR[y.houseMajority]})` : `Divided: House ${PARTY_ABBR[y.houseMajority]}, Senate ${PARTY_ABBR[y.senateMajority]}`}</td><td className="num">{y.major}</td><td className="num">{y.minor}</td><td className="num">{y.vetoes}</td><td className="num">{y.overrides}</td></tr>)}</tbody></table>
        <p className="tiny muted">Major bills are simulated one by one with recorded roll calls; other legislation is summarized by year.</p>
      </section>}
      <section className="card" style={{ marginTop: 12 }}>
        <h2>Major bills</h2>
        {!c.bills.length ? <p className="muted small">No major bill has reached a floor vote in this Congress yet.</p> :
          <table className="data"><thead><tr><th>Introduced</th><th>Bill</th><th>Sponsor</th><th>House</th><th>Senate</th><th>Status</th></tr></thead>
            <tbody>{c.bills.map((b) => <tr key={b.id} className="click" onClick={() => go(`government/bill/${b.id}`)}><td>{formatDay(dayOf(b.introduced))}</td><td><a href={`#/government/bill/${b.id}`}>{b.title}</a><div className="tiny muted">{b.topic}</div></td><td><PartyBadge party={b.sponsorParty} /></td><td className="num">{b.house ?? '—'}</td><td className="num">{b.senate ?? '—'}</td><td style={{ color: statusColor(b.status) }}>{b.status}</td></tr>)}</tbody></table>}
      </section>
    </>
  );
}

function BillView({ id }: { id: number }) {
  const b = useQuery<BillDto | null>({ kind: 'bill', id });
  if (b === null) return <p className="muted">Loading…</p>;
  return (
    <>
      <p className="small"><a href={`#/government/congress/${b.congress}`}>← The {ordinal(b.congress)} Congress</a></p>
      <h2>{b.title}</h2>
      <p className="small muted">Introduced {formatDate(b.introduced)} by the {PARTY_NAME[b.sponsorParty]} majority · {b.topic}{b.reconciliation ? ' · budget reconciliation (simple majority in the Senate)' : ''} · salience {Math.round(100 * b.salience)}/100</p>
      <p><strong style={{ color: statusColor(b.status) }}>{b.status[0]!.toUpperCase()}{b.status.slice(1)}</strong>{b.enacted ? ` on ${formatDate(b.enacted)}` : ''}</p>
      <section className="card">
        <h2>Roll calls</h2>
        <table className="data"><thead><tr><th>Date</th><th>Chamber</th><th>Question</th><th className="num">Yea</th><th className="num">Nay</th><th>By party</th><th>Result</th></tr></thead>
          <tbody>{b.rollCalls.map((r, i) => <tr key={i}><td>{formatDay(dayOf(r.time))}</td><td>{r.chamber === 'house' ? 'House' : 'Senate'}</td><td>{r.question}</td><td className="num">{r.yea}</td><td className="num">{r.nay}</td>
            <td className="small">{r.byParty.map((p) => <span key={p.party} style={{ marginRight: 10 }}><span className="party-dot" style={{ background: PARTY_COLORS[p.party] }} /> {PARTY_ABBR[p.party]} {p.yea}–{p.nay}</span>)}</td>
            <td>{r.passed ? 'Agreed' : 'Rejected'}</td></tr>)}</tbody></table>
        <p className="tiny muted">Members vote by the bill's distance from current policy in the issue space, party pressure and their constituency's lean. Senate bills need 60 votes to end debate, except budget reconciliation; overriding a veto takes two-thirds of each chamber.</p>
      </section>
    </>
  );
}

// ---- State legislatures ---------------------------------------------------------------------------------------

function CompBar({ c }: { c: LegislaturesDto['states'][number]['chambers'][number] }) {
  return <div title={c.composition.map((x) => `${PARTY_NAME[x.party]} ${x.seats}`).join(', ')}>
    <div className="tiny" style={{ marginBottom: 2 }}>{c.composition.map((x) => <span key={x.party} style={{ marginRight: 8, color: x.party === 1 ? 'var(--dem-2)' : x.party === 2 ? 'var(--rep-2)' : 'var(--text-2)' }}>{PARTY_ABBR[x.party]} {x.seats}</span>)}</div>
    <SeatBar composition={c.composition} seats={c.seats} />
    {(c.districts.multi > 0 || c.districts.mode !== 'single') && <div className="tiny muted" style={{ marginTop: 2 }}>{districtsText(c)}</div>}
  </div>;
}

function LegislaturesPanel() {
  const l = useQuery<LegislaturesDto>({ kind: 'legislatures' });
  const [sort, setSort] = useState<'name' | 'control'>('name');
  if (!l) return <p className="muted">Loading…</p>;
  const t = l.totals;
  const score = (s: LegislaturesDto['states'][number]) => s.chambers.reduce((a, c) => a + ((c.composition.find((x) => x.party === 1)?.seats ?? 0) / c.seats), 0) / Math.max(1, s.chambers.length);
  const states = [...l.states].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : score(b) - score(a)));
  return (
    <>
      <div className="grid cols-4">
        <section className="card"><div className="kicker">Chambers controlled</div><div className="row" style={{ gap: 14 }}><span className="bignum" style={{ color: 'var(--dem-2)' }}>{t.dChambers}</span><span className="bignum" style={{ color: 'var(--rep-2)' }}>{t.rChambers}</span></div><div className="tiny muted">{t.split ? `${t.split} tied or without a majority` : 'of 99 chambers'}</div></section>
        <section className="card"><div className="kicker">Trifectas</div><div className="row" style={{ gap: 14 }}><span className="bignum" style={{ color: 'var(--dem-2)' }}>{t.dTrifectas}</span><span className="bignum" style={{ color: 'var(--rep-2)' }}>{t.rTrifectas}</span></div><div className="tiny muted">Governor and every chamber; {50 - t.dTrifectas - t.rTrifectas} states divided</div></section>
        <section className="card"><div className="kicker">State legislators</div><div className="row" style={{ gap: 14 }}><span className="bignum" style={{ color: 'var(--dem-2)' }}>{fmtInt(t.dLegislators)}</span><span className="bignum" style={{ color: 'var(--rep-2)' }}>{fmtInt(t.rLegislators)}</span></div><div className="tiny muted">{t.others ? `${fmtInt(t.others)} other or vacant` : ''}</div></section>
        <section className="card"><div className="kicker">Elections</div><p className="small" style={{ margin: '4px 0 0' }}>Every seat is elected on its state's schedule, by district, with one nominee per party.</p></section>
      </div>
      <section className="card" style={{ marginTop: 12 }}>
        <div className="row between"><h2 style={{ margin: 0 }}>By state</h2><div className="seg" aria-label="Sort"><button className={sort === 'name' ? 'on' : ''} onClick={() => setSort('name')}>A–Z</button><button className={sort === 'control' ? 'on' : ''} onClick={() => setSort('control')}>Most Democratic</button></div></div>
        <table className="data" style={{ marginTop: 8 }}><thead><tr><th>State</th><th>Governor</th><th style={{ width: '24%' }}>Upper chamber</th><th style={{ width: '24%' }}>Lower chamber</th><th>Trifecta</th><th>Last session</th></tr></thead>
          <tbody>{states.map((s) => {
            const upper = s.chambers.find((c) => c.kind === 'state_upper'), lower = s.chambers.find((c) => c.kind === 'state_lower');
            return <tr key={s.stateIdx}>
              <td><a href={`#/government/districts/${s.stateIdx}/${lower ? 'sldl' : 'sldu'}`}>{s.name}</a></td>
              <td>{s.governorParty !== null ? <PartyBadge party={s.governorParty} /> : '—'}</td>
              <td>{upper ? <CompBar c={upper} /> : '—'}</td>
              <td>{lower ? <CompBar c={lower} /> : <span className="tiny muted">Unicameral</span>}</td>
              <td>{s.trifecta !== null ? <PartyBadge party={s.trifecta} /> : <span className="tiny muted">Divided</span>}</td>
              <td className="small">{s.session ? <>{s.session.laws} laws · {s.session.vetoes} vetoes{s.session.budgetLate ? <div className="tiny" style={{ color: 'var(--gold)' }}>Late budget</div> : null}</> : '—'}</td>
            </tr>;
          })}</tbody></table>
        <p className="tiny muted">Nebraska's single chamber is officially nonpartisan; its members still carry a party label here. Sessions are summarized per year (laws, vetoes, a late budget when the Governor and the legislature are of different parties).</p>
      </section>
    </>
  );
}

// ---- Census and apportionment ---------------------------------------------------------------------------------

function CensusPanel() {
  const c = useQuery<CensusDto>({ kind: 'census' });
  const [which, setWhich] = useState<number | null>(null);
  if (!c) return <p className="muted">Loading…</p>;
  const cen = c.censuses.find((x) => x.year === which) ?? c.censuses[0];
  const dem = c.demography;
  const y2d = (y: number) => civilToDays(y, 1, 1);
  const share: Series[] = [
    { key: 'w', label: 'White (non-Hispanic)', color: CANDIDATE_COLORS[0]!, points: dem.map((d) => ({ x: y2d(d.year), y: 100 * d.white })) },
    { key: 'h', label: 'Hispanic', color: CANDIDATE_COLORS[1]!, points: dem.map((d) => ({ x: y2d(d.year), y: 100 * d.hispanic })) },
    { key: 'c', label: 'College graduates', color: CANDIDATE_COLORS[2]!, points: dem.map((d) => ({ x: y2d(d.year), y: 100 * d.college })) },
    { key: 'o', label: 'Aged 65+', color: CANDIDATE_COLORS[3]!, points: dem.map((d) => ({ x: y2d(d.year), y: 100 * d.age65 })) },
  ];
  const plans = c.plans.filter((p) => p.kind === 'cd');
  return (
    <>
      {!cen ? <section className="card"><h2>The census</h2><p className="muted small">The first census of this universe is taken on April 1, 2020. Apportionment follows at the end of that year (Huntington–Hill, 435 seats), and the new maps take effect for the 2022 elections.</p></section> : <>
        <div className="row between wrap">
          <h2 style={{ margin: 0 }}>The {cen.year} census</h2>
          {c.censuses.length > 1 && <select value={cen.year} onChange={(e) => setWhich(Number(e.target.value))} aria-label="Census year">{c.censuses.map((x) => <option key={x.year}>{x.year}</option>)}</select>}
        </div>
        <div className="grid cols-3" style={{ marginTop: 8 }}>
          <section className="card"><div className="kicker">Resident population</div><div className="bignum">{(cen.total / 1e6).toFixed(1)}M</div></section>
          <section className="card"><div className="kicker">The 435th seat</div><div className="bignum">{cen.lastSeat ?? '—'}</div></section>
          <section className="card"><div className="kicker">Next in line</div><div className="bignum">{cen.nextInLine ?? '—'}</div></section>
        </div>
        <section className="card" style={{ marginTop: 12 }}>
          <h2>Apportionment</h2>
          {cen.states.every((s) => s.seats === null) ? <p className="muted small">Counts are in; apportionment is announced by December 31, {cen.year}.</p> : <>
            <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>{cen.states.filter((s) => s.change).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).map((s) => <span key={s.stateIdx} className="badge" style={{ borderColor: s.change! > 0 ? 'var(--ok, #2E9E5B)' : 'var(--gold)' }}>{s.usps} {s.change! > 0 ? `+${s.change}` : s.change}</span>)}</div>
            <table className="data"><thead><tr><th>State</th><th className="num">Population</th><th className="num">Seats</th><th className="num">Change</th><th className="num">People per seat</th></tr></thead>
              <tbody>{[...cen.states].sort((a, b) => b.population - a.population).map((s) => <tr key={s.stateIdx}><td>{s.name}</td><td className="num">{fmtInt(s.population)}</td><td className="num">{s.seats ?? '—'}</td><td className="num" style={{ color: s.change ? (s.change > 0 ? 'var(--ok, #2E9E5B)' : 'var(--gold)') : undefined }}>{s.change ? (s.change > 0 ? `+${s.change}` : s.change) : ''}</td><td className="num">{s.seats ? fmtInt(s.population / s.seats) : '—'}</td></tr>)}</tbody></table>
            <p className="tiny muted">The District of Columbia is counted but has no voting seat. Seats are apportioned by the method of equal proportions (Huntington–Hill): one seat per state, then by priority value P/√(n(n+1)).</p>
          </>}
        </section>
      </>}
      {dem.length > 1 && <section className="card" style={{ marginTop: 12 }}>
        <h2>The changing electorate</h2>
        <TimeChart series={share} yLabel="Share of adult residents (%), January 1 each year" fmt={(v) => v.toFixed(0)} />
        <p className="tiny muted">Aging, mortality, new adults, naturalization and migration between counties, recomputed each January. Adults: {fmtInt(dem[0]!.adults)} in {dem[0]!.year} → {fmtInt(dem[dem.length - 1]!.adults)} in {dem[dem.length - 1]!.year}.</p>
      </section>}
      <section className="card" style={{ marginTop: 12 }}>
        <h2>Congressional plans drawn in this universe</h2>
        {!plans.length ? <p className="muted small">Every state still uses its 2016 plan. New plans are drawn after each census and take effect two years later.</p> :
          <table className="data"><thead><tr><th>State</th><th>From</th><th className="num">Districts</th><th className="num">Max. deviation</th><th className="num">Counties split</th><th>Contiguous</th></tr></thead>
            <tbody>{plans.map((p) => <tr key={p.planId} className="click" onClick={() => go(`government/districts/${p.stateIdx}/cd/${p.firstYear}`)}><td>{p.usps}</td><td>{p.firstYear}</td><td className="num">{p.districts}</td><td className="num">{(100 * p.maxDeviation).toFixed(2)}%</td><td className="num">{p.countiesSplit}</td><td>{p.contiguous ? 'Yes' : 'No'}</td></tr>)}</tbody></table>}
        <p className="tiny muted">Plans are drawn by a neutral algorithm from whole base units: contiguous, compact, close to equal population, keeping counties whole where it can. States with a single seat elect at large.</p>
      </section>
    </>
  );
}

// ---- District maps --------------------------------------------------------------------------------------------

const PLAN_LABEL = { cd: 'U.S. House', sldu: 'State senate', sldl: 'State house' } as const;
const hue = (i: number) => `hsl(${(i * 137.508) % 360} 52% 56%)`;

function DistrictsPanel({ state: stateParam, plan, year: yearParam }: { state?: number; plan: 'cd' | 'sldu' | 'sldl'; year?: number }) {
  const geo = useQuery<GeoMeta>({ kind: 'geoMeta' });
  const states = useMemo(() => geo ? [...geo.states].sort((a, b) => a.name.localeCompare(b.name)) : undefined, [geo]);
  const census = useQuery<CensusDto>({ kind: 'census' });
  const now = useApp((s) => s.time);
  // The state with the most House districts by default.
  const biggest = useMemo(() => { if (!geo) return 0; const n = new Map<number, number>(); for (const c of geo.cds) n.set(c.stateIdx, (n.get(c.stateIdx) ?? 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0; }, [geo]);
  const state = stateParam ?? biggest;
  const thisYear = now ? daysToCivil(easternDay(now)).y : 2016;
  const years = useMemo(() => {
    const ys = new Set<number>([2016]);
    for (const p of census?.plans ?? []) if (p.stateIdx === state && p.kind === plan) ys.add(p.firstYear);
    return [...ys].sort((a, b) => a - b);
  }, [census, state, plan]);
  const year = yearParam ?? [...years].reverse().find((y) => y <= Math.max(thisYear, 2016)) ?? 2016;
  const m = useQuery<DistrictMapDto | null>({ kind: 'districtMap', state, plan, year });
  const [mode, setMode] = useState<'district' | 'party' | 'lean'>('district');
  const nav = (s: number, p: string, y?: number) => go(`government/districts/${s}/${p}${y ? `/${y}` : ''}`);
  return (
    <>
      <div className="row wrap" style={{ gap: 10 }}>
        <select value={state} onChange={(e) => nav(Number(e.target.value), plan)} aria-label="State">{(states ?? []).map((s) => <option key={s.idx} value={s.idx}>{s.name}</option>)}</select>
        <div className="seg" aria-label="Plan">{(['cd', 'sldu', 'sldl'] as const).map((p) => <button key={p} className={plan === p ? 'on' : ''} onClick={() => nav(state, p)}>{PLAN_LABEL[p]}</button>)}</div>
        <div className="seg" aria-label="Plan year">{years.map((y) => <button key={y} className={year === y ? 'on' : ''} onClick={() => nav(state, plan, y)}>{y === 2016 ? '2016 plan' : `From ${y}`}</button>)}</div>
        <div className="seg" aria-label="Colour by">{(['district', 'party', 'lean'] as const).map((k) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{k === 'district' ? 'Districts' : k === 'party' ? 'Holder' : 'Lean'}</button>)}</div>
      </div>
      {m === null ? <p className="muted" style={{ marginTop: 12 }}>{states ? 'No districts of this kind in this state (Nebraska has a single chamber).' : 'Loading…'}</p> :
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 12, marginTop: 12 }}>
          <section className="card"><DotMap m={m} mode={mode} /><p className="tiny muted">{m.planLabel}. Each dot is a base unit (a block group or voting-district piece) coloured by its district; holders are today's. Lean is the simulated electorate's generic-ballot margin.</p></section>
          <section className="card" style={{ maxHeight: 560, overflow: 'auto' }}>
            <h2>{PLAN_LABEL[plan]} districts ({m.districts.length})</h2>
            <table className="data"><thead><tr><th>District</th><th className="num">Population</th><th>Holder</th><th className="num">Lean</th></tr></thead>
              <tbody>{m.districts.map((d) => <tr key={d.idx}><td><span className="party-dot" style={{ background: hue(d.idx) }} /> {d.label}</td><td className="num">{fmtInt(d.population)}</td><td>{d.holderParty !== null ? <PartyBadge party={d.holderParty} /> : '—'}</td><td className="num" style={{ color: d.lean >= 0 ? 'var(--dem-2)' : 'var(--rep-2)' }}>{fmtLean(d.lean)}</td></tr>)}</tbody></table>
          </section>
        </div>}
    </>
  );
}

function DotMap({ m, mode }: { m: DistrictMapDto; mode: 'district' | 'party' | 'lean' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const frame = useRef<{ s: number; ox: number; oy: number } | null>(null);
  const order = useMemo(() => Array.from(m.x.keys()).sort((a, b) => m.side[b]! - m.side[a]!), [m]);
  const colors = useMemo(() => m.districts.map((d) => (mode === 'district' ? hue(d.idx) : mode === 'party' ? PARTY_COLORS[d.holderParty ?? 0]! : marginColor(d.lean) ?? '#3a4166')), [m, mode]);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const draw = () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < m.x.length; i++) { x0 = Math.min(x0, m.x[i]!); x1 = Math.max(x1, m.x[i]!); y0 = Math.min(y0, m.y[i]!); y1 = Math.max(y1, m.y[i]!); }
      // The canvas follows the state's shape (within limits).
      const dpr = window.devicePixelRatio || 1, W = c.clientWidth;
      const H = Math.round(Math.max(320, Math.min(620, (W - 16) * (y1 - y0) / Math.max(1, x1 - x0) + 16)));
      c.width = W * dpr; c.height = H * dpr; c.style.height = `${H}px`;
      const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const s = Math.min((W - 16) / Math.max(1, x1 - x0), (H - 16) / Math.max(1, y1 - y0));
      const ox = (W - s * (x1 - x0)) / 2 - s * x0, oy = (H - s * (y1 - y0)) / 2 - s * y0;
      frame.current = { s, ox, oy };
      // Each unit as a square of its own area (a little larger, so neighbours touch), largest first.
      for (const i of order) {
        const d = m.district[i]!, r = Math.max(1.6, Math.min(48, 1.15 * s * m.side[i]!));
        g.fillStyle = colors[d]!; g.globalAlpha = hover === null || hover === d ? 0.92 : 0.22;
        g.fillRect(ox + s * m.x[i]! - r / 2, oy + s * m.y[i]! - r / 2, r, r);
      }
      g.globalAlpha = 1;
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(c);
    return () => ro.disconnect();
  }, [m, colors, hover, order]);
  const onMove = (e: React.MouseEvent) => {
    const f = frame.current, c = ref.current; if (!f || !c) return;
    const rc = c.getBoundingClientRect(), px = e.clientX - rc.left, py = e.clientY - rc.top;
    let best = -1, bd = 64;
    for (let i = 0; i < m.x.length; i++) { const dx = f.ox + f.s * m.x[i]! - px, dy = f.oy + f.s * m.y[i]! - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    setHover(best >= 0 ? m.district[best]! : null);
  };
  const h = hover !== null ? m.districts[hover] : null;
  return (
    <div>
      <canvas ref={ref} style={{ width: '100%', display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`District map, ${m.districts.length} districts`} />
      <div className="tiny muted chart-readout">{h ? <>District {h.label} · {fmtInt(h.population)} people · {h.holderParty !== null ? `held by the ${PARTY_NAME[h.holderParty]}s`.replace('Vacants', 'vacant') : 'vacant'} · {fmtLean(h.lean)}</> : 'Hover over the map to identify a district.'}</div>
    </div>
  );
}

// ---- Election law (Phase 7.1) ------------------------------------------------------------------------------------
function ElectionLawPanel() {
  const l = useQuery<ElectionLawDto>({ kind: 'electionLaw' });
  const [all, setAll] = useState(false);
  if (!l) return <p className="muted">Loading…</p>;
  const shown = all ? l.states : l.states.filter((s) => s.changed || s.rules.some((r) => /Ranked-choice|Top-|Nonpartisan|November all-candidate/.test(r)));
  return (
    <div className="grid cols-2">
      <section className="card">
        <h2>Changes in this universe</h2>
        {l.changes.length === 0 ? <p className="muted small">No state has changed its election law yet. Every state still elects under its law of January 1, 2016. Laws change through simulated legislation: each state’s session may adopt or repeal ranked-choice voting or change its primary system, taking effect the next January 1.</p> : (
          <table className="data"><thead><tr><th>State</th><th>Change</th><th>Effective</th></tr></thead>
            <tbody>{l.changes.map((c, i) => <tr key={i}><td>{c.name}</td><td className="small">{c.summary}<div className="tiny muted">{c.source === 'legislature' ? 'State legislation' : c.source === 'initiative' ? 'Ballot initiative' : 'Scenario'}</div></td><td className="small">{c.effective}{!c.inForce && <div className="tiny muted">not yet in force</div>}</td></tr>)}</tbody>
          </table>
        )}
        <p className="tiny muted">A change applies only to elections held on or after its effective date; elections already held keep the rules they were held under.</p>
      </section>
      <section className="card">
        <h2>How states elect today</h2>
        <label className="small row" style={{ gap: 6, marginBottom: 6 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Every state (otherwise only those with ranked, all-candidate or nonpartisan ballots, or a changed law)</label>
        <table className="data"><thead><tr><th>State</th><th>Rules</th></tr></thead>
          <tbody>{shown.map((s) => <tr key={s.stateIdx}><td>{s.name}{s.changed && <span className="badge" style={{ marginLeft: 6 }}>changed</span>}</td><td className="small">{s.rules.join(' · ')}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}

// ---- State offices, boards and courts (Phase 7.2) --------------------------------------------------------------
function StateOfficesPanel({ state }: { state?: number }) {
  const d = useQuery<StateOfficesDto>({ kind: 'stateOffices', ...(state !== undefined ? { state } : {}) });
  const [national, setNational] = useState(false);
  if (!d) return <p className="muted">Loading…</p>;
  const groups: [StateOfficesDto['bodies'][number]['group'], string][] = [['executive', 'Statewide officers'], ['boards', 'Commissions and boards'], ['courts', 'Courts']];
  const cur = d.states.find((s) => s.stateIdx === d.stateIdx);
  const comp = (c: { party: number; seats: number }[]) => c.map((x) => <span key={x.party} className="small" style={{ marginRight: 10 }}><span className="party-dot" style={{ background: PARTY_COLORS[x.party] }} /> {PARTY_ABBR[x.party] ?? '—'} {x.seats}</span>);
  return (
    <>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <label className="small">State{' '}
          <select value={d.stateIdx} onChange={(e) => go(`government/offices/${e.target.value}`)}>{d.states.map((s) => <option key={s.stateIdx} value={s.stateIdx}>{s.name}</option>)}</select>
        </label>
        <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={national} onChange={(e) => setNational(e.target.checked)} /> Every state at a glance</label>
      </div>
      {national ? (
        <section className="card">
          <h2>Supreme courts and down-ballot offices by party</h2>
          <p className="tiny muted">Justices belong to a party even where the ballot carries no label (the party they ran with, or of the governor who appointed them). Down-ballot offices: the statewide officers beyond governor, lieutenant governor, attorney general and secretary of state.</p>
          <table className="data"><thead><tr><th>State</th><th>Supreme court</th><th>How justices are chosen</th><th>Down-ballot officers</th></tr></thead>
            <tbody>{d.summary.map((s) => <tr key={s.stateIdx} className="click" onClick={() => { setNational(false); go(`government/offices/${s.stateIdx}`); }}><td>{s.name}</td><td>{comp(s.court)}</td><td className="tiny">{s.courtSelection}</td><td>{s.executive.length ? comp(s.executive) : <span className="tiny muted">none elected</span>}</td></tr>)}</tbody>
          </table>
        </section>
      ) : (
        <>
          {d.bodies.length === 0 && <p className="muted small">{cur?.name ?? 'This state'} elects no offices beyond governor, lieutenant governor, attorney general and secretary of state, and has no elected boards; its courts are appointed.</p>}
          {groups.map(([g, title]) => {
            const bs = d.bodies.filter((b) => b.group === g); if (!bs.length) return null;
            return (
              <section key={g} className="card" style={{ marginBottom: 12 }}>
                <h2>{title}</h2>
                {g === 'executive' ? (
                  <table className="data"><thead><tr><th>Office</th><th>Holder</th><th>Since</th><th>How chosen</th><th>Next election</th></tr></thead>
                    <tbody>{bs.map((b) => { const m = b.members[0]; return (
                      <tr key={b.key}><td>{b.name}</td><td>{m?.name ? <><a href={`#/people/${m.personId}`}>{m.name}</a> {m.party !== null && <PartyBadge party={m.party} />}</> : <span className="muted">vacant</span>}</td>
                        <td className="small">{m?.since ? formatDate(m.since) : '—'}</td><td className="tiny">{b.selection}</td><td className="small">{m?.next ?? '—'}</td></tr>); })}</tbody>
                  </table>
                ) : bs.map((b) => (
                  <div key={b.key} style={{ marginBottom: 14 }}>
                    <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}><strong>{b.name}</strong><span>{comp(b.composition)}</span></div>
                    <div className="tiny muted" style={{ margin: '2px 0 6px' }}>{b.selection}{b.notes.length ? ` · ${b.notes.join(' · ')}` : ''}</div>
                    <SeatBar composition={b.composition} seats={b.seats} />
                    <table className="data" style={{ marginTop: 6 }}><thead><tr><th>Seat</th><th>Member</th><th className="num">Age</th><th>Since</th><th>How they got the seat</th><th>Next</th></tr></thead>
                      <tbody>{b.members.map((m) => (
                        <tr key={m.officeId}><td className="small">{m.seat}</td><td>{m.name ? <><a href={`#/people/${m.personId}`}>{m.name}</a> {m.party !== null && <PartyBadge party={m.party} />}</> : <span className="muted">vacant</span>}</td>
                          <td className="num small">{m.age ?? '—'}</td><td className="small">{m.since ? formatDate(m.since) : '—'}</td><td className="tiny">{m.acquired ?? '—'}</td><td className="small">{m.next ?? '—'}</td></tr>))}</tbody>
                    </table>
                  </div>
                ))}
              </section>
            );
          })}
          <p className="tiny muted">The 2016 baseline of each state’s law (offices, terms, how judges are chosen, retirement ages); seats’ staggering and board districts are drawn by the simulation. Justices’ parties are shown even where the ballot is nonpartisan.</p>
        </>
      )}
    </>
  );
}

/** How a chamber's seats are elected (Phase 7.4): single-member, "vote for N", numbered positions or staggered seats. */
function districtsText(ch: LegislaturesDto['states'][number]['chambers'][number]): string {
  const d = ch.districts;
  if (!d.count) return '';
  if (d.mode === 'posts') return `${d.count} districts, each electing ${d.maxSeats} members to numbered positions`;
  if (d.mode === 'staggered') return `${d.count} districts of ${d.maxSeats} members, elected in alternate cycles`;
  if (!d.multi) return `${d.count} single-member districts`;
  return `${ch.seats} seats in ${d.count} districts; ${d.multi} elect several members on one ballot (vote for up to ${d.maxSeats})${d.floterial ? `; ${d.floterial} floterial districts overlap the others` : ''}`;
}

// ---- Ballot measures (Phase 7.3) -------------------------------------------------------------------------------
function MeasuresPanel({ year }: { year?: number }) {
  const [state, setState] = useState<number | null>(null);
  const d = useQuery<MeasureListDto>({ kind: 'measures', ...(state !== null ? { state } : year !== undefined ? { year } : {}) });
  const meta = useQuery<GeoMeta>({ kind: 'geoMeta' });
  if (!d) return <p className="muted">Loading…</p>;
  const passed = d.rows.filter((r) => r.outcome === 'passed').length, decided = d.rows.filter((r) => r.outcome).length;
  return (
    <section className="card">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2>Ballot measures{d.year ? ` · ${d.year}` : state !== null && meta ? ` · ${meta.states[state]?.name}` : ''}</h2>
        <div className="row" style={{ gap: 8 }}>
          <select aria-label="Year" value={state === null ? String(d.year ?? '') : ''} onChange={(e) => { setState(null); go(`government/measures/${e.target.value}`); }}>
            {state !== null && <option value="">All years</option>}{d.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select aria-label="State" value={state ?? ''} onChange={(e) => setState(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Every state</option>{meta?.states.map((s) => <option key={s.idx} value={s.idx}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {d.rows.length === 0 ? <p className="muted small">No ballot measures yet. Measures are filed with each state’s candidates, months before the election.</p> : (
        <>
          <p className="small muted">{d.rows.length} measure{d.rows.length === 1 ? '' : 's'}{decided ? ` · ${passed} of ${decided} decided passed` : ''}. ★ polled and called on election night · ⚖ changes the state’s election law if it passes.</p>
          <table className="data"><thead><tr><th>Year</th><th>State</th><th>Measure</th><th>Kind</th><th className="num">Yes</th><th>Result</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.contestId} className="click" onClick={() => go(`contest/${r.contestId}`)}>
                <td className="num muted">{r.year}</td><td>{r.state}</td>
                <td><a href={`#/contest/${r.contestId}`}><strong>{r.name}</strong></a>{r.polled && ' ★'}{r.effect && ' ⚖'}<div className="tiny muted">{r.title}</div></td>
                <td className="tiny">{r.kind}<div className="muted">needs {r.threshold}</div></td>
                <td className="num">{r.yes !== null ? `${(100 * r.yes).toFixed(1)}%` : '—'}</td>
                <td>{r.outcome ? <span className="badge" style={{ background: r.outcome === 'passed' ? PARTY_COLORS[-1] : PARTY_COLORS[-2], color: '#fff' }}>{r.outcome === 'passed' ? 'Passed' : 'Failed'}</span> : <span className="tiny muted">{r.status === 'counting' ? 'counting' : 'on the ballot'}</span>}</td>
              </tr>))}</tbody>
          </table>
        </>
      )}
    </section>
  );
}
