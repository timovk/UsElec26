# Phase 2 Report — Core Election Simulation

**Status:** implemented and tested. Not started on Phase 3; waiting for your approval.
**Engine version:** 0.2.0 · **Schema version:** 2 · **Geography pack:** 2016.1 (unchanged)

## 1. What you can do now

Advance through 2016 and every election happens on the date state law sets. Each year's calendar is planned on January 1, and each step below follows from the one before it.

1. **Filing.** About 75 days before each state's primary:
   - Each incumbent decides whether to run again. Age, a hostile district and term limits push toward retirement, and retirements make the news.
   - Officeholders with ambition (state officers, House members, governors) may run for higher office.
   - New candidates come from the state's bench.
   - Libertarian, Green and independent candidates file where they have ballot access. The Green Party is missing from the 2016 presidential ballot in GA, IN, NV, NC, OK and SD.
2. **Primaries.** Held on each state's 2016 date under its primary type (open, semi-closed, closed, top-two or Louisiana's jungle system):
   - Open and semi-closed primaries draw crossover voters.
   - Primary runoffs (for example Texas, Georgia and North Carolina) follow automatically.
   - An unopposed candidate is nominated without a primary ballot line.
   - California and Washington use top-two primaries.
3. **Presidential nominations.**
   - A sitting President who is eligible usually runs unopposed.
   - Otherwise up to seven national figures run. Vice presidents, governors and senators are the most likely, weighted by ambition and recognition.
   - Every state votes in a simplified national primary on June 14.
   - The conventions (July 28) pick running mates. The Libertarian and Green tickets are formed at the same time.
4. **The general election (November 8).** On the ballot:
   - President in 50 states and DC, with Maine and Nebraska awarding votes by congressional district;
   - 34 Senate seats, plus any special elections;
   - 435 House seats;
   - every governor, lieutenant governor, attorney general and secretary of state elected on the 2016 cycle.

   Georgia and Louisiana runoffs follow when no candidate gets a majority.
5. **Electoral College.**
   - Electors meet on December 19 and Congress counts the votes on January 6.
   - If no one reaches 270, the 12th Amendment applies: the House votes by state delegation (26 needed) and the Senate picks the Vice President.
   - If the House deadlocks, the 20th-Amendment fallback applies.
6. **Taking office.**
   - The new Congress is sworn in January 3 and the President at noon on January 20.
   - Governors take office on each state's own date (Kentucky, for example, inaugurates in December of the election year).
   - Winners leave their old office, and that office's vacancy is handled lawfully.
7. **Vacancies.**
   - A House vacancy triggers a special election.
   - A vacant or appointed Senate seat is filled at the next regular general election.
   - An officer-elect who dies before inauguration leaves the office vacant.
8. **Explore the results.** Everything is permanent and sealed:
   - **Results:**
     - for any year: the presidential result in electoral votes and popular vote;
     - the balance of power before and after;
     - every seat that changed party;
     - a filterable table of every contest;
     - an **Archive audit** button.
   - **Contest page:**
     - candidates, votes and shares;
     - ballots, undervotes, eligible voters and turnout;
     - votes by method (Election Day, early in person, mail, provisional);
     - every county;
     - the archive seal.
   - **County page:** the county's presidential history with swings, and every contest it voted in.
   - **Archive:** browse by state, then county.
   - **Map → Election results:**
     - county, state or district margins for President, Senate, Governor or House;
     - the electoral-vote panel and the national popular vote.
   - **People:** each politician's electoral history.
   - **Desk:** latest results and the upcoming-elections calendar.
9. **Time controls.**
   - **Next election 🗳** jumps to the next election day and holds every contest on it.
   - The time bar shows what the engine is doing ("Counting ballots…", "Sealing and archiving results…").

Results still appear the moment polls close. Counting them on election night is Phase 3.

## 2. Using it on a Chromebook

1. **Deployment.** Phase 2 is pushed to the development branch. GitHub Pages deploys from `main`, which still serves Phase 1. Tell me if you want `main` updated, as we did for Phase 1. The installed app then shows *"A new version of the app is ready — Reload to update"*.
2. **Your Phase 1 universes keep working.** On first open they upgrade to schema 2 and their election calendar is planned.
   - Elections whose 2016 date has already passed in that universe are moved to at least one week ahead (presidential primaries: 30 days).
   - This is tested with a real save made by the Phase 1 code.
