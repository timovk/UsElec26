# 10 — Development Roadmap

## 10.1 Refinements to the baseline (with justification)

| # | Change | Justification |
|---|---|---|
| R1 | **Geographic pipeline (Base Units, CD115/SLD crosswalks) moves into Phase 1.** | The initial universe needs a House of Representatives elected from real districts (spec §3.1). It is also the project's largest data risk, and front-loading it validates the architecture early. |
| R2 | **Minimal contingent election (12th Amendment) in Phase 2.** | A 269–269 tie or a third-party EV win is possible from the first simulated presidential election. Leaving it out would make some universes invalid. |
| R3 | **Simplified nominating contests in Phase 2.** Full primaries remain in Phase 5. | General elections need nominees. Phase 2 nominates through real (simplified) primary contests run by the same ballot kernel, so no nominee is ever "picked". Phase 5 adds campaigns, delegates, debates and conventions. |
| R4 | **Wire service, flagship decision desk, voter survey and retraction logic in Phase 3.** Multiple networks and disagreement UI remain in Phase 9. | Phase 3's acceptance criterion ("watch 2016 unfold") requires calls, and calls at poll closing require the survey. Building retraction into the desk model from the start prevents a later redesign. |
| R5 | **Census, apportionment, baseline algorithmic redistricting and state legislative general elections move to Phase 6.** Partisan strategies, commissions, litigation and mid-decade redistricting remain in Phase 9. | Users will reach 2021 within the first few sessions. Without these, every universe would permanently keep 2010-cycle maps and 2016 legislatures (frozen history cannot be repaired later). State legislative control also determines who draws maps. |
| R6 | **Testing, determinism and benchmark harnesses start in Phase 1** and grow every phase. | Spec §19: testing from the beginning. |

**Compatibility note:** saves are forward-compatible through migrations. A universe that passes 2021 before
Phase 6 ships keeps its unredistricted history: that is what happened in that universe, and it is
labelled as such. **For a long-term "canonical" universe, start it after Phase 6.**

## 10.2 Cross-phase quality gates (every phase)

- CI on every push: typecheck, lint (including dependency-cruiser layering and the firewall), unit and property tests, E2E
  smoke in Chromium, benchmark smoke with budgets, determinism test, migration test against golden
  saves.
- No placeholder controls without a "Planned" label.
- Each phase ends with: a deployed build, Chromebook usage notes, **actual** test and benchmark output, known
  limitations, a changelog, and a pause for your approval (spec §24).

## 10.3 Phases and milestones

### Phase 0: Architecture & feasibility ✅ (this delivery)
Deliverables: these documents and spikes. Exit: your approval and the decisions in README.

### Phase 1: Foundational political universe
| Milestone | Deliverables |
|---|---|
| M1.1 Scaffold & CI/CD | Vite + React + TS strict; lint and boundaries; Vitest, fast-check, Playwright; GitHub Actions → Pages; PWA shell (installable, offline) |
| M1.2 Core libraries | Keyed counter-based RNG; deterministic math (fdlibm port); UTC time and US tz engine; `ENA1` codec; typed worker RPC; engine/compute worker skeleton |
| M1.3 Persistence | SQLite-WASM on OPFS (sahpool) in the engine worker; schema v1; migration framework; slots, autosave, manual save, backups; `.ena` export/import; integrity checks; Web Locks; storage estimate and persist |
| M1.4 Geography pack v1 | Pipeline from Census sources: states, counties, CD115, 2016 SLDs, BUs, atoms (2016 epoch), RJs; adjacency; LOD TopoJSON; validation report |
| M1.5 Population v1 | County×cohort IPF tables, BU marginals, VEP base for Jan 2016 |
| M1.6 Electorate v1 | Coalition generator, partisan identity, spatial fields, calibration to §4.7 targets (static-geography statistics) |
| M1.7 Institutions & parties | Offices (President, VP, Senate classes, House, governors, elected LG/AG/SoS), chambers with compositions and leaders, succession rules, party entities and platforms |
| M1.8 People & initial government | Name generation with blocklist; tiered politicians; pre-simulation backgrounds (biographical only); consistent initial officeholders; administration and cabinet |
| M1.9 Clock & scheduler | Discrete-event engine; advance day/week/month/next event; aging, birthdays, rare deaths with succession |
| M1.10 Dashboard | Hub, Desk, national/state/county map of *underlying lean* (labelled simulation truth), officeholder lists, profiles, settings/storage |

