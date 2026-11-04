# 07 — Historical Archive Architecture

The archive is a foundational system (spec §14). Every other module writes to it through one interface,
`archive.record*()`, and nothing ever writes to the archive tables directly.

## 7.1 Guarantees

| Guarantee | Mechanism |
|---|---|
| **Permanence** | History tables are append-only. No code path issues `UPDATE`/`DELETE` on them, which is enforced by a repository layer that exposes only `insert` and by a test that greps the SQL. |
| **Immutability with explicit corrections** | Results are *revisions* (§7.3). A recount adds a revision and never edits one. |
| **Detectability** | Each revision and each night record has a SHA-256 seal over a canonical encoding. The audit recomputes seals. |
| **No silent regeneration** | Archive readers never call simulation code. Replays read records (§7.6). |
| **Survives everything** | Covered by save/load, export/import and migration tests on golden saves. Historical blobs are byte-compared before and after. |
| **Exact geography of the time** | Every election stores its `epoch_id`. Rendering and aggregation use that epoch's boundaries. |

## 7.2 What is recorded per election

- Election: date, kind, jurisdiction, epoch, rules hash (the exact rules in force), engine version.
- Contest: office or measure, district, method, seats, candidates (persistent `person_id`s and parties),
  incumbency.
- Results per revision:
  - **Base Unit grain** for federal and statewide contests: per BU, the votes for each option and undervotes,
    plus ballots cast and eligible electorate per BU. This is the "precinct-level" record. It makes any future
    re-aggregation exact (§7.5).
  - **Atom grain** for state-legislative, local and judicial contests and for district measures. This is
    exact for every jurisdiction of that epoch.
  - **RJ × mode grain** for every contest: the Election-Day, early, mail and provisional breakdown by reporting
    jurisdiction.
  - Materialized **contest totals**, **turnout**, **county rollups** and **Electoral College** rows for fast queries.
- Night record (§8): the full feed of batches, wire expected-vote updates, voter-survey releases, every
  projection event with its confidence and expected-vote %, retractions, alerts and commentary lines.
- Post-election: canvass and certification revisions, recount records, legal cases, and the assumption of office.
- Context: polls (permanent), polling-average snapshots, forecast runs, and the economic releases and approval
  series available at the time.

## 7.3 Result revisions

```
rev 0  cast         sealed at ballot lock (ground truth of ballots cast; hidden until counted)
rev 1  unofficial   end of the counting feed (all batches applied)
rev 2  canvass      provisional adjudication, cured ballots, corrections
rev 3  certified    the legal result
rev 4+ recount / court-ordered correction  (each with reason, superseding revision, and net change)
```

**As built in Phase 3:** rev 0 holds the cast ballots at Base-Unit grain plus a 'rejected' blob (mail and provisional
ballots cast but never counted, by unit and mode). Rev 1 (unofficial) is the feed's total without provisional batches;
rev 2 (canvass) is the whole feed; rev 3 (certified) equals rev 2 and is stored as *derived* from rev 0 − rejected (totals,
RJ × mode table and certified rollups, with a seal chained to the rev 0 seal) rather than as a second full unit-grain
copy. The audit recomputes the certified unit grain. Recounts (rev 4+) are not yet implemented.

Recounts do **not** rerun the election. A recount re-tabulates the cast ballots with a modeled
tabulation-error process: per-mode, per-technology error rates of about 0.005–0.1% of ballots, realized as
small signed deltas per RJ. The margin changes by a realistic few dozen to few hundred votes, and the
outcome changes only if the margin was smaller than that.

## 7.4 Storage budget (estimates, to be measured in Phase 2 and Phase 7)

Assumptions: ~300k Base Units, ~60k atoms per epoch, ~4,600 reporting jurisdictions, codec `ENA1` at the
measured 1.06 bytes per count.

**Per presidential-year cycle, federal + governor coverage (Phases 2–6):**

| Component | Basis | MB |
|---|---|---|
| General results, BU grain (Pres, Sen, Gov, House) | 300k × ~2.9 contests × ~3.5 counts | 3.2 |
| Ballots and eligible per BU | 300k × 2 | 0.6 |
| RJ × mode breakdown, rollups, summaries | | 0.6 |
| Night record (feed + events + commentary) | ~70k batches × ~16 counts + ~5k events | 1.5 |
| Primaries (atom grain) and their nights | | 1.5 |
| Polls and averages | ~3,000 polls | 0.6 |
| Forecast history | ~115 runs × ~25 KB | 1.5 |
| Events, government, economy, people | | 0.5 |
| **Total** | | **≈ 10** |

A midterm cycle is about 8 MB. **Century total ≈ 450 MB** at this coverage. Full Phase-7 coverage (statewide
down-ballot at BU grain; legislatures, locals and measures at atom grain) adds about 5 MB per cycle, for **≈ 700 MB per
century**. Treat these figures as ±50% until measured.

**Why this is acceptable:** Chrome lets an origin use a large share of free disk (quota is a fraction of total
disk). A 64 GB Chromebook typically has several GB available to the app. The cost is shown in Settings →
Storage. Export files are about the same size, since blobs are already compressed.

