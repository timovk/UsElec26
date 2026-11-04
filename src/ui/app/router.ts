import { useEffect, useState } from 'react';

export interface Route { screen: string; params: string[] }

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [screen = '', ...params] = h.split('/').filter(Boolean).map(decodeURIComponent);
  return { screen: screen || 'hub', params };
}

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => { const f = () => setR(parse()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}

export const go = (path: string) => { location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`; };
