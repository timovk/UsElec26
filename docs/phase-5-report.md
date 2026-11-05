# Phase 5 Report — Campaigns, Polling, Forecasts and Primaries

**Status:** implemented and tested; awaiting your approval before Phase 6.
**Engine version:** 0.5.0 · **Schema version:** 4 · **Night record:** version 2 (unchanged) · **Geography pack:** 2016.1 (unchanged)

## 1. What you can do now

1. **Follow a campaign day by day.** From January 1 of each election year, the campaign runs every morning at 06:00 ET:
   - candidates raise and spend money and build name recognition;
   - presidential campaigns spend their attention on the states that matter most to them;
   - debates, scandals, gaffes and endorsements happen;
   - national opinion moves (about 0.3 points of margin a day, a few points over a campaign).

   The news feed reports the bigger moments.
2. **Polls & Forecasts** (the new **% Polls** entry in the rail) has five tabs:
   - **Forecast:**
     - the chances for the presidency, Senate and House;
     - the electoral-vote histogram with the 270 line;
     - the "snake" of states from most Democratic to most Republican, each as wide as its electoral votes, with
       frequent tipping-point states underlined;
     - the tipping-point table;
     - Senate and House seat distributions;
     - the forecast's history;
     - the most competitive races.
   - **Races:** every polled race. A race page shows:
     - the polling average with its 80% band and every poll as a dot (by candidate share or by margin);
     - a note on how registered-voter polls were adjusted;
     - the race's forecast history;
     - its polls.
   - **Polls:** the latest polls with pollster, dates, population (LV/RV), sample size, margin of error and
     responses.
   - **Pollsters:** 32 fictional organizations, each with its method, sponsor, scope and house effect. Once
     races are decided, each also gets a track record (average error and bias of its final-three-weeks polls).
   - **Forecast vs result:** after the count, a comparison with the final forecast:
     - the final presidential forecast against the electoral-vote result;
     - the Brier score;
     - the number of upsets;
     - a reliability diagram;
     - the largest misses.
3. **Primaries** (the **⚑ Primaries** entry) follows the presidential nominating contests on the 2016 calendar
   (caucuses, primaries and state conventions):
   - a delegate tracker: pledged delegates, Democratic superdelegates and the majority line;
   - the candidates, with status, delegates, states won and endorsements;
   - each contest's date, event, delegates, winner and top results;
   - the convention's ballots.

   Candidates drop out as their campaigns run out of money and votes. A nominee becomes presumptive once a
   majority is locked in. A nomination with no majority goes to a contested convention with several ballots.
4. **Congressional and gubernatorial primaries** have campaigns and polls. Senate and governor primaries also
   collect endorsements. A general-election race is polled only once both parties have chosen their nominees.
5. **The Desk** shows the latest forecast in a season card. On election night the decision desk starts from the
   final forecast instead of the old proxy prior.

## 2. Using it on a Chromebook

1. Phase 5 is on the development branch. GitHub Pages serves `main`, which still has Phase 4. Tell me when to update it.
2. **Existing universes keep working.** They are migrated to schema 4 on opening.
   - **A universe still before January 1, 2016:** gets the full campaign.
   - **A universe already past January 1, 2016:** its 2016 nominations were settled the Phase 2 way, so its
     2016 presidential race gets no polls or forecast. Its other 2016 races should still be polled. That case was
     not tested (the compatibility test opens a universe at January 1, 2016). Everything runs in full from the
     next election year.
3. **Following a campaign:**
   - press **+1 month** and open **Primaries** to watch the delegate race;
   - from June, open **Polls** for the forecasts;
   - after November, open **Forecast vs result**.

   **Next election 🗳** now stops on every primary day too. **+1 month** is the quickest way through the spring.
4. **Speed:** a simulated year takes longer than in Phase 4 because of the daily polls and forecasts (see §5).
   Please send me your Chromebook's time for January 1 → Election Day.

## 3. What was built

