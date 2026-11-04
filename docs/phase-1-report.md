# Phase 1 Report — Foundational Political Universe

**Status:** implemented, tested, awaiting your approval before Phase 2.
**Engine version:** 0.1.0 · **Schema version:** 1 · **Geography pack:** 2016.1

## 1. What you can do now

1. Open the app, then create a universe with an optional name and seed.
2. You get a fictional United States on January 1, 2016:
   - a President and Vice President, the Cabinet, and the 100-member Senate in its real classes
   - 435 House members in the real 115th-Congress districts
   - 50 governors, plus lieutenant governors, attorneys general and secretaries of state where the state has them
   - party control of all 99 state legislative chambers, with their leaders
   - congressional leadership
3. Explore:
   - **Desk:** who governs, chamber balance, upcoming elections, news.
   - **Map:** states, counties or congressional districts. Colour by the underlying partisan lean (labelled *simulation truth*), the governor's party, the Senate delegation or House representation. Click anything for details.
   - **People:** a searchable directory and full profiles.
   - **Electorate:** how this universe's fictional coalitions were generated and calibrated.
4. Advance time by a day, week, month or year, to the next newsworthy event, or with play at an adjustable speed. People age, and deaths happen at realistic rates. Every vacancy follows the correct legal path:
   - 25th-Amendment succession for President and Vice President
   - each state's gubernatorial succession rule
   - gubernatorial Senate appointments, including same-party and special-election-only states
   - caucus elections for congressional leaders
   - House seats stay vacant until special elections arrive in Phase 2
5. Save automatically, reload, export a `.ena` file (for example to Google Drive), import it back, delete it, and run an integrity check. It all works offline after the first visit.

## 2. Using it on a Chromebook

After the first deployment (see §7), open **`https://timovk.github.io/UsElec26/`** in Chrome.
- **Install (recommended):** click the install icon at the right of the address bar. *Election Night* then gets
  its own window and a shelf icon, and works offline.
- **Back up:** in Universes or Settings, click **Export**. The save dialog can write directly to *Google Drive*.
  Universes live only in this browser on this device until you export them.
- **Restore or move:** on Universes, use **Import a universe (.ena)**.
- **Performance check:** Settings → **Run diagnostics** measures your Chromebook. Please send me those numbers.
  They calibrate the performance budgets for Phase 2.

## 3. What was built

