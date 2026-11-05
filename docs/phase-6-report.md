# Phase 6 Report — Political Evolution

**Status:** implemented and tested; awaiting your approval before Phase 7.
**Engine version:** 0.6.0 · **Schema version:** 6 · **Night record:** version 2 (unchanged) · **Geography pack:** 2016.1 (unchanged)

As agreed, the two items carried over from Phase 5 (faster simulated years and live primary nights) were left
for later, and Phase 6 went straight to political evolution.

## 1. What you can do now

1. **Let a universe run for decades.** Every January 1, the population and the electorate move on:
   - **Demography:** adults age from one band to the next and die at realistic rates. New adults come of age,
     immigrants naturalize, and people move between counties (the fast-growing ones keep growing for a while).
     The race and education mix follows national trends.
   - **The electorate:** party platforms move. The party out of the White House moves toward the swing voters,
     faster the longer it has been out; activists pull each party back toward its base; a presidential nominee
     leaves an imprint. Groups' partisanship drifts toward what the platforms imply, faster for the young.
     Ageing carries old loyalties forward, and new voters start fresh. Realignments are emergent, not scripted.
   - The news summarizes each year's population and electorate.
2. **The economy and presidential approval.**
   - The economy runs monthly: expansions, recessions, unemployment and inflation, nationally and by state.
   - It is published on a realistic calendar: the jobs report on the first Friday, CPI, and quarterly GDP
     estimates.
   - Approval comes from the electorate itself: partisans see the economy through their party's eyes, a new
     President gets a honeymoon, and scandals, vetoes and laws move standing. Nine national pollsters publish
     approval polls.
   - Both feed every election: a recession or an unpopular President costs their party votes.
3. **Careers between elections:**
   - scandals, and resignations over them;
   - deaths, health resignations and moves to the private sector;
   - cabinet turnover, and a new cabinet with every new President;
   - rare party switches;
   - leadership elections when each Congress and legislature convenes;
   - retirements that weigh age, tenure, scandal and a hostile new district;
   - state legislators who climb to Congress or the governorship.

   Vacancies follow each office's rules: immediate succession, appointment, or special election.
4. **Congress legislates.**
   - **Bills:** the majority drafts major bills toward its platform. Each House and Senate roll call is
     recorded, with every member's vote. Senate bills need 60 votes for cloture, except one budget-reconciliation
     bill a year under unified government.
   - **The President** signs or vetoes; a two-thirds vote in each chamber overrides.
   - **Effects:** laws move national policy and the President's standing.
   - **State sessions:** each state's legislative session is summarized every year (laws, vetoes, overrides, a
     late budget under divided government).
5. **The census, apportionment and new maps.**
   - **The census** counts every state on April 1, 2020, 2030, 2040 and so on.
   - **Apportionment:** the 435 seats are apportioned by Huntington–Hill on December 31, with news of who gained
     and lost. The 435th seat and the next in line are recorded.
   - **New maps:** every state with more than one seat gets a new congressional plan, and every state new
     legislative plans. A neutral algorithm draws them from whole base units: contiguous, compact, equal in
     population, keeping counties whole where it can. They take effect for the elections two years after the
     census.
   - **Old maps stay exactly as they were:** every past contest keeps its district, so the archive and old
     results maps are unchanged.
6. **State legislatures are elected.**
   - All 7,383 seats in 99 chambers are held by people and elected on each state's real schedule:
     two- and four-year terms, odd-year states, and senates elected all at once after redistricting where the
     state does that.
   - Control of chambers changes hands, and party conferences choose new leaders.
7. **A new Government page** (the **§** entry in the rail) has five tabs:
   - **Approval & economy:** the published approval average and every poll, and the jobs, inflation and GDP
     releases. The simulation's monthly truth (approval by party, recessions) sits in a collapsed, labelled
     section.
   - **Congress:** chamber composition, the record by year, and every major bill with its roll calls by party.
   - **State legislatures:** all 99 chambers, trifectas and each state's last session.
   - **Census & apportionment:** each census, seats gained and lost, the 435th seat and the next in line, the
     changing electorate, and every congressional plan with its statistics.
   - **District maps:** any state's House, state senate or state house plan, for any year it was in effect,
     coloured by district, holder or lean.

   The **Electorate** page now shows how the platforms, the national lean and the spread of states have moved.
   **People** can be filtered to state senators and representatives.

## 2. Using it on a Chromebook

1. Open **https://timovk.github.io/UsElec26/** once `main` is updated (the live site is still Phase 5 until then).
2. **Start a new universe** to get everything in this phase. A universe saved under Phase 5 opens and keeps
   running: its state legislators are created on open, and evolution starts on its next January 1. But it keeps
   the Phase 1 electorate's weaker group structure (see §7).
