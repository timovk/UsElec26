import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './theme/app.css';
import { App } from './app/App';

let applyUpdate: () => void = () => location.reload();
let notify: ((v: boolean) => void) | null = null;
let pending = false;

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const update = registerSW({
    onNeedRefresh() { pending = true; notify?.(true); },
    onOfflineReady() { /* app shell cached: works offline from now on */ },
  });
  applyUpdate = () => void update(true);
}

function Root() {
  const [updateAvailable, setUpdate] = useState(pending);
  useEffect(() => { notify = setUpdate; return () => { notify = null; }; }, []);
  return <App updateAvailable={updateAvailable} applyUpdate={() => applyUpdate()} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
