# Phase 7.3 Report — Ballot Measures

**Status:** implemented, awaiting approval.
**Engine version:** 0.7.3 · **Schema version:** 9 · **Night record:** version 2 (unchanged) · **Geography pack:** 2016.1 (unchanged)

Phase 7.3 is the third of eight Phase 7 sub-phases ([roadmap](architecture/10-roadmap.md#phase-7-complete-electoral-coverage)).
It puts statewide ballot measures on every state's ballot, under each state's law of January 1, 2016:
- citizen initiatives (statutes and constitutional amendments);
- veto referendums;
- constitutional amendments and statutes referred by the legislature;
- bond issues.

As agreed:
- **Only election-law measures change the simulation.** Ranked-choice voting, top-four and top-two primaries,
  open primaries, and the repeal of ranked-choice voting become dated law changes, like the legislatures' reforms
  of 7.1. Every other measure is decided, archived and recorded as enacted, but changes nothing else.
- **The top two measures of each state's ballot are polled** and called on the broadcast night.
- **In-universe measures from the start.** No real measure is imported, not even 2016's. Each universe writes its
  own from generic topics, so Maine's real 2016 ranked-choice question is not on its ballot.

In the 2016 election on the real geography (seed SPEED-1):
- **122 measures in 36 states:** 61 citizen initiatives, 45 referred by legislatures, 15 bonds and one veto
  referendum. California had the most (16), then South Dakota (8).
- **77 passed (63%):** 44% of initiatives, 83% of referrals. Real ballots pass roughly 60–65% of measures:
  about 40% of initiatives and 75–85% of referrals.
- **The thresholds bite:** Florida Amendment 4 got 59.5% yes and failed under the 60% rule.
- **The voters changed their election law:** California's Proposition 60 passed with 55.1%, replacing the
  top-two primary with a top-four primary and ranked-choice general elections from January 1, 2017.
  Two Colorado initiatives, for ranked-choice voting and a top-two primary, failed.
- **On election night,** the desk called all 62 polled measures correctly (the top two, or the only one, in
  each of the 36 states), with no call reversed.

## 1. What you can do now

1. **See every measure.** **Government → Ballot measures** lists a year's measures, or one state's measures over
   the years. Each row has its name ("Proposition 51", "I-182", "Question 3"), kind, yes share and result. ★ marks
   measures that were polled and called on election night; ⚖ marks those that change election law.
   **Results → [year] → Ballot measures** opens the same list.
2. **Open a measure.** Its page shows:
   - the title and what a yes vote does;
   - the kind of measure and who put it on the ballot (a petition, with about how many signatures, or the
     legislature);
   - the vote it needs;
   - the parties' positions, when they take sides;
   - Yes and No by county, and a link to analyse the night for a polled measure;
   - Passed or Failed, and for an election-law measure the change and the date it takes effect, with a link to
     **Government → Election law**.
3. **Watch the polls.** **Polls** lists the polled measures (kind *Ballot measure*) next to the other races, with
   Yes and No averages.
4. **Watch them on election night.** The polled measures are counted and called with the rest of the night.
   - The ticker and the latest projections say "MNN projects Florida Amendment 2 passes" or "… fails".
   - Pick **Ballot measures** from the office menu to see only them.
   - The desk calls the result by the state's rule: a Florida amendment with 57% yes is called as failing.
5. **See them in the histories.** State and district history pages, and the Results Explorer (stage
   **General**), include measures. The results lists show "Passed" or "Failed".
6. **See voters change their election law.** When an election-law initiative passes, the state's law changes on
   the next January 1. The change appears under **Government → Election law** with the source *initiative*. The
   following elections use it, exactly as if the legislature had passed it.

## 2. Using it on a Chromebook

1. Open **https://timovk.github.io/UsElec26/** once `main` is updated. Until then the live site runs 7.2.
2. **Existing universes open and keep running.** A universe saved before 7.3 gains one ballot-measure office per
   state when it opens. Measures are filed with each state's candidates, so they appear from the next filing
   deadline; elections already held are not changed. The engine ledger records the switch to engine 0.7.3.
3. Open **Government → Ballot measures**, or **Results → 2016 → Ballot measures** after the election.
4. **Speed:** a simulated year is about 9% slower than in 7.2, nearly all of it on Election Day (§5).

## 3. What was built

| Part | Where | What it does |
|---|---|---|
| 2016 law | `src/rules/measures2016.ts` | For every state and DC: which kinds of measures it allows (24 initiative states, 23 with veto referendums; Delaware refers nothing to the voters), the signatures needed, the vote needed, how measures are numbered (continuing series such as California's propositions, Washington's initiatives and Colorado's amendments and propositions start from their real 2016 numbers), and how many measures a ballot usually carries. |
| The vote needed | `src/rules/measures2016.ts` | A simple majority, or: Florida 60%; New Hampshire two-thirds; Minnesota, Tennessee, Hawaii and Wyoming a majority of every ballot cast in the election; Massachusetts, Nebraska and Mississippi a majority with yes votes at least 30%, 35% or 40% of the ballots; Illinois 60% of the votes on the question or a majority of the ballots. |
| Topics | `src/rules/measures2016.ts` | 39 generic topics: economic (minimum wage, taxes, bonds, labour law), social (marijuana, guns, abortion, sentencing), institutional (redistricting, term limits, ethics, housekeeping amendments) and five election-law topics. Each is a direction in the electorate's issue space, with a prominence, how readily the parties take sides, a baseline lean and the kinds of measure that carry it. The directions read the issue axes the same way as Congress's bills. One-time reforms (recreational and medical marijuana, Medicaid expansion, death-penalty repeal, a redistricting commission, term limits and others) list the states that already had them on January 1, 2016, and are never proposed there. |
| Measure generation | `src/engine/measures.ts` | At each state's filing deadline, a deterministic draw for the seed, year and state decides how many measures of each kind its ballot carries. Topics are drawn from those the state's law allows. A one-time reform that passed is not proposed again; other topics can return eight years after passing. Election-law topics come up more after "spoiler" races, as in the legislatures' reform sessions. Each measure is positioned between the state's voters and the nation's, because the same texts run in many states. Referrals sit near the centre, initiatives further out. Parties take sides where their platforms differ along the topic. Odd-year measure elections are held in the states that hold them (Texas, Louisiana, Washington, Maine, Colorado, Ohio, New York, New Jersey and Pennsylvania). |
| Schema 9 | `src/persistence/schema.ts`, `src/institutions/model.ts` | `ballot_measure`: name, title, summary, kind, topic, sponsor, threshold, parameters, party positions, election-law effect, polled, outcome and the law enacted. A measure is a contest of kind `measure` under the state's holderless ballot-measure office. Its options Yes and No are candidacies with person and party −1 and −2, so the count, archive, maps and queries handle them like any contest. |
| The vote | `src/engine/electionModel.ts` | Each voter class votes on the issue: its position along the topic past the measure's cut point (weighted by prominence), the topic's lean, the party cue and a pull toward the status quo (No). More voters skip low-profile questions. |
| Decisions | `src/engine/measures.ts`, `src/engine/elections.ts` | At certification, by the state's rule. A passed election-law measure enacts a law change (source `initiative`) effective the next January 1. |
| Polls and the night | `src/engine/season.ts`, `src/engine/elections.ts`, `src/projections/observer.ts` | The two most prominent measures of each ballot are polled like races. On the night, the desk calls them by the rule's weights over yes, no and blank ballots, not by who leads. |
| Commentary | `src/engine/nightStory.ts`, `src/broadcast/story.ts` | Projections and ticker lines say "passes" or "fails". |
| Queries and UI | `src/engine/archiveQueries.ts`, `src/engine/protocol.ts`, `src/ui/screens/Government.tsx`, `ContestScreen.tsx`, `Results.tsx`, `ResultsExplorer.tsx`, `ElectionNight.tsx`, `DistrictScreen.tsx`, `CountyScreen.tsx`, `Polls.tsx` | The measures list, measure pages, Yes (green) and No (red) colours, filters and histories. |
| Speed | `src/electorate/kernel.ts`, `src/projections/observer.ts` | Growable buffers and shared option probabilities in the ballot kernel; memoized wire estimates on the night. These recover about 40% of the time the measures first added, without changing any result. |

## 4. Test results

### 4.1 Suites

| Check | Result |
|---|---|
| Typecheck, ESLint and module boundaries (`npm run lint`) | pass: no dependency violations (136 modules, 614 dependencies) |
| Unit, property and real-data tests (`npx vitest run`) | **138 passed**, 12 skipped (opt-in long runs), 220 s; 5 new tests, the old-save test extended |
| End-to-end, Chromium (`npx playwright test`), this server | **4/4 passed** in 6.8 min |

### 4.2 New and updated tests

**The law** (`tests/unit/engine/measures.test.ts`):
- **Coverage:**
  - every state and DC has rules;
  - 24 states allow initiatives and 23 veto referendums, and Delaware refers nothing to the voters;
  - Florida, New Hampshire, Minnesota and Massachusetts have their thresholds, California a simple majority.
- **Decisions:** each kind of rule is decided correctly at its edges:
  - Florida: 59% fails, 60% passes;
  - Minnesota: blank ballots count against;
  - Nebraska: a majority below its 35% floor fails;
  - Illinois: passes either way.

  The night-call weights agree with the decision rule on random vote counts.
- **Activity:**
  - over 20 simulated cycles, even years average 90–160 measures and odd years 12–45;
  - odd-year measures occur only in states that hold them;
  - no initiatives in states without them;
  - the same seed gives the same draw.
- **Election law:** each election-law topic makes the right change for the state's current law. A top-two state
  that adopts ranked-choice voting gets a top-four primary, and a repeal restores the primary system it replaced.

**A fixture universe, January 2016 to January 2018:**
- **Filing:** more than 60 measures in 2016 and some in odd-year 2017. Each is a certified contest under its
  state's ballot-measure office, with the options Yes and No.
- **Decisions:** every outcome matches its threshold. Referrals pass more often than initiatives, and initiatives
  pass between 10% and 70% of the time.
- **Polls:** at most two measures are polled per state and election, and only polled measures have polls.
- **Election night:** more than ten measures are on the broadcast night, all of them polled. The desk's calls
  match the certified outcome at least 90% of the time, thresholds included.
- **Election law:** every passed election-law measure enacted a law change with source `initiative`, effective the
  next January 1.
- **Names:** each follows its state's series (Colorado's and Missouri's initiated statutes are Propositions,
  Montana's I- beside CI- and LR-), and no name repeats.
- **One-time reforms:** none is proposed in a state that already had it in 2016.
- **Queries and integrity:** the measure page and the measures list return them, and the database integrity
  checks pass.

**Older universe** (`tests/unit/engine/compat.test.ts`): the Phase 1 save now also gains 51 ballot-measure
offices when it opens, and certifies its 2016 measures.

**Browser** (`tests/e2e/elections.spec.ts`): after the 2016 election, the test opens **Government → Ballot
measures** and a measure's page.

**Updated:**
- **Archive audit:** measures that are not polled are, like legislative seats, not expected on the night feed.
- **The 6 am broadcast reference image:** regenerated, because the night now includes the measures.

### 4.3 The 2016 measures on the real geography

From a Node run of January 2016 to February 2017 (seed SPEED-1):

| | |
|---|---|
| Measures | 122 in 36 states: 44 initiated statutes, 17 initiated amendments, 43 legislative amendments, 2 legislative statutes, 15 bonds, 1 veto referendum |
| Passed | initiated statutes 52%, initiated amendments 24%, legislative amendments 84%, bonds 80%, both legislative statutes; the veto referendum failed, so the law was overturned |
| Yes share | initiatives 36–66% (median 49%), referrals 37–87% (median 61%) |
| Close (45–55% yes) | 46 of 122 |
| Votes on the question, as a share of ballots | median 94.6%, lowest 91.4% |
| Party positions | 45 measures, the parties on opposite sides |
| Rules other than a simple majority | 9 measures, in Florida, Illinois, Massachusetts, Nebraska and Wyoming |
| Polls | 62 measures polled; 55 of them have at least one poll (166 polls in all) |
| Election night | 62 of the 691 races on the broadcast night; all called correctly, none reversed |
| Election law | 3 election-law initiatives; one passed (California's top-four primary) |

For comparison, real ballots pass roughly 40% of initiatives and 75–85% of referrals. In November 2016 they carried
about 155 statewide measures in 35 states.

## 5. Measurements

Node figures are from the same machine, run back to back. The 7.2 code was checked out and run again for this
comparison, so they differ from the 7.2 report, which was measured on another machine. Chromium timings on this
server vary by up to 10% between runs, so the 7.2 column there is the 7.2 report's.

| Measurement | 7.2 | 7.3 |
|---|---|---|
| Node, real geography, January 1 → December 1, 2016 | 54.9 s | 59.8 s (+9%) |
| of which November (Election Day) | 29.0 s | 33.5 s |
| Counting ballots, all year (the kernel and the night) | 26.1 s | 29.4 s |
| Campaigns, polls and forecasts, all year | 14.2 s | 14.9 s |
| Writing the archive and the night record, all year | 5.6 s | 6.3 s |
| Chromium: January 1 → November 8, 2016 (season test) | 53.3 s and 48.6 s | 47.0 s (56.7 s in an earlier run) |
| Chromium: to the 2016 ballot lock (elections test) | 61.3 s | 54.5 s (60.6 s earlier) |
| Chromium: the Election Day step | 22.0 s | 20.0 s (21.0 s earlier) |
| Chromium: universe creation | 6.0 s | 4.9 s |
| Chromium: 2016 archive audit | 136.8 s | 145.4 s |
| Broadcast playback frames (median, p95) | 16.7, 16.8 ms | 16.7, 16.7 ms |
| Database size, real geography, February 1, 2017 | 61.0 MB | 66.5 MB (+5.5 MB, +9%) |

**Where the time goes.** 122 more contests are on 2016's ballots, and 62 more races (691 in all) on the
broadcast night. The added cost is in counting (+3.4 s), polling (+0.7 s) and archiving (+0.7 s). Before
optimization the measures added 13%. The kernel and observer changes in §3 cut that to 9%, without changing any
result.

**2016 differs from 7.2 for the same seed.** The measures change the draws on Election Day and in the polls. The
season test's final forecast is 46% / 53% (263 EV), against 61% / 289 EV in 7.2. The Brier score is 0.051,
against 0.043. It is still deterministic: the same seed and version give the same universe.

## 6. Fixes and decisions

- **Party sides were reversed** relative to Congress. Congress's bills treat a positive economic position as
  public investment and wages ("Wage Fairness Act"); the measure topics had it the other way round on all three
  axes. So the party that sponsors wage bills in Congress opposed minimum-wage measures. The topics now use
  Congress's convention.
- **Calibration on the real geography.** The first version:
  - passed every one of the 60 referrals and bonds;
  - drew measure positions with so much noise (about 16 points of yes share) that results for the same kind of
    measure did not resemble one another across states.

  Positions are now drawn between the state's and the nation's voters, with less noise and a stronger party cue
  on partisan topics. Pass rates are 44% for initiatives and 83% for referrals.
- **The 2016 status of one-time reforms.** California voted on creating a redistricting commission it already
  had, and legal-marijuana states on legalizing it. One-time topics now carry the states that had them on
  January 1, 2016, and are not proposed again after passing. "Sports betting" was dropped from the casino topic:
  it was legalized nationwide only after the federal ban fell in 2018, a real post-2016 change.
- **Names:**
  - Arizona's initiatives and referrals shared one counter; they now number apart (Propositions 205 and 123 on).
  - Colorado's, Missouri's, South Dakota's and Montana's initiated statutes now have their own series
    (Proposition 106, I-182, Initiated Measure 22).
  - Alabama had "legislatively referred statutes"; only states where statutes can reach the ballot (by
    initiative or veto referendum) have them now.
- **A measure's prominence** could go below zero; it is now kept between 0.03 and 1.
- **The measure page** showed the threshold twice and a "nonpartisan ballot" note; both are fixed, and the vote table is
  headed *Option*.
- **Speed.** The first version added 13% to a simulated year. Profiling found the costs in the ballot kernel
  (more contests per ballot) and in the election-night observer (62 more races). Three changes, with identical
  results checked by fingerprinting every table, brought it down:
  - growable integer buffers for the kernel's per-contest lists;
  - one probability table per contest for every county that is no candidate's home county;
  - wire estimates memoized between ratio updates.
- **Decisions:**
  - **The polled measures** are the two most prominent of each ballot (prominence plus a small random term).
  - **Parties take a side** only when their platforms differ clearly along the measure (a cue of at least 0.25);
    otherwise the ballot shows no party positions.
  - **Votes on measures count** like any contest's: blank ballots are kept, so rules on "every ballot cast" can be
    applied.

## 7. Known limitations

- **Generic topics.** The 39 topics have fictional particulars ("Raise the state minimum wage in steps over four
  years"). 17 topics are one-time reforms, 13 of them with the states that had them in 2016. Others, such as
  voter ID, a 20-week abortion limit or right-to-work, can be proposed where the state already has a statute;
  a constitutional amendment on the same subject is plausible there. No campaign spending, endorsements beyond the
  parties' sides, or late swings are modelled. Support comes from where the voters stand, the topic's lean, the
  pull of the status quo and the party cue.
- **Party sides are the universe's own.** A party backs a measure when its platform lies in the measure's direction,
  so in a universe whose Democrats are socially conservative (as in seed SPEED-1), they back an abortion limit.
  Coalitions span several issues, so a one-issue measure often splits them, and a measure a party backs can fail
  in a state that party carries easily. Real ballots show the same: minimum-wage increases pass in states that
  vote Republican.
- **Yes shares are less spread than in reality:** initiatives got 36–66% yes on the real geography in 2016,
  referrals 37–87%. Real measures range from about 20% to 85%, and lopsided results are commoner.
- **Only election law changes the simulation.** As agreed, a passed minimum wage, tax or marijuana measure is
  recorded as enacted but does not affect the economy, the issues or later campaigns.
- **Election-law topics are rare by design.** About three come up per even year across the country, so a passed
  one is an event: one passed on the real geography in 2016 (California's top-four primary).
- **Not modelled:**
  - Nevada's rule that an initiated amendment must pass twice;
  - indirect initiatives (Maine, Massachusetts, Michigan, Mississippi, Nevada, Ohio and others), which go to the
    legislature first;
  - competing measures on the same topic, and California's rule that the measure with more yes votes wins;
  - signature drives that fail to qualify;
  - local measures (with county and city offices in 7.6 and 7.7);
  - recall elections.
- **Most measures are not on the broadcast night.** Only the top two of each ballot are polled and called on the
  night. The rest are counted and certified, and are in Results.
- **Retention votes are still off the night.** They could join it using the yes/no calls built here; that is not
  done in this phase.
- **Rules combining a majority with a ballot floor** (Massachusetts, Nebraska, Mississippi) are called on election
  night on the majority alone. The floor is applied exactly at certification. A measure could in principle be
  called as passing and then fail its floor; no such case occurred in testing.
- **Roll-off is narrower than in reality:** 5–9% of voters skip a measure; real roll-off runs from about 3% to
  15% or more on obscure amendments.
- **Speed and storage:** about 9% more time per simulated year and 9% more storage than 7.2.
- **Carried over:** North Carolina's primary runoff threshold, which I flagged earlier, is unchanged in the data
  (§10).

## 8. Changelog

- `4f48968` Phase 7.3: ballot measures (2016 law, topics, generation, schema 9, voting, decisions, polls, election
  night, election-law changes by initiative, queries, UI, tests); engine 0.7.3.
- `b9528d9` Faster Election Day (kernel buffers and shared probabilities, memoized wire estimates; identical
  results). Measure numbering fixed for states with separate initiative and referral series (Arizona).
  Legislatively referred statutes only where statutes can reach the ballot. Measure page fixes. The browser test
  covers the measures. The 6 am broadcast image was refreshed.
- This commit:
  - topic directions aligned with Congress's;
  - positions between state and nation, a stronger party cue and calibrated pass rates;
  - the 2016 status of one-time reforms, which are not proposed again after passing;
  - statute numbering series;
  - a measure's prominence kept between 0.03 and 1;
  - tests: names and one-time reforms (fixture), measures in the old-save test; the 6 am broadcast image
    refreshed again;
  - docs: architecture 03, 05, 06 and 10, README;
  - this report.

## 9. Next: Phase 7.4 — Multi-member and floterial districts (awaiting your approval)

- **Real seat counts** for each legislative district: Arizona's, New Jersey's and Washington's two-member house
  districts, West Virginia's, Vermont's and New Hampshire's multi-member districts, and so on.
- **"Vote for N" ballots** in the kernel, with the top N elected. Michigan's boards, which elect two seats every
  even year, and Arizona's Corporation Commission move onto them as well.
- **New Hampshire's floterial districts**, which overlap the ordinary ones.

The estimate is 3–5 hours.

## 10. Open question from earlier

As noted earlier, the 2016 data gives North Carolina's primary runoff threshold as 30%. On January 1, 2016 it
was 40%; the 30% rule dates from 2017. The data therefore imports a post-2016 change. The fix is one line. I
have not made it, because it changes primary outcomes and is outside 7.3. Say if you want it, alone or with
7.4.
