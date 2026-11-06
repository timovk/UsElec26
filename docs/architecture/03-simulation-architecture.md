# 03 — Simulation Architecture

This document explains how the universe is structured and how its systems interact over time. The
mathematics is in [04-statistical-methodology.md](04-statistical-methodology.md).

## 3.1 The universe as state plus history

```
Universe
├── Static base (copied from the geography pack at creation, never mutated)
│     Base Units, counties, states, 2016 boundary plans, adjacency, reporting-jurisdiction definitions
├── Hot state (in Engine Worker memory, checkpointed to DB)
│     population fields · electorate fields · party platforms · economy state · campaign state · event state
├── Entity state (DB rows, updated in place with history tables)
│     people · offices · terms · parties · pollsters · networks · district plans · rules
└── History (append-only, immutable, sealed)
      elections · contests · results revisions · night records · polls · forecasts · events · econ releases
```

Two rules apply. **History is append-only.** **Hot state may be recomputed, but only forward in time.**

## 3.2 Interaction overview

```mermaid
flowchart TD
  ECON[economy] --> ENV[national/regional environment]
  EVT[events] --> ENV
  GOV[government activity] --> ENV
  ENV --> APP[approval]
  PARTY[party platforms] --> PID[partisan identity drift]
  POP[population evolution] --> ELEC[electorate fields]
  PID --> ELEC
  ENV --> ELEC
  CAMP[campaigns] --> VAL[candidate valence by geography]
  CAREER[careers] --> CANDS[candidacies]
  CANDS --> CAMP
  ELEC -->|measure port| POLLS[polling]
  POLLS --> FC[forecasting]
  POLLS --> CAMP
  FC --> CAMP
  ELEC --> BALLOTS[ballot lock & realization]
  VAL --> BALLOTS
  BALLOTS --> COUNT[count plan]
  COUNT --> NIGHT[observers: wire, desks, alerts, commentary]
  NIGHT --> ARCH[archive]
  BALLOTS --> ARCH
  ARCH --> CAREER
  ARCH --> PARTY
  ARCH --> FC
  ARCH --> INST[institutions: terms, offices]
  INST --> CAREER
```

Every arrow is a typed interface. The loop *results → careers/parties → candidacies → campaigns → results*
is what makes elections into chapters of a continuing history.

## 3.3 Election lifecycle (state machine)

Every contest goes through explicit, separately recorded stages, as spec §20.5 requires:

```
Scheduled ──► Filing ──► Primary/Nomination ──► Campaign ──► EarlyVoting ──► ElectionDay
   │                                                              │ (progressive lock)
   │                                                              ▼
   │                                                     BallotLock (results sealed: rev 0 "cast")
   │                                                              ▼
   │                                          Counting (Night Record: feed, projections)
   │                                                              ▼
   │                                    Canvass ─► Certified (rev N) ─► [Recount ─► Certified (rev N+1)]
   │                                                              ▼
   └──────── (vacancy) ──► SpecialElection           AssumptionOfOffice (term starts)
```

- **Projection** is a network event. **Certification** is a legal event. Only certification changes who
  holds office. A network can call a race that is later certified for the other candidate. That is rare, and
  the archive records it.
- **Elections exist only because law requires them.** `calendar` derives every election from
  `office.termSchedule` plus `rules` (for example U.S. House: every even year on the Tuesday after the first
  Monday in November, per 2 U.S.C. §7; Senate classes; each state's gubernatorial cycle; vacancy rules
  for specials). No election is generated "for activity".

## 3.4 Progressive ballot lock

Ballots are cast over weeks (mail and early voting), not in an instant:

- For each ballot mode `m`, the engine keeps a running, volume-weighted average of the short-term
  environment and campaign effects over that mode's casting window. Mail ballots returned in October
  reflect October, and Election Day ballots reflect Election Day.
- At the **lock instant** (polls opening on Election Day in the earliest time zone), the engine has every
  input fixed. The ballot kernel (§4.5) realizes the complete result, and the system seals it (SHA-256) as
  revision 0, *ballots cast*. From then on, nothing in the simulation can change a cast ballot. Counting
  only *reveals* the ballots. Canvass, curing and recounts produce explicit, logged revisions (§7.3).