- **Dependencies:** Census hosts allow-listed (README decision 2); GitHub Pages enabled.
- **Tests:** determinism (same seed → same DB content hash); fork test (advance 2 years in one go versus 1 year, save, reload, 1 year → identical); geography reconciliation; calibration across 100 seeds; codec round-trip property tests; migration from a v1 golden save; OPFS persistence across reload (E2E); export/import round trip.
- **Acceptance:** on a Chromebook you can open the URL, install the app, create a universe, view its government and lean maps, advance time, save, reload, export and import. Everything works offline after the first load.
- **Risks:** Census data access; BU count above budget; OPFS quirks; calibration difficulty.

### Phase 2: Core election simulation
**Status:** implemented — see [../phase-2-report.md](../phase-2-report.md). Deviations: primaries are archived at county × district grain until atoms exist (Phase 6); presidential nominations use one simplified national primary.

| Milestone | Deliverables |
|---|---|
| M2.1 Rules & calendar | 2016 baseline rules (federal, governor, primary types and dates, filing deadlines) with citations; calendar from office terms |
| M2.2 Contests & ballots | Contest creation; per-BU ballot composition; specials from vacancies |
| M2.3 Candidates | Incumbent run/retire decisions; challengers from the bench; simplified nominating primaries (kernel-run) |
| M2.4 Fundamentals | Quality, incumbency, money proxy; environment from approval and economy stubs (clearly labelled until Phase 6) |
| M2.5 Electorate kernel | Turnout, mode, choice; type aggregation; realization in the compute pool; progressive lock; sealing |
| M2.6 Outcomes | Electoral College including ME/NE districts; minimal contingent election; certification stub; assumption of office on legal dates |
| M2.7 Archive v1 | Revisions, BU/atom/RJ-mode blobs, rollups, summaries, county pages, contest pages, results map |
| M2.8 Audit v1 | Invariants in §7.7 |

- **Tests:** all §7.7 invariants on many seeds; kernel property tests; EC allocation unit tests (including ties and ME/NE); calibration of election statistics (§4.7); performance (general election ≤ 15 s on reference).
- **Acceptance:** simulate the 2016 general and inspect mathematically consistent results from county to nation, with correct office transitions.
- **Risks:** calibration of ticket splitting and undervotes; kernel performance at the full BU count.

### Phase 3: Election-night counting
**Status:** implemented — see [../phase-3-report.md](../phase-3-report.md). Deviations: one network (flagship); survey toplines only; recounts deferred; primaries are still decided at the close of voting (their nights arrive with Phase 5 primaries).

| Milestone | Deliverables |
|---|---|
| M3.1 Poll closings | Local-time closing rules → RJ schedules across split zones |
| M3.2 RJ & RU model | Synthetic precincts (VTD-count calibrated), admin profiles |
| M3.3 Count plan | Modes, pre-processing rules, arrival curves, post-night counting, provisional, corrections; exact partition |
| M3.4 Wire | Expected-vote model |
| M3.5 Voter survey | Survey sampling and weighting |
| M3.6 Decision desk | Flagship model, status rules, retractions, control projections |
| M3.7 Record & playback | Night Record encode/seal; Broadcast Worker; functional night view (clock, map fill, race list) |

- **Tests:** batches sum exactly to rev 1; cumulative ≤ final; no call before the last poll closing; replay hash equality; desk accuracy over 200+ simulated nights (wrong-call rate, median call times by category).
- **Acceptance:** watch 2016 unfold from 5 pm ET with calls, and with some races unresolved after midnight when uncertainty justifies it.
- **Risks:** call realism (too fast or too slow); expected-vote modelling.

### Phase 4: Broadcast interface
**Status:** implemented — see [../phase-4-report.md](../phase-4-report.md). Deviations: 2–8 commentary templates per story type (not 10–30); over-performance and bellwether stories deferred; swing and turnout-change maps need a previous comparable election (from 2018 on); visual regression uses one stored Chromium baseline.
Deliverables: broadcast layout and identity, national/state/county maps (Canvas2D), EC counter, Senate/House
bars, Key Race Alerts, projection animations, audio and reduced motion, commentary v1 (story types in §8.6),
playback controls and markers, Results Explorer v1, Analyst dashboard v1, map modes (winner, margin, swing,
turnout, turnout change, reporting, outstanding).
- **Tests:** visual regression snapshots; frame-time benchmarks (map recolor ≤ 50 ms, animations ≥ 50 fps at 1366×768 on reference); commentary fact-binding validator (no unbound slot ever rendered); repetition metrics.
- **Acceptance:** a complete, polished election night on a Chromebook.
- **Risks:** rendering performance on weak GPUs; commentary quality.

