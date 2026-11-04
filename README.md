# Election Night: America

A persistent, statistically grounded simulation of American electoral history. It has fictional politicians and a
fictional electorate, set in real American geography and institutions, beginning January 1, 2016.

## Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture & feasibility | ✅ [docs/architecture](docs/architecture/README.md) |
| 1 | Foundational universe: geography, population, electorate, government, people, clock, saves, dashboard | ✅ implemented, awaiting approval ([report](docs/phase-1-report.md)) |
| 2 | Core elections: calendar, candidates, shared-electorate ballots, President/Senate/House/Governor, archive | next |
| 3–10 | Election-night counting, broadcast, campaigns and polls, political evolution, full coverage, archive, advanced systems, polish | [roadmap](docs/architecture/10-roadmap.md) |

## Using it (Chromebook)

1. Open **https://timovk.github.io/UsElec26/** in Chrome (available once GitHub Pages is enabled; see the Phase 1 report §7).
2. Optional: click *Install* in the address bar. The app then opens in its own window and works offline.
3. Create a universe, explore the Desk, Map and People screens, and advance time.
4. **Back up regularly** with **Export**. Universes are stored only in this browser until you export them. The save dialog
   can write directly to Google Drive.

## Development

Everything runs in the browser. There is no server. The commands below are for development only. Users never need them.

```bash
npm ci
npm run dev                         # local dev server
npx vitest run                      # unit, property and real-data tests
npx vite build && npx playwright test   # end-to-end in Chromium
node tools/bench/run.mjs 4          # benchmark with 4× CPU throttling
node tools/geo-pipeline/run.mjs     # rebuild the Census geography pack (downloads ~1.7 GB; see its README)
```

Key documents:
- [Architecture](docs/architecture/README.md)
- [Phase 1 report](docs/phase-1-report.md)
- [Geography pack format](docs/data/geo-pack-format.md)
- [Geography validation](docs/data/geo-pack-2016.1-validation.md)
- [Data sources and licenses](docs/data-sources.md)

## Data and licenses

Geography and population come from U.S. Census Bureau products, which are public domain (17 U.S.C. §105). The
real-politician blocklist comes from `unitedstates/congress-legislators` (CC0). Fonts are Inter and Barlow
Condensed (SIL Open Font License). Every politician, the parties' coalitions and every event in a universe are
fictional.
