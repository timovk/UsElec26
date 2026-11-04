# Phase 3 Report — Election-Night Counting

**Status:** implemented and tested; awaiting your approval before Phase 4.
**Engine version:** 0.3.0 · **Schema version:** 3 · **Geography pack:** 2016.1 (unchanged)

## 1. What you can do now

1. **Election Day starts at the ballot lock.** **Next election 🗳** now stops at 6:00 am ET on the morning of a general election, special or general runoff. At that moment:
   - every ballot is realized and sealed as the *cast* record (revision 0);
   - the entire count is computed and sealed once as the **night record**: every batch of votes with its time, the wire's expected vote, and every decision-desk status and projection, through the end of counting weeks later.

   The Desk shows a ★ **Watch Election Night** card.
2. **Watch the night.** Open **Election Night**: it shows the latest counted election, and the picker next to the title (or **★ night** links in Results, and **★ Watch this election night** on contest pages) opens any earlier one. Click **Start coverage at 5:00 pm ET**, then **▶ Play** at 1× to 600× (60× is one simulated minute per second). On screen:
   - a national map filling in: solid = projected, pale = leading, dark = polls open;
   - electoral-vote, Senate and House bars, with the 270 and majority lines and the seats not up;
   - a race list filtered by office and status, and a focused race board;
   - an **On the desk** log of poll closings and projections.

   The race board shows candidates, votes, shares, the lead, "≈ x% of expected vote counted", "y of z precincts reporting", and every county or town reporting.
3. **The night is live and the universe follows it.** Playing at the live edge advances the universe clock with you, so the Desk, Results and Map show exactly what has been counted so far.
   - **Going back:** rewinding is a replay of the same sealed record.
   - **Going forward:** skipping ahead (Next poll closing, Next projection, 6 am, or a click on the timeline) asks first, because it advances the universe.
   - **Skipping the night:** you can just advance; the night stays watchable as a replay.
4. **Counting continues after the night.**
   - Late mail, cured and provisional ballots are counted over days and weeks, according to each state's rules (California and Washington take weeks).
   - Desks keep projecting races, and the news reports each day's projections and a "morning after" summary.
5. **Certification decides.** Each state certifies on its own 2016 timetable. Its results get three revisions:
   - revision 1 — the *unofficial* count;
   - revision 2 — the *canvass*, with provisional ballots adjudicated;
   - revision 3 — the *certified* result.

   Only certification decides winners and schedules runoffs (Georgia, Louisiana) and the assumption of office. Electors vote on the certified results.
6. **Results during the count.**
   - Results, contest pages and **Map → Election results** show the *unofficial count so far*, plus the desk's projection. No view reveals the sealed cast ballots; a person's electoral history shows a race's votes once it is certified.
   - Contest pages show "Counting · unofficial", the expected vote counted and the precincts reporting, with a link to watch the night.
   - After certification they show the certified revision and its revision history.

## 2. Using it on a Chromebook

1. Phase 3 is on the development branch. GitHub Pages serves `main`, which still has Phase 2. Tell me when to update it; the installed app will then offer *Reload to update*.
2. **Existing universes keep working** (schema 3 migration). The next general election in an older universe is counted the new way. Elections already held stay as archived in Phase 2.
3. **Watching a night:**
   - press **Next election 🗳** until the toast says *Polls open: 2016 general election*;
   - click **★ Election Night**, then **Start coverage at 5:00 pm ET**, then **▶ Play**;
   - choose 600× to see the night in about two minutes, or 60× for about 13 minutes from 5 pm to 6 am. **6 am ⇥** jumps to the morning after.
4. **Performance on your device.** Holding the general election (the ballot lock) took about 14 s on this server, and a full **+1 year** took 38 s. A Chromebook will be slower; please tell me how long the Election Day step and **+1 year** take on yours (§7).

## 3. What was built

