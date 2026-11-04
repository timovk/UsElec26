# Election Night: America — Phase 0 Architecture

**Status:** Phase 0 (Architecture & Feasibility) — submitted for approval.
**Spec version answered:** Master Development Specification v0.1.0.
**No application code has been written yet.** Phase 0 deliverables are these documents plus three small
feasibility spikes in [`tools/spikes/`](../../tools/spikes/) whose measured results are in
[`15-feasibility-spikes.md`](15-feasibility-spikes.md).

## Documents

| # | Document | Answers spec §23 item |
|---|----------|-----------------------|
| 01 | [Executive architecture decision](01-executive-decision.md) | 1 |
| 02 | [Application architecture](02-application-architecture.md) | 2 |
| 03 | [Simulation architecture](03-simulation-architecture.md) | 3 |
| 04 | [Statistical methodology](04-statistical-methodology.md) | 4 |
| 05 | [Data architecture](05-data-architecture.md) | 5 |
| 06 | [Geographic strategy](06-geographic-strategy.md) | 6 |
| 07 | [Historical archive architecture](07-historical-archive.md) | 7 |
| 08 | [Election-night architecture](08-election-night.md) | 8 |
| 09 | [User interface design](09-user-interface.md) | 9 |
| 10 | [Development roadmap](10-roadmap.md) | 10 |
| 11 | [Performance strategy](11-performance.md) | 11 |
| 12 | [Technical risks and limitations](12-risks.md) | 12 |
| 13 | [Repository structure](13-repository-structure.md) | 13 |
| 14 | [Phase 1 implementation plan](14-phase-1-plan.md) | 14 |
| 15 | [Feasibility spike results](15-feasibility-spikes.md) | (evidence) |
| — | [Glossary](glossary.md) | — |

## The decisions in one page

1. **Distribution:** a static, installable **Progressive Web App hosted on GitHub Pages** from this
   (public) repository. There is no backend and no server for anyone to administer. On a Chromebook you
   open a URL and click *Install*. After the first load it runs offline in its own window.
   A `file://` build was evaluated and rejected: Chrome blocks module scripts, workers, WASM loading and
   service workers from `file://` origins.
2. **Data stays local:** every universe is a **SQLite database** (official SQLite WebAssembly build) stored in the
   browser's **Origin Private File System**. It is accessed from a dedicated worker through the
   `opfs-sahpool` VFS, which needs no special HTTP headers, so it works on GitHub Pages. The UI always
   states that data is stored *on this device only*. One click exports a single checksummed universe file
   (to Google Drive through the ChromeOS Files picker, or to Downloads).
3. **Stack:** TypeScript (strict), Vite, React for the application shell, and a custom Canvas2D/WebGL2 map
   renderer on pre-projected Census geometry (not MapLibre, whose projections cannot produce the
   broadcast-style Albers map with Alaska/Hawaii insets). D3 modules power the charts, and Vitest, fast-check and
   Playwright run the tests.
4. **Threads:** a single authoritative **Engine Worker** owns the universe and the database (one writer, no
   races). A pool of stateless **Compute Workers** runs heavy kernels: ballot generation, Monte Carlo and
   count plans. A **Broadcast Worker** plays back election nights. The main thread only renders.
5. **Determinism:** each random stream is derived from `hash(universeSeed, purpose, keys…)`
   (counter-based, order-independent). The simulation core uses its own deterministic `exp`/`log`
   implementations. A command log and an engine-version ledger make every universe reproducible and auditable.
6. **Electorate:** the shared-electorate model sits on **Base Units**, which are 2010 Census block groups
   split by the 2016 district boundaries (an estimated 230k–350k units). Each Base Unit holds a distribution
   over 64 *voter types* (16 latent-partisanship bins × 4 cohort classes). Turnout, ballot mode and every
   contest's vote choice are computed from the **same** type distribution. Ballots per (unit, mode) are
   drawn once, and every contest on that ballot partitions exactly those ballots (votes + undervotes).
   Every higher-level total is a sum of unit integers. Nothing is randomized independently at aggregate level.
7. **Political geography is fictional but structured:** the system draws a universe-specific coalition structure
   (how demographic groups map onto a latent issue space and party platforms). It adds multiscale,
   spatially smoothed regional cultures and an urban–rural slope whose *sign* is random. It then
   calibrates to stylized facts of American elections (dispersion, spatial autocorrelation and
   competitiveness), not to real partisan patterns.
8. **Information firewall:** polls, forecasts, news networks and commentary can read only *public
   observables* (published polls, released economic data, the vote feed, archived results), never the
   latent electorate. The build enforces this rule.
9. **Election night = recorded history:** at the ballot lock the system generates and seals final results. A
   seeded **count plan** turns them into timestamped batches through certification. The observers (wire
   service, decision desks, alerts, commentary) are simulated over that feed in simulated time, and everything
   is stored as the **Night Record**. Live viewing *is* playback of that record, so a replay is byte-for-byte the
   same night.
10. **Archive:** results are immutable and *revisioned* (count → canvass → certification → recount), with each
    revision sealed by a SHA-256 hash. They are stored as compressed columnar blobs (measured 1.06 bytes per vote count)
    plus small row tables for fast queries. Every federal and statewide contest is kept at Base Unit
    ("precinct") grain, so future re-aggregation into new districts is exact. The estimate is roughly 450 MB per
    simulated century at federal+governor coverage and roughly 700 MB at full coverage (±50%, measured in Phases
    2 and 7). See [07 §7.4](07-historical-archive.md#74-storage-budget-estimates-to-be-measured-in-phase-2-and-phase-7).

## Refinements to the baseline roadmap (justified in [10-roadmap.md](10-roadmap.md))

- The geographic data pipeline (Base Units and district crosswalks) moves **into Phase 1**. The initial House
  needs real districts, and this is the project's largest data risk.
- A minimal 12th-Amendment **contingent election** moves into Phase 2, because a 269–269 tie is possible from the
  first presidential election.
- A single wire service, a flagship decision desk and the voter (exit) survey are built in Phase 3, since race calls
  need them. Multiple networks and their disagreements remain in Phase 9.
- **Census, reapportionment, baseline algorithmic redistricting and state legislative elections move to
  Phase 6.** Users will reach 2021 quickly, and freezing 2010-cycle maps would permanently distort their
  history. Partisan redistricting strategy, commissions and litigation stay in Phase 9.

## Decisions I need from you before Phase 1

1. **Approve the architecture** (hosted PWA on GitHub Pages, local-only storage with export).
2. **Allow Census Bureau downloads in this cloud environment.** The environment's network policy
   currently blocks `www2.census.gov` and `api.census.gov`. Phase 1's geographic pipeline needs them. In the
   environment settings, add these hosts under Network access → Allowed domains (see
   <https://code.claude.com/docs/en/cloud-environments#network-access>). Without them, Phase 1 can only ship
   counties and states (from the `us-atlas` npm package), and congressional districts and Base Units wait.
3. **Enable GitHub Pages** for this repository once (Settings → Pages → Source: *GitHub Actions*) when Phase 1
   is ready to deploy.
4. **Choose a default political geography:** *fully fictional coalitions* (recommended; Texas can be blue and
   Massachusetts red) or an optional *familiar coalitions* preset (real-world-like group alignments with
   fictional geography). I recommend shipping only the first by default and keeping the second as a hidden
   advanced option.
