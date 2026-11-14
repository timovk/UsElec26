import { useEffect, useState } from 'react';
import { engine } from '../state/engineClient';
import { useApp } from '../state/store';
import type { DiagnosticsResult, IntegrityReport, StorageInfo } from '../../engine/protocol';
import { COUNTY_SCOPES, exportUniverse } from './Hub';
import { fmtBytes } from '../components/common';
import { MapRenderer, loadBasemap, marginColor } from '../map/renderer';

/** The roadmap phase this build completes (update with the About card at the end of every phase). */
const BUILT_THROUGH = '7.6';

export function Settings() {
  const { storage, active, engineVersion, engineUpdated, set, toast } = useApp();
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [diag, setDiag] = useState<DiagnosticsResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const persist = async () => { try { await navigator.storage?.persist?.(); } catch { /* unsupported */ } const s = await engine.request<StorageInfo>({ type: 'storage' }); set({ storage: s }); toast(s.persisted ? 'Persistent storage granted.' : 'The browser declined persistent storage. Installing the app usually allows it.'); };
  const check = async () => { try { setIntegrity(await engine.request<IntegrityReport>({ type: 'integrity' })); } catch (e) { toast((e as Error).message, 'error'); } };
  const runDiag = async () => {
    setRunning(true);
    try {
      const results = await engine.request<DiagnosticsResult[]>({ type: 'diagnostics' });
      // Map redraw benchmark on the main thread.
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;left:-9999px;width:1200px;height:750px'; document.body.appendChild(canvas);
      const bm = await loadBasemap(import.meta.env.BASE_URL); const r = new MapRenderer(canvas, bm); r.resize();
      r.layer = bm.counties; r.fills = bm.counties.ids.map((_, i) => marginColor(((i * 37) % 80) - 40)); r.drawCountyMesh = true;
      r.draw(); canvas.getContext('2d')!.getImageData(0, 0, 1, 1);
      const times: number[] = [];
      for (let i = 0; i < 10; i++) { const t0 = performance.now(); r.draw(); canvas.getContext('2d')!.getImageData(0, 0, 1, 1); times.push(performance.now() - t0); }
      canvas.remove(); times.sort((a, b) => a - b);
      results.push({ name: 'County map redraw', value: Math.round(times[5]!), unit: 'ms (median)', note: `3,142 counties at ${canvas.width}×${canvas.height} px; budget ≤ 50 ms` });
      setDiag(results);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setRunning(false); }
  };

  return (
    <>
      <div className="kicker">Settings</div>
      <h1 className="screen-title">Settings &amp; data</h1>
      <div className="grid cols-2">
        <section className="card">
          <h2>Storage</h2>
          <table className="data"><tbody>
            <tr><td className="muted">Where universes live</td><td>{storage?.kind === 'opfs' ? 'This browser, on this device (Origin Private File System)' : 'Temporary memory — not saved!'}</td></tr>
            <tr><td className="muted">Persistent storage</td><td>{storage?.persisted === null ? 'Unknown' : storage?.persisted ? 'Granted' : 'Not granted'} <button className="btn small" onClick={() => void persist()}>Request</button></td></tr>
            <tr><td className="muted">Used / available</td><td>{fmtBytes(storage?.usage ?? null)} of {fmtBytes(storage?.quota ?? null)}</td></tr>
          </tbody></table>
          <p className="small">Local storage is not a backup. Export your universe regularly — on a Chromebook the save dialog can write straight to Google Drive.</p>
          {active && <button className="btn primary" onClick={() => void exportUniverse(active.id)}>Export “{active.name}”</button>}
        </section>
        <section className="card">
          <h2>Integrity check</h2>
          <p className="small muted">Runs SQLite's full integrity check and the universe's consistency rules.</p>
          <button className="btn" disabled={!active} onClick={() => void check()}>Check the open universe</button>
          {integrity && (
            <table className="data" style={{ marginTop: 10 }}><tbody>
              <tr><td>Database (SQLite integrity_check)</td><td style={{ color: integrity.sqlite === 'ok' ? 'var(--ok)' : 'var(--bad)' }}>{integrity.sqlite}</td></tr>
              {integrity.checks.map((c) => <tr key={c.name}><td>{c.name}</td><td style={{ color: c.ok ? 'var(--ok)' : 'var(--bad)' }}>{c.detail}</td></tr>)}
            </tbody></table>
          )}
        </section>
        {active && <CountyScopeCard />}
        <section className="card">
          <h2>Diagnostics</h2>
          <p className="small muted">Measures this device's performance on the kernels the simulation uses. Results are real measurements, not estimates.</p>
          <button className="btn" disabled={running} onClick={() => void runDiag()}>{running ? 'Running…' : 'Run diagnostics'}</button>
          {diag && <table className="data" style={{ marginTop: 10 }}><tbody>{diag.map((d) => <tr key={d.name}><td>{d.name}</td><td className="num"><strong>{d.value.toLocaleString()}</strong> {d.unit}</td><td className="tiny muted">{d.note}</td></tr>)}</tbody></table>}
        </section>
        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>About</h2>
          {/* Keep this card current: update it at the end of every phase. */}
          <p className="small"><strong>Election Night: America</strong> · built through Phase {BUILT_THROUGH} of the roadmap · simulation engine {engineVersion}, last updated {engineUpdated}.</p>
          <p className="tiny muted">The engine version goes up by one each time the simulation itself changes; a minor fix adds .1. A phase that adds only screens, maps or pages keeps it: the same seed then still gives the same universe.</p>
          <p className="small">A persistent simulation of American elections that starts on January 1, 2016. The geography, the population and the institutions are real as of that day. Every politician, campaign and event is fictional, and each universe writes its own history from there.</p>
          <h3>What it simulates</h3>
          <ul className="small">
            <li><strong>The country:</strong> 3,142 counties built from about 265,000 Census-block areas, with each area's adults by age, race and education. Every January the population moves on: people age, die, come of age, naturalize and move. The electorate evolves too: party platforms shift and loyalties drift, so realignments emerge rather than being scripted.</li>
            <li><strong>Elections:</strong> President (with the Electoral College), Senate, House, governors and every state legislature, including multi-member districts and New Hampshire's floterial districts. Also the other statewide offices, elected boards, state courts (partisan, nonpartisan and retention elections) and statewide ballot measures. Primaries and runoffs follow each state's 2016 rules. Presidential nominations are won through primaries and caucuses, delegates and conventions.</li>
            <li><strong>County government:</strong> every county's elected offices as of 2016: the board (commissioners, supervisors, a council or the fiscal court), the executive or county judge, the sheriff, clerks, treasurer, assessor, auditor, recorder, coroner, surveyor and the rest, and the prosecutors, by county or by judicial district (real districts in nine states, generated elsewhere). Boards elected by district get districts drawn inside the county and redrawn after each census. County races follow each state's calendar, including Wisconsin's spring, Tennessee's August and Alaska's October elections. Settings can limit them to the major counties or switch them off.</li>
            <li><strong>Election law:</strong> each state's law of January 1, 2016. It changes only through the universe's own legislatures and ballot measures: ranked-choice voting, top-two and top-four primaries, open or closed primaries. Real-world changes after 2016 are not imported.</li>
            <li><strong>Campaigns and polls:</strong> fundraising, debates, scandals and endorsements; 32 fictional pollsters; polling averages and forecasts, scored against the results.</li>
            <li><strong>Election night:</strong> poll closings, and the count as each state reports it: by county, by town in New England, by House district in Alaska. There is a voter survey and a decision desk, and the broadcast carries projections, Key Race Alerts and commentary. Every county race is counted and projected too, followed in the Desk's county offices, the Analyst and the Results Explorer. Every night can be replayed.</li>
            <li><strong>Between elections:</strong> the economy and presidential approval. Careers: retirements, scandals, deaths, appointments and special elections. Congress's bills and roll calls, and each state's legislative session. The census every ten years, apportionment and redistricting.</li>
            <li><strong>History:</strong> every result is archived, certified and audited. Every state, congressional district, county, New England town and Alaska House district has a history page; a county's page also lists its officeholders and local news. Maps show each year's presidential, Senate, governor and House results.</li>
          </ul>
          <h3>Not yet in the simulation</h3>
          <p className="small">Mayors, city councils and school boards (planned for Phase 7.7), and precinct maps (7.8). Also trial-court judges, appointed county officials, live primary nights, and primaries for state legislative seats (parties nominate directly).</p>
          <h3>Sources</h3>
          <ul className="small">
            <li><strong>Geography and population:</strong> U.S. Census Bureau: the 2010 Census redistricting data, ACS 2012–2016 five-year estimates, the CVAP 2012–2016 special tabulation, the 2016 cartographic boundary files (states, counties, New England towns, congressional and state legislative districts), and the block equivalency files for the 115th Congress and the 2016 state legislative districts.</li>
            <li><strong>Names:</strong> 2010 Census surnames and 1990 Census given names. Real politicians' names (members of Congress since 1945, presidents, vice presidents and recent governors) are used only to keep them out of the generated names.</li>
            <li><strong>Election law, offices, calendars and courts:</strong> as of January 1, 2016, compiled from state constitutions and statutes as summarized by NCSL, Ballotpedia and state election offices. Some details are approximations.</li>
          </ul>
          <p className="tiny muted">Your universes stay in this browser: the app has no server. The election-night broadcast plays short synthesized sound cues (mute with 🔈). Reduced motion follows your system setting until you choose otherwise in the broadcast controls.</p>
        </section>
      </div>
    </>
  );
}