- A late-breaking scandal therefore hurts the candidate among Election Day voters but not among the early
  vote already banked. This happens in reality, and it is emergent here.

## 3.5 Politicians and hierarchical detail

| Tier | Who | Detail | Count (2016) |
|---|---|---|---|
| **A** | President, VP, cabinet, congressional leaders, senators, governors, declared presidential contenders | Full trait vector, relationships, daily campaign agency, event participation | ~250 |
| **B** | House members, statewide officers, state legislative leaders, big-city mayors, serious challengers for Tier-A/B offices | Trait vector, career model each cycle, campaign agency in their contests | ~1,500 |
| **C** | State legislators, local officials, minor candidates, the "bench" | Compact record (identity, party, ideology, 4 skill scalars, office history). Promoted to B when they seek a B-level office. | ~8,000 at start, grows |

- Every person who appears on any ballot gets a **persistent `person_id`**. Tier C people are
  *materialized lazily*. When a contest needs a candidate pool, a deterministic generator keyed by
  `(state, office, year, slot)` creates them. The same seed always creates the same people, and once
  created they persist forever.
- **Pre-2016 backgrounds** (offices held before 2016, a narrative career summary) are generated as
  *biographical* facts and stored with `provenance = 'pre-simulation background'`. They never produce vote
  totals. The election archive begins with the first simulated election (§3.2 of the spec).
- **Names** come from public-domain frequency data (Census 2010 surnames, SSA given names by birth year), and
  name distributions are conditioned on birth year and region. A blocklist of prominent real politicians
  (current and recent members of Congress, governors and presidents, from the CC0
  `unitedstates/congress-legislators` dataset plus a curated governors list) rejects exact full-name
  matches.
- **Careers** are decided by an expected-utility model each filing season (§4.11). It weighs the value of the
  office, the estimated win probability (from the person's *perceived* environment, using only public
  information), age, the cost of giving up the current seat, ambition and scandal exposure. Promotions follow
  realistic ladders (state legislature → House → Senate/Governor → President) because candidate quality and
  name recognition are earned by holding offices.

## 3.6 Time and time zones

- Canonical time is **UTC minutes**. `core/time` implements the US time-zone rules required:
  Eastern, Central, Mountain, Mountain-no-DST (Arizona, except the Navajo Nation's polling places, which
  are handled by an exceptions table), Pacific, Alaska, Hawaii-Aleutian with DST (Aleutians west of 169.5°W),
  and Hawaii (no DST). It applies the post-2007 DST rules (second Sunday of March, first Sunday of November). The tz
  rules are data, so a simulated law changing DST is possible.
- **Every county maps to a zone.** Thirteen states are split across zones (FL, IN, KY, TN, MI, TX, KS, NE,
  SD, ND, ID, OR, AK). The county→zone table is compiled from 49 CFR Part 71 (the federal definition of
  time-zone boundaries). Poll closing is defined in *local* time by state law, so a state with two
  zones closes in two waves. In 2016 Kentucky's eastern counties close at 6:00 pm ET and its western counties at
  7:00 pm ET. Hawaii closes at 7:00 pm HST (midnight ET), and the Aleutians close at 8:00 pm HST/HDT (1:00 am ET).

## 3.7 Government and institutions

- **Offices** carry term schedules, eligibility (age, residency, term limits per state), and succession and
  vacancy rules. Examples: a Senate vacancy is filled by gubernatorial appointment plus a special election per
  state law; a House vacancy goes to a special election only; a governor vacancy goes to the LG or another
  successor per state constitution; the presidency follows the 25th Amendment and the Presidential Succession Act.
- **Chambers** track composition, leadership elections, majority control and (from Phase 6) roll calls. A bill
  is a vector in issue space plus salience. Members vote by ideological distance, party pressure and
  constituency lean. The 2016 rules apply: Senate cloture at 60 for legislation, a two-thirds veto override, and the
  budget-reconciliation exception. Laws feed back into the environment (approval and issue salience) and can
  change **election rules** (for example adopting RCV or all-mail voting). Rule changes take effect only
  through simulated legislation or ballot measures, starting from the real legal baseline of January 1, 2016.
