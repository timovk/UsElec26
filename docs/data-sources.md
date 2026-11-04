# Data sources

All external data used by Election Night: America, as required by spec §20.6. Exact URLs, SHA-256 hashes,
sizes and retrieval dates of every file are pinned in
[`tools/geo-pipeline/sources.lock.json`](../tools/geo-pipeline/sources.lock.json), and the derived pack lists them
in `public/geo-packs/2016.1/manifest.json`.

**License of U.S. Census Bureau products:** works of the U.S. Government, in the public domain in the United
States (17 U.S.C. §105).

| Dataset | Publisher | Coverage | Reference | Used for | Known limitations |
|---|---|---|---|---|---|
| 2010 Census Redistricting Data (PL 94-171): geographic header, P1, P3, P4 | Census Bureau | All 11,078,297 blocks in 50 states + DC | April 1, 2010 | Block populations (total, 18+, 18+ by Hispanic origin and race), land area, internal points, county subdivision and VTD codes | 2010 counts. The app scales them to 2016 with county estimates. VTD codes are empty for Kentucky and Rhode Island. |
| 115th Congress Block Equivalency File (`cd115.zip`) | Census Bureau (Redistricting Data Office) | Every 2010 block | Plans in force for the 115th Congress (2017–2019), including the 2016 court-ordered plans in FL, NC and VA | Block → congressional district | 247 water blocks coded "ZZ" (no population) are assigned from block-group neighbours. Virginia CD2/CD3 differ by 38,558 people as published (see validation report). |
| 2016 State Legislative District BEFs (`sldu_2016.zip`, `sldl_2016.zip`) | Census Bureau (RDO) | Every 2010 block (SLDL excludes NE and DC) | Plans in force for the 2016 elections | Block → state senate / house district | "ZZZ" water blocks (no population) are assigned from neighbours. DC's wards (coded as SLDU) are not used. |
| ACS 2012–2016 5-year Summary File, tracts and block groups: B01001, B15003, B19013 | Census Bureau | All tracts and block groups | 2012–2016 | Age and sex shares of adults, college attainment (25+), median household income | Sampling error is large at block-group level. Suppressed values are imputed from the tract, then the county (flagged). For Arizona, sequence 2 comes from the whole-state archive because the per-sequence file URL is blocked by the Census web firewall. |
| CVAP Special Tabulation, ACS 2012–2016 | Census Bureau (RDO) | Block groups, tracts, counties | 2012–2016 | Citizen voting-age population (eligible-electorate base) | It is an ACS estimate, not a count. The per-unit ratio to 2010 VAP is noisy and must be smoothed before use. |
| County population estimates, Vintage 2016 (`co-est2016-alldata.csv`) | Census Bureau (Population Estimates Program) | All counties | July 1, 2016 | Scaling to 2016. Independent check of 2010 county totals (CENSUS2010POP). | Estimates are modeled values, not counts |
| Cartographic Boundary Files 2016: counties (5m, 500k), CD115 (5m), SLDU/SLDL (500k), New England county subdivisions (500k) | Census Bureau | 50 states + DC | 2016 | Rendering geometry; district and town names; county legal types | Generalized and shoreline-clipped (rendering only) |
| TIGER/Line 2016 counties (full resolution) | Census Bureau | 50 states + DC | 2016 | County adjacency (rook) | Boundaries extend into water, so counties across rivers or bays are adjacent |
| 2010 Census surname file | Census Bureau | Surnames held by 100+ people | 2010 | Fictional name generation (frequencies, race shares) | No apostrophes or spaces in source; a curated list restores forms like O'Brien and MacDonald |
| 1990 Census first-name files | Census Bureau | ~5,500 given names | 1990 | Fictional given names | Not birth-year specific (SSA files were not reachable from the build environment) |
| `unitedstates/congress-legislators` | Community project | Congress since 1789, presidents and VPs | current | Blocklist: rejecting generated names equal to real politicians | CC0 1.0. Governors and DC mayors come from a curated list (general knowledge) and may be incomplete. |
| 2016 institutional baseline (`src/rules/states2016.ts`): Senate classes, governor cycles and term limits, statewide offices, chamber sizes, vacancy and succession rules | Compiled from state constitutions and statutes as summarized by NCSL, NASS and NGA (developer knowledge) | 50 states + DC | January 1, 2016 | Initial institutions and vacancy handling | Structural invariants are tested (seat totals, class sizes, office counts). Individual entries should be verified against primary sources. Felony-disenfranchisement shares are approximate estimates. |
| 49 CFR Part 71 (Standard Time Zone Boundaries) | U.S. Department of Transportation (regulation) | All counties | current | County time zones (`data/timezones/county-tz.csv`) | Split counties are assigned their population-majority zone. Close calls are noted in the file. |

## Update procedure

See [`tools/geo-pipeline/README.md`](../tools/geo-pipeline/README.md#updating). New vintages become new pack
versions. Existing packs are never modified, because saved universes reference them.
