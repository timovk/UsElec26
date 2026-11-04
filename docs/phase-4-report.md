# Phase 4 Report — The Broadcast Interface

**Status:** implemented and tested; awaiting your approval before Phase 5.
**Engine version:** 0.4.0 · **Schema version:** 3 (unchanged) · **Night record:** version 2 · **Geography pack:** 2016.1 (unchanged)

## 1. What you can do now

1. **Watch election night as a broadcast.** **★ Election Night** now opens in **Broadcast** view:
   - **brand bar:** the fictional MNN network, the night picker, the Eastern clock, LIVE or REPLAY, and the electoral-vote counter with the 270 line;
   - **counters:** Senate and House bars (seats not up included, majority line) and the governors' races; the numbers roll to their new values;
   - **the magic wall:** the national map, coloured as the count goes (solid = projected, pale = leading, dark = polls open). Select a state and the camera flies in to its counties, shaded by margin, with counties that still have a lot of vote out outlined in gold. In the House view, a state opens to its districts. **◀ National** (or a click outside the state) flies back out;
   - **map modes:** winner, margin, swing, turnout, turnout change, reporting, outstanding vote, and candidate share;
   - **banners:** MNN projections, Key Race Alerts, poll closings, electoral milestones, chamber control, the presidency, withdrawals and runoffs slide in with a short synthesized sound cue. A state flashes as its projection comes in. At higher speeds only the bigger moments get a banner;
   - **the lower third:** commentary from five fictional people (anchor, data desk, two political analysts, a correspondent);
   - **the ticker:** uncalled key races with their leader, margin and share counted, then the latest projections;
   - **the race card:** candidates, votes, shares, desk status and time of the call, expected vote and precincts counted, and where the vote is still out;
   - **controls:** play/pause, 1×–600×, a timeline with poll closings and the night's major moments marked, **Jump to ⇥** (next poll closing, projection, Key Race Alert, major moment, or lead change in the focused race), **6 am ⇥**, mute 🔈, reduced motion ◆, and full screen ⛶.
2. **Analyst view** (the **Analyst** tab, or **∑ Analyst** in the rail) shows one race in depth:
   - the count over time, with the desk's status changes marked;
   - outstanding vote by county or town (sortable);
   - votes by voting mode;
   - the county swing scatter against the previous comparable election;
   - turnout;
   - the voter survey's toplines and crosstabs by age, sex, race and education;
   - every desk call with its confidence and the share counted;
   - a virtualized batch log of every report;
   - **simulation truth:** the end of the count, behind a spoiler warning.
3. **Desk view** is the Phase 3 functional view, kept as the third tab.
4. **Results Explorer** (Results screen):
   - faceted search: stage, office, winning party, state, seats that changed party, incumbents defeated, margins under 5 points, and free text, each facet showing how many contests a click would leave;
   - a sortable, virtualized table;
   - a **calls timeline** of every projection on the year's election night, by office and time.

   Contest pages gain a county mini-map and a link to analyze the night.
5. **Map → Election results** gains the same map modes: winner, margin, swing, turnout, turnout change and candidate share.

## 2. Using it on a Chromebook

1. Phase 4 is on the development branch. GitHub Pages serves `main`, which still has Phase 3. Tell me when to update it.
2. **Existing universes keep working.** Nights counted before Phase 4 get their alerts and commentary written when first opened (about half a second, from the record and the archive as of that night). They lack the part-level expected vote, so their reporting and outstanding maps by county stay empty.
3. **Watching:**
   - press **Next election 🗳** to the ballot lock;
   - open **★ Election Night** and click **Start coverage at 5:00 pm ET**, then **▶ Play**;
   - 60× plays one simulated minute per second; 600× gives the night in about two minutes, with banners only for the biggest moments.

   **⛶** fills the screen, which suits 1366×768.
4. **Sound** starts with your first click on ▶ (browsers require a gesture). The mute and reduced-motion choices are remembered on the device. Reduced motion also follows the system setting until you choose otherwise.

## 3. What was built