/** Which counties' elected offices the open universe simulates (Phase 7.6). */
function CountyScopeCard() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<'all' | 'major' | 'off' | null>(null);
  useEffect(() => { void engine.request<{ scope: 'all' | 'major' | 'off' }>({ type: 'countyScope' }).then((r) => setScope(r.scope)).catch(() => {}); }, []);
  const shown = scope ?? 'all';
  const change = async (next: 'all' | 'major' | 'off') => {
    setBusy(true);
    try {
      const r = await engine.request<{ scope: 'all' | 'major' | 'off'; ended: number }>({ type: 'countyScope', scope: next });
      setScope(r.scope);
      toast(next === 'off' ? `County offices switched off${r.ended ? `: ${r.ended.toLocaleString()} terms ended` : ''}.`
        : `County offices: ${COUNTY_SCOPES.find(([v]) => v === next)![1].toLowerCase()}${r.ended ? ` (${r.ended.toLocaleString()} terms ended outside it)` : ''}.`);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <section className="card">
      <h2>County offices</h2>
      <p className="small muted">Which counties' elected offices this universe simulates: boards, executives and judges, sheriffs, clerks, treasurers, assessors, coroners and the rest, and prosecutors.</p>
      <div className="stack">
        {COUNTY_SCOPES.map(([v, l]) => (
          <label key={v} className="row small" style={{ gap: 6 }}>
            <input type="radio" name="county-scope" disabled={busy} checked={shown === v} onChange={() => void change(v)} />{l}
          </label>
        ))}
      </div>
      <p className="tiny muted" style={{ marginTop: 6 }}>
        Every county's offices make each election year about a third slower and the universe larger. Narrowing ends the terms outside the new scope (their seats stay empty, their history stays in the archive); widening fills the seats with officeholders from today, and their elections follow the state's calendar.
      </p>
      {busy && <p className="small">Updating county offices…</p>}
    </section>
  );
}
