# 12 — Technical Risks and Limitations

Severity (S) and likelihood (L) are rated H, M or L. Nothing here is hidden behind optimistic wording.

## 12.1 Requirements the spec names explicitly

### Precinct-level geographic coverage (S: M, L: H, *certain limitation*)
- **There is no authoritative, nationally complete, current precinct-boundary dataset from an official source.**
  Precincts are set by thousands of local jurisdictions and change frequently. Census VTDs (2010, 2020) are
  approximations submitted by states, vary in quality, and in some states are not real precincts.
  Academic compilations exist, but their licensing and coverage vary, and they are not official.
- **Decision:** reporting units are **synthetic precincts** built from Census block-group-based Base Units. Their
  per-county count is calibrated to real 2010 VTD counts, and they are **labelled synthetic everywhere**. We will never
  claim real precinct coverage (spec §20.6). Real-VTD-based reporting units are a research option for a later phase.

### Thousands of simultaneous elections (S: M, L: M)
- Federal plus state legislative contests in a general election number about 7,000 and are well within the kernel's
  design (contests are columns, cost scales with contests per BU).
- **Local government is the real scaling problem.** The United States has on the order of half a million elected
  officials. Modeling all of them is infeasible and would also make the archive and people tables explode.
- **Decision:** default local coverage is **all counties' principal offices, mayors and councils of major cities,
  and school boards of the largest districts**. Extended coverage is an advanced option with its storage cost shown. Tier-C people
  are compact and lazily materialized.

### Shared-electorate ballot consistency (S: H, L: L)
- Consistency is guaranteed **by construction** (§4.5.5): ballots are drawn once per (BU, mode), every contest partitions
  them, and aggregates are sums.
- The residual risk is *plausibility*, not consistency: ticket-splitting and roll-off rates must look
  realistic. They are covered by calibration targets and tests.
- Limitation: individual ballot patterns inside a BU are not realized. Joint distributions are exact mixtures
  from the type model, which is all that any display or analysis requires.

### Long-term archive size (S: M, L: M)
- Estimated at about 450 MB per century (federal and governor) and about 700 MB (full coverage), ±50% (§7.4). Large exports are
  slow to copy to Drive on weak connections.
- Mitigations: compression levers that delete no history (§7.4), a storage meter, and measurement in Phases 2 and 7
  before coverage expands.

### Browser storage limitations (S: H, L: M)
- OPFS is **best-effort** storage unless `persist()` is granted. Under storage pressure, Chrome may evict
  non-persistent origins. Clearing site data, Powerwash, Guest mode or Incognito **destroys** universes.
- OPFS is invisible in the ChromeOS Files app, so users cannot back up universes by copying files.
- `opfs-sahpool` allows one connection per database and no WAL, so one tab at a time owns a universe.
- **Mitigations:** request persistence; display persistence status; export reminders tied to elapsed
  simulated *and* real time; rolling internal backups (which protect against corruption, not
  eviction); a one-click backup to Google Drive through the file picker. **The app states plainly that local storage is not
  a backup.**

### Historical boundary changes (S: H, L: L)
- Boundaries are versioned, and elections reference epochs. BU-grain storage makes recasting statewide and federal
  results exact. District and local contests stored at atom grain can be compared across epochs only
  **by estimation**, which is labelled (§7.5).
- Risk: errors in the 2016 source assignments (block → district) propagate everywhere. Mitigation: reconciliation
  against published district populations in the pipeline's validation step.

### Realistic race-call modeling (S: M, L: M)
- Real decision desks use proprietary models and human judgement. Ours must call neither too fast (unrealistic
  certainty) nor too slow (boring). Wrong calls must be rare but possible.
- Mitigations: an explicit statistical model with stress tests (§4.13, §8.5); calibration over hundreds of simulated
  nights; per-network parameters; every call stored with its confidence and evidence.

### Offline functionality (S: M, L: L)
- The first visit needs the network. Geography detail packs download on first use unless prefetched.
- Service-worker updates must never interrupt a session. Updates apply only on a user-approved reload, and never during a
  night.
- Limitation: no cloud sync. Moving between devices requires export and import.

## 12.2 Other material risks

| Risk | S | L | Mitigation |
|---|---|---|---|
| **Census data access blocked in this development environment** (Phase 0 finding) | H | H (today) | Ask the user to allow-list `www2.census.gov` and `api.census.gov`. The fallback is a reduced Phase 1 (counties only via `us-atlas`). |
| Exact Census product availability for 2016-vintage SLD block assignments (⚑ in §6.2) | M | M | Fallback: block internal-point spatial join, which is exact at block level |
| Base Unit count higher than estimated (for example, if place/MCD joins the key) | M | M | Phase 1 measures it; the kernel scales linearly; place/MCD keying can be restricted to New England and other states that need it |
| Determinism across browsers and engine versions | M | M | Own math library, canonical ordering, keyed RNG; the engine-version ledger accepts that *future* behaviour changes with releases, while the archive preserves the past |
| Calibration difficulty (realistic dispersion with fictional coalitions) | M | M | Explicit stylized-fact targets, automated calibration, multi-seed tests |
| Long-run degeneracy (permanent one-party dominance, or uniform 50/50 geography) | H | M | Equilibrating forces (party repositioning after losses, thermostatic opinion, generational replacement); 100-year multi-seed tests with thresholds |
| Fictional names colliding with real people | L | H | Blocklist for prominent politicians. Collisions with private individuals sharing common names cannot be avoided. |
| Imitating a real broadcaster's identity | M | L | Original names, palette, typography and sounds. Networks' names are checked against real outlets before Phase 4. |
| Chromebook memory (4 GB devices) | M | M | Budgets (§11), lazy loading, no full-BU geometry unless the view needs it |
| GitHub Pages limits (1 GB site, soft bandwidth) | L | L | Geography packs are tens of MB. Cloudflare Pages or Netlify are drop-in alternatives. |
| No custom headers on GitHub Pages (no cross-origin isolation, so no `SharedArrayBuffer`) | L | H | The design doesn't require SAB: transferables and `opfs-sahpool` are enough |
| Scope: the specification describes many years of professional work | H | H | Phased delivery with working, tested increments; architecture that extends without rewrites; honest labelling of what exists |
| Model complexity making behaviour hard to explain | M | M | Analyst Mode exposes components (environment, valence, turnout); decomposition tools for "why did X win" |

## 12.3 Explicit non-goals (for now)

- No real politicians, no real election results, no real polls.
- No multiplayer and no cloud accounts.
- No territories in the Electoral College or Congress.
- No guarantee that two **different app versions** produce the same *future* from the same save. Saved history
  is preserved exactly, but continuing a save under a newer engine follows the newer model (recorded in the ledger).