| Area | Delivered |
|---|---|
| Daily environment (`electorate/environment.ts`) | Each cycle's national, class, division and state forces are a cycle level plus a daily AR(1) deviation (persistence 0.995 a day). Each day has its own random stream, so the path does not depend on how the clock is advanced. Election Day uses that day's value. |
| Campaigns (`campaigns/model.ts`, `engine/season.ts`) | Per candidate and race:<br>• cash, fundraising and spending;<br>• recognition and persuasion;<br>• debate and scandal shocks, endorsements;<br>• primary momentum and viability;<br>• presidential attention by state, by voter power from the latest forecast.<br>Effects reach the ballot as bounded valence through the kernel (×2.5 in primaries). Debates: three presidential, nomination debates every three weeks until April, and statewide general debates. Quarterly finance reports. |
| Measurement port (`electorate/measure.ts`) | `measureTypes`: the kernel's first step gives expected likely and registered voters by piece and voter type.<br>`fieldPoll`: applies a pollster's design and returns sampled counts only. The design has a house effect, class coverage bias, partisan nonresponse, a likely-voter screen whose error can lean either way, undecided voters, and sampling with a design effect.<br>Poll caches are built from the cycle level, and the day's deviation is applied per class. Saved and reloaded universes therefore stay identical. |
| Pollsters (`polling/pollsters.ts`) | 32 fictional organizations (9 national, 10 multi-state, 13 single-state) with invented names and a guard against real pollsters' names.<br>Each has a method, sponsor, house effect with bounded drift, class biases, screen quality and direction, sample sizes, frequency and herding. The cycle's shared bias produces correlated misses. |
| Averages (`polling/average.ts`) | Kalman (local-level) filters on each share and on the margin.<br>House effects are estimated from general-election residuals and shrunk.<br>Registered-voter polls are moved to the likely electorate by the RV−LV gap seen in published polls of the same races.<br>Flooding guard; a simple recency average alongside. |
| Forecasts (`forecasting/model.ts`) | The prior is the lean index, the national estimate and candidate effects (incumbency, cash). Polls update it by precision weighting.<br>Errors are national, division and state terms, each Student-t(5); the national SD grows with time left.<br>1,500 draws give the EV histogram, tipping points, Senate seats with the Vice President's tiebreak, House seats (integrated analytically), governors, and each race's probability and 80/95% interval.<br>Weekly from June 1, daily in the final 100 days. Runs are stored compressed and never modified. |
| Nominations (`engine/nomination.ts`, `primaries/delegates.ts`, `rules/primaries2016.ts`) | The 2016 calendar for both parties in all 50 states and DC: primaries, caucuses (with lower turnout) and state conventions.<br>**Democrats:** proportional at 15%, about two-thirds by district; superdelegates are the party's governors and members of Congress plus DNC members.<br>**Republicans:** each state's 2016 rule (winner-take-all, by district, proportional, thresholds, majority triggers, unbound delegates).<br>Momentum, poll-based viability and withdrawals (candidates leave later ballots). Presumptive nominees.<br>Conventions on the 2016 dates, with multiple ballots and released delegates when no one has a majority. |
| Election night | The desk's baseline and prior SD come from the final forecast of each statewide two-party race. |
| Queries and UI | Season overview, race, polls, pollster, forecast run, calibration and primaries queries. Only published polls are shown, and results only once a count is complete.<br>Polls & Forecasts and Primaries screens; the Desk season card; charts (`ui/components/charts.tsx`): time series with bands and dots, histogram, snake. |
| Schema 4 | `pollster`, `poll`, `poll_response`, `poll_average`, `race_def`, `forecast_run`, `finance_report`, `endorsement`, `campaign_event`, `debate`, `delegate`, `superdelegate`, `convention_ballot`. |

## 4. Test results

| Suite | Result |
|---|---|
| TypeScript (`tsc -b`) | ✅ no errors |
| ESLint + dependency-cruiser layering | ✅ no problems, no dependency violations. This includes the **firewall**: forecasting and polling (L4) may import only `electorate/measure`, never the electorate itself. |
| Unit, property and fixture tests (`vitest run`) | ✅ **82 passed, 6 skipped** (the opt-in real-geography and calibration suites) |
| Full-engine forecast calibration (`ENA_CALIBRATE=8`, opt-in) | ✅ passed (§5.1) |
| End-to-end, Chromium (`playwright test`) | ✅ **4 passed** (6.0 min): the 2016 cycle, the election night, the 2016 campaign (new), and universe persistence. The night spec's visual baseline was refreshed (§6, fix 7) |

**New tests:**
- **Delegate math:**
  - largest remainder;
  - thresholds (and everyone sharing when nobody clears them);
  - Democratic district/statewide allocation at 15%;
  - Republican winner-take-all, majority triggers, district rules and unbound delegates;
  - the 2016 calendar covers every state for both parties with plausible totals.