3. Use **+1 year** to watch decades go by. **Next election 🗳** still stops at each election day. Expect
   roughly:
   - **Early years:** about 1.5 minutes for a year with a general election on an unloaded fast machine, and well
     under a minute for an odd year. **On a Chromebook, roughly 2.5–5 minutes and 1–2 minutes.**
   - **Later years:** in the 2030s, years take about twice as long.
   - **After each census:** the redistricting year (2021, 2031, …) adds about two more minutes (§5.5).
4. After **December 2020**, open **Government → Census & apportionment** to see the 2020 census. From
   **January 2022**, use **District maps** to compare any state's 2016 and 2022 plans.
5. **Export regularly.** Universes grow by about 16–18 MB a simulated year, to about 430 MB by 2041 (§5.5). Export is your only backup.

## 3. What was built

| Area | Modules |
|---|---|
| Demography | `population/evolution` (stocks and flows per county × age band, race and education mix, migration trends) |
| Evolving electorate | `electorate/dynamics` (platforms, attachments, partisanship by county × cohort), `engine/evolution` (the yearly step and its record) |
| Economy and approval | `economy/macro` (regimes, growth, unemployment, inflation, states), `engine/economyEngine` (monthly truth, releases, approval truth and polls, the election term) |
| Careers | `careers/model` (hazards), `engine/careersEngine` (scandals, resignations, switches, cabinets, leadership) |
| Congress and states | `government/congress` (bills, votes, the President), `engine/governmentEngine` (monthly Congress, roll calls, state sessions) |
| Census and districts | `engine/census` (census, apportionment, redistricting, seat changes), `engine/districts` (versioned plans, Huntington–Hill), `geo/redistrict` (the plan-drawing algorithm and plan statistics) |
| State legislatures | `engine/legislatures` (seats, schedules, fields), legislative contests through the shared kernel (`electorate/kernel`, `electorate/shards`) |
| Queries and UI | `engine/governmentQueries`, `ui/screens/Government`, the Electorate page's history, chart axes by year |
| Schema | V5 (13 tables: demography, electorate, economy, releases, approval polls, census, plans, districts, abolished seats, bills, roll calls, Congress and state-session summaries); V6 (two contest indexes) |

## 4. Test results

| Suite | Result |
|---|---|
| Type check (`tsc -b`), lint (ESLint, 0 warnings), layering (dependency-cruiser, 124 modules) | clean |
| Unit, property and integration tests (`npx vitest run`) | **110 passed**, 11 skipped (opt-in long or real-data runs), 35 files |
| End-to-end in Chromium (`npx playwright test`, 4 specs) | **4 passed** (CI, commit `3e9633b`; locally all 4 passed too) |
| Acceptance, 2016 → 2040 on the real geography (opt-in) | **27 of 32 checks pass**; 5 fail (§5.1) |
| Fifty years on the fixture (opt-in) | **33 of 35 checks pass**; 2 fail narrowly in redistricting years (§5.2) |
| Redistricting of every real state (opt-in, `ENA_REDISTRICT=1`) | passed: all contiguous, worst deviation 0.57% (§5.3) |

New in this phase, all passing (by test name):
- **Demography:**
  - flows balance nationally, and base-unit populations add up to their counties;
  - deterministic in the seed and the year;
  - the nation grows, ages, diversifies and becomes more educated at plausible rates;
  - opt-in: the 2016 → 2040 trajectory on the real geography.
- **Electorate dynamics:**
  - coalitions exist (the calibrated group spread);
  - deterministic, and competitive over 50 years while groups realign;
  - new voters start at the target, and cohorts carry partisanship as they age.
- **Economy:** over 60 simulated 50-year paths, business cycles, unemployment and inflation behave like the
  postwar U.S. economy; the economic index falls in recessions.
- **Approval:**
  - it is polarized, and in a normal range overall;
  - it rises with a good economy, a honeymoon and good standing;
  - it falls in a recession and after a scandal.
- **Apportionment:**
  - every state gets a seat and the House size is exact;
  - monotone in House size;
  - a textbook case;
  - **2010 census → the 2012 apportionment, all 50 states**.
- **Redistricting:**
  - equal population, contiguous, compact, few county splits;
  - multi-member districts in proportion to their seats;
  - nesting of house in senate districts;
  - determinism;
  - opt-in: every real state from 2010 populations.
- **Career hazards:**
  - scandals are rarer with integrity and for less-watched offices;
  - only serious scandals force resignations;
  - cabinet tenure is about 2.5 years;
  - party switches need a real mismatch;
  - retirement rises with tenure, scandal and a worse district.
- **Congress:**
  - party-line House votes;
  - a 52-seat Senate majority rarely reaches cloture;
  - bills move policy toward the sponsor;
  - the President signs what improves on the status quo.