| Area | Delivered |
|---|---|
| Counting rules (`src/rules/counting2016.ts`) | For each state, 2016 baseline:<br>• poll closing in local time, with zone overrides (Tennessee);<br>• mail pre-processing;<br>• late-postmark windows and shares;<br>• share of mail received on Election Day;<br>• post-night pace;<br>• canvass and certification days;<br>• automatic-recount thresholds;<br>• mail and provisional rejection rates.<br>Split-county time zones (Aleutians West, Gulf FL, Idaho County and others) by an approximate coordinate rule. 2016 mode usage (early in person, mail, provisional) by state. |
| Synthetic precincts (`src/counting/precincts.ts`) | Reporting jurisdiction × district *parts*, then precincts of whole Base Units inside each part, calibrated to the 2010 voting-district counts (Kentucky and Rhode Island are estimated at about 1,800 people per precinct). A precinct never crosses a district line, so "precincts reporting" is exact. 159,437 precincts nationally in 5,304 parts. |
| Count plan (`src/counting/countPlan.ts`) | **Step 1, schedule (sees ballot counts only, never votes):**<br>• each jurisdiction has a persistent administrative profile: speed, cadence, dump-style reporting, mail capacity, glitch propensity;<br>• Election Day precincts complete after closing (plus voters-in-line tails) and are pushed at the cadence;<br>• early votes and pre-processed mail are released shortly after closing;<br>• other mail is processed in sessions (night until 3 am, then 9 am–6 pm daily), ordered so that areas with younger voters return later;<br>• late-postmark mail arrives over the following days;<br>• provisional ballots are adjudicated at the canvass;<br>• rejected ballots are never counted;<br>• rare glitches publish a batch short and correct it later.<br>**Step 2, partition:** every (unit, mode) cell's votes are split across its chunks by multivariate hypergeometric sampling (a new exact, deterministic sampler), so the batches partition the counted ballots exactly. |
| Measurement (`src/electorate/measure.ts`) | The only door from the electorate to observers:<br>• the desks' published pre-election baseline (the model expectation plus state, mode, race and local error);<br>• the voter survey: a sample of the realized electorate with nonresponse bias correlated nationally;<br>• the wire's turnout priors. |
| Wire and decision desk (`src/projections/`) | **The wire's expected vote per part and mode:** known early-vote and mail returns; Election Day estimated from precincts reporting with a shrunk ratio estimator; outstanding mail learned the next day; late mail and provisional ballots with uncertainty.<br>**The desk** follows §4.13 with a contest swing, mode-specific swings, local deviations, a systematic within-mode drift (late ballots differ from early ones) and precinct-aware Election-Day drift. P(lead holds) uses a Student-t (ν = 6) tail.<br>**Status rules from §8.5:**<br>• poll-close calls, too early, too close and projections;<br>• runoff projections for majority-rule contests;<br>• evidence rules: ≥ 25% of expected vote counted, and ≥ 20% counted in every mode that makes up ≥ 15% of the vote;<br>• a stress test and the recount-band test;<br>• human-review latency (3–10 min);<br>• withdrawals only after doubt persists for 30 minutes.<br>**Control projections:** President at 270, and Senate and House majorities counting the seats not up and the Vice President's tiebreak. |
| Night record (`src/counting/record.ts`) | Every state's count merged in time order. Columns are stored with the ENA1 varint codec; the record is sealed with SHA-256. About 67,000 batches and 280,000 race rows in 1.66 MB for a presidential general. |
| Playback (`src/broadcast/playback.ts`, `src/workers/broadcast.worker.ts`) | State at any time is a pure function of the record (checkpoints every 1,000 batches plus binary search). The Broadcast Worker sends only the races that changed. |
| Engine flow | Generals, specials and general runoffs are held at the lock (06:00 ET). A special on the general-election day shares the same ballots and night. Rev 0 cast plus the rejected-ballot blob, the sealed night, scheduled night news, and per-state certification (revs 1–3, derived certified unit grain). The Electoral College and ME/NE district electors use certified results. |
| Archive audit | New checks:<br>• the night record's seal;<br>• Σ night batches = canvass totals;<br>• running totals never exceed the final count;<br>• certified = cast − rejected at every Base Unit;<br>• unofficial ≤ canvass = certified;<br>• certified rollups = Σ units;<br>• seals of every revision (the certified seal chains to the cast seal). |
| UI | **Election Night** screen (functional; the broadcast presentation is Phase 4), Desk card, counting status on contest pages, "Projected" badges, live results map. |
| Found and fixed on the way | A Phase 1 determinism bug: the partisan lean was Float64 in a fresh universe but Float32 after a reload, so margins differed in the last bits after reloading. It is now rounded at creation. Found by the mid-campaign save/reload test. |

