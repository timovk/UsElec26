# Election Night: America

A persistent, statistically grounded simulation of American electoral history. It has fictional politicians and a
fictional electorate, set in real American geography and institutions, beginning January 1, 2016.

## Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture & feasibility | ✅ [docs/architecture](docs/architecture/README.md) |
| 1 | Foundational universe: geography, population, electorate, government, people, clock, saves, dashboard | ✅ approved ([report](docs/phase-1-report.md)) |
| 2 | Core elections: calendar, candidates, shared-electorate ballots, President/Senate/House/Governor, archive | ✅ approved ([report](docs/phase-2-report.md)) |
| 3 | Election-night counting: poll closings, synthetic precincts, count plan, wire, voter survey, decision desk, night record and playback | ✅ approved ([report](docs/phase-3-report.md)) |
| 4 | Broadcast interface: Broadcast Mode, magic-wall maps and map modes, alerts and commentary, Analyst mode, Results Explorer | ✅ approved ([report](docs/phase-4-report.md)) |
| 5 | Campaigns, polling and forecasts: campaigns and events, fictional pollsters, polling averages, Monte Carlo forecasts, presidential primaries with delegates and conventions, debates and endorsements | ✅ approved ([report](docs/phase-5-report.md)) |
| 6 | Political evolution: demography, an evolving electorate, economy and approval, careers and succession, Congress and state government, census, apportionment, redistricting, state legislative elections | ✅ implemented, awaiting approval ([report](docs/phase-6-report.md)) |
| — | Speed: faster simulated years (deferred from Phases 5 and 6); the year 2016 takes about half as long | ✅ on `main` ([report](docs/speed-report.md)) |
| 7 | Complete electoral coverage, in sub-phases 7.1–7.8 (rules over time and ranked-choice voting, statewide offices and courts, ballot measures, multi-member districts, town reporting, county and city offices, precinct maps) | 7.1 ✅ implemented ([report](docs/phase-7.1-report.md)); 7.2 ✅ approved ([report](docs/phase-7.2-report.md)); 7.3 ✅ approved ([report](docs/phase-7.3-report.md)); 7.4 ✅ approved ([report](docs/phase-7.4-report.md)); 7.5 ✅ approved ([report](docs/phase-7.5-report.md)); 7.6 ✅ approved ([report](docs/phase-7.6-report.md)); 7.7–7.8 planned ([roadmap](docs/architecture/10-roadmap.md#phase-7-complete-electoral-coverage)) |
| 8–10 | Archive, advanced systems, polish | [roadmap](docs/architecture/10-roadmap.md) |

## Using it (Chromebook)

1. Open **https://timovk.github.io/UsElec26/** in Chrome.
2. Optional: click *Install* in the address bar. The app then opens in its own window and works offline.
3. Create a universe, explore the Desk, Map and People screens, and advance time. **Next election 🗳** holds the next
   election day (it stops at the ballot lock on the morning of a general election); **Election Night** presents the count
   as a broadcast live from 5:00 pm ET (with Desk and Analyst views); **Results** (with the Results Explorer), contest and
   county pages and **Map → Election results** show the count so far and, after each state certifies, the certified archive.
   **Polls** shows the polls, polling averages and forecasts of the campaign (and, afterwards, forecast against result);
   **Primaries** follows the presidential nominating contests, delegates and conventions. **Government** shows approval and
   the economy, Congress (bills and roll calls), the state legislatures, the state offices and courts, the ballot measures,
   the census and apportionment, and every district map. **Archive** holds the election history of every state, congressional district and
   county, and of every New England town and Alaska House district, which is how those states report (their maps and
   election-night tables show them too); a district code such as TX-15, wherever it appears, opens that district's history.
4. **Back up regularly** with **Export**. Universes are stored only in this browser until you export them. The save dialog
   can write directly to Google Drive.

## Development

Everything runs in the browser. There is no server. The commands below are for development only. Users never need them.

```bash
npm ci
npm run dev                         # local dev server
npx vitest run                      # unit, property and real-data tests
ENA_CYCLE=S-A,S-B npx vitest run tests/unit/elections/cycleReal.test.ts   # 2016 cycle on the real geography
ENA_DESK_REAL=30 npx vitest run tests/unit/night/deskAccuracy.test.ts     # decision-desk accuracy over simulated nights
ENA_STORY=SEED-A npx vitest run tests/unit/night/story.test.ts            # alerts and commentary on a real night
ENA_MAKE=out.ena ENA_MAKE_UNTIL=2016-11-09T07:00 npx vitest run tests/unit/tools/makeUniverse.test.ts  # build a universe file
ENA_CALIBRATE=8 npx vitest run tests/unit/polling/engineCalibration.test.ts  # forecast calibration over simulated cycles
ENA_LONGRUN=50 npx vitest run tests/unit/engine/longRun.test.ts           # 50 years on the fixture with stylized-fact checks
ENA_ACCEPT=seed npx vitest run tests/unit/engine/longRun.test.ts          # 2016 → 2040 on real geography (checkpoints; resumable)
ENA_REDISTRICT=1 npx vitest run tests/unit/geo/redistrict.test.ts         # draw every state's plan from the real geography
npx vite build && npx playwright test   # end-to-end in Chromium
node tools/bench/run.mjs 4          # benchmark with 4× CPU throttling
node tools/geo-pipeline/run.mjs     # rebuild the Census geography pack (downloads ~1.7 GB; see its README)
```

Key documents:
- [Architecture](docs/architecture/README.md)
- [Phase 1 report](docs/phase-1-report.md)
- [Phase 2 report](docs/phase-2-report.md)
- [Phase 3 report](docs/phase-3-report.md)
- [Phase 4 report](docs/phase-4-report.md)
- [Phase 5 report](docs/phase-5-report.md)
- [Phase 6 report](docs/phase-6-report.md)
- [Speed report](docs/speed-report.md)
- [Phase 7.1 report](docs/phase-7.1-report.md)
- [Phase 7.2 report](docs/phase-7.2-report.md)
- [Phase 7.3 report](docs/phase-7.3-report.md)
- [Phase 7.4 report](docs/phase-7.4-report.md)
- [Phase 7.5 report](docs/phase-7.5-report.md)
- [Phase 7.6 report](docs/phase-7.6-report.md)
- [Geography pack format](docs/data/geo-pack-format.md)
- [Geography validation](docs/data/geo-pack-2016.1-validation.md)
- [Data sources and licenses](docs/data-sources.md)

## Data and licenses

Geography and population come from U.S. Census Bureau products, which are public domain (17 U.S.C. §105). The
real-politician blocklist comes from `unitedstates/congress-legislators` (CC0). Fonts are Inter and Barlow
Condensed (SIL Open Font License). Every politician, the parties' coalitions and every event in a universe are
fictional.