- **Government queries:** every new query against a fixture universe; party breakdowns sum to each roll call.
- **Succession and career continuity** are checked on whole simulated histories rather than in isolation:
  - the universe lifecycle test: vacancies over four years, an integrity report with one holder per office and
    no deceased officeholders;
  - the long runs (§5.1–5.2): no office ever has two holders at once, nobody holds two elected seats at once,
    no term starts after death, the presidency is never vacant, no vacancy lasts beyond two years, and special
    elections are held.
- **Updated suites:**
  - the universe lifecycle (7,383 state legislative seats in 99 chambers, determinism, save/reload, export/import);
  - the 2016 cycle (a save and reload mid-campaign equals one run);
  - the night E2E (refreshed baseline);
  - the universe E2E (now visits every Government tab).

Not covered by a dedicated test: the economic release calendar, budget reconciliation, vetoes and overrides
(exercised in the long runs and visible in the Congress record, but not asserted).

## 5. Measurements

### 5.1 Acceptance: 2016 → 2040 on the real geography (seed P6)

Command: `ENA_ACCEPT=P6 npx vitest run tests/unit/engine/longRun.test.ts` (Node, real Census geography, January 1,
2016 → January 2, 2041, about 65 minutes alongside the 50-year run). The full year-by-year table and every check
are written to `.cache/accept-P6-report.txt`.

| Jan 2 | President | House D–R | Senate D–R | Governors D–R | Legislatures D–R | Neutral lean | Approval (truth) | Unemployment | Adults (M) | 65+ | Platform distance |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2016 | D | 223–212 | 57–43 | 32–18 | 63–35 | D+5.1 | 54% | 4.9% | 220.3 | 19.2% | 1.43 |
| 2017 | D | 224–210 | 57–43 | 33–17 | 63–35 | D+5.1 | 52% | 4.5% | 222.3 | 20.0% | 1.40 |
| 2018 | D | 236–199 | 58–42 | 34–16 | 62–37 | D+5.1 | 52% | 4.9% | 224.1 | 20.7% | 1.38 |
| 2020 | D | 234–201 | 61–39 | 38–12 | 58–41 | D+4.9 | 42% | 5.2% | 227.7 | 21.9% | 1.37 |
| 2022 | D | 258–172 | 66–34 | 38–12 | 65–33 | D+4.7 | 30% | 9.3% | 231.1 | 23.0% | 1.37 |
| 2024 | D | 254–178 | 66–33 | 39–11 | 68–31 | D+4.6 | 32% | 10.6% | 234.4 | 23.9% | 1.37 |
| 2026 | D | 283–149 | 70–28 | 39–11 | 70–26 | D+4.2 | 53% | 7.4% | 237.5 | 24.7% | 1.38 |
| 2028 | D | 275–156 | 72–28 | 37–13 | 69–29 | D+3.9 | 43% | 6.6% | 240.4 | 25.4% | 1.41 |
| 2030 | R | 221–210 | 68–32 | 35–15 | 55–43 | D+3.6 | 42% | 5.7% | 243.3 | 26.0% | 1.42 |
| 2032 | R | 268–166 | 69–31 | 40–10 | 69–29 | D+3.3 | 45% | 5.1% | 246.0 | 26.5% | 1.41 |
| 2034 | R | 250–181 | 68–32 | 41–9 | 60–37 | D+3.1 | 47% | 5.2% | 248.6 | 26.9% | 1.34 |
| 2036 | R | 289–143 | 78–22 | 44–6 | 69–30 | D+2.8 | 24% | 8.1% | 251.2 | 27.3% | 1.33 |
| 2038 | R | 288–145 | 80–20 | 44–6 | 69–30 | D+2.5 | 33% | 10.7% | 253.7 | 27.7% | 1.30 |
| 2040 | R | 298–132 | 83–17 | 42–8 | 73–26 | D+2.4 | 26% | 9.9% | 256.0 | 28.0% | 1.27 |
| 2041 | R | 298–135 | 82–18 | 41–9 | 71–26 | D+2.3 | 34% | 9.6% | 257.2 | 28.1% | 1.22 |

(Odd years omitted except 2017 and 2041. A year's row is its January 2, so House and Senate show the Congress
elected two years before.)

**What happened in this universe:**
- **Founding:** the Democrats start with a D+5 neutral lean and a President in office.
- **2016–2028:** they hold the White House through three elections, including 2024 at about 10% unemployment.
  The House stays theirs throughout.
- **2028:** the Republicans win the presidency.
- **2036–2040:** a deep slump (unemployment up to 11.3%, approval down to 17%) produces a 1930s-style Democratic
  wave: 289–298 House seats and 78–83 Senate seats.
