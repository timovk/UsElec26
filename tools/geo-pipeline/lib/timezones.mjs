// County → time zone, compiled from the federal definition of U.S. time-zone boundaries
// (49 CFR Part 71, "Standard Time Zone Boundaries"). Zones are given as the canonical IANA zone whose
// rules are identical to the county's zone since 2007 (e.g. Indiana's America/Indiana/* zones and
// America/Detroit, America/Boise, America/Kentucky/* behave exactly like the zone named here for every
// date the simulation can reach, 2016 onward).
//
// `split` marks counties crossed by a zone boundary; `tz` is then the zone of the population majority
// (best estimate from settlement patterns; where the split is close the county seat's zone is used and
// the note says so).

const ET = 'America/New_York', CT = 'America/Chicago', MT = 'America/Denver', AZ = 'America/Phoenix';
const PT = 'America/Los_Angeles', AK = 'America/Anchorage', HT = 'Pacific/Honolulu';

export const STATE_DEFAULT = {
  AL: CT, AK, AZ, AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET, FL: ET, GA: ET, HI: HT, ID: MT, IL: CT,
  IN: ET, IA: CT, KS: CT, KY: ET, LA: CT, ME: ET, MD: ET, MA: ET, MI: ET, MN: CT, MS: CT, MO: CT, MT: MT,
  NE: CT, NV: PT, NH: ET, NJ: ET, NM: MT, NY: ET, NC: ET, ND: CT, OH: ET, OK: CT, OR: PT, PA: ET, RI: ET,
  SC: ET, SD: CT, TN: CT, TX: CT, UT: MT, VT: ET, VA: ET, WA: PT, WV: ET, WI: CT, WY: MT,
};

// Exceptions by county NAME (2016 vintage, as in the cartographic boundary file) within each state.
// [zone, split?, note?]
export const EXCEPTIONS = {
  FL: {
    Escambia: [CT], 'Santa Rosa': [CT], Okaloosa: [CT], Walton: [CT], Holmes: [CT], Washington: [CT],
    Bay: [CT], Jackson: [CT], Calhoun: [CT],
    Gulf: [ET, true, 'Split along the Intracoastal Waterway: north (Wewahitchka) Central, south (Port St. Joe) Eastern; near-even split, county seat zone used'],
  },
  IN: Object.fromEntries(['Lake', 'Porter', 'LaPorte', 'Newton', 'Jasper', 'Starke', 'Gibson', 'Posey', 'Vanderburgh', 'Warrick', 'Spencer', 'Perry'].map((n) => [n, [CT]])),
  KY: Object.fromEntries(['Adair', 'Allen', 'Ballard', 'Barren', 'Breckinridge', 'Butler', 'Caldwell', 'Calloway', 'Carlisle',
    'Christian', 'Clinton', 'Crittenden', 'Cumberland', 'Daviess', 'Edmonson', 'Fulton', 'Graves', 'Grayson', 'Green',
    'Hancock', 'Hart', 'Henderson', 'Hickman', 'Hopkins', 'Livingston', 'Logan', 'Lyon', 'McCracken', 'McLean', 'Marshall',
    'Metcalfe', 'Monroe', 'Muhlenberg', 'Ohio', 'Russell', 'Simpson', 'Todd', 'Trigg', 'Union', 'Warren', 'Webster'].map((n) => [n, [CT]])),
  TN: Object.fromEntries(['Anderson', 'Blount', 'Bradley', 'Campbell', 'Carter', 'Claiborne', 'Cocke', 'Grainger', 'Greene',
    'Hamblen', 'Hamilton', 'Hancock', 'Hawkins', 'Jefferson', 'Johnson', 'Knox', 'Loudon', 'McMinn', 'Meigs', 'Monroe',
    'Morgan', 'Polk', 'Rhea', 'Roane', 'Scott', 'Sevier', 'Sullivan', 'Unicoi', 'Union', 'Washington'].map((n) => [n, [ET]])),
  MI: { Gogebic: [CT], Iron: [CT], Dickinson: [CT], Menominee: [CT] },
  TX: { 'El Paso': [MT], Hudspeth: [MT], Culberson: [CT, true, 'Northwestern corner (Guadalupe Mountains) observes Mountain Time'] },
  KS: { Greeley: [MT], Hamilton: [MT], Sherman: [MT], Wallace: [MT] },
  NE: {
    ...Object.fromEntries(['Arthur', 'Banner', 'Box Butte', 'Chase', 'Cheyenne', 'Dawes', 'Deuel', 'Dundy', 'Garden', 'Grant',
      'Hooker', 'Keith', 'Kimball', 'Morrill', 'Perkins', 'Scotts Bluff', 'Sheridan', 'Sioux'].map((n) => [n, [MT]])),
    Cherry: [CT, true, 'Western part observes Mountain Time; county seat (Valentine) and majority Central'],
  },
  SD: Object.fromEntries(['Bennett', 'Butte', 'Corson', 'Custer', 'Dewey', 'Fall River', 'Haakon', 'Harding', 'Jackson',
    'Lawrence', 'Meade', 'Oglala Lakota', 'Pennington', 'Perkins', 'Ziebach'].map((n) => [n, [MT]])),
  ND: {
    ...Object.fromEntries(['Adams', 'Billings', 'Bowman', 'Dunn', 'Golden Valley', 'Grant', 'Hettinger', 'Slope', 'Stark'].map((n) => [n, [MT]])),
    McKenzie: [CT, true, 'Southern part observes Mountain Time; majority (Watford City) Central'],
    Sioux: [CT, true, 'Western part observes Mountain Time; county seat (Fort Yates) Central — verify'],
  },
  ID: {
    ...Object.fromEntries(['Benewah', 'Bonner', 'Boundary', 'Clearwater', 'Kootenai', 'Latah', 'Lewis', 'Nez Perce', 'Shoshone'].map((n) => [n, [PT]])),
    Idaho: [PT, true, 'Part south of the Salmon River observes Mountain Time; majority (Grangeville) Pacific'],
  },
  OR: { Malheur: [MT, true, 'Small southern portion observes Pacific Time'] },
  NV: { Elko: [PT, true, 'West Wendover observes Mountain Time'] },
  AZ: {
    Apache: [AZ, true, 'Navajo Nation portion observes daylight saving time (MDT in summer); identical to MST in November'],
    Navajo: [AZ, true, 'Navajo Nation portion observes daylight saving time (MDT in summer); identical to MST in November'],
    Coconino: [AZ, true, 'Navajo Nation portion observes daylight saving time (MDT in summer); identical to MST in November'],
  },
  AK: { 'Aleutians West': [AK, true, 'Adak and Atka (west of 169°30′W) observe Hawaii–Aleutian Time (America/Adak); majority (Unalaska) Alaska Time'] },
  AL: { Russell: [CT, false, 'Phenix City area unofficially observes Eastern Time; legally Central'] },
};

export function countyTimezone(usps, countyName) {
  const ex = EXCEPTIONS[usps]?.[countyName];
  if (ex) return { tz: ex[0], split: ex[1] ?? false, note: ex[2] ?? '' };
  return { tz: STATE_DEFAULT[usps], split: false, note: '' };
}

/** Verify that every exception name exists (catches typos). Returns the names that were not found. */
export function unusedExceptions(countiesByState) {
  const missing = [];
  for (const [usps, m] of Object.entries(EXCEPTIONS))
    for (const name of Object.keys(m)) if (!countiesByState.get(usps)?.has(name)) missing.push(`${usps}:${name}`);
  return missing;
}
