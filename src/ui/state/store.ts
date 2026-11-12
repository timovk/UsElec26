import { create } from 'zustand';
import type { NewsDto, SlotInfo, StorageInfo } from '../../engine/protocol';
import { engine } from './engineClient';

interface AppState {
  ready: boolean; fatal: string | null;
  storage: StorageInfo | null; slots: SlotInfo[]; engineVersion: string; engineUpdatedIn: string;
  active: SlotInfo | null; time: number | null; playing: boolean;
  progress: { step: string; fraction: number } | null;
  toasts: { id: number; text: string; kind: 'info' | 'error' }[];
  liveNews: NewsDto[];
  revision: number; // bumps whenever universe state changes, so screens refetch
  set: (p: Partial<AppState>) => void;
  toast: (text: string, kind?: 'info' | 'error') => void;
  bump: () => void;
}

let toastId = 1;
export const useApp = create<AppState>((set, get) => ({
  ready: false, fatal: null, storage: null, slots: [], engineVersion: '', engineUpdatedIn: '', active: null, time: null, playing: false, progress: null, toasts: [], liveNews: [], revision: 0,
  set: (p) => set(p),
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 9000 : 4500);
  },
  bump: () => set({ revision: get().revision + 1 }),
}));

engine.on((e) => {
  const s = useApp.getState();
  if (e.event === 'progress') s.set({ progress: { step: e.step, fraction: e.fraction } });
  else if (e.event === 'clock') { s.set({ time: e.time, playing: e.playing }); s.bump(); }
  else if (e.event === 'news') s.set({ liveNews: [...e.items.slice().reverse(), ...s.liveNews].slice(0, 40) });
  else if (e.event === 'error') { s.set({ playing: false }); s.toast(e.message, 'error'); }
});

export async function refreshSlots(): Promise<void> {
  const slots = await engine.request<SlotInfo[]>({ type: 'list' });
  useApp.getState().set({ slots });
}