3. **Hold an election.** Click **Next election 🗳** to go one election day at a time, or **+1 year** for the whole cycle. Measured on this server in Chromium with 3 compute workers (§7):
   - a primary day: 0.1–2.3 s;
   - the November general: about 6 s;
   - the whole of 2016: about 21 s.

   A Chromebook will be slower, perhaps 1.5–3×. Please tell me how long the **+1 year** from January 1, 2016 takes on yours.
4. **Explore.** Open **Results**, then click any contest, then any county. Also try **Map → Election results**.
5. **Check the archive.** On **Results**, click **Audit the 2016 archive**. It re-reads every sealed result and should say *All N elections passed*.
6. **Back up after big elections.** Click **Export**. A universe is about 27 MB after the 2016 cycle.

## 3. What was built

| Area | Delivered |
|---|---|
| Election law, 2016 (`src/rules/elections2016.ts`) | For each state: primary date rule, primary type, primary runoff threshold and timing, general runoff (GA, LA), voting modes (all-mail, early in person, no-excuse absentee), inauguration rule, presidential ballot access. Federal dates: general, electors (first Monday after the second Wednesday of December), January 6 count, January 3 and January 20. Electoral votes from House seats + 2. |
| Calendar (`src/engine/elections.ts`) | Elections planned on January 1 for the year: regular races by office cycle, filing, primaries, presidential nomination, conventions, general, Electoral College. Specials from vacancies. Scheduled events persist in the database, so the plan survives save/reload. |
| Candidates | Incumbent retire-or-run model, ambition pass (state officers and House members run for higher office), newcomers from the bench with home county, age, background and party-appropriate traits. Minor-party and independent filings. Running mates for joint governor/LG tickets and presidential tickets. One candidacy per person per year (derived from the archive). |
| Ballot kernel (`src/electorate/kernel.ts`) | The **shared electorate**: for each Base Unit, ballots are drawn **once** per voting mode, and every contest on that ballot partitions exactly those ballots among candidates plus an undervote. Turnout, mode and choice come from 48 voter types (4 cohort classes × 12 partisanship bins) moment-matched within 16 age × class groups. Multinomial-logit choice with party sign, candidate quality, incumbency, class fit, minor-party appeal and home-county and home-state bonuses. Exact binomial and multinomial draws, so counts are integers that add up. |
| Election environment (`src/electorate/environment.ts`) | For each year: national swing from fundamentals (time-for-change, midterm penalty, economy *stub*, AR(1) random), class swings, regional, state and county AR(1) shocks, enthusiasm, the mode gap, and state and county turnout shocks. A universe turnout target is drawn from 55–64% and calibrated by secant iteration with Gauss–Hermite quadrature. Turnout is lower for midterm, off-year, special, primary and runoff elections. |
| Compute pool (`src/engine/computePool.ts`, `src/workers/compute.worker.ts`) | Shards (one per state and election) run on `min(4, cores − 1)` Compute Workers, largest first, with results put back in input order. Tested: inline, 1 worker and 4 workers produce byte-identical universes. |
| Outcomes | Plurality, Georgia majority, primary runoffs, top-two, Louisiana jungle and December runoff. Seeded tie-breaks. Electoral College with ME/NE district electors from the archived district totals, and the 12th-/20th-Amendment contingent procedure. Certification. Assumption of office on the legal date. Resign-to-run vacancies. |
| Archive v1 (`src/archive/results.ts`, schema v2) | Immutable result revisions with **SHA-256 seals**. `ENA1` columnar blobs at Base-Unit grain (generals), county × district grain (primaries) and reporting-jurisdiction × mode grain. County rollups with district totals for each state and election. Per-Base-Unit turnout (eligible, ballots, by mode). Candidate totals, undervotes and turnout as rows for fast queries. |
| Audit (`auditElection`) | For each election and contest: the seal is recomputed and must match; blob checksums; candidate totals = Σ units; undervotes = Σ units; for **every** Base Unit, votes + undervotes = ballots and ballots ≤ eligible; county rollups = Σ units. Runs from the UI, in unit tests on every fixture election, and on all of 2016 on the real geography. A tampering test confirms that changing one stored vote fails the audit. |
| Queries and UI | Results, Contest, County, Archive, map results view, person electoral history, Desk results card, Next election button, progress steps. Election Night, Polls and Analyst remain labelled placeholders for Phases 3–5. |

