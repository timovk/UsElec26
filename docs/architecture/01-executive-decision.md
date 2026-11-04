# 01 — Executive Architecture Decision

## 1.1 Constraints that drive the decision

| Constraint | Consequence |
|---|---|
| The user has only a Chromebook and must not install Python, Node, servers or Linux. | The app must run in Chrome on ChromeOS, launched from a URL or from the ChromeOS shelf. |
| The archive must persist for a simulated century. | We need a transactional database with indexes, migrations and integrity checks. A key-value cache is not enough. |
| Thousands of contests and roughly 230k–350k geographic Base Units. | Heavy numeric kernels must run off the main thread on typed arrays. |
| The user prefers minimal setup and no administration. | No backend to operate, no accounts and no API keys. |
| Offline use is desirable. | All simulation must be local. Assets are cached by a service worker. |
| Long-term maintainability. | One language (TypeScript) end to end, strict module boundaries and tests from day one. |

## 1.2 Options evaluated

### Option A — Hosted web application

**A1. Static PWA (no backend): recommended.** The build output is static files (HTML, JS, WASM,
geometry and data packs) served from a CDN. All computation and storage happen in the user's browser.

- Chromebook: native fit. Chrome on ChromeOS can *install* a PWA, which then gets a shelf icon, its own
  window and offline launch.
- Hosting: **GitHub Pages**, which is free for this public repository and deployed by a GitHub Actions workflow on
  every merge to `main`. Cloudflare Pages or Netlify are drop-in alternatives (both free and both support
  custom headers) if headers are ever required.
- No server to administer, no running cost and no user data leaving the device.
- Updates: the service worker downloads new versions in the background. The app *offers* to reload, and
  never reloads automatically during an election night.

**A2. Web app plus backend (API server and cloud database).** This was rejected for now:

- It requires operating a server, a database, authentication and backups, and it costs money. All of that contradicts
  "no server administration".
- It brings no simulation benefit. The kernels fit comfortably on a Chromebook CPU (see §11 and the spikes).
- Cloud backup is obtained more simply by exporting to Google Drive (ChromeOS mounts Drive in the Files
  app, and the File System Access save picker can write there directly).
- A future optional sync feature (Google Drive API) can be added without changing the architecture,
  because the universe is a single database file.

### Option B — Downloadable browser application (`file://`)

A zip the user unpacks and opens as `index.html`. Evaluated in detail and **rejected**, because Chrome's
security model for `file://` origins breaks required capabilities:

| Capability | Status under `file://` in Chrome |
|---|---|
| ES module scripts (`<script type="module">`, which Vite emits) | Blocked (CORS, origin `null`) |
| `fetch()` of local data/geometry files | Blocked |
| `new Worker(url)` | Blocked for file URLs |
| WebAssembly via `fetch`/`instantiateStreaming` (SQLite) | Blocked. Base64 inlining is possible but bloats the build. |
| Service worker (offline and install as an app) | Unavailable (requires http/https) |
| Origin Private File System / quota | Unreliable and implementation-specific for file origins |

A single inlined HTML file (all JS inlined, workers via Blob URLs, WASM base64-encoded) can work around
some of this. It would still forfeit offline install, make storage fragile, prevent lazy loading of
geography, and produce a 10–30 MB HTML file. The spec explicitly warns against assuming `file://` provides
all functionality. We agree.

### Option C — Packaged apps (Chrome Apps, Android APK via TWA, Linux on ChromeOS)

Chrome Apps are discontinued. A Trusted Web Activity wraps the same PWA and adds Play Store overhead
without any new capability. Linux (Crostini) is excluded by the spec.

## 1.3 Recommendation

> **A hosted, static, installable PWA (Option A1) whose simulation and data are entirely local.**
> In the spec's terms it is a hybrid: *distributed* like Option A (a URL), *behaves* like Option B (runs and
> stores locally, offline-capable).

