import { useRef, useState } from 'react';
import { engine } from '../state/engineClient';
import { refreshSlots, useApp } from '../state/store';
import type { SlotInfo } from '../../engine/protocol';
import { formatDate } from '../../core/time';
import { fmtBytes } from '../components/common';
import { go } from '../app/router';

export async function saveFile(bytes: Uint8Array, fileName: string): Promise<'picker' | 'download'> {
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> };
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'Election Night: America universe', accept: { 'application/octet-stream': ['.ena'] } }] });
      const s = await h.createWritable(); await s.write(bytes as BlobPart); await s.close(); return 'picker';
    } catch (e) { if ((e as DOMException).name === 'AbortError') throw e; }
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'download';
}

export async function exportUniverse(id: string): Promise<void> {
  const { toast, set, active } = useApp.getState();
  try {
    const r = await engine.request<{ bytes: Uint8Array; fileName: string }>({ type: 'export', id });
    const how = await saveFile(r.bytes, r.fileName);
    toast(how === 'picker' ? `Saved ${r.fileName}.` : `Downloaded ${r.fileName} to your Downloads folder.`);
    await refreshSlots();
    if (active?.id === id) set({ active: useApp.getState().slots.find((s) => s.id === id) ?? active });
  } catch (e) { if ((e as DOMException).name !== 'AbortError') toast(`Export failed: ${(e as Error).message}`, 'error'); }
}

/** County offices simulated (Phase 7.6). */
export const COUNTY_SCOPES: ['all' | 'major' | 'off', string][] = [
  ['all', 'Every county’s offices'], ['major', 'Counties of 250,000 people or more'], ['off', 'No county offices'],
];

