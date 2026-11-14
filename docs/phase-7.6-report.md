# Phase 7.6 Report — County Offices

**Status:** implemented, awaiting your approval.
**Engine version:** 11.0 (was 10.0) · **Schema version:** 11 (was 10) · **Night record:** version 3 (was 2; older
records read as before) · **Geography pack:** 2016.1 (unchanged)

Phase 7.6 is the sixth of eight Phase 7 sub-phases ([roadmap](architecture/10-roadmap.md#phase-7-complete-electoral-coverage)).
Every county in the country now has its elected government. As agreed (1B, 2A, 3B, 4A, 5C):
1. **Every county office (1B):** the board, the executive or county judge, the sheriff, the clerks, treasurer,
   assessor, auditor, recorder, coroner, surveyor and the other row offices, and the prosecutors.
2. **Board districts (2A)** drawn inside each county and redrawn after every census.
3. **Prosecutorial districts (3B):** the real 2016 districts in nine states, generated districts in seven others
   (named below), and elected by county everywhere else.
4. **All counties by default (4A).** Existing universes gain them when first opened, and Settings can limit them to
   the major counties or switch them off.
5. **Counted live on election night (5C)** in the Desk, the Analyst and the Results Explorer, but not in the
   broadcast's banners or ticker. The top races of the largest counties are featured.

**The cost, as promised.** I said I would tell you if the measured cost came out above about 20% per election year.
It does: **+31% for 2016 and +35% for 2018 with every county's offices**, and +14% for the odd year 2017 (§5).
The first working version cost about +45% and I brought it down from there; the rest is the work itself (three
times as many contests, four times as many people). With **major counties only, it is +4%** over the three years.
Universes also grow faster: twice the size after three years (§5). The default is "all counties", as you chose. If
you prefer "major counties" as the default, that is a one-line change; every universe can still be switched in
Settings.

In short:
- **36,671 elected county seats** in 3,111 counties of 48 states (Connecticut, Rhode Island and the District of
  Columbia have no county government), each with an officeholder from day one.
- **County races on each state's calendar:** November of even or odd years, Wisconsin's April, Tennessee's August,
  Alaska's October; partisan or nonpartisan per state law, with party primaries, runoffs and nonpartisan primaries
  where the state holds them. In 2016: 18,481 county contests (and 6,833 federal and state ones); in 2018, 20,535.
- **Election night counts every county race** with its state, and the desk projects them. You follow them in the
  Desk, the Analyst and the Results Explorer.
- **Every county page** shows its board, offices, the prosecutor's district and local news. **Government → County
  government** sums up every state.

## 1. What you can do now

1. **Choose at creation.** **Universes → Start a new universe → Advanced → Counties**: every county's offices (the
   default), the counties of 250,000 people or more, or none.
2. **Open a county's government.** **Archive → a state → a county**: below its election history, **County
   government** lists the board with its seats by district, its party balance, each member's party, start date,
   how they got the seat and next election; the county's other offices; the prosecutor's or public defender's
   district covering the county; and the county's local news (deaths, appointments, county election results).
3. **See every state at a glance.** **Government → County government**: per state, the counties, seats, boards by
   majority, and executives, sheriffs and prosecutors by party. Click a state for its counties.
4. **Follow county races on election night.** **Election Night → Desk → Office: County offices.** The list opens
   on **Featured: largest counties**: the executive, sheriff and prosecutor of the counties of a million people or
   more, across the country. Pick a state, then a county, to see all its races: leader, margin, share counted and
   the desk's status. Click a race for its race board.
5. **Analyse one.** **Election Night → Analyst → County races ›**: the count over time with the desk's status
   changes, votes by mode, the desk's calls and the batch log of any county race.
6. **Browse every county result.** **Results → Results Explorer → County offices**: all the year's county contests
   with the same filters as the federal and state list (office, state, winning party, flips, incumbents defeated,
   close races, search). While a count is under way, it shows the live count and the desk's projections.
7. **History by county.** A county page's **All contests** has a **County offices** filter for its own races.
8. **Change the scope.** **Settings → County offices**. Narrowing ends the terms outside the new scope; their history
   stays in the archive. Widening installs officeholders in the newly covered counties, whose seats then follow the
   state's calendar.

## 2. Using it on a Chromebook

1. Open **https://timovk.github.io/UsElec26/** once `main` is updated. Until then the live site runs 7.5.
2. **Existing universes gain county offices when you first open them** (the default, every county). Opening takes a
   few seconds longer that once (it creates about 36,000 officeholders), and the universe grows by about 24 MB (a
   7.5 universe at January 2019 went from 111 to 135 MB, opening in 6.6 s on this server). If you would rather not,
   switch to **major counties** or **off** in **Settings → County offices** afterwards: the terms outside the scope
   end, and nothing more is simulated there.
3. **Each election year takes longer** with every county (§5). The major counties alone cost little.
4. **Export your universes** (Settings → Export) before opening them in 7.6 if you want a 7.5 copy: once opened,
   a universe is migrated to schema 11.

## 3. What was built

| Part | Where | What it does |
|---|---|---|
| County law of 2016 | `src/rules/county2016.ts` | Every state's elected county offices as of January 1, 2016: board names, sizes (by county population where it varies), elected by district, at large or by residency district, terms, election years and staggering, partisan or nonpartisan; the executive or county judge; the row offices; prosecutors by county, by real 2016 district (Alabama 41, Colorado 22, Florida 20 state attorneys and 20 public defenders, Georgia 49, Maine 8, Massachusetts 11, New Mexico 13, South Carolina 16, Tennessee 31) or by generated district (Arkansas 28, Kentucky 57, Louisiana 42, Mississippi 22, North Carolina 44, Oklahoma 27, Texas 155); county-specific exceptions (Cook, Harris, Miami-Dade, King and many others); consolidated city-counties and independent cities. A real district is used only if every county in it matched; else the state's districts are generated. |
| Offices and officeholders | `src/engine/county.ts` | The offices with their titles ("Sheriff, Harris County"; "Commissioner, Harris County Commissioners Court, District 2"; "State Attorney, 9th Judicial Circuit of Florida"); first holders with the county's 2016 lean and a background fitting the office; the scope (all, major, off); board districts drawn per county from its Base Units with equal population, stored by year (`county_plan`) and redrawn after each census; the kernel's county, board and district maps; vacancies filled by appointment. |
| County elections | `src/engine/elections.ts` | Filing on the state's calendar (November, Wisconsin's April, Tennessee's August, Alaska's October): incumbents stand again or retire, challengers file depending on the lean, large counties' top offices are almost always contested; about half of the newcomers are earlier county candidates; party primaries, runoffs and nonpartisan primaries per state law; at-large boards as "vote for N" races (Pennsylvania's limited voting: one fewer mark than seats); decisions, archive and terms; county news kept local. |
| Election night | `src/counting/record.ts`, `src/counting/countPlan.ts`, `src/projections/observer.ts`, `src/broadcast/playback.ts`, `src/engine/nightQueries.ts` | County races counted with their state's races (pooled by part and mode, rejected ballots still per unit), projected by the desk, and kept in the record's new `local` section; read on demand by the Broadcast Worker; the featured races. |
| Screens | `src/ui/screens/ElectionNight.tsx`, `src/ui/night/Analyst.tsx`, `src/ui/night/localRaces.ts`, `src/ui/screens/ResultsExplorer.tsx`, `src/ui/screens/CountyGovernment.tsx`, `src/ui/screens/CountyScreen.tsx`, `src/ui/screens/Government.tsx`, `src/ui/screens/Settings.tsx`, `src/ui/screens/Hub.tsx` | The Desk's county offices, the Analyst's county races, the Explorer's county list, the county page's government, the Government overview, the Settings scope and the creation option. |
| Queries | `src/engine/countyQueries.ts`, `src/engine/archiveQueries.ts`, `src/engine/queries.ts` | County government and overview; the Results lists rebuilt on batched reads (§5); history pages keep county races to the county's own page. |
| Schema 11 | `src/persistence/schema.ts` | `office_seat.county_idx`, `county_plan`, `news.local`, `contest.local` (set by a trigger) with partial indexes. |
| Engine 11.0 | `src/engine/universe.ts` | Also changed for every universe: mortality is checked weekly (each person on a weekday of their own) rather than daily; the results archive writes several rows per statement; candidate lists are read once per election. |

