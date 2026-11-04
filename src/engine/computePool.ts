/**
 * Runs kernel shards. In the browser shards are distributed over a pool of Compute Workers; in Node
 * (tests, tools) they run inline. Results are returned in input order, and the kernel is a pure function
 * of its input, so results are identical for any number of workers.
 */
import { runJobSealed, jobTransferables, type JobInput, type JobOutput } from './nightJob';

export interface ShardRunner { readonly workers: number; run(inputs: JobInput[], onProgress?: (done: number, total: number) => void): Promise<JobOutput[]> }

export class InlineRunner implements ShardRunner {
  readonly workers = 0;
  async run(inputs: JobInput[], onProgress?: (done: number, total: number) => void): Promise<JobOutput[]> {
    const out: JobOutput[] = [];
    for (const inp of inputs) { out.push(await runJobSealed(inp)); onProgress?.(out.length, inputs.length); }
    return out;
  }
}

export { jobTransferables as outputTransferables };

export class WorkerPoolRunner implements ShardRunner {
  private pool: Worker[] = [];
  constructor(private readonly factory: () => Worker, readonly workers: number) {}

  private ensure(): void { while (this.pool.length < this.workers) this.pool.push(this.factory()); }

  async run(inputs: JobInput[], onProgress?: (done: number, total: number) => void): Promise<JobOutput[]> {
    this.ensure();
    const results = new Array<JobOutput>(inputs.length);
    // Largest shards first for load balance; results are placed back by index.
    const order = inputs.map((_, i) => i).sort((a, b) => inputs[b]!.bus.count * (inputs[b]!.contests.length + 2) - inputs[a]!.bus.count * (inputs[a]!.contests.length + 2) || a - b);
    let next = 0, done = 0;
    await Promise.all(this.pool.map((w) => new Promise<void>((resolve, reject) => {
      const pump = () => {
        if (next >= order.length) { w.onmessage = null; resolve(); return; }
        const idx = order[next++]!;
        w.onmessage = (ev: MessageEvent<{ ok: boolean; out?: JobOutput; error?: string }>) => {
          if (!ev.data.ok) { reject(new Error(ev.data.error)); return; }
          results[idx] = ev.data.out!; done++; onProgress?.(done, inputs.length); pump();
        };
        w.onerror = (e) => reject(new Error(e.message || 'compute worker failed'));
        w.postMessage(inputs[idx]);
      };
      pump();
    })));
    return results;
  }

  terminate(): void { for (const w of this.pool) w.terminate(); this.pool = []; }
}
