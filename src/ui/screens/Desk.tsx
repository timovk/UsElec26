import { useEffect, useState } from 'react';
import { engine } from '../state/engineClient';
import { useApp } from '../state/store';
import type { CalendarEntry, DeskSummary, ForecastDto, NewsDto, NightListItem, YearSummary } from '../../engine/protocol';
import { formatDate, formatDay, formatTime } from '../../core/time';
import { OfficeHolder, PARTY_COLORS, PARTY_NAME, PartyBadge, SeatBar, Truth, fmtLean } from '../components/common';

export function useQuery<T>(q: Parameters<typeof engine.query>[0], deps: unknown[] = []): T | null {
  const revision = useApp((s) => s.revision);
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    engine.query<T>(q).then((d) => { if (live) setData(d); }).catch((e: Error) => useApp.getState().toast(e.message, 'error'));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, JSON.stringify(q), ...deps]);
  return data;
}

function Chamber({ c, title }: { c: DeskSummary['senate']; title: string }) {
  const get = (p: number) => c.composition.find((x) => x.party === p)?.seats ?? 0;
  const vacant = get(0), other = c.composition.filter((x) => x.party > 2).reduce((a, x) => a + x.seats, 0);
  return (
    <div>
      <div className="row between"><strong>{title}</strong><span className="small muted">{c.majority ? `${PARTY_NAME[c.majority]} majority` : 'Tied'}</span></div>
      <div className="row between" style={{ margin: '6px 0' }}>
        <span className="bignum" style={{ color: 'var(--dem-2)' }}>{get(1)}</span>
        <span className="small muted">{other ? `${other} other · ` : ''}{vacant ? `${vacant} vacant` : ''}</span>
        <span className="bignum" style={{ color: 'var(--rep-2)' }}>{get(2)}</span>
      </div>
      <SeatBar composition={c.composition} seats={c.seats} />
    </div>
  );
}