### Phase 5: Campaigns, polling, forecasts, primaries
**Status:** implemented — see [../phase-5-report.md](../phase-5-report.md). Deviations: primary election nights are not yet counted live (primaries are decided at the close of voting); primary polls approximate the primary electorate from the general electorate's types; the economy is still a stub in the fundamentals; debates are held for the presidential nomination and general and for statewide general races, not for congressional or gubernatorial primaries; 1,500 forecast draws rather than 20,000.
Deliverables: campaign dynamics, events in campaigns, pollsters, poll fieldwork and archive, Kalman averages,
Monte Carlo forecasts and history, presidential primaries (2016 calendar baseline, caucuses, delegate rules
including thresholds and superdelegates as in 2016 rules, withdrawals, conventions including contested ones),
congressional and gubernatorial primaries, debates, endorsements.
- **Tests:** poll-error distributions versus design; average coverage; forecast calibration over many simulated cycles (reliability within tolerance); delegate math unit tests; the firewall (forecast cannot import electorate).
- **Acceptance:** follow 2016 from January primaries through November with live polls and forecasts, and inspect forecast-versus-result afterwards.

### Phase 6: Political evolution
**Status:** implemented — see [../phase-6-report.md](../phase-6-report.md). Deviations: no state legislative primaries (one nominee per party); the national map draws the 2016 district shapes (new plans are drawn from base units on the Government page); redistricting is neutral and algorithmic only (as planned; strategies are Phase 9); the two Phase 5 carry-overs (speed, live primary nights) were deferred at your request.
Deliverables: careers (retirements, ambition, ladders), appointments, resignations, deaths, special
elections, approval from the electorate, event chains, economy (full), Congress activity (bills, roll calls,
vetoes), state government activity, demographic evolution (aging, migration, growth), **census,
Huntington–Hill apportionment, baseline algorithmic redistricting** (contiguous, compact, equal-population plans from
whole BUs), **state legislative general elections**.
- **Tests:** office succession; career continuity; apportionment against known-answer tests; plan validity (contiguity, population deviation, nesting rules); demographic accounting identities; 50-year headless runs with stylized-fact checks.
- **Acceptance:** advance 2016 → 2040 with a plausible evolving history, decennial reapportionment and new maps, while old maps stay intact.

### Phase 7: Complete electoral coverage
Deliverables: statewide down-ballot offices, multi-member and floterial districts, municipal and county offices
(major cities and all counties by default), judicial elections, school boards (largest districts), ballot
measures, jurisdiction rules with effective dates (RCV, top-two, runoffs, nonpartisan), New England town reporting,
Alaska HD reporting, synthetic-precinct map layer (WebGL2).
- **Tests:** rule versioning (no retroactive application); RCV tabulation known-answer tests; storage budget re-measured.

**Status:** 7.1 implemented — see [../phase-7.1-report.md](../phase-7.1-report.md). 7.2 implemented — see [../phase-7.2-report.md](../phase-7.2-report.md). 7.3 implemented — see [../phase-7.3-report.md](../phase-7.3-report.md). 7.4 implemented — see [../phase-7.4-report.md](../phase-7.4-report.md). Correction to the 7.1 line below:
real-world changes after 2016 (Alaska's top-four in 2022, Maine's ranked-choice voting in 2018) are not scheduled.
Per §3.4 of the simulation architecture, rules change only through simulated law; 7.1 builds the mechanisms and
the states' own reform sessions.

Phase 7 is delivered in eight sub-phases. Each ends like a phase: working code, Chromebook notes, actual test
results, limitations, a changelog, speed and storage re-measured, and a pause for your approval. The order puts
the rules framework first (later contests depend on it) and the costliest additions (local offices) last.
Stopping after 7.5 gives a lean Phase 7. Estimates are working time.

