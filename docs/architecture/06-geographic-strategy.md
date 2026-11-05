# 06 — Geographic Strategy

## 6.1 Principles

1. **Real geography from authoritative sources** (U.S. Census Bureau). No invented boundaries.
2. **One fine-grained spatial base** from which every jurisdiction is an exact union, so overlapping
   jurisdictions (counties, districts, municipalities) reconcile exactly (spec §20.1).
3. **Boundaries are versioned.** A new plan creates a new version and never edits an old one (spec §4.2, §13.4).
4. **Processing happens at build time** in a reproducible pipeline run by the developer or CI. The user never
   processes data.

## 6.2 Sources

All sources below are U.S. Census Bureau products (works of the U.S. Government, public domain under
17 U.S.C. §105) unless noted. Exact product files are pinned in `tools/data-sources/sources.lock.json`
(URL, SHA-256, size, retrieval date). Items marked ⚑ must be confirmed during Phase 1 acquisition.

| Purpose | Dataset | Reference year | Notes |
|---|---|---|---|
| Render states, counties | Cartographic Boundary Files `cb_2016_us_state/county_{500k,5m,20m}` | 2016 | 3,142 county-equivalents (verified on the 2017 edition via `us-atlas`, which has the same county set) |
| Render CDs | Cartographic Boundary `cb_2016_us_cd115_500k` | 115th Congress | Includes at-large states |
| Render SLDs | Cartographic Boundary `cb_2016_<st>_sldu/sldl_500k` | 2016 | NE has upper only. ⚑ Confirm vintage matches 2016 plans in every state. |
| Places, county subdivisions | Cartographic Boundary `cb_2016_<st>_place/cousub_500k` | 2016 | Towns/MCDs for New England reporting |
| Block groups (render + base) | Cartographic Boundary `cb_2016_<st>_bg_500k` (2010 BG vintage) | 2016 | ~217k block groups |
| Block → CD115 | 115th Congress Block Equivalency/Assignment Files ⚑ | 2010 blocks | Exact block assignment |
| Block → 2016 SLDs | SLD Block Equivalency Files ⚑. Fallback: spatial join of 2010 block internal points with TIGER/Line 2016 SLD polygons. | 2010 blocks | The fallback is a standard, exact-at-block-level method |
| Block → place, MCD, VTD, urban/rural | 2010 Census Block Assignment Files; TIGER/Line `tabblock2010` attributes (`UR10`, `UACE10`) | 2010 | |
| Block population | 2010 Census (PL 94-171 / SF1: P1 total, P3 18+), via TIGER/Line `tabblock2010_<st>_pophu` (`POP10`) | 2010 | ~11M blocks |
| Demographics | ACS 5-year 2012–2016: B01001 (age×sex), B03002 (race/Hispanic), B15003 (education), B19013 (income) | 2016 | Block group / tract |
| Eligible electorate | CVAP Special Tabulation from ACS 2012–2016 | 2016 | Block group level |
| Population scaling | Vintage 2016 county population estimates | 2016 | Scales 2010 bases to January 2016 |
| Precinct counts | 2010 Voting Districts (VTD) from TIGER/Line | 2010 | Gives a realistic count of synthetic precincts per county |
| Media regions | 2015 OMB CBSA delineations | 2015 | Public stand-in for proprietary DMAs |
| Time zones | 49 CFR Part 71 (federal regulation) | current | Hand-compiled county→zone table for the split states, with citations |
| Election law baseline (2016) | State statutes and official state election sites (primary); NCSL compilations (secondary, cross-check) | 2016 | Compiled into `data/rules/*.json` with a citation per entry |
| Names | Census 2010 surname file; SSA national given-name files | 2010 / by year | Public data |
| Real-name blocklist | `unitedstates/congress-legislators` (CC0) + curated governors list | current | Used only to *reject* matches |

**Phase 1 outcome:** the Census hosts were allow-listed. `api.census.gov` now requires a key, so the
pipeline uses bulk files on `www2.census.gov` only. The ⚑ items were resolved with **official** block equivalency
files for the 115th Congress and for the 2016 state legislative plans; no spatial join was needed. Every source is
pinned in `tools/geo-pipeline/sources.lock.json` and described in [docs/data-sources.md](../data-sources.md).
The measured counts are **265,023 Base Units** (264,692 without the New England town split) and 4,703 reporting
jurisdictions. Full results are in [docs/data/geo-pack-2016.1-validation.md](../data/geo-pack-2016.1-validation.md).

## 6.3 The geographic hierarchy

