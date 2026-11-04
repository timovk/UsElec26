/// <reference lib="webworker" />
/** Compute Worker: a stateless kernel executor (docs/architecture/02 §2.1). */
import { runShard, type ShardInput } from '../electorate/kernel';
import { outputTransferables } from '../engine/computePool';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (ev: MessageEvent<ShardInput>) => {
  try {
    const out = runShard(ev.data);
    self.postMessage({ ok: true, out }, outputTransferables(out));
  } catch (e) {
    self.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
