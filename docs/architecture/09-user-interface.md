# 09 — User Interface Design

## 9.1 Navigation structure

```
┌──────┬──────────────────────────────────────────────────────────────────────────┐
│ RAIL │  Screen                                                                  │
│ Hub  │                                                                          │
│ Desk │                                                                          │
│ ●LIVE│  (Broadcast appears in the rail only when an election night is available) │
│ Map  │                                                                          │
│ Res. │                                                                          │
│ Arch.│                                                                          │
│ Pols │                                                                          │
│ Polls│                                                                          │
│ Anal.│                                                                          │
├──────┴──────────────────────────────────────────────────────────────────────────┤
│ TIME BAR  Tue Nov 8 2016 · ⏸ ▶ ⏩ · +1d +1w +1m · ▸ next event · ▸▸ next election · ⌁ storage chip │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **Global search** (Ctrl/⌘+K) for any candidate, county, district, contest or year.
- **Deep links** (hash routes, which work offline): `#/archive/2036/PA/42029`, `#/contest/12345`,
  `#/person/881`. Any result is at most two interactions away (spec §16.4).
- The **time bar** is always present outside Broadcast Mode. During a night it becomes the
  playback bar.

## 9.2 Screens

**Government** (Phase 6, `ui/screens/Government.tsx`) has five tabs:
- **Approval & economy:** the published approval average and every poll, and the jobs, inflation and GDP
  releases. Monthly simulation truth (approval by party, recessions) sits in a collapsed, labelled section.
- **Congress:** composition, the yearly record, and every major bill with its roll calls by party.
- **State legislatures:** control of all 99 chambers, trifectas and the last session of each state.
- **Census & apportionment:** populations, seats gained and lost, the 435th seat and the next in line, the
  changing electorate, and every congressional plan with its statistics.
- **District maps:** any state's House, state senate or state house plan in any year it was in effect, drawn
  from base units and coloured by district, holder or lean.

| Screen | Purpose | Key content |
|---|---|---|
| **Hub** | Universes | Save slots with size and last export; New Universe (one click; optional seed and name; advanced options hidden); Import/Export/Back up; storage status |
| **Desk** (Universe Dashboard) | "Who governs and what's next" | President/VP, Congress control bars, governors map, upcoming elections, approval and generic ballot averages, economy sparklines, news feed, next-event countdown |
| **Broadcast Mode** | Election night (§9.3) | |
| **Interactive Map** | Geographic exploration | Layers (states, counties, CDs, SLDs, towns, synthetic precincts); metrics (winner, margin, swing, turnout, turnout change, reporting progress, outstanding vote, candidate share); election and compare-with selectors; legend; tooltips; detail drawer |
| **Results Explorer** | Find anything | Faceted search (year, office, state, party, status, margin); sortable virtualized tables; contest pages (totals, county table, mini map, mode breakdown, revisions, calls timeline); candidate pages |
| **Historical Archive** | History as history | Year → state → county drill-down; **county pages** (every contest ever held there, trend charts, swing table, turnout history); timelines (presidential results, chamber control, governorships, Electoral College); replay launcher |
| **Politicians** | People | Directory with filters; profiles (career timeline, electoral history with links, offices, relationships, ratings) |
| **Polls & Forecasts** | Pre-election information | Averages with bands, poll lists, pollster pages and ratings, forecast pages (EV histogram, "snake" of states by margin, tipping-point table, seat distributions, forecast history line) |
| **Analyst Mode** | Depth | Outstanding-vote model by RJ with intervals; batch log; mode breakdown; swing scatterplots (county swing vs demographics); turnout analytics; voter-survey crosstabs; forecast vs result; network call timelines; labeled *simulation truth* panels |
| **Settings** | | Audio, reduced motion, color-vision options, storage and backups, archive integrity, diagnostics (device benchmark), advanced simulation options (hidden behind a disclosure) |

**Phase 5 status (as built).**
- **Polls & Forecasts** (`#/polls/<year>/<tab>`), with five tabs:
  - **Forecast:** presidency, Senate and House probabilities; the EV histogram with the 270 line; the snake of
    states (each as wide as its electoral votes, tipping-point states underlined); the tipping-point table; seat
    distributions; forecast history; the most competitive races.
  - **Races:** every polled race with its average and forecast. A race page shows the average with its 80% band
    and the polls as dots (shares or margin), the forecast history and the poll list.
  - **Polls:** the latest polls.
  - **Pollsters:** each pollster's method, sponsor, scope, house effect and, after elections, its track record.
  - **Forecast vs result:** after the count, the Brier score, a reliability diagram, upsets and the largest misses.
  Only published polls appear; results appear only once each race's count is complete.
- **Primaries** (`#/primaries/<year>`): per party, the nominee or presumptive nominee, a delegate tracker
  (pledged, superdelegates, the majority line), the candidates (status, delegates, states won, endorsements),
  convention ballots, and the calendar with each contest's event, delegates, winner and top results.
- The **Desk** gains a season card with the latest forecast and links.
- Charts follow the Phase 4 rules: one y-axis, 2 px lines, a recessive grid and hover readouts. Candidates of the
  same party use a categorical palette validated for the dark surface, always with direct labels.

## 9.3 Broadcast Mode (the centrepiece)

