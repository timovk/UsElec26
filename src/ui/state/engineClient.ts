/** Main-thread client for the Engine Worker: promise-based requests plus event subscriptions. */
import type { EngineEvent, Query, Request, Response } from '../../engine/protocol';

type Listener = (e: EngineEvent) => void;

export class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners = new Set<Listener>();

  constructor() {
    this.worker = new Worker(new URL('../../workers/engine.worker.ts', import.meta.url), { type: 'module', name: 'engine' });
    this.worker.onmessage = (ev: MessageEvent<Response | EngineEvent>) => {
      const m = ev.data;
      if ('event' in m) { for (const l of this.listeners) l(m); return; }
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
    };
    this.worker.onerror = (e) => { for (const l of this.listeners) l({ event: 'error', message: e.message || 'The simulation engine crashed.' }); };
  }

  request<T>(req: Request, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, req }, transfer);
    });
  }

  query<T>(query: Query): Promise<T> { return this.request<T>({ type: 'query', query }); }

  on(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
}

export const engine = new EngineClient();