- **The lean erodes:** party competition moves the neutral lean from D+5.1 to D+2.3, and the platforms stay
  1.2–1.4 apart.
- **Demography:** the electorate grows 16.7% and ages (65+ from 19.2% to 28.1%).
- **Censuses:** in 2020, 2030 and 2040 each reapportions 435 seats. All 100 new congressional plans are
  contiguous and within 0.41% of equal population (median 0.08%).
- **Old maps:** every 2016–2020 contest stays on its 2016 district.
- **Government:** over the 25 years Congress took up 109 major bills and enacted 64. Presidents cast 39 vetoes,
  and 9 were overridden. 4,412 approval polls were published.

**Checks: 27 pass, 5 fail.**

Passed:
- integrity;
- succession (the presidency never vacant; 224 special elections; no vacancy over two years);
- career continuity (no office with two holders; nobody in two seats; no term after death);
- career ladders (584 state legislators moved up);
- the midterm penalty (6 of 6);
- House incumbents re-elected 89–99%;
- turnout (presidential 59–62%, midterms 41–45%, odd years 35–39%);
- 85 changes of control in state chambers;
- a competitive, gradually moving lean;
- distinct platforms;
- approval and the business cycle;
- growth and ageing;
- every census and new map;
- old maps intact;
- 435 races in every House election.

Failed:

| Check | Result | Assessment |
|---|---|---|
| The presidency changes hands (at least twice in 25 years) | Once: D 2009–2029, R 2029–2041 | Unusual: Democrats kept the White House through a 2022–24 slump. Twenty-year runs have happened (1933–53, 1861–85). |
| House control changes (at least once) | Never: Democratic for 25 years | Within history: the real House was Democratic from 1955 to 1995. |
| No majority beyond historical extremes (Senate ≤ 80) | 83 Democratic senators in 2040 | Beyond the 1937 record (76). Three Senate classes were elected in a slump under a Republican president, in a universe whose small states lean Democratic. Approval at 17% is also below any real president (the lowest was about 22%). |
| Open House seats 10–90 every cycle | 107 in 2022, 96 in 2034 (others 47–86) | Much improved (156 before seats followed constituents); still high after redistricting. |
| Every legislative plan within 10% | 7 of 190 plans fail: New Hampshire's house 31–33%, Alaska's house 26%, Hawaii's senate 22%, Wyoming's nested house 18% (2032), Massachusetts's house 14% (islands, non-contiguous), New Mexico's house 11% | Islands, very large rural units, nesting and New Hampshire's 400-seat house (§7). |

**Is this a plausible evolving history?** Mostly, yes.
- Elections, careers, succession, the census and the maps behave like the real system throughout.
- Old maps and old results are intact.
- The weak points are the extremes: a presidential party that survives a slump, and a Senate supermajority
  beyond any real one. Both point at the same two levers:
  1. how strongly a slump moves approval and the vote (approval should not fall below about 20%);
  2. how far one party can dominate the Senate when small states lean its way.

  I would tune both before Phase 7 (one more acceptance run each). I have not done it in this phase, because
  each change needs a fresh 25-year run to verify.


### 5.2 Fifty years on the fixture geography (seed long-1)

Command: `ENA_LONGRUN=50 npx vitest run tests/unit/engine/longRun.test.ts`. The fixture geography is synthetic,
with a handful of base units per state. It took 90 minutes here; the full report is in `.cache/longrun-long-1-report.txt`.

| Jan 2 | President | House D–R | Senate D–R | Governors D–R | Legislatures D–R | Neutral lean | Approval | Unemployment | Adults (M) | 65+ | Platform distance | People tracked |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2016 | D | 185–250 | 44–56 | 19–31 | 34–64 | D+0.8 | 52% | 4.9% | 222.0 | 19.7% | 1.41 | 8,835 |
| 2021 | R | 188–244 | 37–63 | 21–29 | 34–63 | D+0.3 | 48% | 6.3% | 231.1 | 22.5% | 1.31 | 24,232 |
| 2026 | R | 250–184 | 51–49 | 30–20 | 56–42 | D+0.3 | 32% | 8.3% | 239.3 | 24.5% | 1.30 | 37,278 |
| 2031 | R | 264–166 | 57–43 | 32–18 | 58–40 | D+0.4 | 41% | 6.8% | 246.7 | 26.0% | 1.29 | 53,509 |
| 2036 | D | 196–238 | 53–47 | 19–31 | 45–51 | D+0.5 | 44% | 7.0% | 253.4 | 27.1% | 1.19 | 66,164 |
| 2041 | D | 213–216 | 51–49 | 16–34 | 51–44 | D+0.6 | 52% | 4.3% | 259.6 | 27.9% | 1.15 | 82,380 |
| 2046 | R | 252–181 | 57–43 | 28–22 | 55–42 | D+0.7 | 31% | 6.2% | 265.4 | 28.5% | 1.12 | 94,868 |
| 2051 | D | 286–145 | 71–29 | 36–14 | 67–31 | D+0.9 | 51% | 4.7% | 270.6 | 29.0% | 1.12 | 112,412 |
| 2056 | D | 161–272 | 39–61 | 14–36 | 32–64 | D+0.9 | 49% | 3.8% | 275.5 | 29.4% | 1.07 | 124,861 |
| 2061 | R | 233–200 | 49–51 | 27–23 | 56–43 | D+1.1 | 50% | 3.8% | 280.0 | 29.7% | 1.08 | 141,668 |
| 2066 | R | 223–210 | 49–50 | 26–24 | 49–49 | D+1.1 | 46% | 5.8% | 284.1 | 30.0% | 1.06 | 154,622 |

