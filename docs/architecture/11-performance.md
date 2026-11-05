# 11 — Performance Strategy

## 11.1 Budgets (reference Chromebook, §1.5)

| Operation | Budget | Notes |
|---|---|---|
| First load (network) | ≤ 5 s to interactive Hub | App shell ≤ 400 KB gz; SQLite WASM ≈ 1 MB; geography lazily loaded |
| Warm start (cached, offline) | ≤ 2 s to Hub; ≤ 3 s to open a universe | |
| Create universe | ≤ 15 s | With a progress display |
| Advance 1 simulated day (no election) | ≤ 50 ms | Event-driven; most days touch little state |
| Advance 1 month | ≤ 1.5 s | Includes polls and an economic release |
| Advance 1 year with a general election, excluding the night | ≤ 40 s | Kernel ≈ 5–8 s, count plan ≈ 4 s, observers ≈ 3 s, forecasts |
| Election-night frame (main thread) | ≤ 4 ms per diff | Diffs at ≤ 10 Hz; animations on the compositor |
| County map recolor | ≤ 50 ms | Canvas2D redraw on change |
| Pan/zoom animation | ≥ 50 fps | Cached-bitmap transform, crisp re-raster at the end |
| Archive: county history over 100 years | ≤ 200 ms | §7.8 |
| 100-year headless run | ≤ 60 min on reference; ≤ 20 min on desktop | Mostly daily processes plus about 50 generals |
| Memory (all threads) | ≤ 600 MB typical, ≤ 900 MB peak | 4 GB Chromebooks must work |

## 11.2 Measured in Phase 0 (see [15-feasibility-spikes.md](15-feasibility-spikes.md))

| Spike | Result (2.1 GHz Xeon, 1 thread unless noted) | Consequence |
|---|---|---|
| Ballot kernel: 230k BU × 4 modes × 8 contests, realized per (BU, mode, contest) | **2.8 s**, 22.1M binomial draws, 0 sum violations | Within budget once split across a 3–4 worker pool on Chromebook-class cores (estimate 2–5 s) |
| Same kernel but realized per latent stratum (5 strata) | 15.5 s | Rejected. Strata are kept analytic, which led to the type design in §4.4. |
| Same, 12 contests per ballot | 4.2 s | Linear scaling in contests |
| Archive encoding: column varint + deflate-raw | **1.06 bytes/count** (from 4 bytes raw) | Basis of the §7.4 budget |
| Canvas2D: 3,142 counties fill + stroke at 2× DPR, headless Chromium, software raster | **32 ms median**, 41 ms p90; parse and Path2D build 67 ms | Redraw on change only; bitmap caching for motion; WebGL2 for denser layers |

These are server-CPU numbers. A Chromebook core is roughly 1.5–3× slower. The **Diagnostics** page (Phase 1)
runs the same kernels on the user's device and reports real figures.

### Measured in Phase 2 (see [../phase-2-report.md](../phase-2-report.md) §7)

| Operation | Chromium, 3 compute workers (4-core server) | Node, 1 thread |
|---|---|---|
| General election day (51 states, ~560 contests at Base-Unit grain) | 6.0 s: kernel 1.8 s, tally 0.15 s, seal and archive 2.8 s | 7.7 s: kernel 6.3 s, tally 0.26 s, archive 0.97 s |
| A primary day | 0.1–2.3 s | — |
| Advance through all of 2016 (no election night yet) | 21 s (budget ≤ 40 s with Phases 3–5) | ~30 s |
| Archive audit of all 2016 elections (~810k unit-contest records) | — | 1.5–1.8 s |

One lesson: every OPFS transaction commit costs a sync, about 85 ms in headless Chromium here. Writing the 51
states of a general election in separate transactions cost 4.4 s. They are now written in one.

### Measured in Phase 3 (see [../phase-3-report.md](../phase-3-report.md) §7)

| Operation | Chromium, 3 compute workers (4-core server) | Node, 1 thread |
|---|---|---|
| General election day at the ballot lock (kernel, count plan, wire, survey, desk, sealing, night record) | 13.7 s: shards 1.1 s, kernel + night jobs 5.2 s, tally 0.2 s, seal cast 3.2 s, night record 1.6 s, write 1.5 s | 17.2 s: kernel + night jobs 14.4 s, seal 1.1 s, record 0.9 s |
| Advance through all of 2016 (no viewing) | 38 s | ~46 s |
| Playback frame (Broadcast Worker, ~560 races) | interactive at 10 Hz; 5:00 pm → midnight in 45 s at 600× including live advances | — |
| Night record | 1.66 MB, 67k batches, 280k race rows | |
| Archive audit including the night (≈1.6M unit records) | — | 3.5 s |

Against the Chromebook budget (§11.1: ≤ 40 s for a year with a general election, excluding watching the night), the
server measurement of 38 s suggests roughly 55–115 s on a Chromebook. Known levers: seal and encode results in the
compute workers (≈2 s of the 3.2 s seal step), cheaper primaries, and fewer evaluations by the desk on quiet races.

### Measured in Phase 4 (see [../phase-4-report.md](../phase-4-report.md) §5)

| Operation | Chromium, 1366×768 (4-core server, headless) |
|---|---|
| Broadcast playback at 600×, live (banners, counters, ticker, universe advancing) | frame interval median and p95 16.7 ms (60 fps) |
| Magic-wall camera flight (vector redraw per frame) | median 16.7 ms (60 fps) |
| Map recolour, state and county views | p95 ≤ 1.2 ms (budget 50 ms) |
| Alerts and commentary for a real night (at the ballot lock) | 0.41 s (Node) |
| Jan 1 → the 2016 general's ballot lock | 28.6–31.3 s (Phase 3: 30–34 s) |
| The Election Day step (ballot lock) | 13.1–13.7 s (Phase 3: 13.7 s). The engine's seal step fell from 3.2 s to 0.07 s (sealing now happens in the compute workers, +1.4 s there); the night-record step grew by about 1.5 s (it now writes the commentary) |

