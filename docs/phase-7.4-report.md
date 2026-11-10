# Phase 7.4 Report — Multi-member and Floterial Districts

**Status:** approved.
**Engine version:** 0.7.4 · **Schema version:** 10 · **Night record:** version 2 (unchanged) · **Geography pack:** 2016.1 (unchanged)

Phase 7.4 is the fourth of eight Phase 7 sub-phases ([roadmap](architecture/10-roadmap.md#phase-7-complete-electoral-coverage)).
Every state legislative district now elects the members its state's law gave it on January 1, 2016, and elects
them the way that state does. As agreed:
- **New Hampshire's floterial districts** are generated the way the state builds them.
- **The bugs I found are fixed inside 7.4**: letter-coded districts, North Dakota's House, Alaska's and West
  Virginia's senates. A fifth turned up while I was working on the schedules: Minnesota's Senate. It is fixed too
  (§6).

In 2016 on the real geography (seed SPEED-1):
- **268 "vote for N" races** elect 649 members. 13% of the districts split their seats between the parties.
  7.4% of the possible votes go unused: ballots marking fewer than N names, or none.
- **Minnesota's House** is elected in its 134 districts. Before, the voters of district 1A elected all 134 members,
  and the House came out 13D–121R; it is now 64D–69R. Vermont's 180 legislators were elected the same wrong way.
- **New Hampshire** elects its 400 representatives in 208 races: 161 town districts and 47 floterials.
- **North Dakota** elects half its House (48 members in 24 two-seat races), which it never did before.
- **Alaska** elects half its Senate in 2016 (10 seats). Before, all 20 seats came up together in midterm years.
- **West Virginia** elects one senator in each of its 17 districts; before, both of 9 districts' seats came up.
- **Michigan's four university and education boards** each elect two seats in one race, and **Arizona's
  Corporation Commission** three.
- **Speed and storage are unchanged** (§5).

## 1. What you can do now

1. **See how each chamber is elected.** **Government → State legislatures** says, under each chamber whose
   districts are not single-member, how its seats are elected. Examples:
   - New Hampshire: "400 seats in 208 districts; 100 elect several members on one ballot (vote for up to 10); 47
     floterial districts overlap the others".
   - Washington: "49 districts, each electing 2 members to numbered positions".
   - West Virginia's Senate: "17 districts of 2 members, elected in alternate cycles".
2. **Open a "vote for N" race.** Its page says *Vote for 2: the top 2 are elected*. It lists every candidate,
   usually two per party, with **✔ Elected** next to each winner. It also shows the votes cast and the unused
   votes, out of N per ballot.
3. **Find them in the results.**
   - **Results** and the Results Explorer list the race under the district ("2016 Arizona House of
     Representatives, District 7"), with all its winners.
   - **People** and person pages give each member's seat: "District 7 (seat 2)", "Belknap 9", "Addison-1",
     "District 1A", "1st Barnstable", "District 3 (Position 1)".
4. **See the districts as the states name them.** The district maps label Minnesota's districts 1A, 1B and so
   on, Vermont's and New Hampshire's by town or county, and Massachusetts's by name.

## 2. Using it on a Chromebook

1. Open **https://timovk.github.io/UsElec26/** once `main` is updated. Until then the live site runs 7.3.
2. **Existing universes open and keep running.** The first time a universe saved before 7.4 opens:
   - **New Hampshire's floterial districts** are stored.
   - **Every legislator is re-seated by the 2016 law.** Members keep their offices; where a district's seat count
     changed (New Hampshire, Vermont, West Virginia and Maryland's subdistricts), a few offices move to districts
     that gain seats. Titles change to the new district names.
   - **Collapsed plans are replaced.** Maryland's or South Dakota's redistricted plan, in a universe past the 2020
     census, has districts that collapsed into one number. It gives way to the 2016 lines until the next census.
   - **Races already filed for the current year** are decided as filed. The next election uses the new districts.
   - The engine ledger records the switch to engine 0.7.4.
3. Open **Government → State legislatures**. After a November election, **Results → [year]** and pick
   *State House* or *State Senate* in the explorer.

## 3. What was built

| Part | Where | What it does |
|---|---|---|
| 2016 law | `src/rules/legislativeSeats2016.ts` | Each multi-member chamber's rule: "vote for N" districts with fixed members (Arizona, New Jersey, North Dakota: 2; South Dakota: 2, its split districts 1; Maryland: 3 per district, shared among subdistricts), or seats by population (Vermont, West Virginia, New Hampshire); numbered positions (Washington, Idaho); staggered seats (West Virginia's Senate). Seats by population use Webster's divisor method, which reproduces the 2012 plans: Vermont's 58 one-seat and 46 two-seat House districts, its Senate's Chittenden 6, Rutland, Washington and Windsor 3; West Virginia's 47, 11, 6, 2 and 1 districts of one to five seats. |
| Numbers and names | `src/rules/legislativeSeats2016.ts`, `src/engine/districts.ts` | Districts are numbered uniquely within a state: letter-coded and named districts are numbered in order. Each carries the state's name for it ("1A", "A", "Addison-1", "Belknap 1", "1st Barnstable"), which titles and maps use. |
| Floterials | `src/geo/floterials.ts`, `src/engine/districts.ts` | New Hampshire: each town district keeps the whole seats its population earns (from x.85). Leftovers of a quarter seat or more are pooled with the nearest such districts in the county until they make a seat; the rest join the county's nearest floterial, and a stranded half seat rounds up. The chamber is then settled at 400. Result on the real map: 47 floterials with 55 seats, against about 42 in the real 2012 plan. Floterials are stored as districts that list their member districts. |
| Schema 10 | `src/persistence/schema.ts` | `contest.seats`, `contest_seat` (the offices a race fills and who won each), `district.label`, `district_member`. Migration is automatic. |
| The ballot | `src/electorate/kernel.ts` | A vote-for-N contest: each voter type's chance of marking each candidate is the inclusion probability of marking N names in order without replacement (Plackett–Luce). It is computed by a 16-point quadrature, accurate to about 0.01 against exact enumeration. Bullet voting (a single mark) is mixed in: 6% of voters, plus up to 30% more when the voter's party runs fewer than N candidates. Counts are marks, N per ballot, with the unused marks last; no ballot marks more than N. |
| Filing | `src/engine/legislatures.ts`, `src/engine/elections.ts` | A "vote for N" district's seats are one race. Its incumbents run unless retiring. Each major party runs a slate of up to N: a full one where it can win, a shorter one, or none, where it cannot. A minor party sometimes runs. The ballot always has at least N names. |
| Decisions | `src/engine/elections.ts` | The top N win. Re-elected incumbents keep their own seats; other winners take the remaining seats in order and take office at the term's start. |
| Statewide boards | `src/rules/downballot2016.ts`, `src/engine/elections.ts` | Michigan's four boards (two seats each even year, nominated by convention) and Arizona's Corporation Commission (three seats in 2016, two in 2018) are one vote-for-N race. Where a party runs more than N, a vote-for-N primary picks its N nominees. |
| Floterial ballots | `src/engine/legislatures.ts`, `src/engine/elections.ts` | A floterial race is voted on by the member districts' voters, through an extra district map in the kernel (as Phase 7.2's board districts are). |
| Schedules | `src/engine/legislatures.ts` | North Dakota's House by halves with its Senate; West Virginia's two senate seats per district in alternate cycles; Minnesota's Senate on its 2-4-4 cycle. |
| Existing universes | `src/engine/universe.ts`, `src/engine/legislatures.ts` | Floterials stored; offices re-seated and retitled; collapsed plans replaced by the 2016 lines. |
| Redistricting | `src/engine/census.ts` | After a census, plans are drawn with each district's members (floterials are not drawn). New Hampshire's seats and floterials are recomputed on the new map, and members re-seated. |
| Queries and UI | `src/engine/archiveQueries.ts`, `src/engine/governmentQueries.ts`, `src/ui/screens/ContestScreen.tsx`, `src/ui/screens/Government.tsx` | Vote-for-N race pages, all winners in results lists, chamber descriptions, district names on maps. |

## 4. Test results

### 4.1 Suites

| Check | Result |
|---|---|
| Typecheck, ESLint and module boundaries (`npm run lint`) | pass: no dependency violations |
| Unit, property and real-data tests (`npx vitest run`) | **146 passed**, 12 skipped (opt-in long runs); 8 new tests, the old-save test extended |
| End-to-end, Chromium (`npx playwright test`), this server | **4/4 passed** in 7.6 min |

### 4.2 New and updated tests

**`tests/unit/engine/multiMember.test.ts`** (8 tests):
- **The real districts:**
  - Arizona, New Jersey and North Dakota: 2 per district.
  - South Dakota: 33 two-seat districts and four single-seat halves.
  - Vermont: House 58 one-seat and 46 two-seat districts; Senate with Chittenden 6.
  - West Virginia: House 47/11/6/2/1 districts of one to five seats; Senate 17 districts of 2.
  - Maryland: 3 per district.
  - Every chamber's seats add up to its size.
  - New Hampshire: 30–60 floterials, each within one county, with the chamber at 400.
- **Numbers and names:** unique within every state and chamber, and the names Minnesota, Alaska, Vermont, New
  Hampshire, Massachusetts and Texas use.
- **Rules:** codes to numbers and names; Webster's method; the fallback for synthetic geographies.
- **Floterials:** leftovers pooled within a county, and the chamber's size kept.
- **Schedules:** North Dakota's House by halves; Minnesota's Senate in 2016, 2020, 2022 and 2026; West Virginia's
  alternate seats; Alaska's halves.
- **Vote for N:**
  - The inclusion probabilities are within 0.015 of exact enumeration on 60 random cases.
  - At most N marks per ballot, and fewer marks when the voter's party runs fewer candidates.
- **A fixture universe, 2016 into 2017:**
  - Floterials are stored at founding, and every chamber's offices fill its districts' seats.
  - Vote-for-N races take place in Arizona, New Hampshire, South Dakota, Vermont and West Virginia. Each is
    certified with exactly N winners, each winner holds one of the district's seats, and votes plus unused votes
    equal N × ballots.
  - Floterial races take place.
  - Michigan's four boards elect 2 each and Arizona's commission 3.
  - North Dakota's House is elected.
  - The integrity checks pass.

**Older universe** (`tests/unit/engine/compat.test.ts`): the Phase 1 save now also reaches schema 10, stores
floterials, certifies more than 20 vote-for-N races in 2016 and elects North Dakota's House.

**Updated:** the archive audit checks votes + unused votes = N × ballots for every unit of a vote-for-N race.

### 4.3 The 2016 legislatures on the real geography

From a Node run of January 2016 to February 2017 (seed SPEED-1):

| | Before (7.3) | 7.4 |
|---|---|---|
| Minnesota House | 134 races, all in district 1A; 13D–121R | 134 races in 134 districts; 64D–69R |
| Vermont House / Senate | 150 and 30 races, all in one district | 104 races (46 vote-for-N) and 13 (10 vote-for-N) |
| New Hampshire House | 400 single-seat races in 161 districts | 208 races (100 vote-for-N, 47 floterials), 400 seats |
| Arizona House | 60 separate races | 30 races, vote for 2; 11 split between the parties |
| North Dakota House | never elected | 24 races, vote for 2 (48 members) |
| South Dakota House | 70 races in 34 districts | 37 races: 33 vote for 2, 4 single seats |
| West Virginia House / Senate | 100 races; Senate 18 seats in 9 districts | 67 races (20 vote-for-N); Senate 17 seats in 17 districts |
| Alaska Senate | none in 2016 (all 20 in midterms) | 10 seats |
| Statewide boards | separate races per seat | Michigan's four boards: vote for 2; Arizona's Corporation Commission: vote for 3 |

Across the 268 vote-for-N races, the parties run 1.5 candidates per seat. 13% of districts split their seats.
Unused votes are 6–10% by state; Arizona has the fewest, with full two-party slates.

## 5. Measurements

The machine was about 15% slower than for the 7.3 report, so both versions were run back to back.

| Measurement | 7.3 | 7.4 |
|---|---|---|
| Node, real geography, January 1 → December 1, 2016 | 68.8 s | 69.2 s (+0.6%, within run-to-run noise) |
| of which November (Election Day) | 38.7 s | 38.6 s |
| Counting ballots, all year | 33.9 s | 34.2 s |
| Writing the archive, all year | 5.6 s | 5.5 s |
| Database size, real geography, February 1, 2017 | 66.5 MB | 66.5 MB (−0.1%) |
| Chromium: to the 2016 ballot lock (elections test) | — | 64.7 s (Election Day step 22.4 s) |
| Chromium: January 1 → November 8, 2016 (season test) | — | 54.1 s |
| Chromium: universe creation | — | 5.9 s |
| Broadcast playback frames (median, p95) | 16.7, 16.7 ms | 16.7, 16.8 ms |

The Chromium figures were not paired with a 7.3 run on this slower machine, so they are not compared; the Node
pair above is the measure of 7.4's cost. The season test's final forecast is 45% / 55% (259 EV), with a Brier score
of 0.051.

**Why nothing changes:** vote-for-N ballots cost more per race (N marks, inclusion probabilities), but there are
fewer races: New Hampshire's 400 become 208, Arizona's 60 become 30, Vermont's 180 become 117. The two balance.

**2016 differs from 7.3 for the same seed.** The legislatures above change most, and the draws after them change
with them. The universe is still deterministic: the same seed and version give the same universe.

## 6. Fixes and decisions

- **The four bugs you approved fixing:**
  - **Letter-coded districts read as district 0** (Minnesota's House "01A", Vermont's House "A-1" and Senate
    "ADD", Alaska's Senate "A", Maryland's subdistricts "1A", South Dakota's 26A/B and 28A/B). Every seat then
    went to the state's first district. That put Minnesota's 134 House races and all of Vermont's in one district,
    gave Alaska's Senate the same parity for every seat, and merged Maryland's and South Dakota's subdistricts
    after redistricting. Districts are now numbered uniquely and named as the state names them.
  - **North Dakota's House was never elected.** Its four-year terms were not on any schedule. It is now elected
    by halves with the Senate.
  - **Alaska's Senate** came up all at once in midterm years; it is now elected by halves, 10 seats in 2016.
  - **West Virginia's Senate** put both of a district's seats up together. Seat 1 is now up in presidential years
    and seat 2 in midterms.
- **A fifth bug, found while working on the schedules:** Minnesota's Senate was set to be elected in 2014, 2018
  and 2022. Minnesota really elects it on a 2-4-4 cycle: 2016, 2020, 2022, 2026. It now does.
- **Vote-for-N accuracy.** My first approximation of the inclusion probabilities (Rosén's) was off by up to 8 points
  when voters mark most of the field. It was replaced by a quadrature of the exact integral, within 0.015 in
  testing.
- **No ballot marks more than N names.** Drawing each candidate's marks independently could, by chance, add up to
  more than N per ballot. Each draw is now capped at the marks left.
- **New Hampshire's floterials, as generated** (47, with 55 seats): the largest under-representation is 27%, by a
  strict population measure, and most districts are within ±15%. That is an improvement on Phase 6's 31–33%.
- **Decisions:**
  - **Ranked-choice voting** applies only to single-seat races. A state that adopts it keeps plurality voting in its
    vote-for-N districts; multi-winner ranked voting (single transferable vote) is not modelled.
  - **The ballot always has N names:** the stronger party completes a short ballot.
  - **Maps** show the ordinary districts; floterials are listed in the chamber description and on race pages.
  - **Re-seating an existing universe** moves an office only where its district's seat count changed. Its holder
    serves out the term, then the seat is elected in its new district.

## 7. Known limitations

- **Seat counts by population** (New Hampshire, Vermont, West Virginia, Maryland's subdistricts) come from 2010
  population. They reproduce the 2012 plans where I could check them (Vermont, West Virginia). New Hampshire's
  ordinary-district seats and floterials are generated, so they are close to the real plan but not the same.
- **Floterial boundaries are simulated.** They pool neighbouring districts of a county as the state does, but they
  are not the 2012 plan's.
- **No multi-winner ranked-choice voting**, and no cumulative voting.
- **Legislative primaries** are still not held: parties nominate directly.
- **A universe already past the 2020 redistricting** keeps its later plans, except Maryland's and South Dakota's
  collapsed ones, which revert to the 2016 lines until the next census. New Hampshire's later plan has no
  floterials until the next census.
- **Not changed (Phase 6):**
  - **Lopsided chambers.** In seed SPEED-1, states with very one-sided electorates elect one-sided legislatures:
    Alaska's 75%-Democratic presidential vote gives a 40–0 House. Legislative races follow the district's lean
    with little personal vote. That could be refined with legislative primaries later.
  - **Illinois's and New Jersey's** 2-4-4 senate cycles are approximated as plain four-year terms.

## 8. Changelog

- `7f543fe`, `4b00bba` (before 7.4, on `main`): North Carolina's primary runoff threshold set to 40% (engine
  0.7.3.1), and the 6 am broadcast image refreshed.
- This commit: Phase 7.4. Engine 0.7.4, schema 10.
  - Multi-member and floterial districts: the 2016 seat rules, numbering and names, floterials, vote-for-N
    ballots, filing and decisions.
  - The statewide boards, schedules, re-seating of existing universes, and redistricting.
  - Queries and UI, tests, docs (architecture 03, 05, 06 and 10, README) and this report.

## 9. Next: Phase 7.5 — Town and Alaska reporting (awaiting your approval)

- **Maps and results by New England town and Alaska House district**: the count already uses these reporting
  units.
- **Election night** too: town-by-town returns in Maine, New Hampshire, Vermont, Massachusetts, Connecticut and
  Rhode Island.

The roadmap estimate is 3–4 hours.
