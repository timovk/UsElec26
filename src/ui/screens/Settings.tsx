import { useState } from 'react';
import { engine } from '../state/engineClient';
import { useApp } from '../state/store';
import type { DiagnosticsResult, IntegrityReport, StorageInfo } from '../../engine/protocol';
import { exportUniverse } from './Hub';
import { fmtBytes } from '../components/common';
import { MapRenderer, loadBasemap, marginColor } from '../map/renderer';

export function Settings() {
  const { storage, active, engineVersion, set, toast } = useApp();
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
        <section className="card">
          <h2>Diagnostics</h2>
          <p className="small muted">Measures this device's performance on the kernels the simulation uses. Results are real measurements, not estimates.</p>
          <button className="btn" disabled={running} onClick={() => void runDiag()}>{running ? 'Running…' : 'Run diagnostics'}</button>
          {diag && <table className="data" style={{ marginTop: 10 }}><tbody>{diag.map((d) => <tr key={d.name}><td>{d.name}</td><td className="num"><strong>{d.value.toLocaleString()}</strong> {d.unit}</td><td className="tiny muted">{d.note}</td></tr>)}</tbody></table>}
        </section>
        <section className="card">
          <h2>About</h2>
          <p className="small">Election Night: America · engine {engineVersion} · Phase 3 (election-night counting).</p>
          <p className="small">Geography and population: U.S. Census Bureau (2010 Census, ACS 2012–2016, CVAP 2012–2016, 2016 cartographic boundaries, 115th Congress and 2016 legislative block equivalency files). Names: Census 2010 surnames and 1990 given names. All politicians, parties' coalitions and events are fictional.</p>
          <p className="tiny muted">Reduced motion follows your system setting. Audio arrives with the election-night broadcast (Phase 4).</p>
        </section>
      </div>
    </>
  );
}