## 4. How a simulated election works (short version)

1. **Electorate.** For each Base Unit (Census block group within district lines), the eligible population is split into cohorts. Each cohort has a fictional partisanship distribution set when the universe was created.
2. **Voter types.** The kernel groups those cohorts into 48 voter types and computes each type's turnout probability. Turnout is higher with stronger partisanship, enthusiasm for one side, older and more educated cohorts, and competitive states.
3. **Ballots.** The number of ballots is drawn once per Base Unit and mode (exact binomial). The mode shares follow the state's 2016 voting options.
4. **Choices.** Every contest on that ballot divides the same ballots among its candidates and an undervote (exact multinomial). The President, Senator, House member and governor are therefore all chosen by the same voters. Ticket splitting arises from candidate quality, incumbency and the home-area bonuses.
5. **Archive.** Results are summed upward: Base Unit → county → district → state → nation. Every level is an exact sum, sealed and archived before anyone takes office.

Details are in [04-statistical-methodology](architecture/04-statistical-methodology.md) and the code comments.

## 5. Test results (actual runs, this environment)

| Suite | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | ✅ no errors |
| ESLint | ✅ no problems |
| Module boundaries and information firewall (dependency-cruiser) | ✅ no violations (69 modules, 252 dependencies) |
| Unit, property and integration tests (Vitest) | ✅ **52 passed**, 2 skipped: the opt-in real-geography benchmark and the Phase 1 opt-in survey |
| Real-geography 2016 cycle (opt-in, `ENA_CYCLE=…`) | ✅ 3/3 seeds pass, with the full audit of every 2016 election |
| End-to-end in Chromium (Playwright) | ✅ **2 passed** (Phase 1 flow, and the new election flow below), no console errors in the page or the workers |

**New tests in Phase 2:**
- **Full cycle (fixture):**
  - 51 presidential contests and 435 House generals, all decided;
  - electoral votes sum to 538;
  - the new Congress sworn in January 3 and the President at 12:00 ET on January 20, 2017;
  - integrity report clean;
  - every news headline produced during the advance is returned.
- **Save/reload in mid-campaign:** advancing to December in one go gives the same database content as advancing to April 15, saving, reopening and continuing.
- **Compute pool:** inline, 1 worker and 4 simulated workers (inputs cloned as `postMessage` does, replies in random order) give byte-identical universes.
- **Archive audit:**
  - every one of the more than 60 fixture elections passes;
  - adding one vote to one stored total is detected.
- **Kernel properties:**
  - ballots ≤ eligible;
  - modes partition the ballots exactly;
  - every contest partitions exactly the ballots of every unit;
  - realized totals track the analytic expectation;
  - deterministic;
  - primary electorates are smaller and partisan.
- **Next election:** stops after the first election day with all of that day's contests held, and the next click moves on to the next day.
- **Phase 1 compatibility:** a universe saved by the actual Phase 1 release (engine 0.1.0, schema 1) opens, migrates and runs all of 2016, including the inauguration.
- **End-to-end (Chromium, real geography):**
  - create a universe, then **+1 year** (all 2016 primaries and the general);
  - Results: the electoral votes sum to 538;
  - **Audit the 2016 archive**: all passed;
  - a contest page, then a county page;
  - the results map;
  - **+1 month** past the inauguration;
  - the Desk shows the 2016 results.

**Bugs found and fixed by these tests:**
- A vacancy was recorded twice in one save interval, which left the database marking a seat both vacant and filled.
- An officer-elect who died left the outgoing holder's term open.
- Election news was dropped from the advance summary.
- The integrity hash failed on tables without a rowid.
- "Next election" on January 1 ran all the way to November.
- Results and Desk defaulted to the just-planned next year, which had no results yet.

## 6. Election statistics (real geography, three seeds)