```
Block (2010, ~11M)                       build-time only, never shipped
  └─► Base Unit (BU)                      = 2010 block group ∩ CD115 ∩ SLDU2016 ∩ SLDL2016 (∩ place/MCD ⚑)
        • persistent for the life of every universe          est. 230k–350k units (measured in Phase 1)
        • carries: population marginals, eligible electorate, urbanicity, centroid, adjacency, geometry ref
        • nests exactly in county and state
  ├─► Atom (per boundary epoch)           = maximal set of BUs sharing the same jurisdiction tuple
  │     • unit of exact cross-tabulation for that epoch      est. 40k–80k per epoch
  ├─► Reporting Jurisdiction (RJ)          = election-administration unit that reports results
  │     • county / parish / independent city (most states)
  │     • town (MCD) in CT, MA, ME, NH, RI, VT
  │     • state house district in Alaska (Alaska reports by election district, not borough)
  │     • Kalawao County, HI, folded into Maui's administration
  └─► Reporting Unit (RU)                  = synthetic precinct: a group of BUs inside one RJ and one atom,
        • sized so each county's count ≈ its real 2010 VTD count
        • explicitly labelled "synthetic precinct (Census block-group based)" everywhere it appears
```

**Why block groups split by districts.** They are the finest level with ACS demographics and CVAP. Splitting
them by the 2016 districts (using block assignments) makes every 2016 district an **exact** union of BUs.
In-simulation redistricting (Phase 6+) builds plans from whole BUs, so future districts are exact unions
by construction. BUs at roughly 1,000–1,500 residents are fine enough for congressional plans within ±0.25%
population deviation (real plans reach ±1 person by splitting blocks, and the UI reports the deviation
honestly). New Hampshire's tiny House districts are built from towns and wards (MCD-keyed BUs), which is why
place/MCD may need to join the BU key. Phase 1 measures the BU count both ways.

**Crosswalks.** With BUs, the county ↔ CD ↔ SLD ↔ municipality crosswalk is just a group-by over BU
attributes. There are no area-weighted guesses. The only *estimated* allocations ever made are documented
cross-epoch comparisons for contests stored at atom grain (§7.5).

## 6.4 Population base at Base Unit level

1. Block populations (2010) are summed into BU parts. Block-group ACS/CVAP attributes are apportioned to parts by
   block 18+ population share.
2. County joint cohort tables (64 cohorts) are built by **iterative proportional fitting** (IPF) seeded with the state's
   ACS joint distributions and constrained to the county marginals.
3. BU cohort counts = county joint × BU marginal adjustments (raking). They are computed on the fly, never stored as
   a full 64-column table per BU (§5.5).
4. Scaled to January 2016 using Vintage 2016 county estimates.
5. **Validation:** BU totals reconcile exactly to 2010 county and CD populations. Eligible electorate ≤ 18+
   population in every BU.

## 6.5 Build pipeline (`tools/geo-pipeline/`)

```
fetch ─► verify (SHA-256) ─► parse (shapefile/dbf/csv) ─► block table
      ─► BU construction + attributes ─► atoms (2016 epoch) ─► RJ/RU definitions
      ─► geometry: mapshaper (clean, dissolve, topology) ─► Visvalingam simplification at 3 LODs
      ─► projection (composite Albers USA with AK/HI insets; per-state projections for AK/HI views)
      ─► quantized TopoJSON per layer/LOD + label points (polylabel) + flatbush indexes
      ─► adjacency graphs (from shared arcs) ─► validation suite ─► geo-pack-<version>/ + manifest.json
```

**Pack contents (planned):**

| Layer | LOD | Format | Size target (gz) |
|---|---|---|---|
| Nation, states | national | TopoJSON, pre-projected | < 100 KB |
| Counties (+ states mesh) | national | TopoJSON | ≈ 0.3 MB (us-atlas equivalent is 795 KB raw) |
| Counties | per-state detail | TopoJSON per state | ≈ 2–4 MB total, lazily loaded |
| CDs (115th) | national + detail | TopoJSON | ≈ 1 MB |
| SLDU/SLDL (2016) | per state | TopoJSON | ≈ 6–10 MB total, lazily loaded (Phase 6+) |
| BUs | per state | TopoJSON, WebGL triangulation at load | ≈ 30–60 MB total, lazily loaded (Phase 7/8) |
| Semantic tables | — | `ENA1` blobs | ≈ 10–20 MB (copied into each universe) |

The validation suite checks that every block is assigned exactly once, that populations reconcile at
every level, that the topology is valid (no gaps or overlaps at state seams), and that adjacency is
symmetric. It also checks that Virginia's 38 independent cities, Louisiana's parishes, and Alaska's
boroughs, census areas and unorganized areas are present with the correct legal type labels.

## 6.6 Jurisdiction-specific notes (built into data, not code branches)

| Case | Handling |
|---|---|
| Louisiana parishes, Alaska boroughs/census areas, Virginia independent cities | `geo_unit.attrs.legal_type` drives labels ("Parish", "Borough", "Census Area", "City") |
| Alaska results | RJ = state house district (SLDL is in the BU key, so this is exact). Borough-level displays are aggregations, labeled as such. |
| New England | RJ = town/MCD. County displays aggregate towns. ME/NH unorganized territories are their own RJs. |
| Connecticut | 8 counties at the 2016 vintage (no county government. Displays still work). |
| County set over time | Frozen at the 2016 vintage. Post-2016 real-world changes (Valdez-Cordova split in 2019, Connecticut planning regions in 2022) were administrative decisions in the *real* timeline and are not imported. The versioning system can represent them if a simulated law ever requires it. |
| Nebraska | Unicameral, nonpartisan legislature (SLDU only); EVs by CD |
| Maine | EVs by CD; RCV only if adopted in-universe (the real 2016 ballot measure is a simulated contest) |
| DC | Single county-equivalent; 3 EVs (23rd Amendment); wards in Phase 7 |
| Territories | Out of scope (spec covers 50 states + DC). Non-voting delegates possible later. |

