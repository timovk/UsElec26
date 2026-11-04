# Geography Pack Format — `geo-pack 2016.1`

This is the contract between the build-time pipeline (`tools/geo-pipeline/`) and the application
(`src/geo/`). The pipeline writes these files to `public/geo-packs/2016.1/`. The app reads them without
any further processing beyond decompression.

All indices (`idx`) are **0-based, dense and stable within a pack version**. Tables are sorted by GEOID.
Projected coordinates use `d3.geoAlbersUsa().scale(1300).translate([487.5, 305])` (viewBox `0 0 975 610`,
the same as `us-atlas`), so screen-space y points down.

## Files

| File | Content |
|---|---|
| `manifest.json` | `{ packVersion, createdAt, pipelineVersion, projection:{name, scale, translate, viewBox}, counts:{…}, files:{name:{bytes, sha256}}, sources:[{id, url, sha256, bytes, retrieved, license, notes}] }` |
| `states.json` | `[{ idx, fips:"01", usps:"AL", name, region:1–4, division:1–9, pop2010, vap2010, pop2016 }]`: 50 states + DC (51) |
| `counties.json` | `[{ idx, geoid:"01001", stateIdx, name:"Autauga", fullName:"Autauga County", legalType, pop2010, vap2010, pop2016, landM2, tz, tzSplit, tzNote, centroid:[x,y], lonlat:[lon,lat], vtdCount2010, buStart, buCount }]`: 2016 vintage (3,142). `vtdCount2010` is 0 for every county in Kentucky and Rhode Island, whose 2010 PL 94-171 data carries no VTD codes. |
| `cd115.json` | `[{ idx, geoid:"0101", stateIdx, district (0 = at-large), pop2010, vap2010 }]`: 435. The District of Columbia has no entry (its non-voting delegate district is not a House seat). |
| `sldu2016.json`, `sldl2016.json` | `[{ idx, geoid, stateIdx, code, name, pop2010, vap2010 }]`. `name` is the cartographic-boundary NAME (e.g. "First Suffolk", "12", "01A"). Nebraska has no SLDL. DC has neither (the Census codes DC's wards as SLDU; they are not exported). |
| `cousub.json` | New England county subdivisions (towns, cities, plantations, gores, grants, locations, purchases, unorganized territories, reservations): `[{ idx, geoid (10), stateIdx, countyIdx, name, legalType, pop2010 }]`. Unpopulated water areas coded `00000` appear as "County subdivisions not defined" (legalType `undefined`). |
| `rj.json` | Reporting jurisdictions: `[{ idx, kind:"county"\|"town"\|"ak_house_district", stateIdx, code, name, countyIdx (null for AK HD), pop2010 }]`. Sorted by state, then code. Kalawao County (15005) has no RJ of its own: its BUs report with Maui County (15009). |
| `bu.bin.gz` | Base Units, columnar binary (below) |
| `county-adjacency.json` | `number[][]` indexed by county idx: rook-adjacent county indices (shared boundary of positive length), computed from full-resolution boundaries. Islands get `[]`. |
| `topo/counties.topo.json` | TopoJSON, pre-projected and quantized. Objects: `counties` (id = county GEOID, `properties.name`), `states` (id = state FIPS, merged from counties), `nation`. Simplified for national display, ≤ 1.5 MB. |
| `topo/cd115.topo.json` | TopoJSON, pre-projected. Object `cd115` (id = CD GEOID). Shoreline-clipped (cartographic boundary). ≤ 1.5 MB. |

`legalType` is one of `County`, `Parish`, `Borough`, `Census Area`, `City and Borough`, `Municipality`,
`City` (Virginia and other independent cities), `District` (DC). `tz` is an IANA zone. `tzSplit` is `true`
when the county itself is divided by a time-zone boundary; `tz` is then the zone of the county's
population majority.

**2016 vintage county codes:** 2010 source data uses some superseded codes. They are mapped as
`46113 → 46102` (Shannon → Oglala Lakota), `02270 → 02158` (Wade Hampton → Kusilvak), and
`51515 → 51019` (Bedford city merged into Bedford County, 2013).

## `bu.bin.gz`

A gzip stream whose decompressed bytes are:

```
bytes 0–3    ASCII "ENAB"
bytes 4–7    uint32 LE  headerLength = N
bytes 8–8+N  UTF-8 JSON header
padding      zero bytes up to a multiple of 8
columns      each column's raw little-endian array, each starting at an 8-byte-aligned offset
```

Header: `{ "rows": R, "sort": "state,county,tract,bg,part", "columns": [ { "name", "type", "byteOffset", "byteLength", "note"? } ] }`.
`type` ∈ `u8 u16 u32 i32 f32 f64`. `byteOffset` is relative to the start of the column area.

A **Base Unit** is a 2010 census block group split by every 2016 district boundary (CD115, SLDU, SLDL),
and in the six New England states also by county subdivision. Every block belongs to exactly one BU.

| Column | Type | Meaning |
|---|---|---|
| `county` | u16 | county idx |
| `cd` | u16 | cd115 idx, 65535 = none (District of Columbia) |
| `sldu` | u16 | sldu idx, 65535 = none |
| `sldl` | u16 | sldl idx, 65535 = none |
| `cousub` | u16 | cousub idx, 65535 = none (outside New England) |
| `rj` | u16 | reporting-jurisdiction idx |
| `tract` | u32 | 6-digit tract code as an integer (2016-vintage county) |
| `bg` | u8 | block group digit |
| `part` | u8 | 0-based part number within the block group |
| `blocks` | u16 | number of 2010 blocks |
| `pop2010` | u32 | total population (2010 Census, PL 94-171 P1) |
| `vap2010` | u32 | 18+ population (P3) |
| `vapHisp` | u32 | 18+ Hispanic (P4) |
| `vapWhiteNH` | u32 | 18+ White alone, not Hispanic (P4) |
| `vapBlackNH` | u32 | 18+ Black alone, not Hispanic (P4) |
| `landM2` | f32 | land area (sum of block `AREALAND`) |
| `x`, `y` | f32 | projected population-weighted centroid of block internal points (area-weighted if pop = 0) |
| `lon`, `lat` | f32 | the same centroid in degrees |
| `cvap` | f32 | citizen 18+ estimate (CVAP special tabulation 2012–2016, block group), apportioned to parts by `vap2010` share |
| `a18_29`, `a30_44`, `a45_64`, `a65p` | u16 | shares of 18+ population by age band (ACS 2012–2016 B01001, block group), × 1/65535 |
| `male18` | u16 | male share of 18+ (B01001), × 1/65535 |
| `college25` | u16 | share of 25+ with a bachelor's degree or higher (B15003), × 1/65535 |
| `medInc` | f32 | median household income (B19013), in 2016 dollars. If suppressed it is filled from the tract, then the county, and the row is flagged in `flags`. |
| `flags` | u8 | bit 0: income imputed; bit 1: ACS shares imputed from the tract or county (block group lacked data); bit 2: CVAP imputed |

The share columns hold block-group values (copied to every part of that block group). The pipeline
guarantees that `a18_29 + a30_44 + a45_64 + a65p ≈ 65535` (±4 from rounding).

## Validation guarantees (checked by the pipeline, reported in `docs/data/geo-pack-2016.1-validation.md`)

1. Every 2010 block in the 50 states + DC is assigned to exactly one BU.
2. Σ BU `pop2010` = the 2010 Census population for each county (2016-vintage mapping), each state and the nation.
3. Σ BU `pop2010` per CD115 deviates from the state's ideal district population by the published plan's deviation
   (reported per state). District assignments come from the official Census block equivalency files.
4. Every BU's `cd`, `sldu`, `sldl` and `county` belong to the same state.
5. `cvap ≤ vap2010 × 1.05` (ACS/decennial vintage mismatch is tolerated and reported). In practice ~30% of BUs exceed the
   ratio because of growth since 2010 and block-group sampling error. Consumers must smooth and cap the ratio.
6. Adjacency is symmetric. Topology has no gaps or overlaps at state seams. County count = 3,142.