| Area | Delivered |
|---|---|
| Alerts and commentary (`src/broadcast/story.ts`, `src/engine/nightStory.ts`) | A deterministic pipeline over the night record (§8.6), run once at the ballot lock and stored in the record.<br>**Detection:** poll closings (with the calls and the races too early or too close at closing), first votes, lead changes (with hysteresis: a lead of at least 0.3 points, not in the first trickle, at most one every 20 minutes per race), see-saw races, margin moves with their cause, outstanding vote, projections (hold or flip from the seat holder before the election, balance-of-power impact, "first win since"), chamber control, electoral-vote milestones, the presidency, withdrawals, runoffs, recount watch, late counts, turnout, and field reports.<br>**Causes and where-the-vote-is** come from the record: the jurisdictions behind the latest batches (size and voting mode), the outstanding expected vote by jurisdiction from the part-level wire, and who has been winning those places.<br>**Scheduling:** a speaking beat every 5 simulated minutes, plus immediate slots for the biggest moments (poll closings first). Each story's importance decays with age; there are cooldowns per race, per story type and per race × type, a novelty bonus for kinds of story not heard for an hour, and speaker rotation within each story's roles. A newer story about a race's count replaces an unspoken older one, so stale facts are never read.<br>**Realization:** 2–8 templates per story type with `{slot}`s and optional `[[fact\| clause]]`s. Templates can require or exclude facts (a "narrowing" template is never used for a widening lead). Numbers are rounded as spoken ("about 41,000", "1.2 million"), sentences are capitalized, and recently used templates are avoided.<br>**Validation:** a line with any unbound slot, `undefined`, `NaN` or `null` is dropped. |
| Record v2 | Part-level wire expected vote (`partWire`); voter-survey crosstabs (raked to the realized toplines, with nonresponse bias, then sampled); the stored story. Version 1 records still decode. |
| Broadcast Mode (`src/ui/night/Broadcast.tsx`, `NightMap.tsx`, `audio.ts`, `broadcast.css`) | Original look: navy and white with red and gold accents, Barlow Condensed display type, a skewed MNN bug. Lays out for 1366×768 inside the app and stacks below 1100 px.<br>**Magic wall:** a geometric-interpolation camera flight that redraws the vector map every frame. Counties are shaded by margin; counties with outstanding vote get gold outlines; districts appear in the House view.<br>**Banner queue:** filtered by importance for the playback speed, with longer holds for the biggest moments; cleared on seeks so a jump never floods.<br>**Web Audio cues:** synthesized, with no audio files.<br>**Reduced motion** disables banners' motion, flashes, tweens, the ticker crawl and the camera flight. |
| Map modes (`src/ui/night/mapModes.ts`) | Pure value and colour functions shared by the night and archive maps:<br>• margin and swing use the diverging margin scale;<br>• turnout, reporting and outstanding use a single-hue sequential ramp;<br>• turnout change uses a two-hue diverging scale;<br>• candidate share uses a ramp of the party's colour;<br>• a third-party leader is shown in its own colour. |
| Queries | `nightContext` (eligible voters by county and state, each race's previous comparable result); `nightBaseline` (by county); `nightSurvey`; `nightCalls`.<br>**Archive results map:** returns per-area D, R and valid votes, the leading party, ballots, eligible voters and the baseline.<br>**Contest list:** gains state, flip and incumbent-defeated facets.<br>**Broadcast Worker:** `raceDetail` (batches, votes by mode, desk events with the share counted, a thinned count history, the final count on request) and the expected vote by jurisdiction in focus frames. |
| Analyst Mode, Results Explorer | As in §1. Charts follow one axis, 2 px lines, recessive grid and hover readouts; the batch log and the explorer table render only the rows in view. |
| Performance | **Results are sealed in the compute workers:** each state's job encodes and hashes its contests' cast-ballot blobs, its turnout blob and its rejected-ballot blobs, in parallel; the engine thread only writes them. The inline runner uses the same path, so tests and the browser produce identical archives. |

## 4. Test results

| Suite | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ no errors |
| ESLint + dependency-cruiser layering | ✅ no problems, no dependency violations |
| Unit, property and fixture tests (`vitest run`) | ✅ **67 passed, 5 skipped** (the opt-in real-geography suites; the real-night commentary suite `ENA_STORY=SEED-A` was run separately and passed) **** |
| End-to-end, Chromium (`playwright test`) | ✅ **3 passed** (2.9 min): the 2016 cycle, the election night, and universe persistence **** |

**New tests:**
- **Commentary fact-binding validator:**
  - template mechanics: unbound slots drop the line, optional clauses appear only when bound, `NaN` never renders;
  - every line and alert of a full fixture night passes the validator;
  - no line or alert about a race comes before its polls close;
  - lines are in time order, and speakers are valid;
  - rebuilding the story from the record and the archive gives the identical text (determinism).
- **Repetition metrics:**
  - share of lines whose template was used in the previous 8 lines (fixture < 15%);
  - the largest share of the night held by any one template (< 20%);
  - distinct-trigram ratio, reported.
- **Analyst data:** votes by mode and the count's history equal the playback's totals at the same moment, and desk events never precede the polls closing.
- **Map context:**
  - eligible voters for every state;
  - no baseline in the first simulated cycle;
  - the calls list;
  - archive map cells are consistent (D + R ≤ valid, ballots ≤ eligible).
- **Spoiler check:** while the count goes on, the year summary does not reveal turnout from the sealed cast ballots (see §6, fix 1).
- **Map modes:** each mode's value; missing data never invents a value; projected/leading/third-party colours; legends; recolouring 3,142 counties in every mode stays within the 50 ms budget.
- **Night E2E (rewritten for Broadcast Mode):**
  - live playback with banners and commentary;
  - frame timing during playback and the camera flight;
  - map recolour timing;
  - mute and reduced motion;
  - the Results Explorer during the count (and the turnout check);
  - skip to 6 am;
  - **visual regression snapshot** of the broadcast at 6 am;
  - **replay determinism:** the same moment reached twice renders pixel-identically;
  - Analyst, Desk and the picker;
  - archive map modes.

## 5. Measurements

| Measurement | Value | Notes |
|---|---|---|
| Broadcast playback at 600×, live, 1366×768, Chromium | **median 16.7 ms, p95 16.7 ms per frame (60 fps)** | Real frame intervals (requestAnimationFrame) while banners, counters and the ticker animate and the universe advances |
| Magic-wall camera flight | **84 frames in 1.4 s, median 16.7 ms (60 fps)** | Vector map redrawn every frame |
| Map recolour (state and county views) | **median 0.1–0.4 ms, p95 0.6–1.2 ms (four runs)** | Budget ≤ 50 ms. Colour computation for all 3,142 counties in every mode is under 50 ms in Node (unit test) |
| Commentary for a real night (seed SEED-A) | 148 lines and 396 alerts, built in **0.41 s** | Lines by type: 52 projections, 25 outstanding vote, 14 lead changes, 13 margin moves, 9 poll closings, 7 turnout, 6 first votes, 5 field reports, 3 runoffs, 3 late counts, 2 control, 2 control reactions, 2 too close, 2 electoral, 1 see-saw, 1 presidency, 1 headquarters |
| Repetition, real night | 9.5% of lines reuse a template from the previous 8; no template above 4.7% of the night; 63% distinct trigrams | Fixture night: 0.0%, 5.3%, 61% |
| Jan 1 → the 2016 general's ballot lock, Chromium | **28.6–31.3 s (five runs)** | Phase 3: 30–34 s |
| The Election Day step itself (the ballot lock), Chromium, 3 compute workers | **13.1–13.7 s** | Phase 3: 13.7 s. Breakdown of one run: voters go to the polls 1.4 s; counting ballots (kernel, night and now sealing, in the workers) 6.7 s; tally 0.15 s; sealing the ballots cast on the engine **0.07 s** (Phase 3: 3.2 s); sealing the night record 3.3 s (Phase 3: 1.6 s; it now also writes the alerts and commentary); writing the archive 1.0 s |

**What the worker-side sealing achieved, honestly.**
- The engine's seal step fell from 3.2 s to 0.07 s.
- The compute workers took about 1.4 s longer, because they now do that encoding (in parallel over 3 workers).
- Writing the commentary at the lock added about 1.5 s to the night-record step.

Net, the Election Day step is about the same as in Phase 3. On a Chromebook with more cores than workers busy, the parallel part should help more than here.

The remaining levers are:
- building the commentary in a compute worker while the archive is written;
- cheaper primaries;
- fewer desk evaluations on quiet races.

**How the frame figures were measured.** They are real frame intervals (requestAnimationFrame). The map draw times are main-thread canvas command time; rasterization happens on the compositor and shows in the frame intervals.

As before, a Chromebook core is roughly 1.5–3× slower than this 4-core server. The playback and map numbers have large headroom (the budget is 20 ms a frame). The simulation timings do not; please send me your Chromebook's numbers for **+1 year** and the Election Day step.

## 6. Fixes found during Phase 4

1. **Spoiler (Phase 3 leak):** during the count, the Results summary showed national turnout taken from the sealed cast-ballot record. Turnout now appears only when no general election of the year is still being counted, and the archive map's turnout mode uses the ballots counted so far.
2. **House race labels** on election night showed only the state (`FL`); they now show the district (`FL-07`), and commentary says "Florida's 7th District".
3. **Commentary ordering:** a poll-closing line could wait behind projections; poll closings now always speak first at their minute. Electoral milestones are reported for the leader only and stop at 270.

## 7. Known limitations (Phase 4)

1. **Template variety.** The architecture calls for 10–30 templates per story type and speaker style. v1 has 2–8 per type (about 75 in all). The repetition metrics pass, but long nights reuse phrasing, especially for projections and outstanding-vote notes. Adding templates is pure content work; it can grow in any later phase.
2. **Story types not yet implemented:**
   - over-performance against a comparable race;
   - bellwether county completions;
   - an explicit paths-to-270 analysis (electoral milestones and "needs N more" stand in);
   - per-RJ "big-county completion" alerts.
3. **No previous comparable election in the first cycle.** Swing, turnout change and the swing scatter are disabled with a note until the archive holds an earlier result (from 2018 onward, against 2016).
4. **Historic notes are thin.** "First win since …" uses the archive's office terms, which before the simulation start hold only the genesis office holders. It therefore rarely fires before the late 2010s.
5. **Field reports and the headquarters scenes are generic** (no candidate speeches or concessions yet). Those need the campaign events of Phase 5.
6. **Banners and alerts show what the desk knows.** A banner never uses simulation truth. The Analyst's "simulation truth" panel is the only exception, and it asks before revealing.
7. **Visual regression** compares against one stored baseline (Chromium on Linux at 1366×768, 3% pixel tolerance). A different Chromium build in CI may need the baseline refreshed.
8. **Frame-time benchmarks** run headless on this server. A real Chromebook GPU may differ; the map draws are light (51 states or one state's counties per frame).
9. **Records from before Phase 4** have no part-level expected vote, so county reporting and outstanding maps are blank for those nights.

## 8. Changelog

- **Engine 0.4.0:** results sealed in the compute workers; alerts and commentary written at the ballot lock and stored in the night record (v2, with part-level expected vote and survey crosstabs); the year summary no longer reveals sealed turnout during the count.
- **New modules:**
  - `broadcast/story` (detection, scheduling, realization, validation);
  - `engine/nightStory` (facts from the archive);
  - `engine/baselines` (previous comparable results, eligible voters);
  - `ui/night/` (`useNight`, `Broadcast`, `NightMap`, `mapModes`, `audio`, `Analyst`, `broadcast.css`);
  - `ui/screens/ResultsExplorer`;
  - `ui/components/MiniMap`.
- **Playback:** `raceDetail`, `rjExpected`, `finalVotes`; focus frames carry expected vote by jurisdiction.
- **Map renderer:** camera flights, outlines, flashes, an outside dim for state views, and frame-time sampling for benchmarks.
- **Queries:** `nightContext`, `nightBaseline`, `nightSurvey`, `nightCalls`; results-map cells and baselines; contest facets (state, flip, incumbent defeated); House district in race metadata; RJ → county mapping.
- **UI:** Election Night views Broadcast | Desk | Analyst (`#/night/<id>/<view>`); **∑ Analyst** in the rail; Results Explorer; contest mini-map; archive map modes.
- **Tests:** story and repetition, map modes, analyst data, map context, the spoiler check, the rewritten night E2E with benchmarks, a snapshot and the replay-determinism check; a tool to build `.ena` universes for screenshots (`tests/unit/tools/makeUniverse.test.ts`, opt-in).
- **Docs:** this report, plus updates to architecture 08 (commentary as built), 09 (Broadcast Mode as built), 10 (status) and 11 (measured performance).

## 9. Next: Phase 5 — Campaigns, polling, forecasts, primaries (awaiting your approval)

From the [roadmap](architecture/10-roadmap.md):
- campaign dynamics and events;
- pollsters, poll fieldwork and the poll archive;
- Kalman polling averages;
- Monte Carlo forecasts and their history;
- presidential primaries on the 2016 calendar: caucuses, delegate rules, withdrawals and conventions;
- congressional and gubernatorial primaries;
- debates and endorsements.

Forecasts will replace the desks' proxy priors, and primary nights will use the Phase 3–4 machinery.