## 4. How a night unfolds (why leads change)

Leads and reversals are emergent. The count schedule never sees a vote; a test swaps the candidates and checks that the schedule is identical. Early leads move for three mechanical reasons:

- **Voting modes.** Each universe has its own partisan mode gap. Early and mail ballots can lean one way and Election Day the other.
- **Geography.** Small rural jurisdictions report quickly; large ones report later, in big batches.
- **State law.** Florida, Arizona and North Carolina release early votes and mail first. Pennsylvania, Wisconsin and Michigan count mail on Election Day, and New York days later. California, Washington and Utah keep counting for weeks.

Example: the presidential count on the real geography (seed NR-1, simplified contests), share of the final count by Eastern time:

| State (polls close ET) | 8 pm | 9 pm | 10 pm | 11 pm | midnight | 2 am | 6 am | +4 days | +10 days |
|---|---|---|---|---|---|---|---|---|---|
| Florida (7/8 pm) | 61% | 82% | 92% | 95% | 97% | 98% | 99% | 100% | 100% |
| Georgia (7 pm) | 65% | 82% | 94% | 97% | 98% | 99% | 100% | 100% | 100% |
| Pennsylvania (8 pm) | 0% | 26% | 68% | 85% | 93% | 97% | 99% | 100% | 100% |
| Arizona (9 pm) | – | 0% | 59% | 69% | 78% | 85% | 88% | 92% | 94% |
| California (11 pm) | – | – | – | 0% | 39% | 63% | 75% | 87% | 92% |
| Washington (11 pm) | – | – | – | 0% | 56% | 61% | 65% | 80% | 93% |

## 5. Test results (actual runs, this environment)

| Suite | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | ✅ no errors |
| ESLint | ✅ no problems |
| Module boundaries and information firewall (dependency-cruiser) | ✅ no violations (84 modules) |
| Unit, property and integration tests (Vitest) | ✅ **60 passed**, 4 skipped (the opt-in real-geography benchmarks and the Phase 1 survey) |
| Real-geography 2016 cycle (opt-in, seed S-A) | ✅ passes:<br>• full audit of all 110 elections of 2016 (1,615,534 unit-contest records plus the night record): 0 failures;<br>• the night: 67,428 batches;<br>• 0 wrong or withdrawn projections;<br>• projected by 6 am: President 49 of 51 states, Senate 33 of 34, House 422 of 435;<br>• the presidency was projected at 11:06 pm ET and the House at 12:38 am;<br>• Senate control waited 12 days for the last race. |
| Decision-desk accuracy (opt-in runs) | ✅ see §6 |
| End-to-end in Chromium (Playwright) | ✅ **3 passed**, no console errors in the page or the workers:<br>• the Phase 1 flow;<br>• the 2016 cycle through certification (538 electoral votes, archive audit passes);<br>• the new **watch election night** test: lock, coverage, live playback, projections, the unofficial results page, skip ahead to 6 am, then rewind to a replay |

**New tests:**
- **Hypergeometric sampler:**
  - exact mean and variance in six regimes;
  - the multivariate split partitions exactly (property test).
- **One state's night:**
  - batches partition every race exactly: counted plus rejected = cast;
  - running totals stay within the final count;
  - nothing is reported before its polls close;
  - no desk event before the race's last polls close;
  - **the schedule is identical when the candidates are swapped** (the firewall);
  - deterministic.
- **Full cycle (fixture):**
  - the record's seal verifies;
  - no desk event before polls close, anywhere;
  - the replay's final count equals the certified totals of every contest (more than 500), and two playbacks are identical;
  - the presidency projection;
  - certification;
  - inauguration.
- **Save/reload in mid-campaign:** identical universes, including the night record (this is the test that found the Float32 bug).
- **Inline, 1 worker and 4 workers:** identical universes, including the night.
- **Phase 1 save compatibility:** still passes through schema 3.