The coalitions are fictional, so state outcomes do not follow real 2016 patterns. What should look American is the *shape* of the results.

| Statistic | S-A | S-B | S-C | Comment |
|---|---|---|---|---|
| Underlying national lean (D two-party, before the campaign) | 49.2% | 49.6% | 52.9% | From the Phase 1 electorate |
| Presidential vote D – R | 50.7 – 45.7 | 49.5 – 47.0 | 51.0 – 45.6 | The environment moves it a few points |
| Libertarian / Green | 2.5 / 1.2 | 2.4 / 1.1 | 2.2 / 1.2 | |
| Electoral votes | 307 – 231 | 284 – 254 | 311 – 227 | ME/NE district electors included |
| Turnout (of eligible) | 55.2% | 55.5% | 57.6% | Within about 1 point of each universe's drawn target (S-A 56.2%, S-B 55.2%) |
| Senate races won by the party losing that state's presidential vote | 9 / 34 | 4 / 33 | 6 / 33 | Real 2016 had none. Earlier decades had many. |
| House seats uncontested by a major party | 42 | 34 | 44 | |
| House incumbents re-elected (general) | 95.8% | 96.2% | 94.9% | |
| Undervote: President / Senate / House | 0.5 / 1.0 / 2.3% | 0.5 / 1.0 / 2.0% | 0.4 / 1.1 / 2.3% | Down-ballot drop-off rises as expected |
| Undervote: Governor / LG / AG / SoS | 0.9 / 3.2 / 3.6 / 3.5% | 2.2 / 3.0 / 4.5 / 3.2% | 0.8 / 2.7 / 3.3 / 4.2% | |
| Contests archived in 2016 | — | 822 | 822 | Generals, primaries, top-two, specials, nominations and presidential state contests |
| Full audit of 2016 | 110 elections, 807,767 unit-contest records, 0 failures | 109 / 811,561 / 0 | 108 / 810,302 / 0 | 1.5–1.8 s |

Chamber outcomes vary a lot between universes. The new House had 230, 209 and 294 Democrats in these three seeds. That depends on each universe's fictional geography and on its Phase 1 starting Congress, whose members carry an incumbency advantage. In the E2E universe the starting Congress had 70 Democratic senators and 297 Democratic House members. The first election moved both toward the electorate's lean, to 64 and 248.

## 7. Measured performance

| Measurement | Value | Notes |
|---|---|---|
| General election day, Chromium, 3 compute workers (4-core server) | **6.0 s** | Kernel 1.8 s (parallel), tallying 0.15 s, sealing and archiving 2.8 s. Budget: ≤ 15 s on the reference Chromebook. |
| Same day, Node, single thread | 7.7 s | Kernel 6.3 s, tallying 0.26 s, sealing and archiving 0.97 s |
| A primary day, Chromium | 0.1–2.3 s | Largest: June 7 (CA, NJ and others) 1.9 s, and the national presidential primaries on June 14, 2.3 s |
| Whole 2016 year (+1 year), Chromium | **21 s** | Budget: ≤ 40 s on the reference device, *including* Phase 3–5 work not built yet |
| Jan 1 → Jun 30, 2016, Node | 15.5–16.1 s | All primaries up to then, plus the national presidential primaries |
| Archive audit of every 2016 election | 1.5–1.8 s | About 810,000 unit-contest records |
| Archive size, 2016 cycle | 4.0 MB contest blobs (BU 3.3, county×district 0.1, RJ×mode 0.6) + 1.8 MB per-BU turnout + 0.1 MB rollups | Phase 0 estimate for the comparable components was about 5.2 MB |
| Universe database | 18.3 MB at creation → **26.7 MB** after the 2016 cycle | Includes the 14 MB geography copy |

**Fixed during measurement:** writing all 51 state results in separate transactions cost 4.4 s in Chromium, because each OPFS commit syncs. The general election day is now written in one transaction, which took the day from 9.4 s to 6.0 s.

**Caveat:** these are server-CPU numbers. A Chromebook core is about 1.5–3× slower, so I expect a general election day of roughly 10–18 s on a Chromebook. Please send me the **+1 year** timing from yours, or Settings → Diagnostics.

## 8. Known limitations (Phase 2)

