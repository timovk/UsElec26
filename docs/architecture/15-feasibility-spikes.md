# 15 — Phase 0 Feasibility Spike Results

All spikes are in [`tools/spikes/`](../../tools/spikes/). They are **throwaway measurement code, not
application code**. Machine: cloud container, Intel Xeon @ 2.10 GHz, 4 vCPUs, Node v22.23.4,
Playwright-bundled headless Chromium. All runs are single-threaded.

## S1. Data-source reachability (this development environment)

| Host | Result |
|---|---|
| `registry.npmjs.org` | Reachable |
| `raw.githubusercontent.com` | Reachable |
| `www2.census.gov` | **Blocked** by the environment's network policy (proxy 403 on CONNECT) |
| `api.census.gov` | **Blocked** (same) |
| `cdn.jsdelivr.net`, `unpkg.com` | Blocked |

Consequence: Phase 1's geographic pipeline needs `www2.census.gov` and `api.census.gov` allow-listed (README,
decision 2).

## S2. County geometry (`us-atlas@3.0.1`, Census 2017 cartographic boundaries 1:10m)

| Measure | Value |
|---|---|
| County-equivalents | **3,142** (50 states + DC) |
| Alaska | 29 (Valdez-Cordova still a single census area, i.e. the pre-2019 set) |
| Connecticut | 8 counties (pre-2022 set) |
| Virginia | 133 (95 counties + 38 independent cities) |
| Louisiana | 64 parishes |
| Pre-projected Albers TopoJSON size | 795 KB raw; 9,462 arcs; 37,858 arc points |

The 2017 edition has the same county set as 2016, so it is suitable as the Phase 1 fallback and for rendering
prototypes.

## S3. Ballot kernel (`tools/spikes/ballot-kernel-bench.mjs`)

Synthetic inputs at national scale. Each run checks the invariant *Σ options (including undervote) = ballots* for every (BU, mode, contest).

| Configuration | Ballots | Binomial draws | Time | ns/draw | Sum violations |
|---|---|---|---|---|---|
| 230k BU × 4 modes × **5 strata** × 8 contests | 135.7M | 110.4M | 15,497 ms | 140 | 0 |
| 230k BU × 4 modes × 3 strata × 8 contests | 81.4M | 66.2M | 9,200 ms | 139 | 0 |
| 230k BU × 4 modes × **collapsed** × 8 contests | 135.7M | 22.1M | **2,834 ms** | 128 | 0 |
| 230k BU × 4 modes × collapsed × 12 contests | 135.7M | 33.1M | 4,229 ms | 128 | 0 |
| 4.5k units × 4 modes × 5 strata × 4 contests | 2.6M | 1.1M | 160 ms | 148 | 0 |

County roll-up (230k → 3,142 units, all contests) took 60–97 ms.

**Conclusion:** realizing per latent stratum is too slow. Collapsing strata analytically and realizing per (BU, mode,
contest), as the design in §4.4–4.5 specifies, costs about 2.8 s single-threaded on this CPU. With a 3–4 worker
pool on a Chromebook, and before any sampler optimization (the spike's inversion sampler calls `Math.pow` per
draw; BTPE and table-based normals are planned), this is within budget.

## S4. Archive encoding (`tools/spikes/archive-encoding-bench.mjs`)

| Units × options | Raw (uint32) | Column-major varint + deflate-raw | Bytes/count | Delta + implied last column |
|---|---|---|---|---|
| 230k × 4 | 3.68 MB | **0.98 MB** | **1.06** | 1.23 MB (1.33 B/count) |
| 50k × 4 | 0.80 MB | 0.21 MB | 1.06 | 0.27 MB |

Delta coding did not help because the synthetic unit order carries little spatial signal. It will be retested with
Hilbert-ordered real units.

## S5. Canvas2D county rendering (`tools/spikes/map-render-bench.mjs`)

| Measure | Value |
|---|---|
| Parse TopoJSON + build 3,142 `Path2D` | 67 ms |
| Full frame (fill + 0.25 px stroke, all counties, 2× DPR), median of 20 | **32.2 ms** |
| p90 | 41.4 ms |
| Renderer | Headless Chromium, software raster (no GPU) |

**Conclusion:** a full redraw is acceptable on data change (≤ 50 ms budget), but not per animation frame.
The design redraws on change, transforms cached bitmaps during motion, and uses WebGL2 for denser layers.

## How to re-run

```bash
node tools/spikes/ballot-kernel-bench.mjs [baseUnits] [strata] [contests] [ballotScale]
node tools/spikes/ballot-kernel-bench.mjs 230000 1 8 5      # the "collapsed" row
node tools/spikes/archive-encoding-bench.mjs [units] [options]
node tools/spikes/map-render-bench.mjs <dir with counties-albers-10m.json and topojson-client.min.js>
```