- **Poll error versus design:**
  - sampling error matches `n/deff` and the mean is unbiased;
  - house effects, partisan nonresponse and swings move results in the designed direction;
  - undecided voters, more for little-known candidates;
  - **the spread of systematic errors across the pollster population:** RMS 1.4 points, at most 3.9, on a test
    electorate; the cycle's shared miss has an RMS of 1.1 points;
  - names are fictional.
- **Average coverage:** the 80% band covers a random-walk truth 89% of the time (tolerance 68–93%). The Kalman
  filter widens with time since the last poll.
- **Forecast engine:**
  - monotone in the margin;
  - uncertainty grows with time left;
  - EV, ties and tipping points are consistent;
  - calibrated on synthetic cycles drawn from the model's own error structure.
- **Full-engine calibration (opt-in):** whole 2016 cycles on the fixture geography (campaigns, polls, averages,
  forecasts, the election and the count). Every decided race's final forecast is scored against its result.
- **Phase 5 acceptance E2E (`tests/e2e/season.spec.ts`)** follows one universe through 2016 in Chromium:
  - March 1: the early contests are decided and primary polls are out;
  - June 29: the Senate and House forecasts;
  - July 29: both conventions have nominated, and the presidential forecast is out;
  - late October: the national average;
  - Election Day: the final forecast, and the Desk's season card;
  - December 22: forecast vs result, with the Brier score, the reliability diagram and the presidential EV result.
- Updated: the night E2E now steps through every primary day on its way to the general (up to 160 stops); the
  cycle test's "next election" includes the presidential primaries.

## 5. Measurements

### 5.1 Forecast calibration over simulated cycles (fixture geography, 8 cycles, 4,231 races)

| Measure | Value |
|---|---|
| Brier score, all decided races | **0.029** (competitive races, forecast 2–98%: 0.091) |
| 80% interval coverage, contested races | 73.5% overall: presidential states **80.4%**, governors 83.3%, Senate 75.1%, House 72.2% |
| Error of the margin (result − final forecast) | Presidential states: RMSE 4.4, mean +1.6 D. Senate: 5.5. Governors: 4.9. House: 8.7 |
| Per-cycle presidential polling miss (mean over states, D+) | −1.4, +1.4, +1.0, −1.3, +2.2, +4.1, +2.5, +4.1 |

**Reliability:**

| Forecast Democratic chance | 10–20% | 20–30% | 30–40% | 40–50% | 50–60% | 60–70% | 70–80% | 80–90% |
|---|---|---|---|---|---|---|---|---|
| Races | 133 | 97 | 81 | 48 | 66 | 74 | 81 | 135 |
| Democrats won | 9.8% | 26.8% | 23.5% | 47.9% | 50.0% | 75.7% | 87.7% | 94.1% |

**What this says, honestly:**
- Presidential and statewide forecasts are well calibrated.
- House forecasts are slightly **under**confident in the middle bins: favourites win a little more often than
  forecast. Yet their 80% intervals cover only 72%. Both come from heavy-tailed House errors: most districts land
  close to the forecast, and a few miss by 20+ points. Those big misses are usually races where candidate
  quality, which the forecast cannot see, dominates.
- With 8 cycles the national misses still lean Democratic on average (+1.6). That is one standard error of about
  0.8, so it is not yet clear evidence of bias.

**How the forecast was tuned.**
- The first full-engine run gave well-calibrated probabilities but intervals covering only about 70% of
  presidential states.
- The national component matched (observed per-cycle RMS 2.6 points against 2.45 assumed); the state level did not.
- The state-level terms were widened: the presidential prior SD from 4 to 5, the polls' systematic error from 2 to
  3 points (5 for House polls), and the regional SD from 1.5 to 2.

### 5.2 One real-geography cycle (seed P5-REAL-1)

| | |
|---|---|
| Polls published | 1,552. Forecast runs: 106. Debates: 3 presidential, 12 nomination, 44 statewide. Events: 72 scandals, 46 gaffes. Endorsements: 151 |
| Nominations | Both nominees on the first ballot |
| Final national average vs result | Final average and forecast: R+1.8 (forecast SD 2.5). Result: **R+3.8**. A 2-point polling miss |
| Final forecast vs result, by office | Presidential states: RMSE **3.4**, mean −1.1. Senate: 5.6. Governors: 3.7. House: 8.3, mean −2.2. Brier score: 0.035 over 334 races |
| Polls of the final week | Spread around the average of about ±4 points (sampling error at n ≈ 1,000–2,000 plus house effects) |

