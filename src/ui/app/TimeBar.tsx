import { useEffect, useState } from 'react';
import { engine } from '../state/engineClient';
import { useApp } from '../state/store';
import type { AdvanceTargetMsg, NewsDto } from '../../engine/protocol';
import { formatDate, formatTime } from '../../core/time';
import { fmtBytes } from '../components/common';

const SPEEDS = [{ label: '1 day/s', v: 1 }, { label: '1 week/s', v: 7 }, { label: '1 month/s', v: 30 }, { label: '3 months/s', v: 90 }];

export function TimeBar() {
  const { active, time, playing, set, toast, bump, progress } = useApp();
  const [speed, setSpeed] = useState(7);
  const [busy, setBusy] = useState(false);
  if (!active || time === null) {
    return <div className="timebar"><span className="muted small">No universe open</span><StorageChip /></div>;
  }
  const advance = async (target: AdvanceTargetMsg) => {
    setBusy(true);
    try {
      const news = await engine.request<NewsDto[]>({ type: 'advance', target });
      bump();
      if (target.kind === 'nextEvent' && news.length === 0) toast('Nothing notable happened in the next year of simulated time.');
      else if (news.length) { const top = news.find((n) => n.kind === 'results') ?? news[news.length - 1]!; toast(news.length === 1 ? top.headline : `${top.headline} (+${news.length - 1} more on the Desk)`); }
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const togglePlay = async () => {
    if (playing) { await engine.request({ type: 'pause' }); set({ playing: false }); }
    else { await engine.request({ type: 'play', daysPerSecond: speed }); set({ playing: true }); }
  };
  return (
    <div className="timebar" aria-label="Simulation clock">
      <div>
        <div className="date num">{formatDate(time, 'America/New_York', true)}</div>
        <div className="tiny muted">{formatTime(time)} · {active.name}</div>
      </div>
      <span className="sep" />
      <button className="btn primary" onClick={() => void togglePlay()} disabled={busy} aria-pressed={playing}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
      <select aria-label="Playback speed" value={speed} onChange={(e) => { const v = Number(e.target.value); setSpeed(v); if (playing) void engine.request({ type: 'play', daysPerSecond: v }); }}>
        {SPEEDS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
      </select>
      <span className="sep" />
      <button className="btn small" disabled={busy || playing} onClick={() => void advance({ kind: 'days', days: 1 })}>+1 day</button>
      <button className="btn small" disabled={busy || playing} onClick={() => void advance({ kind: 'days', days: 7 })}>+1 week</button>
      <button className="btn small" disabled={busy || playing} onClick={() => void advance({ kind: 'days', days: 30 })}>+1 month</button>
      <button className="btn small" disabled={busy || playing} onClick={() => void advance({ kind: 'days', days: 365 })}>+1 year</button>
      <button className="btn small" disabled={busy || playing} onClick={() => void advance({ kind: 'nextEvent', maxDays: 366 })} title="Advance until something newsworthy happens (at most one year)">Next event ⏭</button>
      <button className="btn small" disabled={busy || playing} onClick={() => void advance({ kind: 'nextElection' })} title="Advance to the next election day and hold it">Next election 🗳</button>
      {busy && progress && <span className="small muted">{progress.step}… {Math.round(progress.fraction * 100)}%</span>}
      <StorageChip />
    </div>
  );
}

function StorageChip() {
  const { storage, active } = useApp();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  if (!storage) return null;
  const local = storage.kind === 'opfs';
  const exported = active?.lastExportReal ? new Date(active.lastExportReal) : null;
  const days = exported ? Math.floor((now - exported.getTime()) / 86400000) : null;
  return (
    <a className="storage-chip" href="#/settings" title="Universes are stored in this browser on this device. Export regularly to keep a backup.">
      <span style={{ color: local ? 'var(--ok)' : 'var(--warn)' }}>●</span>
      {local ? 'Saved on this device' : 'Temporary storage (not persistent!)'}
      {active && <span>· {days === null ? 'never exported' : days === 0 ? 'exported today' : `last export ${days} d ago`}</span>}
      {storage.usage !== null && <span>· {fmtBytes(storage.usage)} used</span>}
    </a>
  );
}
