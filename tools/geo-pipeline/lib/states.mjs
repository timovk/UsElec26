// 50 states + DC: FIPS, USPS, name, PL94 directory name, ACS directory name, Census region/division.
// Region: 1 Northeast, 2 Midwest, 3 South, 4 West. Division 1–9 per Census Bureau definitions.
export const STATES = [
  ['01', 'AL', 'Alabama', 3, 6], ['02', 'AK', 'Alaska', 4, 9], ['04', 'AZ', 'Arizona', 4, 8],
  ['05', 'AR', 'Arkansas', 3, 7], ['06', 'CA', 'California', 4, 9], ['08', 'CO', 'Colorado', 4, 8],
  ['09', 'CT', 'Connecticut', 1, 1], ['10', 'DE', 'Delaware', 3, 5], ['11', 'DC', 'District of Columbia', 3, 5],
  ['12', 'FL', 'Florida', 3, 5], ['13', 'GA', 'Georgia', 3, 5], ['15', 'HI', 'Hawaii', 4, 9],
  ['16', 'ID', 'Idaho', 4, 8], ['17', 'IL', 'Illinois', 2, 3], ['18', 'IN', 'Indiana', 2, 3],
  ['19', 'IA', 'Iowa', 2, 4], ['20', 'KS', 'Kansas', 2, 4], ['21', 'KY', 'Kentucky', 3, 6],
  ['22', 'LA', 'Louisiana', 3, 7], ['23', 'ME', 'Maine', 1, 1], ['24', 'MD', 'Maryland', 3, 5],
  ['25', 'MA', 'Massachusetts', 1, 1], ['26', 'MI', 'Michigan', 2, 3], ['27', 'MN', 'Minnesota', 2, 4],
  ['28', 'MS', 'Mississippi', 3, 6], ['29', 'MO', 'Missouri', 2, 4], ['30', 'MT', 'Montana', 4, 8],
  ['31', 'NE', 'Nebraska', 2, 4], ['32', 'NV', 'Nevada', 4, 8], ['33', 'NH', 'New Hampshire', 1, 1],
  ['34', 'NJ', 'New Jersey', 1, 2], ['35', 'NM', 'New Mexico', 4, 8], ['36', 'NY', 'New York', 1, 2],
  ['37', 'NC', 'North Carolina', 3, 5], ['38', 'ND', 'North Dakota', 2, 4], ['39', 'OH', 'Ohio', 2, 3],
  ['40', 'OK', 'Oklahoma', 3, 7], ['41', 'OR', 'Oregon', 4, 9], ['42', 'PA', 'Pennsylvania', 1, 2],
  ['44', 'RI', 'Rhode Island', 1, 1], ['45', 'SC', 'South Carolina', 3, 5], ['46', 'SD', 'South Dakota', 2, 4],
  ['47', 'TN', 'Tennessee', 3, 6], ['48', 'TX', 'Texas', 3, 7], ['49', 'UT', 'Utah', 4, 8],
  ['50', 'VT', 'Vermont', 1, 1], ['51', 'VA', 'Virginia', 3, 5], ['53', 'WA', 'Washington', 4, 9],
  ['54', 'WV', 'West Virginia', 3, 5], ['55', 'WI', 'Wisconsin', 2, 3], ['56', 'WY', 'Wyoming', 4, 8],
].map(([fips, usps, name, region, division]) => ({
  fips, usps, name, region, division,
  dir: name.replace(/ /g, '_'),           // PL94 directory: District_of_Columbia, New_Hampshire …
  acsDir: name.split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join(''), // ACS: DistrictOfColumbia, NewHampshire …
}));
export const NEW_ENGLAND = new Set(['09', '23', '25', '33', '44', '50']);
export const byFips = new Map(STATES.map((s) => [s.fips, s]));
// 2010-vintage → 2016-vintage county code changes.
export const COUNTY_RECODE = new Map([['46113', '46102'], ['02270', '02158'], ['51515', '51019']]);
