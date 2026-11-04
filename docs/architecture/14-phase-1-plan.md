# 14 — Phase 1 Implementation Plan

## 14.1 Goal

Phase 1 must deliver a **usable foundational universe**. It must also **retire the architecture's riskiest
assumptions** before any election code is written:

| Assumption to validate | How Phase 1 proves it |
|---|---|
| A static PWA on GitHub Pages works well on a Chromebook, including offline | Deployed URL; install; offline E2E test; manual Chromebook check by you |
| SQLite-WASM on OPFS is reliable for long-lived saves | Persistence E2E across reloads; export/import round trip; crash-mid-transaction test; integrity checks |
| The simulation is deterministic and save/load-continuous | Same-seed DB hash test; fork test; worker-count independence test |
| The Census-based Base Unit layer is buildable and exact | Pipeline validation report: exact population reconciliation to counties and CD115 |
| The electorate model produces varied, plausible, persistent fictional geography | Calibration test over 100+ seeds against the §4.7 static targets; visual lean maps |
| Budgets hold on Chromebook-class hardware | Bench harness (throttled Chromium) plus the on-device Diagnostics page |

## 14.2 Build order (each step lands with its tests)

1. **Scaffold (M1.1).** Vite, React, TS strict, ESLint, dependency-cruiser, Vitest, fast-check, Playwright;
   `ci.yml` and `deploy-pages.yml`; PWA manifest and service worker; app shell with rail, time bar and placeholder
   screens explicitly marked "Planned (Phase N)".
2. **Core (M1.2).** `core/rng` (counter-based, keyed: Philox-4×32 or a SplitMix64-derived counter generator,
   chosen by test throughput); `core/math` (fdlibm `exp/log/log1p/expm1/pow/erf` with bit-exact tests);
   `core/time` (UTC minutes, US zones, DST rules, county→zone table); `core/codec` (`ENA1`); typed RPC; worker
   skeletons with a job protocol.
3. **Persistence (M1.3).** SQLite-WASM with `opfs-sahpool` inside the engine worker; schema v1; migration runner;
   catalog DB; save slots; autosave policy; `VACUUM INTO` saves and backups; `.ena` export (File System Access
   with a download fallback) and import with checksum; `quick_check` on open; Web Locks; storage persist and estimate.
4. **Geography pack v1 (M1.4).** `tools/geo-pipeline`: fetch with pinned hashes → BUs (2010 BG ∩ CD115 ∩ 2016
   SLDs; measure the count with and without place/MCD keying) → atoms → RJs → LOD TopoJSON for states, counties and CD115 →
   adjacency → validation report committed to `docs/`. Output is committed under `public/geo-packs/2016.1/`.
5. **Population v1 (M1.5).** IPF county×cohort tables; BU marginals; VEP base (CVAP − felony
   disenfranchisement share per 2016 law); January 2016 scaling.
6. **Electorate v1 (M1.6).** Coalition generator; partisan identity; multiscale spatial fields; calibration loop;
   stored hot-state blobs; "expected two-party lean" computed analytically at state, county and CD level.
7. **Institutions and parties (M1.7).** Office catalog (President, VP, 100 Senate seats in classes 1–3, 435 House
   seats, 50 governors, and elected LG/AG/SoS where the state elects them); 99 chambers with compositions and leaders;
   succession and vacancy rule data (2016 baseline); party entities and platforms.
8. **People and initial government (M1.8).** Name generator (surname and given-name frequencies by birth year and
   region, plus blocklist); traits by tier; initial officeholders drawn so party control correlates with
   lean *with realistic incumbency noise* (some senators hold seats in hostile states); a pre-simulation
   career background for each (biographical, `provenance = 'pre-simulation background'`, no vote totals);
   President, VP and cabinet with a coherent backstory: party, home state, years in office, and the 2016 term-limit status
   (the sitting president's eligibility to run in 2016 is generated consistently).
9. **Clock and scheduler (M1.9).** Discrete-event core; advance controls (day, week, month, next event, date); daily and
   annual processes (aging, birthdays, rare deaths triggering succession through the rules); command log; engine ledger.
10. **Dashboard (M1.10).** Hub (create/open/delete with confirmation, import/export), Desk (government
    summary, chamber bars, upcoming *scheduled* elections listed as "Election simulation: Phase 2"), Map (Canvas2D:
    states, counties, CDs; metric "underlying lean", labelled *Simulation truth*), people directory and profiles,
    Settings (storage, backups, integrity check, Diagnostics).

## 14.3 Minimum working functionality (the Phase 1 demo you can run)

On a Chromebook:
1. Open the GitHub Pages URL and install the app (optional).
2. **New Universe.** Within about 15 s the Desk shows a fictional President and VP, Senate and House majorities, governors,
   and state legislative chamber control.
3. Open the **Map**: counties and districts are coloured by the universe's underlying lean. Texas might be blue. Each
   new seed produces a different, coherent geography.
4. Click a senator to see a profile with home county, age, background and party.
5. **Advance 1 month**, then 1 year: the date moves, people age, rare vacancies are filled by the correct legal rule.
6. **Reload the tab.** The universe is exactly where you left it. Go **offline** and it still opens.
7. **Export** to Google Drive, **delete** the universe, **import** the file: identical (the app shows matching seals).

## 14.4 Explicitly out of scope for Phase 1

Elections of any kind, polls, forecasts, campaigns, the economy beyond static January 2016 values, events,
legislation, broadcast UI, the historical archive UI, state-legislative districts on the map, and local officials.
Each appears in the UI only as a labelled "Planned (Phase N)" entry, or not at all.

## 14.5 Phase 1 test list

| Test | Type |
|---|---|
| RNG: keyed streams independent of call order; known-answer vectors | unit/property |
| Math: bit-exact against reference vectors across 10⁶ inputs | unit |
| Time: DST transitions, split-state counties, poll-closing conversions (fixture) | unit |
| Codec: round-trip on random arrays; implied-column correctness; CRC failures detected | property |
| Geography: every block assigned once; BU→county/CD/state population reconciliation; adjacency symmetry | pipeline validation |
| Population: IPF margins match within tolerance; VEP ≤ VAP for every BU | unit/statistical |
| Electorate calibration: §4.7 static targets over 100 seeds | statistical |
| Determinism: create(seed) twice → identical DB content hash; 1 vs 4 compute workers → identical | determinism |
| Fork: advance 2 years vs advance 1 + save + reload + advance 1 → identical | determinism/persistence |
| OPFS persistence across reload; export/import round trip; corrupted import rejected | E2E (Chromium) |
| Crash safety: kill the worker mid-transaction → reopen consistent | E2E |
| Migrations: v1 golden save opens under the current schema | persistence |
| Budgets: create universe ≤ 15 s, advance a month ≤ 1.5 s, county map recolor ≤ 50 ms (throttled Chromium) | bench |

## 14.6 If the Census hosts cannot be allow-listed

Phase 1 still ships everything above **except** M1.4–M1.6 at Base Unit resolution. Geography falls back to
states and counties from the `us-atlas` npm package (2017 cartographic boundaries; the same 3,142
county-equivalents as 2016), with the electorate model at county resolution. The House would then have to be
deferred, because real CD115 boundaries and populations are needed to assign districts honestly. That is a real
reduction, which is why the allow-list request is decision #2 in the README.

## 14.7 What you'll receive at the end of Phase 1

Working source on this branch (or `main` after merge, as you prefer) and the deployed URL. Also:
Chromebook usage instructions, **actual** test and benchmark output, the geography validation report, known
limitations, a changelog, and the Phase 2 plan for your approval.