**Checks: 33 of 35 pass.**

Passed:
- **Integrity and continuity:** no office ever has two holders, nobody holds two seats, no term starts after
  death, and the presidency is never vacant (15 terms).
- **Careers:** 423 special elections; 1,357 state legislators moved up.
- **Alternation:** the presidency changes party 5 times, with at most 16 years in a row for one party. The House
  changes 7 times. The largest Senate majority is 72 and the largest House majority 314.
- **The midterm penalty:** 12 of 12 midterms.
- **States:** 244 changes of control across the 99 chambers.
- **The electorate:** the neutral lean stays within D+0.2 to D+1.2, and the platforms stay 1.06–1.41 apart.
- **Approval and the economy:** approval averages 45% (range 27–59%); unemployment 2.8–8.8%, recessions 13% of months.
- **Demography:** adults +28%; 65+ from 19.7% to 30.0%.
- **Censuses:** five, each reapportioning 435 seats, with new maps for every multi-seat state.
- **House seats:** 435 in every House election (this is what found the regained-seat bug, §6).
- **Old maps** intact.

Failed (both narrowly, both in redistricting years):

| Check | Result |
|---|---|
| House incumbents re-elected 80–99% | 79% in 2034 (every other cycle 83–98%) |
| Open House seats 10–90 | 139 in 2022 and 109 in 2042 (every other cycle 51–88). The fixture's coarse maps change more between plans than real ones (the real-geography run had 107 in 2022). |

Plan validity is reported, not asserted, on the fixture (median deviation 3.9%), because its units are too coarse.


### 5.3 Redistricting quality

Congressional plans for every state from the 2010 populations (opt-in `ENA_REDISTRICT=1`), against the real
2016 plans:

| Statistic | Algorithmic plans | The real 2016 plans |
|---|---|---|
| Largest population deviation | **0.43%** | — |
| Contiguous districts | **all** | all |
| Counties split (43 multi-district states) | **341** | 409 |
| Mean compactness (1 = a disc) | **0.87** | 0.81 |
| Time for all states | 19.8 s | — |

On populations evolved to 2041 (the acceptance universe), all of these come out contiguous:

| Plan | Largest deviation |
|---|---|
| California, 54 and 57 districts | 0.12% and 0.34% |
| Texas, 41 | 0.12% |
| Florida, 30 | 0.16% |
| New York, 24 | 0.12% |
| Wyoming senate (30) and nested house (60) | 2.4% and 5.5% |
| Florida senate and house | 1.0% and 1.2% |
| California senate and assembly | 1.2% and 1.3% |

The algorithm sees no partisan data. Seat numbers follow constituents (architecture 06 §6.8).

### 5.4 Calibration

- **Group structure.** The Phase 1 electorate had almost no differences between groups (about 0.02 logits
  between cohorts), so its politics was purely geographic. County fields are now centred within states, and the
  generator targets a realistic spread: cohort leans now differ by 0.45–0.76 logits (groups split roughly 55/45
  to 80/20).
- **Founding calibration** after the narrower founding balance: 10 of 10 real-geography seeds (A–J) are inside
  every stylized-fact range. The national two-party share is 47.5–51.6%; the spread of state margins is 11.7–15.2.
- **Approval:** 47–55% on average across seeds; 12–18% among the other party's identifiers.
- **Economy:** stylized facts over 60 simulated 50-year paths:
  - expansions last about 7 years and recessions about 11 months;
  - unemployment rises about 2 points in a recession;
  - inflation stays near 2%, with rare shocks.
- **Apportionment:** the known-answer test (2010 census populations → the 2012 House) matches every state.

### 5.5 Speed and storage

All timings are on this 4-core server. Each long run shared the machine with the other one, so the Node figures
are somewhat pessimistic. A Chromebook is 1.5–3× slower.

**Node, real geography** (the acceptance run, seconds to advance one year):