| Sub-phase | Deliverables | Estimate |
|---|---|---|
| **7.1 Election rules over time** | Jurisdiction rules with effective dates, never applied before them; ranked-choice voting (rankings from the voter model, round-by-round tabulation with exhausted ballots, first choices on election night and the full tabulation later, as in Maine); nonpartisan contests; Alaska's top-four from 2022; the existing top-two, jungle and runoff rules moved onto the framework. Tests: RCV known-answer tests, no retroactive application. | 5–7 h |
| **7.2 Statewide down-ballot, boards and state courts** | Treasurer, auditor/comptroller, superintendent, insurance, agriculture and labor commissioners, utility commissions (per each state's rules); elected state boards of education and university regents; state supreme courts and statewide appellate courts: partisan, nonpartisan and retention elections, appointments and mandatory retirement. | 6–8 h |
| **7.3 Ballot measures** | Statewide initiatives and referendums, decided by voters' issue positions rather than party; topics from the platforms and the electorate's issues; archive and election-night coverage with desk calls. | 4–5 h |
| **7.4 Multi-member and floterial districts** | Real seat counts per legislative district; "vote for N" ballots in the kernel with top-N winners; New Hampshire floterial districts. | 3–5 h |
| **7.5 Town and Alaska reporting** | Maps, results pages and election night by New England town and Alaska House district (the count already uses these reporting units). | 3–4 h |
| **7.6 County offices** | Commission, sheriff, clerk and prosecutor in every county; odd-year and spring calendars; nonpartisan races; a per-universe setting (off / major counties / all counties); bulk certification and archiving to protect the per-year cost. | 6–8 h |
| **7.7 Cities and school boards** | Mayors and councils of major cities and boards of the largest school districts; new geography (Census places and school districts, a pack update); municipal calendars. | 6–9 h |
| **7.8 Precinct map layer** | Results at synthetic-precinct level on the night and archive maps (WebGL2). | 4–6 h |

**Live primary nights** (deferred from Phase 5) are not part of Phase 7; they come at a later date.

### Future ideas (not scheduled)
Ideas agreed for later, outside the numbered phases until they are scheduled:
- **Live primary nights** (deferred from Phase 5): presidential and state primary nights counted and broadcast
  like the general election.
- **Regional appellate courts** (from 7.2): intermediate appellate courts elected by region (Texas's 14 courts of
  appeals, Ohio's 12 appellate districts, Washington's three divisions and the like). 7.2 covers supreme courts
  and the appellate courts elected statewide.
- **Court rulings** (from 7.2): courts deciding cases that matter to the simulation (redistricting suits,
  election-law cases), and rulings that spark campaigns against a justice at a retention election.

### Phase 8: Advanced historical archive
Deliverables: rich county histories, long-term trends, interactive timelines, animated historical maps,
complete replay library, career histories, advanced search, dataset exports (CSV/JSON/zip), comparability badges throughout.
- **Tests:** 100-year archive stability; query budgets; export round-trip and schema docs.

### Phase 9: Advanced political systems
Deliverables: partisan, commission and court-drawn redistricting with strategy; legal challenges; mid-decade
redistricting; detailed legislative process; deep event chains; recounts and legal disputes; certification
politics; multiple networks with disagreement UI and network switcher; faithless electors.
- **Tests:** retraction and disagreement statistics; legal-process state machines.

### Phase 10: Optimization & polish
Deliverables: profiling-driven optimization (possible WASM kernels), storage levers (§7.4), accessibility audit,
responsive polish, comprehensive test expansion, data-integrity audits, 10/50/100-year stress tests with
published benchmark results.

## 10.4 Testing strategy summary

| Layer | Tooling | Examples |
|---|---|---|
| Unit | Vitest | EC allocation, Huntington–Hill, swing formulas, tz conversions, codec |
| Property-based | fast-check | Kernel invariants, batch partition, revision chains, RCV |
| Statistical | Vitest + seeded runs | Calibration targets, poll-error distributions, forecast calibration, call accuracy |
| Determinism | Custom harness | Same seed and commands → same DB hash; fork test; worker-count independence |
| Persistence | Playwright (real OPFS in Chromium) | Reload persistence, export/import, migrations on golden saves, crash mid-transaction |
| E2E | Playwright | Create → advance → election → night → archive → replay flow |
| Performance | Bench harness in Chromium with CPU throttling, plus on-device Diagnostics | Budgets in §11 |
| Long-run | Headless engine in Node workers (CI nightly) | 100-year runs on N seeds: stability, archive integrity, size |