### Measured in Phase 5 (see [../phase-5-report.md](../phase-5-report.md) §5.3)

| Operation | Chromium, 1366×768 (4-core server, headless) |
|---|---|
| Jan 1 → the 2016 general's ballot lock (stopping on every primary day) | 76.5–78.1 s (Phase 4: 28.6–31.3 s): the daily campaign season (polls, averages, forecasts, campaigns) is the new cost |
| The whole of 2016 (**+1 year**) | 72.4–78.0 s |
| Election Day work at the ballot lock | About 12 s, as in Phase 4 |
| Season work over 2016, Node, real geography | Poll fieldwork 6.0 s (1,552 polls); forecasts 4.0 s (106 runs of 1,500 draws); voter-type caches 3.8 s; races 1.0 s; campaigns 0.8 s |
| Playback, camera flight, recolour | Unchanged |

**This is over the §11.1 budgets.** A year with a general election takes 72–78 s on this server against a budget
of 40 s on the slower reference Chromebook. A campaign month takes about 6–7 s here against 1.5 s; 2–4 minutes
from January to Election Day are expected on a Chromebook. Mitigations, in order:
1. the forecast in a compute worker, in parallel with the day's fieldwork;
2. poll fieldwork in the compute workers;
3. incremental forecast inputs;
4. fewer draws before the final 100 days.

### Measured in Phase 6 (see [../phase-6-report.md](../phase-6-report.md) §5.5)

| Measurement | Value |
|---|---|
| Chromium, January 1 → the 2016 ballot lock (unloaded CI runner) | 91 s (Phase 5: 77 s on this server) |
| Chromium, auditing the 2016 archive | 151 s (it re-checks about 5,000 legislative contests) |
| Node, real geography, a presidential year | 152 s (2016) → 331 s (2040) |
| Node, real geography, an odd year | 30 s (2017) → 83 s (2039) |
| Redistricting (all congressional and legislative plans), once a decade | about 100–140 s |
| September 2036 before and after the contest indexes (schema 6) | 75 s → 8.6 s |
| Universe database on the real geography | about 16–18 MB per simulated year (431 MB by 2041) |

Phase 6 is over budget in both time and storage. The main causes are about 6,000 state legislative contests every
even year and a history that grows: tracked people rise from 8,800 to 80,000 by 2041.

Levers, in order:
1. certify and archive legislative contests in bulk;
2. run forecasts and poll fieldwork in the compute workers;
3. cache per-day contest lookups;
4. keep fewer full records for never-elected legislative candidates;
5. compact per-contest archives for legislative seats.

## 11.3 Likely bottlenecks and mitigations

| Bottleneck | Mitigation |
|---|---|
| Ballot realization at national BU scale | Type-collapsed aggregation (choice probabilities per county, not per BU); typed arrays; skip empty (BU, mode) cells; shard by state across the pool with keyed RNG; port to WASM (Rust) only if measurements miss the budget |
| Daily simulation cost over 100 years | Discrete-event scheduling; multi-rate processes; poll fieldwork through cached swing-response curves (no BU-level work per poll); idle days cost ≈ 0 |
| Forecast Monte Carlo | Aggregated state/district model (not BU); 20k draws across the pool; analytic shortcuts for safe races; daily only in the final 100 days |
| Count plan + desk evaluation | Hypergeometric chunking in the pool; desks evaluate analytically in O(RJs in contest) per update, with Monte Carlo only near thresholds; evaluation throttled to at most once per simulated minute per contest |
| Map rendering on weak GPUs | Pre-projected quantized geometry; Path2D cache; redraw-on-change; cached bitmaps during motion; LOD by zoom; viewport culling with flatbush; WebGL2 texture-based recolor for ≥ 10k features |
| Geography download size | Per-state lazy loading; service-worker cache; an optional "make available offline" prefetch |
| SQLite write amplification | Blobs, not rows, for numeric mass; one transaction per simulated day or batch; 8–16 KB page size (benchmarked in Phase 1); hot-state checkpoints only for changed keys |
| Archive query latency | Materialized rollups per (election, state); `contest_geo` index; LRU of decoded blobs in the engine worker |
| React re-render storms during a night | Worker-side diffing; ≤ 10 Hz updates; memoized panels; virtualized tables; no React inside the map |
| GC pauses | Transferable buffers instead of structured clones; preallocated typed arrays in kernels; no per-frame allocation in renderers |
| Thermal throttling on fanless devices | Pool size `min(4, cores − 1)`; budgets carry roughly 2× headroom; long jobs yield, report progress and can be cancelled |

## 11.4 Measurement discipline

- **Bench harness** (`tools/bench/`): Playwright drives Chromium with DevTools CPU throttling (4×) to
  approximate the reference device, runs named benchmarks, and writes JSON results to `tools/bench/results/`.
  CI compares results against the budgets and the last baseline and fails on regressions above 20%.
- **On-device Diagnostics** (Settings → Diagnostics): runs a reduced suite (kernel, codec, map redraw, DB
  write/read) on the user's Chromebook and shows the numbers. You can paste them into an issue to calibrate the budgets.
- Benchmarks report medians and p90 over repeated runs, never best-case numbers.