| Year | 2016 → 2020s | 2030s | 2040 |
|---|---|---|---|
| Presidential year | 152–201 s | 224–289 s | 331 s |
| Midterm year | 159–186 s | 216–271 s | — |
| Odd year | 30–49 s | 49–83 s | — |
| Year after a census (redistricting) | 144 s (2021) | 193 s (2031) | — |

For comparison, Phase 5 measured 44 s from January 1 to December 1, 2016.

**Why Phase 6 costs more:**
- **State legislatures:** about 5,000–6,000 contests every even year, through filing, the kernel and certification.
- **The year's work:** demography and the electorate (a few seconds); the economy, approval polls, careers and
  Congress daily or monthly; redistricting about 100–140 s after each census.

**Why it grows with history:** election years roughly double over 25 years. There are three causes:
- tens of thousands more tracked people (8,800 in 2016, 80,000 by 2041);
- a larger archive;
- in these Node runs only, the test storage copying the whole database at every save. The browser writes
  through to its storage instead.

The worst cause found was fixed (§6, item 10): unindexed contest lookups had made September 2036 take 75 s; it
now takes 8.6 s.

**Chromium.** The "CI" column is the GitHub Actions runner with nothing else running (the cleanest measurement). The
"this server" column ran with one long run in the background.

| Measurement | Phase 6, CI | Phase 6, this server | Phase 5 (this server, idle) |
|---|---|---|---|
| Universe creation | 6.0 s | 10.8 s | 4.4 s |
| January 1 → the 2016 ballot lock (Next election, through every primary day) | **91 s** | 180 s | 76.5–78.1 s |
| January 1 → November 8, 2016 (+1 month steps) | 91 s | 193 s | 76.0–86.8 s |
| The 2016 primaries and general (elections E2E) | 126 s | 284 s | — |
| Auditing the 2016 archive (Results → Audit) | **151 s** | — | — |
| The final Next election step (mid-September → the ballot lock, including Election Day) | 34 s | 68 s | 17.8 s |
| Broadcast playback, magic-wall flight, map recolour | 60 fps (median frame 16.7 ms) | 60 fps | same |

**Storage:**

| January 2 of | 2016 | 2018 | 2020 | 2023 | 2029 | 2036 | 2041 |
|---|---|---|---|---|---|---|---|
| Universe database (real geography) | about 26 MB (browser storage after creation) | 55 MB | 86 MB | 146 MB | 242 MB | 339 MB | 431 MB |

That is about 16–18 MB per simulated year. An export (`.ena`) is about 72% of that (244 MB for 2036). Most of it
is election archives and the people and contests that Phase 6 adds: about 6,000 legislative contests and their
candidates every even year.

**Honestly:**
- **This is well over budget.** The budget is at most 40 s for a year with a general election on the reference
  Chromebook; 2016 alone takes about 1.5 minutes on an unloaded CI runner.
- **The archive audit is slow:** 2.5 minutes for 2016, because it re-checks every state legislative contest.
- **Storage will matter.** A universe run to the 2040s needs several hundred MB of browser storage.
- **Next step:** both are the "speed fix" you deferred. I recommend doing it before Phase 7, which adds many
  more contests.


## 6. Fixes found during Phase 6

1. **The electorate had no coalitions.** The Phase 1 calibration let geography absorb nearly all group
   differences (group SD about 0.02 logits). Fixed by centring county fields within states and adding a target for
   the spread between groups (§5.4).
2. **Approval ran too high** (51–64%, with 19–34% among the other party). The response slope and baseline were
   recalibrated (now 47–55%, opposition 12–18%).
3. **Recessions barely moved unemployment** (+1.2 points). Recession growth and the Okun link were strengthened
   (+2.0 points).
4. **Demography drifted:**
   - the college share fell (the young were not becoming more educated);
   - growth was too fast;
   - county trends were too persistent.

   Each was corrected and is now covered by accounting identities and trend tests.
5. **Redistricting:**
   - early plans for Texas and California were 14% and 85% off equal population;
   - California then stuck at 4.2%;
   - it took 50 s.

   Fixed with a stray-population penalty, county-respecting cuts, squared-deviation rebalancing restricted to
   the worst district, and merging only small fragments.
6. **Too many special elections** (other exits and cabinet picks from sitting officeholders were too frequent).
7. **The Senate was too bipartisan** on major bills; party pressure was raised to polarized-era levels.
8. **Swearing in about 5,000 legislators** took 160 s after each election (one commit per oath). It is now batched:
   about 22 s on the fixture.
9. **Seat leans for new legislative plans were zero** (arrays sized from the 2016 pack). Found while building
   the district maps; fixed before any new plan was used.
10. **Election years got slower every year.**
    - **Cause:** contest lookups scanned the whole contest table, which grows by about 6,000 contests every even
      year.
    - **Found by:** profiling September 2036, which took 75 s, 87% of it in four queries.
    - **Fix:** two indexes (schema 6) bring it to 8.6 s.