| Area | Delivered |
|---|---|
| App platform | Vite + React + TypeScript (strict) PWA with offline service worker, install manifest and icons. One Engine Worker owns the universe; the main thread only renders. |
| Core libraries | Keyed reproducible RNG streams (xoshiro128\*\* seeded by cyrb128). Exact binomial (inversion + BTRS), multinomial, gamma, beta, Dirichlet. fdlibm ports of `exp` and `log` (within 1 ulp of V8, >99% bit-identical). US time-zone engine with 2007+ DST rules. `ENA1` columnar codec, typed bundles, CRC32, SHA-256. |
| Persistence | Official SQLite-WASM in the worker on OPFS (`opfs-sahpool`, so no special server headers are needed). Schema v1 with a migration runner. Auto-save (one transaction per advance). `.ena` export and import with SHA-256 checksum. `quick_check` on open. Integrity audit. Single-tab lock. Storage persistence and usage display. |
| Geography pack 2016.1 | Built from U.S. Census Bureau bulk files by `tools/geo-pipeline/` (reproducible, byte-identical reruns). **265,023 Base Units** from 11,078,297 blocks. 3,142 counties, 435 CDs, 1,938 state senate and 4,785 state house districts, 4,703 reporting jurisdictions (New England towns, Alaska house districts). Population reconciles exactly: 308,745,538. Official block equivalency files for the 115th Congress and the 2016 legislatures. See [validation report](data/geo-pack-2016.1-validation.md) and [data sources](data-sources.md). |
| Population | County × 64-cohort joint tables (IPF), Base Unit marginals (age, sex, race/ethnicity, education by age, income, density). Voting-eligible population = 2010 adults × county growth to 2016 × citizenship rate (block-group CVAP shrunk toward the county rate, capped at 1) × (1 − felony disenfranchisement). |
| Electorate | Per-universe fictional coalitions in a 3-axis issue space. Multiscale, spatially smoothed political culture (division → state → county → neighbourhood) plus unsmoothed county idiosyncrasy. Random-sign urban and income slopes. Two-control calibration to stylized facts of American elections (§5). |
| Institutions | Real 2016 structure: Senate classes, governor cycles and term limits, LG/AG/SoS selection, chamber sizes, vacancy and succession rules, the 15 departments. Invariants are tested (33/33/34 classes, 1,972 + 5,411 legislative seats, 43 elected AGs, 35 elected SoS, and so on). |
| Politicians | 942 fictional officeholders with persistent identities. Names come from Census frequency data, with surname choice conditioned on race and ethnicity and a blocklist of 4,890 real politicians. Traits and an ideology positioned relative to the party platform and the constituency lean. Pre-2016 careers are narrative facts labelled *pre-simulation background*, with no fabricated vote totals. Louisiana and Mississippi swear in their 2015 winners in January 2016. |
| Clock | Discrete-event scheduler: daily tick at 06:00 ET plus persisted one-off events. Play and pause, +1 day/week/month/year, next event. Command log and engine-version ledger. |
| UI | Universes hub, Desk, interactive Canvas2D map (zoom, pan, tooltips, detail panel), People directory and profiles, Electorate inspector, Settings (storage, integrity, diagnostics). Features not built yet are shown only as labelled "Phase N" placeholders. |
| CI/CD | `ci.yml`: typecheck, ESLint, dependency-cruiser layering and information firewall, unit tests, build, Playwright E2E. `deploy-pages.yml`: build and deploy to GitHub Pages. |

## 4. Test results (actual runs, this environment)

| Suite | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | ✅ no errors |
| ESLint | ✅ no problems |
| Module boundaries and information firewall (dependency-cruiser) | ✅ no violations (56 modules, 174 dependencies) |
| Unit, property and real-data tests (Vitest) | ✅ **41 passed**, 1 skipped (an opt-in survey test) |
| End-to-end in Chromium (Playwright) | ✅ **1 passed**: create → Desk → +1 month → map click → profile → reload persistence → export → import → integrity check, with no console errors |

Highlights of what the tests cover:
- **Determinism:** the same seed produces an identical database content hash, and a different seed produces a different one.
- **Save/load continuity:** advancing 400 days in one go equals advancing 200, saving, reloading and advancing 200, byte for byte. This test found and fixed two real bugs.
- **Export/import:** a round trip gives identical content, and corrupted files are rejected.
- **Real geography:** Base Unit populations sum to the exact 2010 Census total. Calibration lands inside every stylized-fact range on **10/10 seeds**.
- **Math:** binomial mean and variance in both sampling regimes, and multinomial sums are exact (property-based).
- **Time:** DST transitions, and 2016 poll-closing conversions (Hawaii 7 pm = 12:00 AM ET; Aleutians = 1:00 AM ET).
- **Institutions:** invariants of the 2016 baseline.

## 5. Calibration (10 seeds, real Census geography)

| Statistic | Target range | Achieved across seeds |
|---|---|---|
| National Democratic two-party share | 45–55% | 45.5–52.4% |
| SD of state margins (50 states) | 10–20 pts | 14.2–18.4 |
| SD of county margins | 22–32 pts | 24.0–30.1 |
| Counties > 60% for one party | 45–85% | 45–55% |
| States within 5 points | 3–14 | 5–13 |
| Moran's I (county clustering) | 0.5–0.8 | 0.56–0.75 |

