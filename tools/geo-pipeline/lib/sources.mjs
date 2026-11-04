// Every external input of the pipeline. URLs verified by directory listing on 2026-11-04.
import { STATES, NEW_ENGLAND } from './states.mjs';

const W = 'https://www2.census.gov';
const CC0 = 'CC0 1.0 (unitedstates/congress-legislators)';
export const ACS_SEQS = { B01001: '0002', B15003: '0043', B19013: '0059' };
// Per-sequence files that the Census web firewall consistently rejects; taken from the whole-state archive instead.
export const ACS_WHOLE_STATE = new Set(['AZ:0002']);

export function allSources() {
  const s = [];
  const PL = `${W}/census_2010/01-Redistricting_File--PL_94-171`;
  for (const f of ['pl_geohd_2010.sas', 'pl_part1_2010.sas', 'pl_part2_2010.sas'])
    s.push({ id: `pl94-layout-${f}`, url: `${PL}/${f}`, group: 'pl94', notes: '2010 PL 94-171 SAS layout (field positions)' });
  for (const st of STATES)
    s.push({ id: `pl94-${st.usps}`, url: `${PL}/${st.dir}/${st.usps.toLowerCase()}2010.pl.zip`, group: 'pl94',
      notes: `2010 Census Redistricting Data (PL 94-171), ${st.name}: geographic header, P1, P3, P4` });
  const RDO = `${W}/programs-surveys/decennial/rdo`;
  s.push({ id: 'bef-cd115', url: `${RDO}/mapping-files/2017/115-congressional-district-bef/cd115.zip`, group: 'bef', notes: '115th Congress block equivalency file (2010 blocks)' });
  s.push({ id: 'bef-sldu2016', url: `${RDO}/mapping-files/2016/2016-state-legislative-bef/sldu_2016.zip`, group: 'bef', notes: '2016 state legislative (upper) block equivalency file' });
  s.push({ id: 'bef-sldl2016', url: `${RDO}/mapping-files/2016/2016-state-legislative-bef/sldl_2016.zip`, group: 'bef', notes: '2016 state legislative (lower) block equivalency file' });
  s.push({ id: 'cvap-2016', url: `${RDO}/datasets/2016/2016-cvap/CVAP_2012-2016_ACS_csv_files.zip`, group: 'cvap', notes: 'CVAP special tabulation from ACS 2012–2016 (block group)' });
  s.push({ id: 'popest-v2016', url: `${W}/programs-surveys/popest/datasets/2010-2016/counties/totals/co-est2016-alldata.csv`, group: 'popest', notes: 'Vintage 2016 county population estimates' });
  const ACS = `${W}/programs-surveys/acs/summary_file/2016`;
  s.push({ id: 'acs5-2016-seqlookup', url: `${ACS}/documentation/user_tools/ACS_5yr_Seq_Table_Number_Lookup.txt`, group: 'acs', notes: 'ACS 2012–2016 sequence/table lookup' });
  for (const st of STATES) {
    const base = `${ACS}/data/5_year_seq_by_state/${st.acsDir}/Tracts_Block_Groups_Only`;
    const ab = st.usps.toLowerCase();
    s.push({ id: `acs5-2016-geo-${st.usps}`, url: `${base}/g20165${ab}.csv`, group: `acs/${st.usps}`, notes: `ACS 2012–2016 geography file, ${st.name}` });
    for (const [tbl, seq] of Object.entries(ACS_SEQS)) {
      if (ACS_WHOLE_STATE.has(`${st.usps}:${seq}`)) {
        s.push({ id: `acs5-2016-tbg-${st.usps}`, url: `${ACS}/data/5_year_by_state/${st.acsDir}_Tracts_Block_Groups_Only.zip`, group: `acs/${st.usps}`,
          notes: `ACS 2012–2016, all sequences for tracts and block groups, ${st.name}. Used because the per-sequence file for sequence ${seq} is answered with a "Request Rejected" page by the Census web firewall.` });
        continue;
      }
      s.push({ id: `acs5-2016-${seq}-${st.usps}`, url: `${base}/20165${ab}${seq}000.zip`, group: `acs/${st.usps}`, notes: `ACS 2012–2016 sequence ${seq} (${tbl}), tracts and block groups, ${st.name}` });
    }
  }
  const CB = `${W}/geo/tiger/GENZ2016/shp`;
  for (const f of ['cb_2016_us_county_5m', 'cb_2016_us_county_500k', 'cb_2016_us_cd115_5m'])
    s.push({ id: f, url: `${CB}/${f}.zip`, group: 'cb', notes: '2016 cartographic boundary file' });
  for (const st of STATES) {
    if (st.fips === '11') continue; // DC has no state legislative districts
    s.push({ id: `cb_2016_${st.fips}_sldu_500k`, url: `${CB}/cb_2016_${st.fips}_sldu_500k.zip`, group: 'cb', notes: `2016 SLDU names, ${st.name}` });
    if (st.fips !== '31') s.push({ id: `cb_2016_${st.fips}_sldl_500k`, url: `${CB}/cb_2016_${st.fips}_sldl_500k.zip`, group: 'cb', notes: `2016 SLDL names, ${st.name}` });
    if (NEW_ENGLAND.has(st.fips)) s.push({ id: `cb_2016_${st.fips}_cousub_500k`, url: `${CB}/cb_2016_${st.fips}_cousub_500k.zip`, group: 'cb', notes: `2016 county subdivision names, ${st.name}` });
  }
  s.push({ id: 'tl_2016_us_county', url: `${W}/geo/tiger/TIGER2016/COUNTY/tl_2016_us_county.zip`, group: 'tiger',
    notes: 'TIGER/Line 2016 counties, full resolution, not shoreline-clipped (used for county adjacency)' });
  s.push({ id: 'tl_2016_us_cd115', url: `${W}/geo/tiger/TIGER2016/CD/tl_2016_us_cd115.zip`, group: 'tiger',
    notes: 'TIGER/Line 2016 CD115 polygons (used only to cross-check the Virginia CD2/CD3 assignment in validation)' });
  s.push({ id: 'surnames-2010', url: `${W}/topics/genealogy/2010surnames/names.zip`, group: 'names', notes: '2010 Census surname file' });
  for (const f of ['dist.male.first', 'dist.female.first'])
    s.push({ id: `given-1990-${f}`, url: `${W}/topics/genealogy/1990surnames/${f}`, group: 'names', notes: '1990 Census first-name frequency file' });
  const LEG = 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main';
  for (const f of ['legislators-current.yaml', 'legislators-historical.yaml', 'executive.yaml'])
    s.push({ id: `congress-legislators-${f}`, url: `${LEG}/${f}`, group: 'legislators', license: CC0, notes: 'Used only to reject generated names matching real politicians' });
  return s;
}
