# Glossary

| Term | Meaning |
|---|---|
| **Base Unit (BU)** | The persistent fine geographic unit: a 2010 Census block group split by 2016 district boundaries. Every jurisdiction is an exact union of BUs. |
| **Atom** | For one boundary epoch, the maximal set of BUs sharing the same jurisdiction tuple (county, CD, SLDU, SLDL, place). It is the unit of exact cross-tabulation within that epoch. |
| **Boundary epoch** | The set of boundary versions in force for an election date. |
| **Reporting Jurisdiction (RJ)** | The unit that reports results on election night: a county, parish or independent city; a town in New England; a state house district in Alaska. |
| **Reporting Unit (RU)** | A *synthetic precinct*: a group of BUs inside one RJ. It is always labelled synthetic. |
| **Cohort** | A demographic cell (age × sex × education × race/ethnicity), 64 in all. |
| **Cohort class** | One of 4 per-universe clusters of cohorts with similar issue positions. |
| **Voter type** | (cohort class, partisanship bin): 64 types per BU that carry the shared electorate. |
| **Environment (Δ)** | The short-term political forces shared by every contest on a ballot (national, class, regional, state, county, local). |
| **Valence (V)** | Contest-specific candidate effects: quality, incumbency, home area, campaign, scandal, ideology fit. |
| **Ballot lock** | The instant results are realized and sealed as revision 0. |
| **Revision** | An immutable version of a contest's results: cast, unofficial, canvass, certified, recount, correction. |
| **Seal** | A SHA-256 hash over a canonical encoding of a revision or record. |
| **Count plan** | The seeded schedule of reporting batches that partitions the cast results exactly. |
| **Wire / wire feed** | The fictional tabulation service and its stream of batches and expected-vote estimates. |
| **Decision desk** | A network's race-projection model and rules. |
| **Night Record** | The stored, sealed feed plus every projection, alert and commentary line of an election night. |
| **Public Record** | Everything an in-universe observer could know: published polls, released statistics, results, filings, news. |
| **Information firewall** | The rule that observers (polling, forecasting, projections, broadcast) read only the Public Record. |
| **Simulation truth** | Latent values (true partisanship, true remaining vote). They are visible only in labelled analysis views. |
| **Comparability class** | Direct, Reaggregated (exact), or Estimated: the label on every historical comparison. |
| **Geography pack** | A versioned, content-hashed bundle of geometry and semantic geographic tables, built at build time from Census sources. |
| **`ENA1`** | The project's columnar blob codec (varint + deflate-raw + CRC32). |
| **`.ena` file** | A universe export: header, checksum, and the gzip-compressed SQLite database. |
| **VEP / VAP / CVAP** | Voting-eligible population, voting-age population, citizen voting-age population. |
| **OPFS / sahpool** | Origin Private File System, and SQLite's SyncAccessHandle-pool VFS for it. |