Two changes from Phase 0 (documented in [04 §4.7](architecture/04-statistical-methodology.md#47-calibration-to-stylized-facts-not-to-real-partisanship)):
- The state statistics exclude DC, by convention.
- Two ranges were widened to the span of modern U.S. elections instead of one election year. For lopsided counties, 2000 was near 50% and 2016 above 80%. For close states, the span was 4–14.

Lopsidedness currently sits at the low end of its range.

## 6. Measured performance

| Measurement | Value | Notes |
|---|---|---|
| Create a universe (Node, 2.1 GHz Xeon) | 8.2 s | Population 0.3 s, electorate calibration 2–5 s, full-resolution lean 2.3 s, government 0.2 s, save 0.4 s |
| Create a universe (Chromium, UI to Desk) | 5.4–6.6 s | Engine worker on this server's CPU |
| Advance one simulated month | 49 ms (Node), 143–163 ms (UI round trip, 4× throttled main thread) | |
| Ballot-kernel throughput (worker) | ~300 ns per binomial draw | Projected 6–7 s single-threaded for a national general election. Phase 2 parallelizes it. |
| Archive encoding (realistic counts) | 1.43 bytes per count | |
| SQLite writes (worker) | ~160k rows/s | |
| County map redraw | 105 ms median at 1200×750 | 4× throttled main thread, **software raster, no GPU**. Budget is 50 ms. A GPU-rastered Chromebook should be faster; WebGL2 is planned. |
| Universe database size | 18 MB | Includes the universe's own 14 MB copy of the geography |

**Honest caveat:** DevTools CPU throttling affects only the page's main thread, not workers. The engine timings
above are from this server's CPU. Real Chromebook numbers come from Settings → Diagnostics on your device.

## 7. Known limitations (Phase 1)

1. **Not yet deployed or pushed.** `git push` returns 403 because the Claude GitHub App isn't installed on `timovk/UsElec26`. Fix it at <https://claude.ai/connect-github>. Then I can push. On the first push, enable GitHub Pages (Settings → Pages → Source: *GitHub Actions*). The deploy workflow runs on `main` and on this branch.
2. **No elections yet.** That is Phase 2. Upcoming elections are listed but not simulated. Vacant House seats, and Senate seats in special-election-only states, stay vacant with an explicit label until Phase 2.
3. **Minimal dynamics.** Only aging, mortality and lawful succession run. Economy, events, approval, legislation and careers arrive in Phases 5–6.
4. **State legislatures** exist as party compositions plus leaders. Individual legislators arrive with legislative elections in Phase 6. There are no local officials until Phase 7.
5. **Compute pool not yet used.** Phase 1 runs everything in the single Engine Worker. The "1 vs 4 workers → identical results" test moves to Phase 2, when the ballot kernel is parallelized.
6. **Institutional data** (`src/rules/states2016.ts`) was compiled from knowledge and passes structural invariant tests. Individual entries, especially term limits and Senate-vacancy rules, should be verified against primary sources. Felony-disenfranchisement shares are approximate and labelled as such.
7. **Kentucky and Rhode Island** have no 2010 voting-district codes, so Phase 3 must estimate their precinct counts.
8. **County lopsidedness** calibrates at the low end of its plausible range.
9. **Storage:** each universe stores its own copy of the geography (about 14 MB) so it stays readable without network access. Only one tab can use the app at a time.

## 8. Changelog

- Phase 0 architecture documents (15) and feasibility spikes.
- Phase 1: everything in §3. Architecture docs updated where implementation refined the design: calibration ranges, eligible-population method, measured counts, npm single-package layout.

## 9. Next: Phase 2 (awaiting approval)

- Election calendar and 2016 election-law baseline.
- Contest generation, candidate emergence, and simplified nominating primaries run by the same ballot kernel.
- The shared-electorate ballot kernel (turnout, mode, choice) parallelized across a compute-worker pool.
- The **2016 general election**: President with the Electoral College including the Maine/Nebraska district rule and a minimal contingent election, Senate, House and governors.
- Offices change hands on the legal dates.
- Archive v1: immutable sealed results at Base Unit, atom and reporting-jurisdiction × mode grain; county pages; contest pages; a results map; the audit suite.
- Acceptance: simulate the 2016 general and inspect mathematically consistent results from Base Unit to nation.
