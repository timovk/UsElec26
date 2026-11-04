/// <reference lib="webworker" />
/** Compute Worker: a stateless kernel executor (docs/architecture/02 §2.1). */
import { jobTransferables, runJob, type JobInput } from '../engine/nightJob';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (ev: MessageEvent<JobInput>) => {
  try {
    const out = runJob(ev.data);
    self.postMessage({ ok: true, out }, jobTransferables(out));
  } catch (e) {
    self.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
