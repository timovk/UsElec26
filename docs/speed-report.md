# Speed Report — Faster Simulated Years (after Phase 6)

**Status:** implemented and tested on `claude/election-night-architecture-x38wzs`; `main` not updated yet.
**Engine version:** 0.6.0 (unchanged) · **Schema version:** 6 (unchanged) · **Night record:** version 2 (unchanged)

This is the speed work deferred from Phases 5 and 6. Phase 7 has not been started.

## 1. Summary

A simulated year now takes **about half as long** in the browser, and **the simulation is unchanged**: for the
same seed, every table holds the same content as before. Section 4.2 explains how that was checked.

| Chromium, this 4-core server, on-disk browser profile | Phase 6 | Now |
|---|---|---|
| **The year 2016**, January 1 → December 26 in "+1 month" steps | 77.5–82.2 s | **40.5–41.2 s** |
| A month without the general election (30-day steps) | 1.8–6.2 s | 1.0–3.6 s |
| November (Election Day, the night and the canvass) | 24.6–26.1 s | 15.0–15.5 s |
| December (certification) | 18.3–18.8 s | 5.0 s |

The same changes on the GitHub CI runner. "Phase 6" is `main`'s last run; "Now" is the two runs on this branch
(`abfd581` and `1439817`). CI runners vary from run to run.

| CI runner | Phase 6 | Now |
|---|---|---|
| January 1 → the 2016 ballot lock (Next election) | 93 s | **43–58 s** |
| The Election Day step itself (ballot lock) | 34.7 s | 14.6–19.4 s |
| January 1 → November 8, 2016 (+1 month steps) | 92 s | 38–48 s |
| The 2016 primaries and general (elections E2E) | 126 s | 36–48 s |
| Auditing the 2016 archive | 153 s | 94–136 s |
| Universe creation | 5.9 s | 4.4–5.4 s |

**Still over budget.** The budget is 40 s for a year with a general election on the reference Chromebook. A
Chromebook is about 1.5–3× slower than this server, so expect **roughly 1–2 minutes** for 2016 there, against
2–4 minutes before. Section 6 lists what could close the rest; those options change results or the design, so
they need your decision.

## 2. Using it on a Chromebook

1. Open **https://timovk.github.io/UsElec26/** once `main` is updated (the live site is Phase 6 until then).
2. Nothing to migrate: existing universes open and keep running exactly as before.
3. **+1 month** and **+1 year** are faster everywhere. The biggest gains are in December (certifying about 6,000
   state legislative contests) and on primary days.
4. A long advance saves its progress every 10 seconds instead of after every simulated day. If the tab is closed
   or crashes mid-advance, the universe reopens at the last save, at most about 10 seconds of work earlier.
   Nothing is corrupted, and re-running reproduces the same history. (A Chromebook going to sleep only pauses the
   advance.)
5. To measure your own device, use **Settings → Diagnostics**, and time a **+1 month** step in, say, April.
   About 2 s on this server means about 3–6 s on a Chromebook.

## 3. What changed

Measured with traces of the browser's engine and compute workers. In order of effect:

1. **Storage writes batched.** Every simulated day used to commit its own transaction, and the browser rewrote
   the changed pages and the journal each time. In the first trace that was 17.9 s of a 31.9 s stretch on the
   engine thread. That trace used Playwright's default in-memory profile, where writes cost more than on disk
   (section 5). An advance now holds one transaction and commits it at most every 10 s of
   wall time, between days, and at the end. The database content is the same, and it stays consistent after a
   crash. The SQLite page cache is 64 MB instead of 2 MB. Nested transactions became savepoints.