**Measured in Phase 2** (real geography, 2016 cycle, three seeds): contest blobs 4.0 MB (Base-Unit grain 3.3 MB, primaries
at county × district grain 0.1 MB, RJ × mode 0.6 MB), per-Base-Unit turnout 1.8 MB, county rollups 0.1 MB. The universe
database grew from 18.3 MB to 26.7 MB over the cycle, including rows for candidacies, totals, people and news. Phase 2
archives primaries at county × congressional-district grain; the atom grain follows when legislative districts arrive
(Phase 6).

**Levers, in order (none delete history):**
1. Store BUs in Hilbert-curve order and delta-code against spatial neighbours (expected −15–30%).
2. A universe-creation option, *Archive detail: county & district level*, stores atom grain instead of BU grain
   for federal and statewide contests (about −30% overall). The archive stays exact for all jurisdictions of each epoch,
   and cross-epoch comparisons become *estimated* (§7.5). It is off by default.
3. Cold-archive packing: re-encode elections older than 20 years with a slower, tighter codec. This is lossless
   and verified by seal.

## 7.5 Comparisons, swing and comparability

**Definitions** (used identically everywhere; D/R are the two major parties, `T` is total valid votes for the contest):

| Metric | Formula | Notes |
|---|---|---|
| Vote share | `share_X = X / T` | |
| Two-party share | `D2 = D / (D + R)` | |
| Margin | `M = (D − R) / T` | Points. Positive means Democratic lead. Displayed as "D+3.2" or "R+3.2". |
| Two-party margin | `M2 = (D − R) / (D + R)` | |
| **Swing (margin shift)** | `S = M2_B − M2_A` | The default "swing". Positive = toward D. Labelled "shift toward D/R". |
| Share change | `Δshare_X = share_X,B − share_X,A` | Never called "swing" |
| Raw vote change | `X_B − X_A` | |
| Turnout rate | `ballots / VEP` (VAP also available) | Turnout change in percentage points |
| Roll-off | `1 − votes_contest / ballots` | |

**Choice of the previous comparable election** (always shown in the UI):

| Contest | Default comparison | Alternatives offered |
|---|---|---|
| President | Previous presidential, same geography | Any earlier presidential |
| Senate | Previous election for the **same seat** (6 years) | Previous Senate race in the state (either class); last presidential |
| Governor | Previous gubernatorial election in the state | Last presidential |
| House | Previous election in the same district *if the boundary version is the same* | Recast comparison (below) |
| Any contest, at county or sub-county level | Same unit, previous comparable election | |

**Comparability classes** (spec §20.3). Every comparison carries one of these, displayed as a badge:

| Class | When | Exactness |
|---|---|---|
| **Direct** | Same geographic unit, same boundary version | Exact |
| **Reaggregated (exact)** | Old results summed over BUs into a new unit. Possible for any contest stored at BU grain, for example the 2032 presidential vote inside 2042's districts. | Exact: sums of recorded integers |
| **Estimated** | Old results stored at atom grain, re-allocated to new units by eligible-population share within split atoms | Estimate. Labelled, with allocation method stated. |

## 7.6 Election-night replay

A replay is **the same playback engine** reading the stored night record (§8.7). Because live viewing is
also playback of a stored record, **replay is the original**, not a reconstruction. A replay
reproduces:

- the original reporting order and every batch's timestamp and content
- the vote totals at every instant (cumulative sums of the feed)
- every projection, retraction, Too Close/Too Early designation, alert and commentary line, at its original time

A test computes the cumulative totals at the end of the feed and asserts equality with revision 1 for every
contest, and it asserts that the replay's event stream hash equals the recorded hash.

## 7.7 Archive validation (audit suite)

The suite runs after each finalization (on that election), in the background on universe load (sampled), and
on demand (full) from Settings → Archive integrity:

1. Candidate totals equal the sum of unit-grain results for each contest and revision.
2. County, CD, SLD and state totals equal the sum of BUs/atoms in that epoch's assignment.
3. For each BU, mode and contest: votes + undervotes + overvotes equal ballots, and ballots are at most eligible.
4. Shares sum to 100% within rounding. Electoral votes sum to 538 (or the in-universe size after a
   reapportionment that changes chamber size, should a simulated law ever do so).
5. The feed reconciles: Σ batches equals revision 1 per (RJ, mode, contest), and cumulative totals are never negative and never
   exceed final.
6. Seals match. Revisions form a valid chain.
7. Election epoch matches the boundary version effective on the election date.
8. **Stability check:** stored seals for old elections are unchanged after advancing time, saving or loading,
   export/import and migrations.

## 7.8 Query patterns and performance

| Query | Path | Target |
|---|---|---|
| Election overview | `contest` + `contest_total` rows | < 50 ms |
| Contest page by county | Decode the contest's `county_rollup` blob for its state | < 50 ms |
| **County history** (Archive → PA → Chester → all years) | `contest_geo` index → contests → per-(election, state) rollup blobs (~10 KB each) | < 200 ms for 100 years |
| Precinct map of a contest | Decode the BU-grain blob for the state (~50–200 KB) | < 150 ms |
| Trend lines (state partisan evolution) | `trend_cache` materialized at finalization | < 30 ms |
| Politician career | `office_term` + `candidacy` by person | < 30 ms |

## 7.9 Exports

- **Universe export** (`.ena`, §5.4): everything, losslessly.
- **Dataset exports** (Phase 8): CSV/JSON for an election, a contest, a county history or a time series, plus a
  zip of a full election (contests × units × options, with a data dictionary). Files are zipped in a worker.
  Every exported file includes provenance columns (revision, grain, comparability class).
