# Phase 7.1 Report — Election Rules Over Time

**Status:** implemented and tested; awaiting your approval before Phase 7.2.
**Engine version:** 0.7.1 · **Schema version:** 7 · **Night record:** version 2 (unchanged) · **Geography pack:** 2016.1 (unchanged)

Phase 7.1 is the first of eight Phase 7 sub-phases ([roadmap](architecture/10-roadmap.md#phase-7-complete-electoral-coverage)).
It builds the framework that later contests depend on: election law with effective dates, ranked-choice voting
(RCV), top-four primaries and nonpartisan ballots.

**One correction to the plan.** The 7.1 line in the roadmap said "Alaska's top-four from 2022". The architecture
you approved in Phase 0 (§3.4, §6.6) says rules change only through simulated law, starting from the real law of
January 1, 2016. Each universe is its own history, so the real world's later reforms are not imported. 7.1
therefore builds the mechanisms, and states adopt them through their own simulated legislative sessions. Ballot
initiatives, like Maine's real 2016 RCV measure, follow in 7.3. If you would rather some universes follow real
history, a "historical reforms" option is easy to add; see §8.

## 1. What you can do now

1. **See each state's election law.** **Government → Election law** lists how every state elects today:
   - top-two primaries (California, Washington);
   - Louisiana's November all-candidate ballot;
   - Nebraska's nonpartisan legislature;
   - every change enacted in your universe, with the date it takes effect.
2. **Watch laws change.** Each state's December session may:
   - adopt ranked-choice voting, for party primaries and for Congress or for every office but President;
   - repeal it;
   - switch between open, semi-closed and closed primaries.

   A change takes effect the next January 1 and never applies to elections already held. Adoption is rare, but
   much likelier after a "spoiler" race: a winner below 50% while a third candidate took more than the margin.
   It is likelier still when the party that lost such a race controls the state. Each change is in the news.
3. **Ranked-choice elections**, where a state has adopted them:
   - **Ballots are ranked.** Rankings come from the same voters as first choices: each voter type ranks
     candidates by how much it likes them, and may stop ranking.
   - **The count.** If nobody wins a majority of first choices, the last-placed candidate is eliminated and
     their ballots move to each voter's next choice still in the race, or are "exhausted". This repeats until
     someone has a majority of the continuing ballots.
   - **On election night** the count is of first choices, as in Maine. A race without a first-choice majority
     gets a "Ranked-choice count" alert and status instead of a projection. The ranked-choice tabulation is
     published with the state's certification, and the contest page then shows every round.
4. **Top-four primaries.** A state that adopts them puts every candidate on one primary ballot; the top four
   advance to a ranked-choice general (the mechanism Alaska uses in the real world).
5. **Nonpartisan ballots.** No party label appears on the ballot, so voters judge the candidates' ideology
   directly rather than by party. In the 2016 baseline this applies to Nebraska's legislature. Phase 7.2
   (judges) and 7.6–7.7 (county, city and school offices) will use it widely.

## 2. Using it on a Chromebook

1. Open **https://timovk.github.io/UsElec26/** once `main` is updated (the live site is the speed work until then).
2. Existing universes open and keep running.
   - They gain the new rules from now on: Nebraska's legislature on a nonpartisan ballot from its next
     election, and law changes from the next December session.
   - Elections already held are not touched.
   - The universe's engine ledger records the switch to engine 0.7.1.
3. Open **Government → Election law** to see the rules, and tick **Every state** to see them all.
4. RCV contests appear only after a state adopts RCV, which is rare: expect a few adoptions per decade
   nationwide, more after spoiler races. When one happens, open the contest from **Results** after
   certification to see the rounds.
5. Speed is unchanged (§5).

## 3. What was built

| Part | Where | What it does |
|---|---|---|
| Dated election law | `src/rules/electionLaw.ts`, `src/engine/lawStore.ts` | Each state's rules on a given day: the 2016 baseline plus the changes in force. Every rule read (primary systems, contest methods, runoff timing, primary crossover voting, poll voter models) asks for the law on the election's day. |
| Contest methods from the law | `src/engine/elections.ts` | `rcv` (instant runoff), `top_four` (an all-candidate primary where four advance), alongside plurality, majority runoff, jungle and top-two. One function chooses the method from the law. |
| Reform sessions | `src/engine/electionReform.ts` | The December session's election-law decisions (adopt or repeal RCV, primary systems), with news. A separate random stream, so other draws are unchanged. |
| Ranked-choice tabulation | `src/counting/rcv.ts`, `src/engine/nightJob.ts`, `src/electorate/kernel.ts` | The kernel returns the voter types behind each first choice per reporting jurisdiction. The compute worker runs the instant runoff on the ballots that will be certified. Transfers come from each type's next preference among the remaining candidates (Plackett–Luce) and are realized as exact integer draws, so ballots are conserved in every round (architecture 04 §4.5). |
| Decisions | `src/engine/elections.ts` | Without a first-choice majority, the final round decides: at certification for counted general elections, at once for primaries. Rounds are archived in `rcv_round`. |
| Nonpartisan ballots | `src/engine/electionModel.ts` | No partisan weight or party sign; candidates judged by ideology. `contest.nonpartisan`. |
| Election night | `src/projections/observer.ts` (unchanged logic), `src/broadcast/story.ts`, UI | RCV races need a first-choice majority to be projected; otherwise "Ranked-choice count", with an alert, analyst lines and banner. |
| Archive and UI | `src/engine/archiveQueries.ts`, `src/ui/screens/ContestScreen.tsx`, `src/ui/screens/Government.tsx` | The method and nonpartisan ballot on contest pages, the rounds table (with exhausted ballots), and the Election law tab. |
| Schema 7 | `src/persistence/schema.ts` | `election_law`, `rcv_round`, `contest.nonpartisan`. Migration from schema 6 is automatic. |

## 4. Test results

### 4.1 Suites

| Check | Result |
|---|---|
| Typecheck, ESLint and module boundaries (`npm run lint`) | pass: no dependency violations (129 modules, 568 dependencies) |
| Unit, property and real-data tests (`npx vitest run tests/unit`) | **123 passed**, 12 skipped (opt-in long runs), 210 s (13 new tests) |
| End-to-end, Chromium (`npx playwright test`), this server | **4/4 passed** in 6.6 min; the final 2016 forecast and the Brier score are unchanged (73% / 304 EV, 0.031) |
| CI on the final commit | CI_RESULT |

### 4.2 New tests

**Instant runoff** (`tests/unit/counting/rcv.test.ts`, 8 tests):
- **Known answers:**
  - a first-round majority ends the count;
  - the last-placed candidate's ballots decide it;
  - exhausted ballots;
  - transferred ballots follow their own voters;
  - zero-vote candidates eliminated together;
  - each area transfers by its own voters.
- **A mixed pile splits in proportion to who is in it:** 400 draws average 9 of 21 to the expected candidate.
- **Properties on 60 random elections:**
  - every round's tallies plus exhausted ballots equal the first round's ballots;
  - the winner has a majority of the continuing ballots or is the last one standing;
  - exhausted ballots only grow, and eliminated candidates never return;
  - the same stream gives the same result.

**Election law** (`tests/unit/engine/electionLaw.test.ts`, 4 tests):
- **Dated rules:**
  - the 2016 baseline: California top-two, Georgia majority, Louisiana jungle, Texas primary runoff, Nebraska
    nonpartisan;
  - a change applies from its effective date and not the day before;
  - later changes supersede earlier ones;
  - the top-four rules.
- **A fixture universe**, 2016 → 2019. After the 2016 election, Maine adopts RCV for Congress and primaries and
  Alaska a top-four primary, both from 2018. Colorado adopts RCV from 2020. The checks:
  - no `rcv` or `top_four` contest before 2018 anywhere, and none in Colorado in 2018;
  - Maine's 2018 Senate and House generals and its primaries are ranked, while its governor is still chosen by
    plurality;
  - Alaska has no party primaries; its top-four primaries advance four, who are exactly the general-election
    candidates; its generals are ranked;
  - all 56 decided RCV contests conserve ballots across rounds, are decided by their final round, and have
    first rounds equal to the certified first choices;
  - the contest page and the Election law tab return the rounds and the changes;
  - Nebraska's legislative contests, and no others, are nonpartisan;
  - the database integrity checks pass.

  Real output:
  ```
  2018 Governor of Alaska: round 1: D 43964, D 44517, D 38749 (out), R 40730, exhausted 0
    | round 2: D 57358, D 58655, R 48879 (out), exhausted 3068 | round 3: D 76376, D 78737 (elected), exhausted 12847
  2018 U.S. House, AK-AL: round 1: D 53505 (out), D 54708, R 58660, exhausted 0 | round 2: D 82940 (elected), R 72220, exhausted 11713
  56 ranked-choice contests decided, 2 needing more than one round
  a century of sessions: 30 election-law changes (7 adopting ranked-choice voting, 4 repealing it, 19 primary systems)
  ```
  In the House race, the eliminated Democrat's ballots went 55% to the other Democrat and 25% to the Republican,
  and 22% exhausted. For comparison, in Alaska's real 2022 count the eliminated Republican's ballots split
  42 / 24 / 34. In the governor's race the first-round leader (D, 44,517) went on to win. The 100-year session run
  checks the reform mechanics: enacted on December 31, effective the next January 1, one news item each.

### 4.3 The simulation elsewhere

The real-geography benchmark (2016, seed SPEED-1) compared with the previous build: every result outside
Nebraska is identical.
- Nebraska's 19 legislative contests differ: they are now on a nonpartisan ballot.
- So do its presidential totals, by a few hundred votes out of about 820,000 (same winner). All contests on a
  ballot share one random stream per base unit, and Nebraska's presidential contest is drawn after its
  legislative ones.
- No state changed its law in 2016 for this seed.
- A universe saved at January 2036 under schema 6 opens, migrates to schema 7 and keeps running.

## 5. Measurements

| Measurement | Before 7.1 | 7.1 |
|---|---|---|
| Node, real geography, January 1 → December 1, 2016 | 55.8 s | 56.0 s |
| Fixture universe, 2016 → 2019 with two ranked states (the test above) | — | 54 s |
| Storage | — | `rcv_round` adds about 10 rows per ranked contest; `election_law` one row per change |

RCV costs nothing unless a state uses it. Where it does, the kernel adds one pass over the voter types for each
ranked contest, and the tabulation runs per reporting jurisdiction in the compute worker; both are small next
to the count itself.

## 6. Fixes and decisions

- **No real-world reforms are scheduled** (the correction above). The roadmap now says so.
- **Piles carry their voters' types, not individual ballots.** The tabulation keeps the expected mix of voter
  types behind each candidate's ballots in each area. That is exact for ranking choices under Plackett–Luce,
  where a ballot's next choice depends only on its voter type and the candidates left. But a pile that mixes
  voters transfers as a random draw with the mix's odds, not ballot by ballot. A first test assumed exact
  per-ballot transfers; it was rewritten to test the proportional split instead.
- **Nebraska's legislature is now nonpartisan**, as it was on January 1, 2016. Phase 6 elected it with party
  labels.

## 7. Known limitations

- **No ranked-choice voting for President.** Presidential contests stay plurality and Electoral College, even
  in a ranked state.
- **Later rounds are archived per contest, not per county.** Maps and county tables show first choices.
- **Polls and forecasts treat ranked races by first choices.** The forecast does not simulate the instant
  runoff.
- **On election night desks do not project the ranked-choice outcome.** The count is of first choices; the
  tabulation is published at certification.
- **Legislatures cannot yet adopt top-two or top-four primaries, nonpartisan ballots or voting-method changes**
  (all-mail, early voting). Top-two and top-four will mostly come by ballot initiative (7.3); the others need
  their own reform models.
- **No legislative primaries yet** (as in Phase 6). So Nebraska's real nonpartisan top-two primary is not
  modelled: its general has one nominee per party, without party labels.
- **The reform model is sparse and not calibrated against real data.** It is a plausible rate of change, not a
  forecast of American reform.
- **Election night playback** shows RCV races as "Ranked-choice count" only in records made by 7.1 or later.

## 8. Changelog

- `a696aa6` Roadmap: Phase 7 split into sub-phases 7.1–7.8.
- `04a3513` Phase 7.1: election law over time, RCV, top-four primaries, nonpartisan ballots, reform sessions, UI
  and tests.
- This commit: engine version 0.7.1; docs (architecture 03, 04, 05, 08 and 10, README); this report.

## 9. Next: Phase 7.2 — Statewide down-ballot offices and state courts (awaiting your approval)

The next sub-phase:
- treasurer, auditor/comptroller, superintendent, insurance, agriculture and labor commissioners, and utility
  commissions, per each state's 2016 law;
- state supreme and appellate courts: partisan, nonpartisan (this sub-phase's ballots) and yes/no retention
  elections.

The estimate is 4–5 hours.

Two questions for you:
1. **Real-world reforms:** should universes stay strictly in-universe, as the architecture says? Or would you
   like an option to follow real reforms after 2016 (Maine's RCV from 2018, Alaska's top-four from 2022)?
2. **Approval** of 7.1, and to start 7.2.