## 6. Decision-desk accuracy

Each run simulates whole election nights on the 2016 contests, with the count, the survey, the priors and the realized ballots redrawn every night. A projection is **wrong** when the projected winner is not the leader of the final count; a runoff projection is wrong when someone won outright or the two advancing candidates differ.

| Run | Nights | Races | Projections | At poll closing | Wrong | Withdrawn | Runoff projections (wrong) | Desk events before polls closed |
|---|---|---|---|---|---|---|---|---|
| Real geography (seed DESK-R1) | 30 | 16,770 | 16,586 | 5,185 (31%) | **0** | 0 | 150 (0) | 0 |
| Fixture geography | 250 | 139,750 | 138,164 | 56,550 (41%) | **0** | 119 (0.48 per night) | 1,250 (0) | 0 |

**Wrong calls.** The target was fewer than 1 wrong call per 500 projections. Across 280 nights there were 0 in 154,750 projections, so the 95% upper bound is about 1 per 52,000.

That is better than the target, and it deserves a caveat:
- The desks' priors are a noisy proxy built from the same model that produces the world (limitation 4).
- Real-world wrong calls come from a model being wrong about the world in ways a simulation may not fully reproduce.

When the forecasts and polls of Phase 5 replace the proxy, the rate should be measured again.

**Withdrawals.** They happen on the fixture geography, whose small districts swing sharply, but none happened on the real geography.

**Call timing on the real geography (30 nights):**

| Office | Median minutes after the race's last polls close | 90th percentile | Not projected by 6 am |
|---|---|---|---|
| President (states) | 43 | 110 | 31 of 1,561 (2.0%) |
| President (Maine and Nebraska districts) | 8 | 70 | 0 of 150 |
| U.S. Senate | 8 | 83 | 11 of 1,001 (1.1%) |
| Governor | 8 | 150 | 30 of 360 (8%: about one slow-counting state per night) |
| U.S. House | 49 | 119 | 242 of 13,138 (1.8%) |
| Lt. Governor / Attorney General / Secretary of State | 55 / 42 / 39 | 255 / 76 / 60 | 0 |

These meet the acceptance criterion: some races stay unresolved after midnight, and into the following days, when the uncertainty justifies it.

## 7. Measured performance

| Measurement | Value | Notes |
|---|---|---|
| Election Day at the ballot lock, Chromium, 3 compute workers (4-core server) | **13.7 s** | Shards 1.1 s, kernel + count + observers 5.2 s, tally 0.2 s, seal the cast ballots 3.2 s, night record 1.6 s, write 1.5 s |
| Same, Node, single thread | 17.2 s | Kernel and night jobs 14.4 s |
| Whole 2016 year (+1 year), Chromium | **38 s** | Phase 2: 21 s |
| Jan 1 → the general's ballot lock, Chromium | 30–34 s | All primaries and specials |
| Watching the night | 5 pm → midnight in about 45 s at 600×, live (the universe advances as you watch) | Frames at 10 Hz from the Broadcast Worker |
| Certification of all states, Node | about 4 s in total (spread over weeks of simulated time) | About 1.5 s of that is database commits |
| Night record | 1.66 MB per presidential general | Design estimate 1–1.5 MB |
| Universe database | 18.3 MB at creation → **30.5 MB** after the 2016 cycle | Phase 2: 26.7 MB. Rev 3 is stored as derived from cast minus rejected, not as a second full copy. |
| Archive audit including the night | 3.5 s | Node |

**Honest caveat:** a Chromebook core is roughly 1.5–3× slower than this server, so a year with a general election may take about 55–115 s. That is over the 40 s budget in [11 §11.1](architecture/11-performance.md). The largest remaining levers are:
- sealing and encoding results inside the compute workers (about 2 s of the 3.2 s seal step);
- cheaper primaries (about 16 s of the year);
- fewer desk evaluations on quiet races.

I propose doing the first as the opening task of Phase 4 once I have your Chromebook timings.

## 8. Known limitations (Phase 3)