- Government stays **subordinate** to elections. It runs at monthly or session granularity, with major
  bills (≈5–30 per Congress) simulated explicitly and the rest summarized as aggregate productivity.

**As implemented in Phase 6** (`engine/governmentEngine.ts`, `government/congress.ts`, `engine/careersEngine.ts`,
`engine/legislatures.ts`, `engine/census.ts`):
- **Congress** meets monthly on the 15th (August recess). In a given month it takes up a major bill with
  probability 0.55 under unified control, 0.40 divided and 0.15 in the autumn of an election year. A bill moves
  policy from the status quo `q` toward the majority's platform. A member's utility is
  `2.2 · (‖x − q‖² − ‖x − b‖²) + pressure + constituency`, with pressure +1.6 for the sponsoring party and −1.7
  for the other, and the vote is logistic(2.2u). The House passes by majority. The Senate needs 60 for cloture,
  except one reconciliation bill a year under unified control (simple majority; the Vice President breaks
  ties). The President signs a same-party bill, or one that improves on `q` from their position. Overrides need
  two-thirds in each chamber. Enacted laws move `q` 55% of the way to the bill and nudge presidential standing.
  Every roll call is stored, with each member's vote.
- **State government:** each December 31, every state's session is summarized (laws, vetoes, overrides, a
  late budget under divided government).
- **Election law** (Phase 7.1, `rules/electionLaw.ts`, `engine/electionReform.ts`): each state's rules are the
  January 1, 2016 baseline plus changes enacted in the universe, each with an effective date (the next January 1).
  An election follows the law in force on its day; changes never apply to elections already held. The session
  may adopt ranked-choice voting (for party primaries and for Congress or every office but President), repeal it,
  or switch among open, semi-closed and closed primaries. Adoption has a small base rate (0.3% per state-year),
  rises after "spoiler" outcomes (a winner below 50% while a minor candidate took more than the margin), and
  rises again when the harmed party controls the state. Repeal is likeliest after ranked ballots overturned a
  first-round leader whose party now governs. Nothing from the real world after 2016 is imported. Ballot
  initiatives join in Phase 7.3.
- **Careers between elections** (monthly): scandals (hazard by office scrutiny and integrity), scandal
  resignations, other mid-term exits (health, private sector), cabinet turnover (mean tenure about 2.7 years), rare
  party switches. A new President brings a new cabinet. Party conferences choose leaders when each Congress
  or legislature convenes. Retirement at filing adds tenure, scandal and a hostile new district. Ambitious
  officeholders run for higher office (the ladder: state legislature → House → Senate or governor).
- **State legislatures:** all 7,383 seats in 99 chambers are offices held by people. They are elected on each
  state's schedule (two- and four-year terms, odd-year states, and all senate seats after redistricting where
  the state does that), with one nominee per party (no primaries yet). A vacancy is filled at the next regular
  election. Control changes are news.
- **Census and districts:** the census on April 1 of each year ending in 0, Huntington–Hill apportionment on
  December 31, redistricting September–November of the following year, new plans for the elections two years
  after the census, and the new districts take office on January 3 of the year after that. Plans are versioned:
  older contests keep their districts forever (see [06-geographic-strategy.md](06-geographic-strategy.md) §6.8).

## 3.8 Parties and the two-party guardrail