## 4. Test results

### 4.1 Suites

| Check | Result |
|---|---|
| Typecheck, ESLint and module boundaries | pass: no dependency violations |
| Unit, property and real-data tests (`npx vitest run`) | **153 passed**, 12 skipped (opt-in long runs); 5 new tests, 6 updated |
| End-to-end, Chromium (`npx playwright test`), this server | **4/4 passed** on the final build (elections and night 4.9 min; season and universe 2.4 min) |

### 4.2 New and updated tests

**`tests/unit/rules/county2016.test.ts`** (real geography): every county of the pack resolves to its bodies (36,085
county seats: 17,389 board seats, 3,092 sheriffs, 2,105 prosecutors, 2,222 clerks of court…); every real
prosecutorial district matches all its counties; the generated districts are contiguous; the three real districts
that are not contiguous are listed (Florida's 18th, Brevard and Seminole, for both state attorney and public
defender; Georgia's Dublin circuit).

**`tests/unit/engine/county.test.ts`** (fixture geography, 3 tests):
- **At founding:** every county office filled; a Texas county judge and commissioners court with four districts in
  the board plan; Florida's prosecutors by generated district; none in Connecticut; the county government page
  (board by district, sheriff) and the Government overview (one sheriff per county); board districts redrawn on a
  new population from the year they are first used, the old plan kept for earlier years; the scope switched off
  (every term ended) and on again (every seat filled); reopening keeps the scope, the plan and the seats.
- **2016–2017 elections:** county races in November of both years, Wisconsin's April and the local elections;
  every 2016 county general decided or in a runoff; the winners hold the offices; contested share between 0.3 and
  0.85; **every county race has voters**; `contest.local` set exactly for county contests; the Results Explorer's
  two lists (no county contest in the main list, every one in the county list); the archive audit passes for every
  election; the night record holds the county races as local races, kept out of the broadcast's races; at least 80%
  projected by the end of the feed; a county race's final count on the night equals its canvass revision.
- **Limited voting:** marks per ballot (three seats, two marks).

**Updated:** the Phase 1 save test (schema 11; the universe gains every county's offices and elects those up in
2016); the down-ballot test (state seats only); the election-law test (Alaska's ranked-choice generals are its state
and federal races, not its borough elections); the season end-to-end test (the presidential forecast checked on
August 5, after a nomination settled at the convention); the night end-to-end visual baseline (regenerated: the
simulated history differs under engine 11.0; the layout is unchanged).

**Checked by eye** in Chromium on a real-geography universe at 12 a.m. on election night 2016 (screenshots, no
console errors): the Desk's featured county races and a race board (Maricopa County's sheriff); Harris County's
races; the Analyst on an unopposed race; the Results Explorer's county list; Harris County's government; the
Government overview; the Settings card; the creation option.