> **Phase 4 status:** implemented — see [../phase-4-report.md](../phase-4-report.md). As built at 1366×768, the race card sits
> in a right column rather than a drawer. The brand bar carries the view tabs (Broadcast | Desk | Analyst), the clock and the EV counter;
> Senate, House and governors counters sit above the map. Map modes: winner, margin, swing, turnout, turnout change, reporting,
> outstanding, candidate share. State views shade counties by margin and outline counties with vote outstanding; in the House view a
> state opens to its districts. Sound cues are synthesized with Web Audio. Reduced motion follows the system setting or a toggle.

Layout at 1920×1080. It reflows to 1366×768, the most common Chromebook panel, by collapsing the right
column into a drawer.

```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ MNN ELECTION NIGHT ’16        [ KEY RACE ALERT · PENNSYLVANIA · Senate ]          9:42 PM ET  │
├──────────────────────────────────────────────────────────────┬────────────────────────────────┤
│                                                              │ PENNSYLVANIA · PRESIDENT       │
│                                                              │ ≈ 61% expected vote · 6,812/   │
│                    NATIONAL MAP (EC)                         │   9,158 precincts              │
│        tap a state → county map with "magic wall" zoom       │ ■ D  Halvorsen   2,104,331 49.6%│
│                                                              │ ■ R  Whitcombe   2,051,870 48.4%│
│                                                              │ ▲ lead 52,461 · outstanding:   │
│                                                              │   Philadelphia, Allegheny mail │
├──────────────────────────────────────────────────────────────┤ [ county list · swing · map ]  │
│ D 209 ████████████████▏         270         ███████████ 187 R│                                │
│ SENATE D 46 · R 49 · ? 5        HOUSE D 188 · R 201 · ? 46    │                                │
├──────────────────────────────────────────────────────────────┴────────────────────────────────┤
│ ▌ANNA REYES (data desk): Whitcombe has cut into the lead after a batch of about 38,000 votes    │
│   from Westmoreland and Washington counties. However, substantial mail ballots remain in …     │
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ TICKER ▸ GA SEN: R 52.1–46.0 (78%) ▸ NC GOV: TOO CLOSE TO CALL ▸ OH-12: R HOLD (PROJ.) ▸ …     │
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ ⏸ ▶ 60× · ⇥ next projection · ⇥ next poll close · ── timeline with markers ── · LIVE / REPLAY │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

All names in this mockup are illustrative placeholders. In the app, every name and number comes from the
record.

- **Projection banner:** a full-width animated banner ("MNN PROJECTION · NORTH CAROLINA · R HOLD"), a short
  original sting, and the map fill animating in. The seat or EV counter rolls to its new value.
- **Race board** for the focused race: candidates, votes, shares, lead, "≈ x% of expected vote", precincts
  reporting, and an "outstanding" clause from the same facts as commentary.
- **Map:** called states are filled solid; leaning states (counted lead, uncalled) are shown hatched
  or pale; states with no votes are neutral. In a state view, counties are filled by leader with intensity by margin, and
  RJs with outstanding vote are outlined.
- **Balance-of-power bars:** projected (solid), leading (pale) and uncalled. A 270 marker, and majority
  markers that account for holdovers and the VP tiebreak.
- **Lower third:** commentary lines with speaker name and role.
- **Ticker:** a crawl of race statuses ordered by importance.
- **Network switcher** (Phase 9): view the same night through another network's calls.

## 9.4 Visual identity (original; inspired by, not copied from, CNN)

| Token | Value (initial) | Use |
|---|---|---|
| `--bg-0` | `#0A1022` deep navy | Broadcast background |
| `--bg-1` | `#131C38` | Panels |
| `--dem` | `#1F5FD6` | Democratic fill; tints at 85/65/45/25% for margin bins |
| `--rep` | `#D7263D` | Republican fill; same tint ladder |
| `--ind` | `#E0A800` | Independents/minor (per party colour where defined) |
| `--alert` | `#FFC53D` | Key Race Alert |
| `--call` | `#FFFFFF` on party colour | Projection banners |
| Type | **Barlow Condensed** (headlines, numerals), **Inter** (UI), both OFL, self-hosted | |

- Margin bins: <1, 1–5, 5–10, 10–20, 20–30, >30 points (configurable in Analyst Mode).
- Animations: 150–400 ms ease-out for state changes; banners ≤ 1.2 s; counters roll at most 800 ms. All are
  disabled or reduced under `prefers-reduced-motion` or the in-app toggle.
- **Audio:** original Web Audio synthesized cues (projection sting, alert tone, poll-closing chime), with a
  master volume and **Mute** in the playback bar. It starts muted until the first user gesture (Chrome autoplay
  policy), and audio never blocks interaction.

## 9.5 Accessibility and honesty in display

- Keyboard reachable throughout, visible focus, ARIA live region for projections (rate-limited).
- Map alternatives: every map has a table view, and colour-vision options swap in a blue/orange palette and/or
  hatching.
- Minimum contrast 4.5:1 for text. Numerals are tabular.
- **Provenance badges** everywhere numbers appear: *Estimated*, *Synthetic precinct*, *Simulation truth*,
  *Unofficial / Certified / Recount rev n*, *Reaggregated (exact)* or *Estimated comparison*.
- Unimplemented features appear only as clearly labelled "Planned (Phase N)" placeholders, never as
  controls that do nothing (spec §1.4).

## 9.6 Responsiveness

The design targets 1366×768 and 1920×1080 landscape. Tablet mode (touch) uses larger hit targets and
gestures (pinch-zoom, two-finger pan). Below 1100 px width, Broadcast Mode stacks map → race board → bars →
commentary. Charts and tables are virtualized for thousands of rows.