- Each party has a **platform** vector in the latent issue space (§4.1), an organizational strength score per
  state, and a brand (valence) score. Platforms move monthly under three forces: *vote seeking* (pull
  toward the swing electorate after losses), *activist pull* (toward the primary electorate), and
  *leader imprint* (the presidential nominee's position).
- **Realignment** is emergent. Groups whose positions are better represented by the other party drift in
  partisan identity, and generational replacement accelerates the drift (§4.2).
- The **two-party structure is structural, not scripted.** Plurality and winner-take-all rules impose a
  strategic-voting penalty on candidates seen as non-viable, and ballot-access costs and donor
  coordination make minor parties unable to sustain parity. Democrats and Republicans are institutional
  constants of the universe: even after landslides they persist, reposition and recover. Independents and
  minor parties can win individual contests (strong local candidates, three-way races, RCV jurisdictions),
  but the system never becomes multiparty. A long-run test asserts this property over 100-year runs on
  many seeds (§10).

## 3.9 Campaigns

Campaign state per candidacy: cash on hand, spending by geography (states for presidential races, the
district for House races, media regions approximated by Census CBSAs), staff and ground game, name
recognition by geography, and favorability. Daily dynamics:

1. Fundraising (skill, prospects, incumbency, national mood, small-donor enthusiasm).
2. Allocation. Presidential campaigns allocate by *voter power* (∂P(win)/∂share in each state, computed from the
   campaign's own forecast, which uses public information). Others spend where they run.
3. Effects. Persuasion (diminishing returns on spending), recognition growth, turnout mobilization,
   debate performance (skill plus noise), gaffes and controversies (from `events`).

Effects enter the vote model as **contest-specific valence by geography**, so they cause ticket
splitting, and they are bounded (a typical net effect is 1–3 points).

**Phase 5 implementation notes (as built).** The campaign season runs at 06:00 ET each day of an election year
(`engine/season.ts`; the model is `campaigns/model.ts`).
- *Daily order:* environment step, campaigns, debates, endorsements, poll fieldwork, publication and averages,
  then forecasts when due.
- *Campaign state* per candidate and race: cash, raised, spent, recognition, persuasion, debate and scandal
  shocks, endorsements, primary momentum and viability, and presidential attention by state.
- *Fundraising* follows skill, prospects, incumbency and the national mood. *Spending* builds persuasion with
  diminishing returns. Presidential campaigns put attention on states by voter power from the latest forecast
  (else the lean index).
- *Valence* is clamped: persuasion ±0.05, state attention ±0.04, shocks ±0.12. It is multiplied by 2.5 in
  primaries, where party labels do not separate the candidates.
- *Debates:*
  - presidential general debates 43, 30 and 20 days out;
  - nomination debates every three weeks until April;
  - statewide general debates 26 days out.
  Performance is skill plus noise.
- *Events:* scandals and gaffes are drawn daily, weighted by integrity and scrutiny. Endorsements come from
  the party's officeholders and favour the leader and the experienced.
- Quarterly finance reports are written to `finance_report`. Campaign effects enter `kernelContest` through a
  valence hook, so they reach the ballot.
- Every day's draws come from one stream per day, so results do not depend on how the clock is advanced.

**Presidential nominations (`engine/nomination.ts`, `primaries/delegates.ts`, `rules/primaries2016.ts`).**
- *Calendar:* each state holds a primary, caucuses or a convention on its party's 2016 date, sharing the
  state's primary election when the days coincide.
- *Delegates:*
  - Democrats: proportional at 15%, about two-thirds by district;
  - Republicans: each state's 2016 rule (winner-take-all, winner-take-all by district, or proportional, with
    thresholds, majority triggers and unbound delegates);
  - Democratic superdelegates: the party's governors and members of Congress plus DNC members. They commit
    over the spring (weighted by candidate quality, the delegate count and home state; all to the presumptive
    nominee once there is one) and vote at the convention.
- *Winnowing:*
  - momentum from beating expectations and from winning the day;
  - viability from the national polling average;
  - withdrawals when cash, rank and share say a campaign is over (later contests drop the candidate);
  - a presumptive nominee once a majority is locked or one candidate remains.
- *Conventions* (Republicans the third Monday of July, Democrats the last Monday):
  - a presumptive nominee is nominated on the first ballot;
  - otherwise ballots continue (at most eight). Withdrawn candidates' and unbound delegates split toward the
    leader, more so on each ballot, and each further ballot releases a growing share of bound delegates;
  - the nomination contest (method `delegates`) records the winner.

## 3.10 The Public Record

The Public Record is the observable face of the universe, and the only thing L4 observers read (§2.2.1): what a
journalist could know. It is materialized from history tables:

- results (as revisions are published), polls (on publication date), economic releases (with release lag),
- candidate filings and fundraising reports, endorsements, announced events and news items,
- the wire's live vote feed (on election nights).

The UI defaults to the Public Record too. *Simulation truth* views (latent partisanship, true current
vote intention, true remaining vote) exist for analysis, are clearly labeled, and are hidden during a live
election night unless the user opts in. This prevents spoilers.