export function Desk() {
  const d = useQuery<DeskSummary>({ kind: 'desk' });
  const cal = useQuery<CalendarEntry[]>({ kind: 'calendar' });
  const news = useQuery<NewsDto[]>({ kind: 'news', limit: 25 });
  const years = useQuery<number[]>({ kind: 'electionYears' });
  // Latest year with held general-election results: the newest year may so far have held only primaries.
  const y0 = years?.[0], y1 = years?.[1];
  const s0 = useQuery<YearSummary | null>(y0 ? { kind: 'yearSummary', year: y0 } : { kind: 'electionYears' }, [y0]);
  const s1 = useQuery<YearSummary | null>(y1 ? { kind: 'yearSummary', year: y1 } : { kind: 'electionYears' }, [y1]);
  const hasResults = (x: unknown): x is YearSummary => !!x && !Array.isArray(x) && 'chambers' in (x as object) && ((x as YearSummary).president.length > 0 || (x as YearSummary).chambers.length > 0);
  const lastS = hasResults(s0) ? s0 : hasResults(s1) ? s1 : null;
  const [showCabinet, setShowCabinet] = useState(false);
  const nights = useQuery<NightListItem[]>({ kind: 'nights' });
  if (!d) return <p className="muted">Loading…</p>;
  const now = d.universe.time;
  const night = nights?.find((n) => now >= n.lockTime && now < n.feedEnd);
  const pres = d.executive[0]!, vp = d.executive[1]!;
  const presParty = pres.holder?.party ?? 0;
  return (
    <>
      <div className="kicker">{d.universe.name} · seed {d.universe.seed}</div>
      <h1 className="screen-title">The Desk</h1>
      <p className="screen-sub">
        {formatDate(d.universe.time, 'America/New_York', true)}. {pres.holder ? `${pres.holder.name}, a ${presParty === 1 ? 'Democrat' : presParty === 2 ? 'Republican' : 'independent'}, is President` : 'The presidency is vacant'}
        {d.presidentTermNumber === 2 ? ' in the final year of a second term.' : ' and eligible to seek a second term.'}
      </p>

      <div className="grid cols-3">
        <section className="card">
          <h2>Executive</h2>
          <OfficeHolder o={pres} /><OfficeHolder o={vp} />
          <button className="btn ghost small" onClick={() => setShowCabinet(!showCabinet)} aria-expanded={showCabinet}>{showCabinet ? '▾ Hide' : '▸ Show'} the Cabinet ({d.executive.length - 2})</button>
          {showCabinet && d.executive.slice(2).map((o) => <OfficeHolder key={o.officeId} o={o} />)}
        </section>

        <section className="card">
          <h2>Congress <span className="tiny muted">115th Congress districts</span></h2>
          <Chamber c={d.senate} title="Senate" />
          <div style={{ height: 14 }} />
          <Chamber c={d.house} title="House of Representatives" />
          <h3>Leadership</h3>
          {d.congressLeaders.filter((o) => /Speaker|Leader|pro tempore/.test(o.title)).map((o) => <OfficeHolder key={o.officeId} o={o} />)}
        </section>

        <section className="card">
          <h2>The states</h2>
          <div className="row between"><strong>Governors</strong><span className="small muted">{d.governors.vacant ? `${d.governors.vacant} vacant` : ''}</span></div>
          <div className="row between" style={{ margin: '6px 0' }}><span className="bignum" style={{ color: 'var(--dem-2)' }}>{d.governors.D}</span><span className="bignum" style={{ color: 'var(--rep-2)' }}>{d.governors.R}</span></div>
          <SeatBar composition={[{ party: 1, seats: d.governors.D }, { party: 5, seats: d.governors.other }, { party: 0, seats: d.governors.vacant }, { party: 2, seats: d.governors.R }]} seats={50} />
          <h3>State legislatures (both chambers)</h3>
          <div className="row between small"><span>Democratic control: <strong>{d.legislatures.dControlled}</strong></span><span>Split: <strong>{d.legislatures.split}</strong></span><span>Republican control: <strong>{d.legislatures.rControlled}</strong></span></div>
          <div className="small muted" style={{ marginTop: 6 }}>{d.legislatures.dSeats.toLocaleString()} Democratic and {d.legislatures.rSeats.toLocaleString()} Republican legislators{d.legislatures.otherSeats ? `, ${d.legislatures.otherSeats} others` : ''}.</div>
          <h3>Underlying national lean <Truth /></h3>
          <div className="bignum" style={{ color: d.nationalLean >= 0 ? 'var(--dem-2)' : 'var(--rep-2)' }}>{fmtLean(d.nationalLean)}</div>
          <div className="tiny muted">{d.electorateNote}</div>
        </section>
      </div>

      {night && (
        <section className="card" style={{ marginTop: 16, borderColor: 'var(--gold)' }}>
          <div className="row between wrap">
            <div>
              <div className="kicker">Election Night · {night.label}</div>
              <strong>{now < night.coverageStart ? `Polls are open. Coverage begins at ${formatTime(night.coverageStart)}.` : now < night.nightEnd ? 'The count is under way.' : 'Counting continues; states certify over the coming weeks.'}</strong>
            </div>
            <a className="btn primary" href={`#/night/${night.id}`}>★ Watch Election Night</a>
          </div>
        </section>
      )}

      <SeasonCard />

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <section className="card">
          {lastS && <div style={{ marginBottom: 14 }}>
            <h2>Latest results · {lastS.year}{lastS.projected && <span className="badge live" style={{ marginLeft: 6 }}>Projected</span>} <a className="small" href={`#/results/${lastS.year}`}>All results ›</a></h2>
            {lastS.president.slice(0, 2).map((p) => <div key={p.name} className="row between small"><span className="row"><PartyBadge party={p.party} />{p.name}</span><span className="num"><strong style={{ color: PARTY_COLORS[p.party] }}>{p.ev}</strong> EV · {(100 * p.share).toFixed(1)}%</span></div>)}
            {lastS.chambers.map((c) => <div key={c.label} className="small muted">{c.label}: {c.after.map((x) => `${PARTY_NAME[x.party] ?? 'Vacant'} ${x.seats}`).join(' · ')}</div>)}
            <div className="small muted">{lastS.flips.length} seat{lastS.flips.length === 1 ? '' : 's'} changed party.</div>
          </div>}
          <h2>Upcoming elections</h2>
          {cal?.map((c) => (
            <div key={c.date} className="news-item">
              <div className="h">{c.label}</div>
              <div className="t">{new Date(`${c.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}</div>
              <div className="small">{c.contests.map((x) => `${x.label}${x.count > 1 ? ` (${x.count})` : ''}`).join(' · ')}</div>

            </div>
          ))}
          {cal?.length === 0 && <p className="muted small">No elections scheduled yet — the calendar for each year is set on January 1.</p>}
          <p className="tiny muted">Dates and offices follow federal law and each state's 2016 election code. State legislative elections arrive in Phase 6; local elections in Phase 7.</p>
        </section>
        <section className="card">
          <h2>News</h2>
          {news?.length ? news.map((n) => (
            <div key={n.id} className="news-item">
              <div className="t">{formatDate(n.time)}</div>
              <div className="h">{n.personId ? <a href={`#/people/${n.personId}`} style={{ color: 'inherit' }}>{n.headline}</a> : n.headline}</div>
              <div className="small muted">{n.body}</div>
            </div>
          )) : <p className="muted">No news yet.</p>}
          {d.vacancies.length > 0 && <><h3>Vacant offices</h3>{d.vacancies.map((o) => <OfficeHolder key={o.officeId} o={o} />)}</>}
        </section>
      </div>
    </>
  );
}

/** The campaign season at a glance: the latest forecast and the nominating contests. */
function SeasonCard() {
  const years = useQuery<number[]>({ kind: 'seasonYears' });
  const year = years?.[0];
  const fc = useQuery<ForecastDto | null>(year ? { kind: 'forecastRun', year } : { kind: 'seasonYears' }, [year]);
  if (!year) return null;
  const f = fc && 'races' in (fc as object) ? (fc as ForecastDto) : null;
  const pct = (p: number) => (p > 0.99 ? '>99%' : p < 0.01 ? '<1%' : `${Math.round(100 * p)}%`);
  const name = (p: number) => f?.nominees.find((n) => n.party === p)?.name ?? (p === 1 ? 'Democrats' : 'Republicans');
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="row between wrap">
        <div>
          <div className="kicker">{year} campaign</div>
          {f ? <strong>Forecast ({formatDay(f.asOf)}): {f.president ? `${name(1)} ${pct(f.president.pD)}, ${name(2)} ${pct(f.president.pR)} to win the presidency` : ''}{f.senate ? ` · Senate: Democrats ${pct(f.senate.pD)}` : ''}{f.house ? ` · House: Democrats ${pct(f.house.pD)}` : ''}</strong>
            : <strong>Polls are coming in. The first forecast is published in June.</strong>}
        </div>
        <div className="row"><a className="btn small" href={`#/polls/${year}`}>% Polls &amp; forecasts</a>{year % 4 === 0 && <a className="btn small" href={`#/primaries/${year}`}>⚑ Primaries</a>}</div>
      </div>
    </section>
  );
}