## 5. Measurements

**The simulation.** Node, real geography, January 1, 2016 → January 1, 2019 (seed SPEED-1), back to back on this
server, the 7.5 build first:

| | 7.5 | 7.6, no county offices | 7.6, major counties | 7.6, every county |
|---|---|---|---|---|
| Creating the universe | 3.6 s | 5.2 s | 5.9 s | 8.2 s |
| 2016 (presidential year) | 75.0 s | 70.8 s (−6%) | 79.4 s (+6%) | **98.3 s (+31%)** |
| 2017 (odd year) | 17.7 s | 15.1 s (−15%) | 16.7 s (−6%) | **20.1 s (+14%)** |
| 2018 (midterm) | 76.4 s | 73.1 s (−4%) | 80.3 s (+5%) | **102.8 s (+35%)** |
| Three years | 169.2 s | 159.1 s (−6%) | 176.4 s (+4%) | **221.2 s (+31%)** |
| People at January 1, 2019 | 20,186 | 20,148 | 25,490 | 77,919 |

- **Why "no county offices" is faster than 7.5:** the engine-wide speed-ups (§3, Engine 11.0) save more than the
  county code costs when it has nothing to do.
- **Earlier measurements of the same kind,** one year at a time during the work, put "every county" at +30% to +34%
  for 2016. Runs on this server vary by a few percent; the back-to-back table is the comparison.
