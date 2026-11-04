# Geography pipeline (`tools/geo-pipeline`)

Build-time, developer-only pipeline that turns authoritative U.S. Census Bureau bulk files into the
geography pack the app loads (`public/geo-packs/2016.1/`, format in
[`docs/data/geo-pack-format.md`](../../docs/data/geo-pack-format.md)), plus seed data in `data/`.
End users never run it.

## Run

```bash
npm install --prefix tools/geo-pipeline          # its own dependencies, separate from the app
node --max-old-space-size=10000 tools/geo-pipeline/run.mjs                 # all steps
node tools/geo-pipeline/run.mjs --only validate                            # one step
node tools/geo-pipeline/run.mjs --from bu                                  # a step and everything after it
GEO_STATES=RI,DC GEO_FORCE=1 node tools/geo-pipeline/run.mjs --only blocks # re-process selected states
```

The full run needs Node 22+, `curl` and `unzip`, about 6 GB of free disk space (1.5 GB downloads plus
extracted files), and outbound HTTPS to `www2.census.gov` and `raw.githubusercontent.com`. The Census
API is **not** used, because it now requires a key. Every step caches its output under `.cache/`
(gitignored), so the pipeline can be resumed.

## Steps

| Step | Does | Output |
|---|---|---|
| `fetch` | Downloads every source in `lib/sources.mjs` with retries. It rejects HTML error pages and broken zips, and records URL, SHA-256, size and date in `sources.lock.json`. A later run fails if a locked file's hash changes. | `.cache/dl/` |
| `names` | 2010 Census surnames (top 20,000, with race shares) and 1990 Census given names | `data/names/*.json` |
| `blocklist` | Real politicians' names (Congress since 1945, presidents/VPs, curated governors 1990–2026), used only to reject generated names | `data/blocklist/politicians.json` |
| `blocks` | Parses 2010 PL 94-171 blocks (geo header + P1/P3/P4), attaches the official 2016 block equivalency files (CD115, SLDU, SLDL), recodes 2010→2016 county codes, and aggregates blocks into raw Base Units | `.cache/work/bu-raw/<fips>.json` |
| `acs` | ACS 2012–2016 block-group/tract B01001, B15003, B19013 from the summary file, plus the CVAP special tabulation | `.cache/work/acs/`, `cvap.json` |
| `bu` | Joins everything, builds counties/districts/towns/reporting jurisdictions, and imputes missing ACS values (flagged) | `.cache/work/tables.json` |
| `geometry` | Pre-projected (Albers USA, us-atlas convention), simplified and quantized TopoJSON for counties/states/nation and CD115. County adjacency comes from full-resolution TIGER/Line. | `public/geo-packs/2016.1/topo/` |
| `pack` | Writes the pack JSON tables, `bu.bin.gz`, `manifest.json` (file hashes, source list) and `data/timezones/county-tz.csv` | `public/geo-packs/2016.1/` |
| `validate` | Re-reads the written pack and checks every contract guarantee against independent references. Writes the report and exits non-zero on failure. | `docs/data/geo-pack-2016.1-validation.md` |

## Determinism

All output files are written with sorted keys and stable row order. gzip uses `mtime = 0`. Two runs over
the same locked inputs produce byte-identical pack files (only `manifest.json`'s `createdAt` and the
sources' `retrieved` dates can differ).

## Updating

To build a new pack version (for example a different vintage), copy `lib/sources.mjs` entries to the new
products, bump `PACK_VERSION` in `lib/util.mjs`, delete `sources.lock.json` entries for replaced sources,
run the full pipeline, and review the validation report. Never overwrite a released pack directory:
packs are append-only (architecture §5.1).
