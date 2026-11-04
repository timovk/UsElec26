# 13 — Proposed Repository Structure

A **single TypeScript project** (one `package.json`, one Vite build) with strictly layered source folders.
Module boundaries are enforced by dependency-cruiser rules rather than by separate packages. That gives
the same guarantees with far less build configuration, and any module can be split into a workspace
package later without code changes.

```
UsElec26/
├── README.md                          project overview, how to open the app, status
├── package.json · package-lock.json   (npm, exact pinned versions)
├── tsconfig.json · vite.config.ts · vitest.config.ts · playwright.config.ts
├── .dependency-cruiser.cjs            layering + information-firewall rules (CI-enforced)
├── .github/workflows/
│   ├── ci.yml                         typecheck · lint · unit/property · E2E · bench smoke · determinism
│   ├── deploy-pages.yml               build → GitHub Pages (on main)
│   └── nightly-longrun.yml            100-year headless runs on N seeds (archive integrity, stability, size)
│
├── docs/
│   ├── architecture/                  this design (Phase 0) — kept current with each phase
│   ├── data-sources.md                dataset sources, licenses, coverage, limitations, update procedure
│   ├── model-notes/                   calibration reports, parameter tables
│   └── changelog.md
│
├── public/
│   ├── geo-packs/<version>/           content-hashed geometry + semantic tables (built by tools/geo-pipeline)
│   ├── fonts/                         self-hosted OFL fonts
│   └── icons/                         PWA icons
│
├── data/                              small committed seed data (with citations)
│   ├── rules/2016/<state>.json        election law baseline: poll hours, primaries, mail, recount, vacancy…
│   ├── timezones/county-tz.csv        county → IANA zone for split states (49 CFR Part 71)
│   ├── names/                         surname + given-name frequency tables (public data)
│   └── blocklist/                     real-politician names (rejection only)
│
├── src/
│   ├── core/            L0  rng (keyed counter-based) · math (fdlibm port) · time (UTC + US tz) ·
│   │                        codec (ENA1) · ids · result types · rpc protocol types
│   ├── geo/             L0  geo-pack loader · BU/atom/RJ/RU model · boundary versions · crosswalks · adjacency
│   ├── rules/           L0  versioned jurisdiction rules · effective-date resolution
│   ├── population/      L1  cohort tables · IPF/raking · eligibility · evolution · census
│   ├── parties/         L1  parties · platforms · brand
│   ├── politicians/     L1  people · traits · name generation · tiers · lazy materialization
│   ├── institutions/    L1  offices · chambers · terms · succession/vacancy
│   ├── economy/         L1  macro + state models · release calendar
│   ├── events/          L2  event catalog · hazards · chains · news text
│   ├── campaigns/       L2  resources · allocation · valence effects · debates
│   ├── careers/         L2  decision model · retirements · appointments · switching
│   ├── government/      L2  sessions · bills · roll calls · vetoes · approval inputs
│   ├── calendar/        L3  election scheduling from terms + rules
│   ├── primaries/       L3  nomination systems · delegates · conventions
│   ├── elections/       L3  contests · ballots per BU · methods (plurality/majority/RCV/top-two/EC/contingent)
│   ├── electorate/      L3  types · turnout · mode · choice · environment · measure() port
│   ├── ballots/         L3  realization kernel · progressive lock · sealing
│   ├── counting/        L3  RJ profiles · count plans · wire feed · canvass · recount tabulation
│   ├── polling/         L4  pollsters · fieldwork · publication · Kalman averages
│   ├── forecasting/     L4  fundamentals · Monte Carlo · forecast history
│   ├── projections/     L4  expected vote · voter survey · decision desks
│   ├── broadcast/       L4  alerts · story detection · commentary templates · playback engine
│   ├── archive/         L5  revisions · seals · rollups · queries · comparability · audit
│   ├── analytics/       L5  swing/margin/turnout metrics · trends · calibration reports
│   ├── persistence/     X   sqlite-wasm adapter · schema · migrations · repositories · import/export · backups
│   ├── engine/          X   composition root · scheduler · command handling · query API · op journal
│   ├── workers/             engine.worker.ts · compute.worker.ts · broadcast.worker.ts (thin entry points)
│   └── ui/                  React app (talks to engine only through src/engine/api types)
│       ├── app/                 shell · routing · rail · time bar · search
│       ├── screens/             hub · desk · broadcast · map · results · archive · politicians · polls · analyst · settings
│       ├── map/                 renderer (canvas2d, webgl2) · layers · LOD · hit-testing · legends
│       ├── charts/              d3-based chart components
│       ├── audio/               Web Audio cues
│       ├── theme/               tokens · typography · motion
│       └── state/               view-model stores fed by engine/broadcast subscriptions
│
├── tests/
│   ├── unit/ · property/ · statistical/ · determinism/ · persistence/ · e2e/
│   ├── golden-saves/                   one save per released schema version (migration tests)
│   └── fixtures/                       tiny synthetic geographies for fast tests
│
└── tools/
    ├── geo-pipeline/                   Node scripts: fetch · verify · build BUs/atoms/RJs · topology · packs · validate
    ├── data-sources/sources.lock.json  pinned URLs + SHA-256 + retrieval dates
    ├── bench/                          benchmark harness + results/
    ├── longrun/                        headless multi-decade runner (Node, worker_threads)
    └── spikes/                         Phase 0 feasibility spikes (kept for reference)
```

**Boundary rules** (dependency-cruiser):
1. `src/<module>` may import only from modules of the same or a lower layer (L0 < L1 < … < L5).
2. `polling`, `forecasting`, `projections` and `broadcast` (L4) may not import `electorate`, `ballots`, or the latent
   fields of `population` and `parties`. `polling` may import only `electorate/measure`.
3. Only `persistence` imports the SQLite library. Modules declare repository interfaces, and `persistence` implements them.
4. `src/ui` may import only `src/engine/api` (types) and `src/core` (pure utilities). It never imports simulation modules.
5. No cycles anywhere.
