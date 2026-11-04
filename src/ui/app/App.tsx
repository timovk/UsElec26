import { useEffect, useState } from 'react';
import { engine } from '../state/engineClient';
import { refreshSlots, useApp } from '../state/store';
import type { SlotInfo, StorageInfo } from '../../engine/protocol';
import { useRoute } from './router';
import { TimeBar } from './TimeBar';
import { Hub } from '../screens/Hub';
import { Desk } from '../screens/Desk';
import { MapScreen } from '../screens/MapScreen';
import { People } from '../screens/People';
import { PersonScreen } from '../screens/PersonScreen';
import { Settings } from '../screens/Settings';
import { ElectorateScreen } from '../screens/ElectorateScreen';
import { Results } from '../screens/Results';
import { ContestScreen } from '../screens/ContestScreen';
import { ArchiveScreen, CountyScreen } from '../screens/CountyScreen';
import { ElectionNight } from '../screens/ElectionNight';
import { PollsScreen } from '../screens/Polls';
import { PrimariesScreen } from '../screens/Primaries';

const NAV: { id: string; label: string; ico: string; needsUniverse?: boolean }[] = [
  { id: 'hub', label: 'Universes', ico: '◎' },
  { id: 'desk', label: 'Desk', ico: '▤', needsUniverse: true },
  { id: 'map', label: 'Map', ico: '◩', needsUniverse: true },
  { id: 'night', label: 'Election Night', ico: '★', needsUniverse: true },
  { id: 'analyst', label: 'Analyst', ico: '∑', needsUniverse: true },
  { id: 'polls', label: 'Polls', ico: '%', needsUniverse: true },
  { id: 'primaries', label: 'Primaries', ico: '⚑', needsUniverse: true },
  { id: 'results', label: 'Results', ico: '▦', needsUniverse: true },
  { id: 'archive', label: 'Archive', ico: '⌛', needsUniverse: true },
  { id: 'people', label: 'People', ico: '☰', needsUniverse: true },
  { id: 'electorate', label: 'Electorate', ico: '◆', needsUniverse: true },
];
const PLANNED: { label: string; ico: string; phase: number }[] = [];

export function App({ updateAvailable, applyUpdate }: { updateAvailable: boolean; applyUpdate: () => void }) {
  const { ready, fatal, active, toasts, set } = useApp();
  const route = useRoute();
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    engine.request<{ storage: StorageInfo; slots: SlotInfo[]; engineVersion: string }>({ type: 'init' })
      .then((r) => { set({ ready: true, storage: r.storage, slots: r.slots, engineVersion: r.engineVersion }); })
      .catch((e: Error) => set({ fatal: e.message }))
      .finally(() => setBooting(false));
  }, [set]);

  useEffect(() => { if (ready && !active && route.screen !== 'hub' && route.screen !== 'settings') location.hash = '#/hub'; }, [ready, active, route.screen]);

  if (fatal) return <div className="modal-back"><div className="modal"><h2 className="screen-title">Cannot start</h2><p>{fatal}</p><button className="btn" onClick={() => location.reload()}>Retry</button></div></div>;
  if (booting) return <div className="modal-back"><div className="modal"><div className="kicker">Election Night: America</div><p>Starting the simulation engine…</p></div></div>;

  const needsUniverse = ['desk', 'map', 'people', 'electorate', 'results', 'contest', 'county', 'archive', 'night', 'analyst', 'polls', 'primaries'].includes(route.screen);
  const screen = (() => {
    if (needsUniverse && !active) return <Hub />; // never query without an open universe
    switch (route.screen) {
      case 'desk': return <Desk />;
      case 'map': return <MapScreen initial={route.params[0] === 'results' ? { year: Number(route.params[1]) } : undefined} />;
      case 'night': return <ElectionNight id={route.params[0] ? Number(route.params[0]) : undefined} view={route.params[1]} />;
      case 'polls': return <PollsScreen year={route.params[0] ? Number(route.params[0]) : undefined} tab={route.params[1]} arg={route.params[2]} />;
      case 'primaries': return <PrimariesScreen year={route.params[0] ? Number(route.params[0]) : undefined} />;
      case 'analyst': return <ElectionNight id={route.params[0] ? Number(route.params[0]) : undefined} view="analyst" />;
      case 'results': return <Results year={route.params[0] ? Number(route.params[0]) : undefined} />;
      case 'contest': return <ContestScreen id={Number(route.params[0])} />;
      case 'county': return <CountyScreen idx={Number(route.params[0])} />;
      case 'archive': return <ArchiveScreen stateIdx={route.params[0] !== undefined ? Number(route.params[0]) : undefined} />;
      case 'people': return route.params[0] ? <PersonScreen id={Number(route.params[0])} /> : <People />;
      case 'electorate': return <ElectorateScreen />;
      case 'settings': return <Settings />;
      default: return <Hub />;
    }
  })();

  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <img className="logo" src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="Election Night: America" />
        {NAV.map((n) => (n.needsUniverse && !active ? null : (
          <a key={n.id} href={`#/${n.id}`} className={route.screen === n.id || (n.id === 'hub' && route.screen === '') || (n.id === 'results' && route.screen === 'contest') || (n.id === 'archive' && route.screen === 'county') ? 'active' : ''}>
            <span className="ico" aria-hidden>{n.ico}</span>{n.label}
          </a>)))}
        {active && PLANNED.map((p) => <span key={p.label} className="planned" title={`Planned for Phase ${p.phase}`}><span className="ico" aria-hidden>{p.ico}</span>{p.label}<span className="tiny">Phase {p.phase}</span></span>)}
        <div className="spacer" />
        <a href="#/settings" className={route.screen === 'settings' ? 'active' : ''}><span className="ico" aria-hidden>⚙</span>Settings</a>
      </nav>
      <main className={`screen${route.screen === 'night' && (route.params[1] ?? 'broadcast') === 'broadcast' ? ' tight' : ''}`} key={route.screen}>{screen}</main>
      <TimeBar />
      <div className="toasts" aria-live="polite">
        {updateAvailable && <div className="toast">A new version of the app is ready. <button className="btn small" onClick={applyUpdate}>Reload to update</button></div>}
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </div>
  );
}

export { refreshSlots };
