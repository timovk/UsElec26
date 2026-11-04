/** Main-thread client for the Broadcast Worker (election-night playback). */
import type { BroadcastRequest, NightFrameDto, NightMarker, RaceDetailDto } from '../../engine/protocol';

export class BroadcastClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('../../workers/broadcast.worker.ts', import.meta.url), { type: 'module', name: 'broadcast' });
    this.worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = this.pending.get(ev.data.id); if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result); else p.reject(new Error(ev.data.error));
    };
  }

  private request<T>(req: BroadcastRequest, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => { this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject }); this.worker.postMessage({ id, req }, transfer); });
  }

  load(payload: Uint8Array): Promise<{ races: number }> { return this.request({ type: 'load', payload }, [payload.buffer]); }
  frame(t: number, focus: number | null, full = false): Promise<NightFrameDto> { return this.request({ type: 'frame', t, focus, full }); }
  markers(): Promise<NightMarker[]> { return this.request({ type: 'markers' }); }
  raceDetail(race: number, t: number, truth: boolean): Promise<RaceDetailDto> { return this.request({ type: 'raceDetail', race, t, truth }); }
  terminate(): void { this.worker.terminate(); }
}