### 5.3 Speed

| Measurement | Value | Phase 4 |
|---|---|---|
| Jan 1 → the 2016 general's ballot lock, Chromium (**Next election** through every primary day) | **76.5–78.1 s** (three runs) | 28.6–31.3 s |
| Jan 1 → Election Day by **+1 month**, Chromium (the acceptance run) | 76.0–86.8 s (four runs) | — |
| The whole of 2016 (**+1 year**), Chromium | 72.4–78.0 s (two runs) | — |
| The final **Next election** step (mid-September → the ballot lock), Chromium | **17.8 s**: campaigns, polls and forecasts for the days in between 5.8 s; then Election Day itself as in Phase 4 (voters 1.3 s, counting 5.4 s, night record 3.0 s, archive 1.5 s) | 13.1–13.7 s |
| Jan 1 → Dec 1, Node, real geography (includes the election night and canvass) | **44.0 s**. Season work: poll fieldwork 6.0 s (1,552 polls), forecasts 4.0 s (106 runs: inputs 1.6 s, simulation 1.9 s), voter-type caches 3.8 s (once a year), races 1.0 s, campaigns 0.8 s, averages 0.2 s | — |
| Broadcast playback at 600×, magic-wall flight, map recolour | Unchanged: median 16.7 ms a frame (60 fps); 84 frames in 1.4 s; recolour p95 0.5 ms | Same |
| Universe creation, Chromium | 4.4 s | — |

**Honestly:**
- **This is over budget.** The architecture's budgets (§11.1) are ≤ 40 s for a year with a general election and
  ≤ 1.5 s for a month, on the slower reference Chromebook. This server already takes 72–78 s for the year and
  about 6–7 s for a campaign month.
- A simulated election year now takes about **2.5× as long in the browser** as in Phase 4: 1,500+ polls,
  daily forecasts from August, and every candidate's campaign each day.
- On a Chromebook (1.5–3× slower than this server) expect roughly **2–4 minutes from January 1 to Election Day**.
- Two optimizations were made in this phase and checked to change no result (every simulation table
  byte-identical):
  - summed voter types cached per state;
  - race salience computed once a day.
- Remaining levers, in order of value:
  1. run the forecast in a compute worker alongside the day's fieldwork;
  2. field polls in the compute workers;
  3. build forecast inputs incrementally;
  4. fewer forecast draws before the final 100 days.

  I recommend doing 1–3 at the start of Phase 6, together with the primary nights.
- Nothing during playback got slower.

## 6. Fixes found during Phase 5

1. **General elections were polled before their primaries.**
   - **Symptom:** a Senate race was polled as the Democrat against minor parties while the Republican primary was
     months away. Its average said D+56 and the forecast D+38; the result was R+16.
   - **Fix:** a general race is polled only once every feeding primary and runoff has a nominee. Until then it is
     forecast as contested from fundamentals, counting an incumbent who is running in an unheld primary.
2. **Polls leaned Democratic by design.**
   - **Cause:** imperfect likely-voter screens always mixed in registered voters, who lean Democratic in most
     universes, and registered-voter polls entered the average unadjusted.
   - **Effect:** the national average missed by about 4 points in the same direction.
   - **Fix:** screen errors now lean either way, and the average applies an RV→LV adjustment estimated from
     published polls.
3. **Pollster biases were too wide** for the real electorate: one pollster sat 9 points off its peers, with a
   final-week poll 20 points off. Biases were narrowed to realistic spreads (§4), and sample sizes and design
   effects brought to typical national-poll values.
4. **Opinion moved too fast:** about 0.9 points of margin a day. It now moves about 0.3 points a day.
5. **Caches leaked between universes.** Decoded forecast runs and election-night context were cached by ids that
   repeat across universes, so opening a second universe in the same session could show the first one's data.
   They are now kept per universe. The full-engine calibration found this.
6. **Forecast vs result waited for certification.** A race now counts once its night's vote feed has ended,
   when the whole count is public.
7. **The night E2E's visual baseline was refreshed.** The same seed now produces a different 2016 (the new
   primaries chose a different Republican nominee), so the stored 6 am broadcast showed another result. The
   rendering itself was unchanged; the replay-determinism check passes against the new baseline.