What the user does:
1. Open `https://timovk.github.io/UsElec26/` in Chrome.
2. Click *Install* in the address bar (optional, recommended).
3. Create a universe. Export it to Google Drive from time to time with the built-in *Back up* button.

## 1.4 Technology stack

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript, strict mode** | One language for engine, UI and tools, with typed interfaces between the 20 systems. |
| Build | **Vite** + `vite-plugin-pwa` (Workbox) | Fast builds, first-class worker and WASM support, generated service worker. |
| UI shell | **React 19** with a small external store (Zustand) | Mature and maintainable. React renders panels and tables only. Maps and dense charts render outside React. |
| Simulation engine | Plain TypeScript modules over `TypedArray`s, running in **Dedicated Workers** | No DOM dependency, so the engine is testable in Node and runs off the main thread. |
| Heavy kernels | TS first. **WebAssembly (Rust) only if a measured budget is missed.** | Spikes show TS is within budget. Kernels are pure functions over typed arrays, so they can be ported later. |
| Database | **SQLite 3 (official `@sqlite.org/sqlite-wasm`)** on **OPFS via the `opfs-sahpool` VFS** | Relational queries, indexes, ACID transactions, `PRAGMA integrity_check`, and a single-file universe that is the export format. `opfs-sahpool` needs **no COOP/COEP headers**, and GitHub Pages cannot set headers. |
| Compression | Native `CompressionStream('deflate-raw')` plus our own columnar varint codecs | Zero dependencies. Measured 1.06 bytes per stored vote count. |
| Maps | **Custom renderer**: Canvas2D (Phase 1–4 layers) and WebGL2 (dense layers), on geometry **pre-projected at build time** | Broadcast maps need Albers USA with AK/HI insets. MapLibre supports Mercator and globe only, and its tile pipeline is overkill. A full redraw of 3,142 counties measured 32 ms with software raster, so we redraw on change and use cached bitmaps for animation. |
| Geometry processing | `mapshaper`, `topojson-server/client`, `d3-geo` (build-time), `flatbush` (runtime spatial index), `polylabel` | Proven tools. TopoJSON shares arcs between neighbours, which makes files small and topology exact. |
| Charts | D3 modules (`d3-scale`, `d3-shape`, `d3-array`) rendering SVG for small charts and Canvas for dense ones | Full control over the broadcast look. |
| Worker RPC | A small typed RPC layer (Comlink-style) with transferable buffers | Zero-copy hand-off of large arrays. |
| Tests | **Vitest** (unit), **fast-check** (property-based), **Playwright** (end-to-end in Chromium), benchmark harness in Chromium with CPU throttling | See §10/§11 and the testing strategy in 10-roadmap.md. |
| Lint/boundaries | ESLint and **dependency-cruiser** (enforces module layering and the information firewall) | Prevents circular dependencies and keeps "observers" from reading latent state. |
| CI/CD | GitHub Actions: lint → typecheck → unit → E2E → bench smoke → deploy to Pages | Fully automated. The user never runs a command. |
| Fonts/audio | Self-hosted OFL fonts and original synthesized audio (Web Audio) | Works offline and avoids proprietary broadcast assets. |

Exact package versions are pinned in Phase 1 (current at the time of writing: Vite 8.3, React 19.3,
TypeScript 7.0, `@sqlite.org/sqlite-wasm` 3.54.1).

## 1.5 Reference hardware and budgets

**Reference device:** a mid/low Chromebook with a 4-core Intel N100/N200-class or MediaTek Kompanio-class CPU,
4–8 GB RAM, 64 GB eMMC and a 1366×768 or 1920×1080 display. Budgets (detailed in §11) are set for this device. The
app ships a **Diagnostics** page that measures the real device and reports the numbers.

## 1.6 What this decision explicitly does *not* promise

- Browser-local storage is **not** a cloud backup. The UI says so, shows the date of the last export, and
  reminds the user to export before risky actions (clearing site data, powerwash, Guest mode).
- The first visit requires a network connection. After that, the app shell and *downloaded* geography packs
  work offline. A "Make available offline" action prefetches all geography packs.