1. **Results are instant.** There is no election night yet: no poll-closing sequence, no reporting jurisdictions coming in, no calls. That is Phase 3. Mode results are already archived for it.
2. **Simplified presidential nominations.** One national primary on June 14 replaces the state-by-state calendar, delegates and debates (Phase 5). The incumbent is usually unopposed.
3. **Primaries are thin.**
   - There are no campaigns, money or endorsements yet (Phase 5). Quality and incumbency decide.
   - Unopposed candidates appear on no primary ballot.
   - The 2016 primary dates and types are reused every year until election law can change (Phase 6).
4. **Specials.**
   - House specials have party-nominated candidates with no special primary.
   - Senate specials put every candidate on one general-election ballot.
   - Specials fall about 95 days after the vacancy (or on the next general if it is near).
5. **Statewide row offices** (LG, AG, SoS) are assumed to be on the governor's cycle.
6. **Louisiana governor elections** are approximated: jungle on the November date, runoff in December.
7. **The economy and presidential approval are stubs.** The fundamentals term is labelled `economyStub` in the stored environment. Real models arrive in Phase 6.
8. **No state-legislative or local elections** (Phases 6–7). Legislatures remain party compositions.
9. **Geographic correlation of shocks** is region → state → county plus one Base-Unit shock. There is no finer neighbourhood correlation within a county.
10. **The election-law data** (`src/rules/elections2016.ts`) was compiled from knowledge, without individual citations, just like Phase 1's `states2016.ts`. It passes structural tests, but individual dates, runoff thresholds and inauguration rules should be checked against state codes.
11. **Kentucky and Rhode Island** still lack 2010 voting-district counts, which matters in Phase 3.
12. **Archive grain for primaries** is county × congressional district instead of the planned atom grain. Atoms arrive with legislative districts in Phase 6. General elections are stored at full Base-Unit grain.

## 9. Changelog

- **Schema v2:**
  - new tables: `election`, `contest`, `candidacy`, `contest_total`, `contest_turnout`, `result_revision`, `result_blob`, `contest_geo`, `county_rollup`, `election_turnout`, `electoral_vote`, `pending_special`;
  - migration from v1 on open.
- **Engine 0.2.0:** election calendar, filing, primaries and runoffs, presidential nominations and conventions, general elections, Electoral College and contingent election, certification, assumption of office, House and Senate specials.
- **New modules:** shared-electorate ballot kernel, election environment and turnout calibration, compute worker pool, archive results and audit, archive queries.
- **UI:**
  - new screens: Results, Contest, County and Archive;
  - Map election-results view;
  - Person electoral history;
  - Desk latest-results card;
  - working Next election button;
  - progress steps in the time bar.
- **Fixes to Phase 1 code:**
  - vacancy persistence when a seat is vacated and filled within one save interval;
  - the outgoing term now ends correctly when an officer-elect dies;
  - the integrity hash now handles tables without a rowid;
  - name generation no longer fails when a small fixture name list runs out (duplicates allowed after 40 tries; real-politician names are never allowed).
- **Tests:** kernel, real-geography kernel benchmark, fixture cycle, mid-campaign fork, compute-pool invariance, archive audit and tampering, Next election, Phase 1 save compatibility, real-geography cycle report, and the election E2E.
- **Docs:** this report. Architecture docs updated: roadmap status, measured archive sizes ([07 §7.4](architecture/07-historical-archive.md)) and measured Phase 2 performance ([11 §11.2](architecture/11-performance.md)).

## 10. Next: Phase 3 — Election-night counting (awaiting your approval)

From the [roadmap](architecture/10-roadmap.md):
- poll-closing times by local time across split time zones;
- synthetic precincts and reporting units calibrated to voting-district counts;
- a count plan per jurisdiction: which modes are counted when, pre-processing rules, arrival curves, overnight and post-night counting, provisional ballots and corrections;
- an exact partition of the sealed results, so the night always ends at the archived totals;
- the wire's expected-vote model;
- the voter survey;
- the decision desk, including race calls, retractions and chamber-control projections.

Phase 2 already stores votes by reporting jurisdiction and mode, and per-Base-Unit ballots by mode. That is exactly what the count plan will release over the night.