- **In the browser** the vote kernel and the night's count run in the compute workers, in parallel, so the
  share of the work done on the engine thread (filing, certifying, archiving) matters more. The end-to-end test
  ran 2016's primaries and general in 80.5 s in Chromium with every county; 7.5's report had 70.5 s and 85.1 s for
  the same test, which varies by ±15% between identical runs on this server. January 1 → November 8 took 75.0 s
  (7.5: 61.4–70.2 s), and creating a universe 12.6 s (7.5: 7.0 s). Not measured on a Chromebook.

**Storage**, the same runs:

| Database at January 1, 2019 | 7.5 | 7.6, major counties | 7.6, every county |
|---|---|---|---|
| Results (unit-grain blobs, totals, revisions, turnout, rollups) | 52.9 MB | 63.9 MB | 113.6 MB |
| People (persons, traits, careers, party history) | 5.9 MB | 7.8 MB | 26.2 MB |
| Offices and terms | 3.5 MB | 10.8 MB | 17.8 MB |
| Contests and candidacies | 4.1 MB | 5.7 MB | 16.6 MB |
| Election-night records | 6.1 MB | 7.2 MB | 9.7 MB |
| Everything else (geography, forecasts, polls, state) | 37.7 MB | 37.6 MB | 37.1 MB |
| **Total** | **110.2 MB** | **132.9 MB** | **221.1 MB** |

- **2016's night record** grows from 2.7 MB to 4.5 MB with the county races.
- **With county offices off,** the database is 118 MB: the offices exist, empty, so that they can be switched on
  later (about 7 MB).
- **Over a long universe** this adds up. Of the extra 111 MB, about 24 MB comes at the start (the offices and their
  first holders: a 7.5 universe gained 24 MB when 7.6 opened it); the rest, about 29 MB a year. At that rate a
  universe run to 2040 would hold about 0.7 GB more than under 7.5 (a straight-line estimate, not measured).

