# Phase 0 feasibility spikes

Throwaway measurement scripts used to ground the Phase 0 architecture in real numbers. **They are not
application code** and will not be imported by the app. Results are in
[`docs/architecture/15-feasibility-spikes.md`](../../docs/architecture/15-feasibility-spikes.md).

| Script | Measures |
|---|---|
| `ballot-kernel-bench.mjs` | Cost of realizing votes for every (Base Unit, mode, contest) at national scale, and the exact-sum invariant |
| `archive-encoding-bench.mjs` | Bytes per stored vote count under the planned column-major varint + deflate encoding |
| `map-render-bench.mjs` | Canvas2D full-redraw time for all 3,142 counties in headless Chromium (requires Playwright) |

Run them with Node 22+ (no dependencies needed except Playwright for the map benchmark, plus the `us-atlas` and
`topojson-client` files given as an argument):

```bash
node tools/spikes/ballot-kernel-bench.mjs 230000 1 8 5
node tools/spikes/archive-encoding-bench.mjs
node tools/spikes/map-render-bench.mjs /path/to/dir-with-us-atlas-and-topojson-client
```
