# Election Night: America

A persistent, statistically grounded simulation of American electoral history. It has fictional politicians and
a fictional electorate, set in real American geography and institutions, and it begins on January 1, 2016. Its
centrepiece is a broadcast-style election night, inspired by the information density of network election
coverage, that reveals elections which actually exist inside the simulation. Every completed election becomes
permanent, inspectable history.

## Status

**Phase 0 (Architecture & Feasibility) is complete and awaiting approval.** No application code has been written
yet, by design. The specification requires an architecture-first approach.

- Architecture: [`docs/architecture/`](docs/architecture/README.md). Start with the README there: it lists the key
  decisions and the decisions needed from the project owner.
- Feasibility measurements: [`docs/architecture/15-feasibility-spikes.md`](docs/architecture/15-feasibility-spikes.md)
  (spike scripts in [`tools/spikes/`](tools/spikes/)).

## How it will be used (from Phase 1)

The planned delivery is an installable web app hosted on GitHub Pages. On a Chromebook: open the URL in Chrome
and optionally click *Install*. It runs offline after the first visit. Universes are stored **on the device**,
and the app provides one-click export (for example to Google Drive) for backups.

## Roadmap

| Phase | Scope |
|---|---|
| 0 | Architecture & feasibility ✅ |
| 1 | Foundational universe: geography, population, electorate, government, people, clock, saves, dashboard |
| 2 | Core elections: calendar, candidates, shared-electorate ballots, President/Senate/House/Governor, archive |
| 3 | Election-night counting: poll closings, reporting batches, expected vote, race calls, replay |
| 4 | Broadcast interface: maps, counters, alerts, projections, commentary |
| 5 | Campaigns, polling, forecasts, primaries |
| 6 | Political evolution, census, reapportionment, redistricting, state legislatures |
| 7 | Complete electoral coverage (down-ballot, local, measures, special rules) |
| 8 | Advanced historical archive |
| 9 | Advanced political systems (redistricting politics, recounts, legal disputes, multiple networks) |
| 10 | Optimization & polish |

Details are in [`docs/architecture/10-roadmap.md`](docs/architecture/10-roadmap.md).