**Where the time goes** (every county against none, three years): counting ballots (the vote kernel and the night)
+21.6 s, writing and certifying the archive +20.9 s, the campaign season's daily work +9.0 s, preparing the
electorate +2.5 s, sealing +6.0 s, tallying +1.1 s. (Filing and the extra people's daily work fall within the
campaign season's step.)

**What I sped up** (from the first working version, +45% measured back to back):
- Candidate lists, contest rows and seats read once per election instead of once per contest (59,000 queries).
- Results written several rows to a statement.
- County contests flagged (`contest.local`) and left out of the daily campaign queries by a partial index.
- County races on the night: votes split by part and mode, with the plan shared by every race on the same units.
- Mortality checked weekly, each person on a day of their own (the same yearly risk).
- Earlier county candidates run again: about half of the newcomers to a county race, so fewer new people a year.

**Queries and pages** (Node, the every-county universe at January 2019):
- Results Explorer: the federal and state list of 2016 in 0.37 s (5.8 s during the night in the first version); the
  county list (18,481 contests) in 0.74 s.
- **Archive audit of 2016: 12.8 s in Node, 31.6 s in Chromium** (7.5's report: 145–197 s in Chromium). It was 138 s
  in Node at first with the county contests: it decoded each state's rollup once per contest and ran about 400,000
  queries; it now reads each election's revisions, candidacies and totals once (26,600 queries). Every 2016
  election passes.
- Opening the night: 0.47 s (its record is decoded once); the featured county races 11 ms; Texas's 1,416 county
  races 23 ms.
- A county's government 6 ms; the Government overview 47 ms; Texas's history page 12 ms; Harris County's 24 ms.
- Opening the universe: 5.3 s.

## 6. Fixes and decisions

- **Bugs found and fixed while testing:**
  - The night's county list and the county pages returned nothing at first: their queries were not routed. The
    query router now fails to compile if a query kind is left out.
  - The Analyst crashed on an unopposed race (one candidate). County races are often unopposed.
  - **222 county races had no voters:** small counties have fewer census areas than board districts (Brown County,
    Illinois, has a nine-district board). Such boards are now elected countywide, each member for a numbered
    district.
  - Reopening a universe installed officeholders in seats left vacant by a death, which the simulation fills itself.
  - Government → State offices & courts failed once county seats existed.
  - "Cook County County Board" in titles.
  - The Results Explorer's federal and state list made several queries per contest (5.8 s during the night).
  - The archive audit decoded each state's rollup once per contest.
  - State and district history pages listed county races; the year summary read every county contest.
- **Decisions:**
  - **County races stay out of the broadcast** (5C): no banner, ticker, alert or commentary line. A county race's
    news is local (its county page), except the executive, sheriff and prosecutor of the counties of a million
    people or more, which is national news and featured on the night.
  - **Major counties** are those of 250,000 people or more (2010 Census): 261 counties.
  - **Generated prosecutorial districts** (Arkansas, Kentucky, Louisiana, Mississippi, North Carolina, Oklahoma,
    Texas): the state's real number of districts, contiguous, drawn from its counties. Their names follow the
    state's usage ("Judicial District", "Judicial Circuit", "Prosecutorial District").
  - **Board districts are the simulation's,** not the counties' real 2016 maps (none are in the geography pack).
  - **County races are counted pooled** by reporting part and voting mode, then split across that part's batches.
    A batch carries its part's mix of votes rather than its own precincts'. The totals, the rejected ballots and the
    audit are exact.
  - **A projected county race is not re-examined** by the desk (thousands a night).
  - **Engine changes for every universe:** weekly mortality and the faster archive writes change the random draws,
    so a seed gives a different history than under engine 10.0.

## 7. Known limitations

- **The cost:** about +31–35% per even year (+14% in an odd year) with every county, and a universe twice the
  size after three years (§5).
- **Not simulated:** trial-court judges, justices of the peace, constables, appointed county officials, school
  boards and city governments (7.7). In consolidated city-counties (San Francisco, Denver, Philadelphia…) the
  governing body and the mayor are city government, for 7.7.
- **Approximations:** board sizes follow the state's usual size by county population, with named exceptions; offices
  that differ county by county within a state follow the common pattern; prosecutors in seven states are in
  generated districts; board districts are drawn by the simulation.
- **Not on the maps:** county races have no map view yet; their results are by county or district on their pages.
- **County races are not polled or forecast.**

## 8. Changelog

- This commit: Phase 7.6.
  - Every county's elected offices as of 2016, with real prosecutorial districts in nine states.
  - Board districts per county, redrawn after each census; the scope setting (all, major, off).
  - County elections on each state's calendar, counted on election night and archived.
  - The Desk's county offices, the Analyst's county races, the Results Explorer's county list, the county
    government section and the Government overview.
  - Engine 11.0 (also: weekly mortality, faster archive writes and queries); schema 11; night record version 3.
  - Tests, docs (architecture 02, 03, 05, 07, 08 and 10, README) and this report.

## 9. Next: Phase 7.7 — Cities and school boards (awaiting your approval)

- **Mayors and city councils** of the major cities, and the **boards of the largest school districts**.
- **New geography:** Census places and school districts (a geography pack update).
- **Municipal calendars**, many nonpartisan and off-cycle.

The roadmap estimate is 6–9 hours.