2. **Synchronous compression.** Every result blob used to go through a browser compression stream (a Blob, a
   stream and a Response per array), and that per-call cost was the largest single item in the compute workers.
   Small inputs now use [fflate](https://github.com/101arrowz/fflate) (MIT, 0.8.2) synchronously. It produces
   the same bytes in every browser and in Node, and both inflaters read both outputs. Large inputs (universe
   export and import) still use the browser's streams.
3. **Prepared statements cached.** Every SQL call used to prepare its statement, copy the SQL into WebAssembly
   memory, run it and throw it away. A prepared statement is now kept per SQL text and reset after each use.
4. **Season lookups:**
   - campaigns are indexed by race, instead of scanning every campaign for each of about 6,000 contests on
     Election Day;
   - the race list and the Senate holdovers skip state legislative contests in SQL;
   - the race list reads only the columns it uses;
   - candidate quality uses an index of offices held, built once per filing and once per daily season, instead
     of scanning every current term for each candidate.
5. **Forecast:**
   - the per-draw loop skips House races by index;
   - the tipping point sorts a reused index array instead of 56 new objects in each of 1,500 draws.
6. **Kernel and population:**
   - raking cohort cells uses index arithmetic and no allocation;
   - each base unit's contests are looked up by geography instead of scanning every contest in the state;
   - the daily mortality step caches birthday dates.

All of these keep the same arithmetic in the same order. Whatever an optimization touched, it produces the same
random draws, the same sums and so the same results.

## 4. Test results

### 4.1 Suites

| Check | Result |
|---|---|
| Typecheck, ESLint and module boundaries (`npm run lint`) | pass: no dependency violations (125 modules) |
| Unit, property and real-data tests (`npx vitest run tests/unit`) | **111 passed**, 12 skipped (opt-in long runs), 203 s |
| End-to-end, Chromium (`npx playwright test`), this server | **4/4 passed** in 6.3 min (Phase 6 on CI: 10.3 min) |
| CI (GitHub Actions) on `abfd581` and `1439817` | pass: typecheck, lint, unit, build, 4/4 E2E (5.1 and 6.7 min; Phase 6: 10.3 min) |

The "Deploy to GitHub Pages" job fails on this branch, as on every branch push before it: GitHub Pages only
deploys from `main`. The build job itself passes.

### 4.2 The simulation is unchanged

`tests/unit/tools/speedBench.test.ts` (opt-in: `ENA_SPEED=<label>`) runs the real geography month by month and
fingerprints every table: a SHA-256 of its rows in key order. Its semantic fingerprint compares compressed
blobs by their content (each blob's header records the CRC-32 and length of its uncompressed bytes) and decodes
night records completely, so it also covers the change of compressor.

| Run | Before (Phase 6 code) | After |
|---|---|---|
| 2016, seed SPEED-1, January 1 → December 1 | semantic `0343409956c371ca` | semantic `0343409956c371ca` |
| From the 2036 acceptance universe (seed P6), January 1 → March 15, 2036 | semantic `ce5b0b69a14859a1` | semantic `ce5b0b69a14859a1` |

The raw (byte) fingerprint changed once, with the compressor (fflate writes different, equally valid deflate
streams). Every other change left it identical: `5199faae3f2e7950` from the fflate commit on.

The browser agrees: the season E2E test prints the final 2016 forecast and the Brier score, and both are
character for character what `main` printed on CI before this work ("73% 26% … 304 (80% range 239–363)",
Brier 0.031).

### 4.3 Node timings (the same benchmark)

January 1 → December 1, 2016 on the real geography, in a single thread: **78.5 s → 55.8 s**. Node gains less
than the browser because its in-memory store never paid the browser's write costs.

## 5. Measurements in detail

Months as "+1 month" steps of 30 days (each run started from a new universe with seed SPEED-1; two runs each):

| Step ending | Phase 6 | Now |
|---|---|---|
| Jan 31 | 2.7–2.8 s | 2.0–2.1 s |
| Mar 1 | 1.8–1.9 s | 1.1–1.2 s |
| Mar 31 (Super Tuesday and March primaries) | 5.7–6.2 s | 3.6 s |
| Apr 30 | 3.2–3.6 s | 2.0–2.2 s |
| May 30 | 3.3–3.7 s | 1.9–2.0 s |
| Jun 29 | 3.6–4.2 s | 2.1–2.2 s |
| Jul 29 | 1.9–2.2 s | 1.0 s |
| Aug 28 | 5.4–5.5 s | 2.7 s |
| Sep 27 | 3.7–4.4 s | 2.1–2.2 s |
| Oct 27 | 2.8–3.2 s | 1.6–1.9 s |
| Nov 26 (Election Day) | 24.6–26.1 s | 15.0–15.5 s |
| Dec 26 (certification) | 18.3–18.8 s | 5.0 s |
| **Total** | **77.5–82.2 s** | **40.5–41.2 s** |

**Where the time goes now:**
- **November:** about two thirds is the night jobs in the three compute workers: the kernel, the count plan,
  the wire, the survey and the desk, plus sealing. All three run at full load for about 10 s. The rest is the
  last days of the campaign (daily forecasts) and certifying the results.
- **Other months:** the engine thread's daily work:
  - the campaign season: forecasts about 4.6 s a year, poll fieldwork, campaigns, the race list;
  - commits (about 4 s a year);
  - candidate filing and primaries;
  - the monthly approval computation (1.6 s a year).

  The compute workers are mostly idle in these months.

**About the measurement.** Playwright's default browser context keeps its storage in memory, and there every OPFS
write is a round trip to the browser process. With that default, the same build takes 47.9 s instead of 38.9 s
for the first eleven months, and the Phase 6 build 98.6 s. A user's browser writes straight to disk, as the
on-disk profile used above does. The CI runner uses the default context, so CI numbers overstate storage costs.

### 4.4 A test fix found on the way

On CI, the season E2E test once printed a final forecast of "76% … 310" instead of "73% … 304". The
simulation had not changed: 76% and 310 are exactly the forecast of **October 26**, which was the latest one when
the test last looked at the Polls screen, on October 27. The test clicked **Next election** while on that screen
and read the forecast card as soon as the date showed November 8. The screen still showed its earlier data until
the refetch after the advance returned, and on CI the read came first.

Faster advances made this race more likely. The test now leaves the screen before opening the forecast, so it
always reads a fresh copy. It passes and prints the November 7 forecast.

In the app itself this is a short delay: after an advance, an open Polls screen briefly shows the previous figures,
then updates.

## 6. What could close the rest (your decision)

Each of these would change either results or a design decision:

| Option | Effect (estimated, this server) | What changes |
|---|---|---|
| Forecasts with fewer draws before the last 100 days (500 instead of 1,500), and weekly instead of daily until the last 30 days | −2 to −3 s a year | Forecast numbers move slightly (Monte Carlo noise); the seed's universe stays deterministic but differs from today's |
| Use every core while the engine waits for election jobs (4 workers on a 4-thread Chromebook instead of 3) | −2 to −3 s in November, less on primary days | Design §11.3 keeps one core free for thermals and the interface |
| Forecast in a compute worker, overlapping the day's poll fieldwork | −1 to −2 s a year | No result change; more engine complexity |
| Bulk certification of state legislative contests | −1 to −2 s in December of even years | No result change; a larger refactor of certification |

Even with all four, a Chromebook would probably still need 50–100 s for 2016. Meeting the 40 s budget there
would take a cheaper model: for example, realizing primaries and state legislative contests at county-part grain
instead of base-unit grain. That changes results.

## 7. Known limitations

- **Over budget on a Chromebook** (section 1). Unmeasured on a real Chromebook; the 1.5–3× factor is an estimate.
- **Progress is saved every 10 s during a long advance**, not after every day. The tab has no `pagehide`
  handler, so closing it mid-advance loses up to about 10 s of simulated work. The universe stays consistent.
- **Memory:** the engine's SQLite page cache can grow to 64 MB, against 2 MB before. That is within the 600 MB
  budget, but it is new.
- **The archive audit** still takes about 1.5 minutes on CI, because it re-checks every state legislative
  contest.
- **Later years** gained less in relative terms: from the 2036 universe, January → mid-March took 15.5 s before
  and 12.2 s after in Node. Long histories remain slower (Phase 6 report, §5.5).
- Storage growth (about 16–18 MB per simulated year) is unchanged.

## 8. Changelog

- `d1e9058` Speed: batch storage writes, bigger page cache, faster season lookups and raking.
- `abfd581` Speed: statement cache, synchronous deflate, campaign index (adds `fflate` 0.8.2).
- `1439817` Speed: forecast draws, held-office index for the season, cheaper daily lookups.
- E2E: the season test reads the final forecast from a freshly opened screen (section 4.4).
- Docs: this report; architecture 05 (autosave batching) and 11 (measurements, write batching).
- Tooling: `tests/unit/tools/speedBench.test.ts`, an opt-in benchmark with month, step and season-section
  timings, SQL and CPU profiles, raw and semantic fingerprints of every table, and `ENA_SPEED_SAVE` to keep the
  database.