11. **Every death was a headline**, including tens of thousands of former candidates. Obituaries are now for
    officeholders and former officeholders.

The long runs then exposed problems that the unit tests could not see. Each was fixed and the runs repeated
(§5.1 shows the final run):

12. **Lopsided electorates stayed lopsided.**
    - **Symptom:** a universe founded at D+9 drifted further toward the Democrats for 24 years, reaching 82
      Democratic senators and 311 representatives.
    - **Cause:** vote seeking moved only the platforms, while most of the lean comes from group attachments and
      geographic culture.
    - **Fix:** a party-competition force on partisanship (proportional plus slowly accumulated), and a narrower
      founding balance (within about ±5 points instead of ±9).
13. **Platforms converged onto the minimum distance** within about 20 years and stayed there.
    - **Cause:** activists pulled toward the current coalition, which blurs as the parties converge.
    - **Fix:** party identity is now sticky (85% founding positions) and vote seeking gentler. The platforms
      settle about 0.9–1.0 apart (from 1.3).
14. **New maps were badly off equal population once populations had evolved:**
    - California's House plan 27% off in 2022 and 21% in 2032;
    - Wyoming's legislature 77–88% off;
    - several legislative plans non-contiguous.

    **Cause:** cuts through bays and mountains stranded large pieces, which repairs handed to a neighbour,
    unbalancing whole regions by up to 240,000 people. Bridges and blocks of short districts then blocked local
    rebalancing.

    **Fix:** settled cuts, bridge moves and flow through balanced districts (architecture 06 §6.8). On the
    evolved populations, California is now within 0.34% and Wyoming's legislature within 5.5%, all contiguous.
15. **Redistricting years had 2–3 times the normal number of open House seats** (156 in 2022).
    - **Cause:** new districts were numbered north to south, so many members found their seat number on a
      distant district and retired or ran statewide.
    - **Fix:** seat numbers now follow constituents (the old number goes to the new district holding most of its
      people).
16. **The night E2E's visual baseline was refreshed** (twice). The same seed produces a different 2016 under
    Phase 6, and again after the founding-balance change. This was the only failing CI check on the Phase 6
    commits.
17. Smaller fixes:
    - the Congress tab showed the next Congress on January 1–2 of odd years;
    - the summary cards lacked a four-column layout;
    - the People office filter scanned every term for each person;
    - multi-year charts labelled their axis by day;
    - long-run checkpoints were written into `test-results/`, which Playwright clears.

## 7. Known limitations (Phase 6)

1. **Speed is over budget, and Phase 6 adds work** (§5.5).
   - Every even year now elects about 6,000 state legislative seats.
   - Certification of a state's results covers all of them.
   - Redistricting adds about two minutes to the year after each census.
   - Auditing an election year's archive now takes about 2.5 minutes (it re-checks every legislative contest).

   This is the "speed fix" you deferred. The clear levers are:
   - run forecasts and poll fieldwork in the compute workers;
   - certify legislative contests in bulk;
   - cache per-day contest lookups.
2. **No state legislative primaries.** Each party nominates one candidate per seat without a primary, and some
   seats go uncontested. Legislative contests are not part of election-night broadcasts or season polls (they are
   certified and archived with each state's results).
3. **District shapes on the national map are the 2016 ones.**
   - The **Map** draws the 2016 districts; after 2022 its House layer says so.
   - New plans are drawn on **Government → District maps** from base units (each a square of its own area), not
     as polygons. Districts are recognizable, but borders are blocky in rural areas.
4. **District holders shown are today's.** Between an election and swearing-in (for example on January 2,
   2023), a new plan's districts still list the outgoing members, matched by seat number.
5. **Redistricting is neutral and algorithmic only.**
   - There are no partisan maps, commissions, courts, litigation, Voting Rights Act districts or mid-decade
     redistricting (Phase 9).
   - Numbering is roughly north to south, not each state's convention.
6. **Universes created before Phase 6** keep their Phase 1 electorate, with almost no differences between
   groups (§6.1). They gain state legislators on open, evolve from their next January 1, and their history
   tables start that year. Start a new universe for the recalibrated electorate.
7. **Government is summarized below the major bills.**
   - Congress: no committees, judicial nominations, shutdowns or debt ceilings; minor laws are counted per year.
   - States: sessions are yearly summaries.
   - Approval exists for the President only (governors have none yet).
8. **The economy is national plus state unemployment.** There are no markets, deficits or sectors. Real 2016
   values are the start only.
9. **Careers:**
   - appointments cover cabinets, vice presidents and Senate and statewide vacancies (no judges or ambassadors);
   - party switching only moves between the two major parties;
   - scandals have six template types.