8. Smaller fixes:
   - a type-only import cycle between the engine and its season modules (the layering rule now ignores type-only
     cycles, which disappear at compile time);
   - the Polls icon did not render on some fonts;
   - a candidate who withdrew stays readable in older polls;
   - the time bar now shows **Campaigns, polls and forecasts** while the daily season runs, instead of the last
     step's label.

## 7. Known limitations (Phase 5)

1. **Primary election nights are not counted live.** Primaries and caucuses are still decided at the close of
   voting, with results, delegates and news, but no broadcast night. The Phase 3–4 night pipeline is built for
   two-party general elections: same-party multi-candidate desk calls, delegate projections and primary-night
   commentary are needed. I recommend doing this as the first item of Phase 6; tell me if you prefer otherwise.
2. **Primary polls approximate the primary electorate** from the general electorate's types (party participation
   by partisanship and the state's primary rules, plus an intensity factor). The primaries themselves are realized
   by the full kernel, so primary polls can be off in ways a real primary electorate would not explain.
3. **The economy is a stub.** The forecast's fundamentals use the midterm and third-term penalties only, and the
   national estimate leans mostly on polls. The economy arrives with Phase 6.
4. **The first cycle's lean index** is a public index (the true expected lean plus regional, state and district
   error). From 2020 it is the previous presidential result in the archive.
5. **House forecasts** have heavy-tailed errors (§5.1).
   - The forecast knows incumbency and cash, but not candidate quality (prior offices held).
   - There are no district-level fundamentals beyond the lean index.
6. **Maine and Nebraska** are forecast statewide; their district electoral votes are not yet forecast separately.
7. **1,500 forecast draws** (not 20,000) keep each run at about 2.5 s on the real geography. Probabilities move
   by about ±1 point between runs from simulation noise alone.
8. **Debates** are held for the presidential nomination and general, and for statewide general races. There
   are none for congressional or gubernatorial primaries.
9. **Template counts** for campaign news are small (a few per event type).
10. **No progressive per-mode ballot lock.** Early and mail ballots still follow the Election Day environment
    rather than the days on which they were cast.
11. **Speed is over budget** for simulated years with a campaign (§5.3).
12. **Next election 🗳 stops on every primary day**: several dozen stops between January and November in a
    presidential year. **+1 month** is quicker for getting through the spring.

## 8. Changelog

- **Engine 0.5.0, schema 4:** daily environment dynamics; the campaign season (campaigns, debates, events, endorsements,
  finance); fictional pollsters fielding polls through the measurement port; Kalman averages with house effects
  and the likely-voter adjustment; Monte Carlo forecasts with history; the 2016 nominating calendar, delegates,
  superdelegates, withdrawals and conventions; forecast-based desk priors.
- **New modules:**
  - `campaigns/model`;
  - `polling/pollsters`, `polling/average`;
  - `forecasting/model`;
  - `primaries/delegates`;
  - `rules/primaries2016`;
  - `engine/season`, `engine/nomination`, `engine/seasonQueries`;
  - `ui/components/charts`;
  - `ui/screens/Polls`, `ui/screens/Primaries`.
- **Kernel:** step 1 (voter types) is shared with the measurement port. `kernelContest` takes campaign valence.
  Caucus turnout comes from each contest group's own offset.
- **UI:** the % Polls and ⚑ Primaries rail entries and their routes (`#/polls/<year>/<tab>/<arg>`,
  `#/primaries/<year>`); the Desk season card.
- **Tests:** delegate math; poll design and pollster spread; average coverage; the forecast engine; the opt-in
  full-engine calibration; the Phase 5 acceptance E2E; updated night and cycle tests.
- **Docs:** this report; architecture 03 (campaigns and nominations as built), 04 (dynamics, polling, averages and
  forecasts as built), 08 (forecast priors; primary nights deferred), 09 (the new screens) and 10 (status).

## 9. Next: Phase 6 — Political evolution (awaiting your approval)

From the [roadmap](architecture/10-roadmap.md):
- careers (retirements, ambition, ladders), appointments, resignations, deaths and special elections;
- approval from the electorate, event chains and the full economy;
- Congress (bills, roll calls, vetoes) and state government activity;
- demographic evolution (aging, migration, growth);
- the census, Huntington–Hill apportionment and baseline algorithmic redistricting;
- state legislative general elections.

The acceptance run is 2016 → 2040. That makes simulation speed matter more, so I propose to begin Phase 6
with two items carried over from Phase 5:
- the season's performance levers (§5.3);
- the deferred primary election nights (§7, item 1).