1. **One network.** Only the flagship desk (MNN, a working name) runs. Networks B and C and the network switcher are Phase 9.
2. **No commentary, alerts or broadcast presentation.** The Election Night screen is the functional view the roadmap calls for. Key Race Alerts, commentary, projection animations, audio and the polished layout are Phase 4. The **On the desk** list shows poll closings and projections.
3. **Voter-survey crosstabs** (age, education, race and so on) are not produced yet. The survey gives toplines for President, Senate and Governor. Crosstabs come with the Analyst dashboard (Phase 4).
4. **Desk priors are a proxy.** The pre-election baseline is the model's expectation plus realistic error (national, state, mode, race and local), standing in for polls and past results until Phase 5 provides forecasts.
5. **Primaries and primary runoffs** are still decided at the close of voting, without a night. Primary nights come with Phase 5.
6. **No recounts yet.** Contests inside an automatic-recount threshold stay *too close to call* on the night and are decided by certification. Revision 4+ (recount) is Phase 9, with legal disputes.
7. **Counting rules, mode usage and certification dates** (`src/rules/counting2016.ts`, `MODE_USAGE_2016`) were compiled from general knowledge of 2016 law and practice, not individually cited. They should be checked against state codes. Split-county time zones use approximate coordinate rules. Arizona's Navajo Nation exception is not needed for November.
8. **Precinct counts** are capped at one precinct per Base Unit. Dense jurisdictions therefore have fewer precincts than their 2010 voting districts: 159,437 nationally, against a target of 176,871 (the 171,489 voting districts of 2010 plus estimates for Kentucky and Rhode Island).
9. **The glitch model** only publishes a batch short and later corrects it upward. Erroneous over-reports, which would push a running total above the final count, are not modelled.
10. **Performance** may exceed the Chromebook budget (§7).

## 9. Changelog

- **Schema 3:** tables `night`, `night_election` and `county_rollup_rev`.
- **Revisions:** rev 0 *cast* plus a *rejected* blob; rev 1 *unofficial*, rev 2 *canvass*, rev 3 *certified*.
- **Engine 0.3.0:**
  - the ballot lock;
  - the count plan, wire, survey and desk in the compute workers;
  - the merged and sealed night record;
  - night news;
  - per-state certification deciding winners;
  - runoff dates counted from the election day;
  - the Electoral College on certified results.
- **New modules:**
  - `counting/` (types, precincts, count plan, record);
  - `projections/` (desk, observer);
  - `broadcast/playback`;
  - `electorate/measure`;
  - `engine/nightJob`, `nightSetup`, `nightQueries`;
  - `workers/broadcast.worker`;
  - `ui/screens/ElectionNight`.
- **Core:** an exact hypergeometric and multivariate hypergeometric sampler.
- **Kernel:** optional per-mode votes and per-part expectations for counted elections. 2016 mode-usage levels by state change mode shares and therefore realized results for a given seed.
- **Queries and UI:**
  - views never reveal sealed cast ballots;
  - the live count during counting;
  - certified revisions afterwards;
  - Election Night screen, Desk card, Projected badges.
- **Fixes:**
  - after the first release: night picker and links from Results and contest pages; chamber control is projected only when at least 10 of the chamber's seats are on the ballot (one-seat specials no longer report "control");
  - lean precision (reload determinism);
  - electoral votes summed by nominee in projections;
  - wording of the projection news.
- **Tests:** sampler, one-state night, desk accuracy, replay and timing checks in the cycle test, and the night E2E.
- **Docs:** this report, plus updates to architecture 07 (revisions as built), 08 (status and deviations), 10 (status) and 11 (measured performance).

## 10. Next: Phase 4 — Broadcast interface (awaiting your approval)

From the [roadmap](architecture/10-roadmap.md):
- the broadcast layout and visual identity;
- national, state and county maps with the "magic wall" zoom;
- the EC counter and Senate and House bars with animations;
- Key Race Alerts and projection banners;
- audio and reduced motion;
- commentary v1 (the story types in §8.6);
- playback controls with event markers;
- Results Explorer v1 and the Analyst dashboard v1, including survey crosstabs;
- map modes: winner, margin, swing, turnout, reporting, outstanding.

The night record from Phase 3 is already everything those features read.