10. **Seven of 190 legislative plans miss the 10% population standard** in the acceptance run:
    - **New Hampshire's house** (31–33%): 400 seats in town-based multi-member districts. One seat is about
      3,400 people, about two base units.
    - **Alaska's house** (26%): huge rural units.
    - **Hawaii's senate** (22%): districts cannot trade population across water.
    - **Wyoming's nested house** (18%, 2032).
    - **Massachusetts's house** (14%): the islands, so not contiguous.
    - **New Mexico's house** (11%).

    Every congressional plan is within 0.41%. The fixes are:
    - apportion seats to districts after drawing (as New Hampshire does with towns);
    - treat islands explicitly;
    - relax nesting when it cannot balance.

    These belong with Phase 7's multi-member and floterial districts.
11. **Redistricting years have too many open House seats.**
    - **Measured:** 107 on the real geography in 2022, 139 on the fixture; normal cycles are 50–85.
    - **Effect:** incumbents re-elected fall to about 80% in some of those years.
    - **Cause:** seats now follow constituents, but members still retire more than real members do when their
      district changes.
12. **Party competition is a stylized force.** A lopsided universe returns toward balance over decades (§4.2 of
    architecture 04). The founding balance is now drawn within about ±5 points (it was ±9). This is a calibration
    choice you may want to adjust: a wider range allows "New Deal"–like eras of one-party dominance. Where small
    states lean to one party, that party can hold 70+ Senate seats for a long time even at a modest national
    lead (§5.1).
13. **Storage grows** with every simulated year (§5.5), mostly from election archives and the ~6,000 new
    legislative contests and candidates every even year.
14. **Deploys from this branch fail at the Pages step.** On every Phase 6 push, the build job (including the unit
    tests) succeeds and the deploy job fails within a second, with no log. The deploy from `main` after Phase 5
    succeeded, so this is most likely the `github-pages` environment accepting `main` only (I have not confirmed
    the setting). The live site updates when `main` is updated.

## 8. Changelog

- **Engine 0.6.0, schema 6:**
  - yearly demographic and electoral evolution;
  - the monthly economy with releases;
  - approval from the electorate with approval polls;
  - careers between elections, Congress and state sessions;
  - the census, apportionment and algorithmic redistricting with versioned plans;
  - state legislative general elections.
- **New modules:**
  - `population/evolution`, `electorate/dynamics`, `engine/evolution`;
  - `economy/macro`, `engine/economyEngine`;
  - `careers/model`, `engine/careersEngine`;
  - `government/congress`, `engine/governmentEngine`;
  - `geo/redistrict`, `engine/districts`, `engine/census`;
  - `engine/legislatures`, `engine/governmentQueries`;
  - `ui/screens/Government`.
- **Changed:**
  - the electorate model (group structure);
  - the kernel and shards (state legislative geography);
  - elections (versioned districts, legislative filing, the economy in the environment, published fundamentals);
  - the season (electoral votes and leans by plan year);
  - the archive audit (legislative contests);
  - the universe (yearly, monthly and decennial events, batched daily transactions).
- **UI:**
  - the § Government rail entry and its routes (`#/government/<tab>/<args>`, `#/government/bill/<id>`,
    `#/government/districts/<state>/<plan>/<year>`);
  - the Electorate page's history;
  - People filters for state legislators;
  - the national map's note on new plans.
- **Tests:**
  - demographic identities and trends;
  - electorate dynamics;
  - economy and approval stylized facts;
  - the apportionment known-answer test;
  - plan validity (contiguity, deviation, nesting, determinism) on synthetic and real states;
  - careers and succession;
  - Congress;
  - the government queries;
  - the long runs with stylized-fact checks (§5.1–5.2);
  - the month profiler;
  - the Government page in the universe E2E.
- **Docs:**
  - this report;
  - architecture 03 (§3.7 as built), 04 (§4.2, §4.11, §4.12 as built), 05 (schema V5 and V6), 06 (§6.8
    versioned plans) and 09 (the Government page);
  - the README.

## 9. Next: Phase 7 — Complete electoral coverage (awaiting your approval)

From the [roadmap](architecture/10-roadmap.md):
- statewide down-ballot offices;
- multi-member and floterial districts;
- municipal and county offices (major cities and all counties by default);
- judicial elections;
- school boards (largest districts);
- ballot measures;
- jurisdiction rules with effective dates (RCV, top-two, runoffs, nonpartisan);
- New England town reporting and Alaska House district reporting;
- the synthetic-precinct map layer (WebGL2).

The two items deferred from Phase 5 are still open: faster simulated years and live primary nights. I suggest
doing the speed work first. Phase 7 multiplies the number of contests again, and the per-year cost (§5.5) is
already over budget.