export function Hub() {
  const { slots, active, storage, progress, set, toast } = useApp();
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [county, setCounty] = useState<'all' | 'major' | 'off'>('all');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SlotInfo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = async (s: SlotInfo) => {
    try {
      const info = await engine.request<SlotInfo>({ type: 'open', id: s.id });
      set({ active: info, time: info.currentTime, playing: false, liveNews: [] }); go('desk');
    } catch (e) { toast(`Could not open the universe: ${(e as Error).message}`, 'error'); }
  };
  const create = async () => {
    setCreating(true); set({ progress: { step: 'Starting', fraction: 0 } });
    try {
      const info = await engine.request<SlotInfo>({ type: 'create', name: name.trim() || 'My America', seed: seed.trim() || undefined, county });
      set({ active: info, time: info.currentTime, playing: false, liveNews: [], progress: null });
      await refreshSlots();
      try { await navigator.storage?.persist?.(); } catch { /* unsupported */ } // only available on the main thread
      const st = await engine.request<typeof storage>({ type: 'storage' }); set({ storage: st });
      go('desk');
    } catch (e) { toast(`Could not create the universe: ${(e as Error).message}`, 'error'); set({ progress: null }); }
    finally { setCreating(false); }
  };
  const doImport = async (f: File) => {
    try {
      const info = await engine.request<SlotInfo>({ type: 'import', bytes: new Uint8Array(await f.arrayBuffer()) });
      await refreshSlots(); toast(`Imported “${info.name}”.`);
    } catch (e) { toast(`Import failed: ${(e as Error).message}`, 'error'); }
  };
  const doDelete = async (s: SlotInfo) => {
    setConfirmDelete(null);
    try {
      await engine.request({ type: 'delete', id: s.id });
      if (active?.id === s.id) set({ active: null, time: null });
      await refreshSlots(); toast(`Deleted “${s.name}”.`);
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  return (
    <>
      <div className="kicker">Election Night: America</div>
      <h1 className="screen-title">Universes</h1>
      <p className="screen-sub">Each universe is one continuous political history of a fictional United States, beginning January 1, 2016.</p>

      <div className="grid cols-2">
        <section className="card">
          <h2>Start a new universe</h2>
          <p className="muted small">Fictional politicians and electorate; real American geography and institutions. The political geography — which states and counties lean which way — is generated fresh for every universe.</p>
          <div className="stack">
            <label className="row"><span style={{ width: 70 }}>Name</span><input type="text" value={name} placeholder="My America" onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} maxLength={60} /></label>
            <button className="btn ghost small" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>{advanced ? '▾' : '▸'} Advanced</button>
            {advanced && (
              <>
                <label className="row"><span style={{ width: 70 }}>Seed</span><input type="text" value={seed} placeholder="random" onChange={(e) => setSeed(e.target.value)} style={{ flex: 1 }} maxLength={64} />
                  <span className="tiny muted">Same seed → same universe.</span></label>
                <label className="row"><span style={{ width: 70 }}>Counties</span>
                  <select value={county} onChange={(e) => setCounty(e.target.value as typeof county)} style={{ flex: 1 }} aria-label="County offices">
                    {COUNTY_SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select></label>
                <span className="tiny muted">Every county's elected offices (boards, sheriffs, clerks, prosecutors…) make each even-year election about a third slower and the universe about twice as large. You can change this later in Settings.</span>
              </>
            )}
            <button className="btn primary" disabled={creating} onClick={() => void create()}>Create universe</button>
          </div>
        </section>

        <section className="card">
          <h2>Your data</h2>
          <p className="small" style={{ marginTop: 0 }}>
            {storage?.kind === 'opfs'
              ? <>Universes are saved automatically <strong>in this browser on this device</strong>. That is not a backup: clearing site data, Powerwash or Guest mode deletes them. Use <strong>Export</strong> to save a <code>.ena</code> file — for example to Google Drive — and <strong>Import</strong> to restore it.</>
              : <><strong>Warning:</strong> persistent storage is unavailable in this browser session, so universes will be lost when the tab closes. Export before leaving.</>}
          </p>
          <div className="row wrap">
            <button className="btn" onClick={() => fileRef.current?.click()}>Import a universe (.ena)</button>
            <input ref={fileRef} type="file" accept=".ena" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ''; }} />
            {storage && <span className="tiny muted">{storage.persisted ? 'Persistent storage granted.' : 'Persistent storage not granted (the browser may evict data under storage pressure).'}</span>}
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Saved universes <span className="muted small">{slots.length}</span></h2>
        {slots.length === 0 ? <p className="muted">No universes yet. Create one above.</p> : (
          <table className="data">
            <thead><tr><th>Name</th><th>Universe date</th><th>Seed</th><th>Created</th><th>Last export</th><th>Size</th><th /></tr></thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong>{active?.id === s.id && <span className="badge record" style={{ marginLeft: 8 }}>Open</span>}</td>
                  <td className="num">{formatDate(s.currentTime, 'America/New_York', true)}</td>
                  <td className="num muted">{s.seed}</td>
                  <td className="muted">{new Date(s.createdReal).toLocaleDateString()}</td>
                  <td className={s.lastExportReal ? 'muted' : ''} style={s.lastExportReal ? undefined : { color: 'var(--warn)' }}>{s.lastExportReal ? new Date(s.lastExportReal).toLocaleString() : 'Never'}</td>
                  <td className="num muted">{fmtBytes(s.bytes)}</td>
                  <td className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn small primary" onClick={() => void open(s)}>Open</button>
                    <button className="btn small" onClick={() => void exportUniverse(s.id)}>Export</button>
                    <button className="btn small danger" onClick={() => setConfirmDelete(s)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {creating && progress && (
        <div className="modal-back" role="dialog" aria-label="Creating universe">
          <div className="modal">
            <div className="kicker">Creating universe</div>
            <h2 className="screen-title" style={{ fontSize: 24 }}>{progress.step}…</h2>
            <div className="progress"><div style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></div>
            <p className="tiny muted">Generating 265,023 Census block-group units, a fictional electorate and the 2016 government. This takes several seconds.</p>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="modal-back" role="dialog" aria-label="Confirm delete">
          <div className="modal">
            <h2 className="screen-title" style={{ fontSize: 24 }}>Delete “{confirmDelete.name}”?</h2>
            <p>This permanently deletes the universe and its entire history from this device. {confirmDelete.lastExportReal ? `Your last export was ${new Date(confirmDelete.lastExportReal).toLocaleString()}.` : 'It has never been exported.'}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => void exportUniverse(confirmDelete.id)}>Export first</button>
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn danger" onClick={() => void doDelete(confirmDelete)}>Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
