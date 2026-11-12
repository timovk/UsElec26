# Phase 7.5 Report — Town and Alaska Reporting

**Status:** implemented, awaiting approval.
**Engine version:** 0.7.4 (unchanged) · **Schema version:** 10 (unchanged) · **Night record:** version 2 (unchanged) ·
**Geography pack:** 2016.1, one presentation file added (`topo/rj.topo.json`)

Phase 7.5 is the fifth of eight Phase 7 sub-phases ([roadmap](architecture/10-roadmap.md#phase-7-complete-electoral-coverage)).
New England reports its results town by town and Alaska by State House district. The count has always run on those
units. Now the maps, the archive and election night show them too. As agreed:
1. **Also in the national view.** Map → Counties shows New England's towns and Alaska's districts nationwide, in
   place of their counties.
2. **Alaska by House district**: its 40 districts as drawn for 2016.
3. **Full pages** for every town and district.
4. **Municipal reporting in Wisconsin, Michigan, Minnesota and the like** is on the roadmap's future ideas list.

In short:
- **1,582 towns and 40 Alaska districts** are on every map that shows counties: Map → Counties (today's lean and
  election results, nationwide and zoomed) and election night's state view.
- **Every town and district has its own history page.** State pages list their towns or districts with the last
  presidential margin in each, and county pages list their towns.
- **Election night names towns.** The race board's "Where the vote is still out", the Analyst's outstanding-vote and
  swing tables name the town or district, and link to its page.
- **The simulation is unchanged.** Same engine, and for the same seed every simulation table is byte-identical to
  7.4's. Existing universes need no migration: every universe has stored its results by town since Phase 2, so past
  elections show by town too.
- **Cost:**
  - A 559 KB map file (158 KB compressed), stored with the app.
  - Election night's state views still run at 60 frames a second.
  - Redrawing the archive's county map takes 2–8 ms longer nationwide (§5). I sped up the map renderer to keep it
    there: it now skips what is outside the view.
  - The simulated year takes the same time.

## 1. What you can do now

1. **See New England by town.** **Map → Counties**, then zoom into New England with the scroll wheel or ＋. Every
   town is coloured by its lean (*Today*) or by its result (*Election results*). Hover for the town's name and margin;
   click for its details, and **Election history** opens its page. Alaska shows its 40 House districts the same way.
2. **Open a state's towns.** **Archive → Vermont** (or any New England state) has a **Towns** table: each town with
   its county, 2010 population and the last presidential margin there, with a filter box. **Archive → Alaska** has
   **House districts**.
3. **Open a town's page.** For example Burlington, Vermont:
   - its county, population and congressional district;
   - its presidential results;
   - **every contest on its ballots**, with the result in the town. A legislative district that covers part of a
     town shows the town's votes in it.
   An Alaska district's page is the same, with the state's contests.
4. **From a county.** A New England county page lists its towns.
5. **On election night.**
   - Click Maine, New Hampshire, Vermont, Massachusetts, Connecticut, Rhode Island or Alaska on the broadcast map.
     The state view shows its towns or districts, coloured as their votes come in. Towns with more than 500 votes
     still to count are outlined in gold (counties: 2,000).
   - The race board's **Where the vote is still out** names the towns ("Manchester") or districts, and links to
     their pages.
   - **Analyst** lists the outstanding vote and the swing by town or district.

## 2. Using it on a Chromebook

1. Open **https://timovk.github.io/UsElec26/** once `main` is updated. Until then the live site runs 7.4.
2. **Existing universes open as before.** Nothing is migrated: the towns come from results every universe already
   stored. Past elections, and replays of past nights, show by town too.
3. The town and district outlines (158 KB compressed) download with the app update and work offline like the rest
   of the app.

## 3. What was built

| Part | Where | What it does |
|---|---|---|
| Town and district outlines | `tools/geo-pipeline/steps/rjgeometry.mjs`, `public/geo-packs/2016.1/topo/rj.topo.json` | A new pipeline step. It takes the 2016 Census boundaries of New England's county subdivisions and Alaska's State House districts, projected and simplified like the county map but finer. Each outline is keyed by its reporting unit. Four towns changed their Census code between the 2010 blocks and the 2016 boundaries (Sanford and Penobscot Indian Island, Maine; Enosburgh and Alburgh, Vermont); each is matched to the one unmatched outline in its county. The step fails if any unit has no outline. |
| Names and areas | `src/geo/reportingUnits.ts` | Display names: "Bethel" rather than "Bethel town", but "Rutland City" beside "Rutland Town"; the four renamed towns. On the maps, towns and districts share one index with the counties: counties first, then each unit after them. |
| Map geometry | `src/ui/map/renderer.ts` | The county layer becomes a *units* layer: counties outside New England and Alaska, then the towns and districts, with their inner borders. |
| Faster map drawing | `src/ui/map/renderer.ts` | Every map now draws only the areas and border lines inside the view (borders are split into a grid of 160 tiles). Zoomed out (below 2×), towns use outlines thinned to 0.4 map units. The arcs are thinned once, so neighbouring towns still share their borders exactly. |
| Archive queries | `src/engine/archiveQueries.ts`, `src/engine/baselines.ts`, `src/engine/queries.ts` | The results map adds each town's and district's votes, from the stored results by reporting unit, or from the live count while a state is counting. Today's lean map uses each unit's voters. New: a town or district history page; a state's table of units with its last presidential margin; a county's list of towns; map details for a unit. |
| Election night | `src/engine/nightQueries.ts`, `src/ui/night/NightMap.tsx`, `src/ui/night/Analyst.tsx`, `src/ui/screens/ElectionNight.tsx` | The state view draws towns and districts with their own count; the previous election's result and turnout by unit for the swing and turnout modes; unit names on the race board and in the Analyst. |
| Pages and links | `src/ui/screens/CountyScreen.tsx`, `src/ui/screens/MapScreen.tsx`, `src/ui/app/App.tsx` | The town and district page (`#/town/<unit>`), the Towns / House districts table on state pages, the town list on county pages, links from maps and night tables. |
| Roadmap | `docs/architecture/10-roadmap.md` | The future idea: municipal reporting beyond New England. |

## 4. Test results

### 4.1 Suites

| Check | Result |
|---|---|
| Typecheck, ESLint and module boundaries | pass: no dependency violations |
| Unit, property and real-data tests (`npx vitest run`) | **148 passed**, 12 skipped (opt-in long runs); 2 new tests |
| End-to-end, Chromium (`npx playwright test`), this server | **4/4 passed** in 8.6 min; again **4/4** in 9.0 min after the renderer speed-up |

### 4.2 New and updated tests

**`tests/unit/engine/reportingUnits.test.ts`** (2 tests):
- **The real pack:** 1,582 towns and 40 Alaska districts; the seven states that report by them; the names (Bethel,
  Sanford, Rutland City and Rutland Town, Burlington); no "unknown" names; no two units of a state with the same name;
  every unit has an outline in the map file; the manifest lists the file with its size.
- **A fixture universe through 2016**, with Vermont reporting by town (two per county) and Alaska by district (four
  per borough):
  - the map metadata lists the units and the states that use them;
  - a town's page has the presidential race and more than three contests; its votes never exceed its county's;
  - an Alaska district's page has no county and the state's contests;
  - Vermont's table of towns has a 2016 margin for every town;
  - the results map has a result for every unit, and Vermont's towns add up to its counties exactly;
  - today's lean map has a value for every unit; a unit's map details name it as a town.

**End to end** (`tests/e2e/elections.spec.ts`), after the 2016 election: Archive → Vermont lists more than 200 towns;
Burlington's page opens with its contests; Archive → Alaska → the first House district opens its page.

**Checked by eye** on a real-geography universe through December 2016 (screenshots, no console errors):
Map → Counties nationwide and zoomed into New England and Alaska; Vermont's state page and Burlington's page; Alaska
House District 1; election night's state view of New Hampshire (towns), Massachusetts and Alaska (districts); the
race board's outstanding towns; the Analyst's outstanding vote for Vermont's presidential race (Colchester).

## 5. Measurements

**The simulation.** Node, real geography, January 1 → December 1, 2016 (seed SPEED-1), 7.4 and 7.5 back to back:

| | 7.4 | 7.5 |
|---|---|---|
| Wall time | 81.8 s | 81.7 s |
| of which November | 45.5 s | 45.1 s |
| Fingerprint of every simulation table | — | identical to 7.4 |

The machine was slower today than for the 7.4 report (69.2 s then), so only the back-to-back pair compares. Two
tables differ: the universe's stored copy of the pack's manifest, and its hash. The manifest now lists the new map
file. Nothing reads that hash, and universes saved before 7.5 keep their own copy.

**The maps.** Chromium on this server, a real-geography universe through December 2016, 7.4 and 7.5 builds back to
back, twice. A full redraw includes rasterizing it (the zoom buttons; median of 20):

| Map → Counties | 7.4 | 7.5, first build | 7.5, as delivered |
|---|---|---|---|
| Election results 2016, nationwide | 19–21 ms | 24–25 ms | 22–23 ms |
| Election results 2016, zoomed into New England | 18–22 ms | 40–42 ms | 27 ms |
| Today (lean), nationwide | 19 ms | 40–42 ms | 27 ms |
| Today (lean), zoomed into New England | 11–15 ms | 28–30 ms | 16 ms |
| Election night: flying into New Hampshire, Massachusetts, Alaska, a central state (frame interval, median / max) | 16.7 / 16.8 ms | 16.7 / 33–50 ms | 16.7 / 16.8 ms |

- **Where the cost was.** The towns' outlines are finer than the counties' (a town is a few pixels across until you
  zoom in). They add as many points as all 3,142 counties, and 1,622 more areas to fill.
- **What I changed.** Drawing only what is in view brought zoomed redraws back near 7.4's. Thinned outlines when
  zoomed out took off another 1–2 ms.
- **What remains.** The national view still has 4,668 areas to fill instead of 3,142, so it redraws 2–8 ms slower.
  It redraws only when the view settles or the colours change, never during a pan or zoom animation.
- **Not measured on a Chromebook.** A slower machine scales all these times up, 7.4's too.

**Other figures.**
- **Geography pack:** +559 KB (158 KB compressed), stored with the app for offline use.
- **Browser runs** (the two end-to-end runs): to the 2016 ballot lock 70.5 s and 85.1 s; January 1 → November 8,
  70.2 s and 61.4 s; universe creation 7.0 s both times. These vary by ±15% between identical runs on this server;
  the Node pair above is the measure of the simulation's speed.
- **Broadcast playback:** frame interval median 16.7 ms, p95 16.8 ms. Map recolour p95 0.8–1.0 ms (budget 50 ms).

## 6. Fixes and decisions

- **Four towns had no outline** at first. Their Census codes changed between the 2010 blocks (which the count uses)
  and the 2016 boundary files: Sanford, Maine became a city in 2013; Penobscot Indian Island, Enosburgh and Alburgh
  were recoded. Each is matched to the only unclaimed outline in its county, and the pack's "unknown" names are
  replaced by the real ones.
- **Decisions:**
  - **The national view** is the archive's Map → Counties layer. Election night's national map is by state (and by
    district for the House), so towns appear when you open a state, as counties do elsewhere.
  - **Uninhabited units** have no voters: 12 water areas, and 24 unpopulated townships, grants, gores and
    unorganized territories in Maine, New Hampshire and Vermont. They are not drawn: the map shows them in the neutral background shade.
  - **Alaska's districts are the 2016 ones** throughout. They are the units the count uses, so a universe that
    redraws Alaska's House after 2020 still reports by the 2016 districts (see §7).
  - **Outlined outstanding vote** on election night starts at 500 votes for a town, against 2,000 for a county,
    because towns are small.
  - **No engine change**, so no version bump: for the same seed, every simulation table is identical to 7.4's
    (§5).

## 7. Known limitations

- **Reporting units are frozen at 2016.** A universe that redistricts Alaska's House after a census still counts
  and reports by the 2016 districts, and New England's towns never merge or split. Both follow the pack's
  reporting jurisdictions, which do not change over time (§6.6 of the geographic strategy).
- **Other states that report by municipality** (Wisconsin, Michigan, Minnesota and others) still report by county:
  their counts would first have to run on those units. It is on the future ideas list.
- **Uninhabited units have no page and no tooltip.**
- **The national county map redraws 2–8 ms slower** than in 7.4 on this server (§5), because it has 1,526 more
  areas.

## 8. Changelog

- This commit: Phase 7.5.
  - Town and Alaska House district outlines in the geography pack (a new pipeline step).
  - Maps by town and district: Map → Counties nationwide and zoomed, and election night's state view.
  - The map renderer draws only what is in view, with thinned town outlines when zoomed out.
  - Town and district history pages, state tables of units, county town lists, and unit names in the night tables.
  - Tests, docs (architecture 06, 09 and 10, the pipeline README, README) and this report.

## 9. Next: Phase 7.6 — County offices (awaiting your approval)

- **County commission, sheriff, clerk and prosecutor** in every county, on odd-year and spring calendars where the
  state holds them, many nonpartisan.
- **A per-universe setting:** off, major counties only, or all counties.
- **Bulk certification and archiving**, so that thousands of county races do not slow down the simulated year.

The roadmap estimate is 6–8 hours.