## 6.7 Rendering

- **Projection at build time.** The national map uses a composite Albers USA (AK at reduced scale, HI inset).
  Coordinates are planar and quantized, so runtime is just affine pan/zoom with no trigonometry per frame.
- **Canvas2D renderer** (Phase 1–4 layers: states, counties, CDs). Each feature gets a cached `Path2D`. Fills redraw
  **only on data change**. Pan/zoom animations transform a cached bitmap and re-rasterize crisply when the
  animation ends. Measured: a full redraw of 3,142 counties takes 32 ms with software raster at 2× DPR, so
  redraw-on-change is fine and per-frame redraw is avoided.
- **WebGL2 renderer** for dense layers (SLDs, BUs/synthetic precincts). Polygons are triangulated once (earcut), and
  colors come from a per-feature color texture. Recoloring 300k features is a single texture upload, and
  outlines go to a separate line pass.
- **Hit-testing:** a `flatbush` index on feature bounding boxes plus point-in-polygon. Tooltips never scan all
  features.
- **LOD and lazy loading:** national LOD at start; per-state detail loads when a state is opened (cached by
  the service worker); BU layers load only in Interactive Map and Archive views.
- **Historical integrity:** each map layer is bound to a `boundary_version`. Rendering an election uses the
  geometry of the version recorded on that election. Simulated plans' geometry is produced by dissolving BU
  topology (`topojson.merge`) when the plan is enacted, and stored once.

## 6.8 Versioned district plans (implemented in Phase 6)

- **Plans are versioned, never edited.** Each kind of district (`cd`, `sldu`, `sldl`) has one global table: the
  2016 pack's districts keep their indices, and every adopted plan appends its districts (`district`,
  `district_plan` tables). A plan stores its BU assignment for one state (a compressed `Uint16` array) and the
  first election year it applies to. `Districts.assignment(kind, year, special)` gives the BU → district map
  for any year. Specials held before a new Congress convenes use the old plan.
- **Offices keep seat numbers.** A seat (say, "District 7") is elected from whatever district has that number in
  the plan in effect. Seats lost in reapportionment are abolished after their last election (`office_abolished`);
  seats gained are new offices. Old contests reference the district they were held in, so the archive and maps
  of earlier years stay exactly as they were.
- **Algorithm** (`geo/redistrict.ts`, neutral, no partisan data):
  1. Recursive population bisection at 16 angles. Both straight and county-respecting cuts are tried, scored by
     inertia (compactness) + a county-split penalty + 25 × population left on the wrong side.
  2. Each chosen cut is **settled**. Pieces of either side that are not connected to the rest of their side cross
     over; the cut is then re-balanced with boundary BUs (never the pieces just moved), a few times. A cut through
     a bay or a mountain range would otherwise strand pieces that later repairs hand to a neighbour, unbalancing
     whole regions.
  3. Contiguity repair on the BU graph (k = 8 nearest neighbours within the same or adjacent counties, components
     joined). Fragments under 35% of the ideal population go to the touching district with the most room.
  4. Rebalancing: boundary BUs move from over- to under-populated neighbours, minimising squared deviation, never
     disconnecting a district. Where every boundary BU is a bridge, a BU moves together with the small piece it
     cuts off. Districts act from a quarter of the tolerance, so surplus flows through balanced districts to a
     deficit several districts away.

  On the real geography with 2010 populations: worst deviation 0.43%, every district contiguous, 341 county splits
  across 43 multi-district states (the real 2016 plans split 409), and mean compactness 0.87 (the 2016 plans:
  0.81). All plans take about 20 s. On populations evolved to 2041, California's 54 and 57 districts come out
  within 0.12% and 0.34%.
- **Seat numbers follow constituents.** Each old district number goes to the new district holding most of that
  district's people (greedy by shared population, within districts of the same seat count). Districts left over
  take the remaining numbers in geographic order. A member's seat therefore continues where their voters are, and
  a state that loses seats ends the seats nobody continues. Their members run in the new district holding most of
  their old one.
- **Legislative plans** are drawn the same way, targeting ±4% of equal population per seat. Multi-member
  districts keep their seat counts (a two-seat district is drawn at twice the population). Where state law nests house districts in senate
  districts (AK, IL, IA, MN, MT, NV, OR, WY two per senate district; OH, WI three), the house plan is drawn by
  splitting each senate district.
- **Rendering:** the national map still draws the 2016 district shapes (its House layer says when new plans are
  in effect). The Government page draws any plan from its base units.

