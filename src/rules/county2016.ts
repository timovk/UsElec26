/**
 * County government as each state's law stood on January 1, 2016 (Phase 7.6): the county governing body (commission,
 * board of supervisors, council, quorum court, fiscal court, police jury…), the elected executive where there is one
 * (county executive, county judge, county mayor, judge/executive, parish president), and every elected county office
 * — sheriff, clerks, treasurer, assessor, auditor, recorder, coroner, surveyor, probate judge and the rest — plus the
 * prosecutors (district attorneys, state's attorneys, county attorneys, solicitors, commonwealth's attorneys) and, in
 * Florida, the public defenders elected by judicial circuit.
 *
 * Compiled from state constitutions and statutes as summarized by NACo, NCSL, Ballotpedia and the state election
 * offices (developer knowledge). Which offices are elected, their terms and whether they are partisan are legal
 * facts of 2016; board sizes (by county population, with the largest counties given individually), the year each
 * office is up and the staggering of board seats are estimates where the law varies county by county. Later phases
 * change these only through simulated law.
 *
 * Districts:
 * - **Board districts** are drawn by the simulation inside each county (the real lines are not in the geography
 *   pack), from 2010 Census populations, and redrawn after each simulated census.
 * - **Prosecutorial districts** that span several counties are the real 2016 circuits where listed here (Florida,
 *   Georgia, Alabama, Colorado, South Carolina, Tennessee, New Mexico, Maine, Massachusetts). In Arkansas, Kentucky,
 *   Louisiana, Mississippi, North Carolina, Oklahoma and Texas the districts are generated: neighbouring counties
 *   grouped into each state's 2016 number of districts.
 *
 * Consolidated city-counties (San Francisco, Denver, Jacksonville, Indianapolis, Nashville, Louisville, New Orleans,
 * Philadelphia, Baltimore, St. Louis, New York City's boroughs, Honolulu, Anchorage, Virginia's independent cities…)
 * elect their county offices here; their mayor and council are city government (Phase 7.7).
 */

/** Kinds of county offices (also members of the institutions' OfficeKind). */
export type CountyKind = 'county_board' | 'county_executive' | 'sheriff' | 'prosecutor' | 'county_clerk' | 'court_clerk' | 'county_treasurer'
  | 'county_assessor' | 'county_auditor' | 'county_recorder' | 'coroner' | 'county_surveyor' | 'county_official';

export const COUNTY_KINDS: readonly CountyKind[] = ['county_board', 'county_executive', 'sheriff', 'prosecutor', 'county_clerk', 'court_clerk', 'county_treasurer',
  'county_assessor', 'county_auditor', 'county_recorder', 'coroner', 'county_surveyor', 'county_official'];
const KIND_SET = new Set<string>(COUNTY_KINDS);
export const isCountyKind = (k: string): boolean => KIND_SET.has(k);

/** How a nonpartisan county race is narrowed and decided (as rules/downballot2016's NpFlow). */
export type CountyNp = 'two' | 'majority' | 'none';

/** Which counties an office or override applies to: by 2010 population, or by name ("Baltimore|City" for an independent city). */
export interface Where { minPop?: number; maxPop?: number; only?: string[]; not?: string[] }

/** One elected county office (a single seat, or `seats` seats elected together at large). */
export interface COffice {
  key: string; kind: CountyKind; name: string; term: number;
  /** Election year (or years, one picked per county) of the office's cycle. */
  y: number | number[];
  np?: boolean; where?: Where; seats?: number;
}

/** A county's governing body. */
export interface CBoard {
  key?: string; name: string; member: string;
  /** Seats, or [minimum 2010 population, seats] tiers from the largest. */
  size: number | [number, number][];
  /**
   * `district`: each member elected by a district of the county; `at_large`: countywide, the seats up together are one
   * "vote for N" race; `residency`: countywide, one race per seat (members live in the seat's district).
   */
  by: 'district' | 'at_large' | 'residency';
  term: number;
  /** Election years of the seats (staggered across them in turn). */
  y: number[];
  /** A chair (president, chairman) elected countywide besides the members. */
  chair?: { name: string; term: number; y: number; where?: Where };
  np?: boolean; spring?: boolean;
  /** Pennsylvania's limited voting: each voter marks this many of the seats up (the minority party wins a seat). */
  limited?: number;
  where?: Where;
}

export interface CExec { name: string; term: number; y: number | number[]; where?: Where; np?: boolean; spring?: boolean }

/** A prosecutor (or public defender) elected by county or by a multi-county district. */
export interface CPros {
  key?: string; kind?: CountyKind; name: string; term: number; y: number | number[];
  by: 'county' | 'circuit' | 'generated';
  /** Real 2016 districts: [name, counties]. */
  circuits?: [string, string[]][];
  /** Generated districts: how many the state had in 2016. */
  count?: number;
  /** District title, e.g. "Judicial Circuit", "Prosecutorial District". */
  districtWord?: string;
  np?: boolean; where?: Where;
}

export interface CountyState {
  /** No elected county government (Connecticut, Rhode Island, the District of Columbia): why. */
  none?: string;
  /** County offices are nonpartisan (California, Minnesota, Hawaii, North Dakota), and how races are narrowed. */
  np?: boolean; npFlow?: CountyNp;
  /** County races decided on the state's primary day (Tennessee's August county election; nonpartisan majority states). */
  onPrimary?: boolean;
  boards: CBoard[];
  exec?: CExec;
  offices: COffice[];
  pros: CPros[];
  /** Why the state elects no prosecutors locally. */
  prosNone?: string;
  /** Consolidated city-counties and independent cities: their governing body and executive are city government (Phase 7.7). */
  city?: string[];
  /** Per-county structure of the largest counties: replaces the default boards and executive. */
  over?: Record<string, { boards?: CBoard[]; exec?: CExec | null; drop?: string[] }>;
  /** Counties without county government at all (Alaska's census areas, Massachusetts's abolished counties keep row offices). */
  noGov?: Where;
}

// ---- Constructors ----------------------------------------------------------------------------------------

const off = (key: string, kind: CountyKind, name: string, term: number, y: number | number[], o: Partial<COffice> = {}): COffice => ({ key, kind, name, term, y, ...o });
const sheriff = (term = 4, y: number | number[] = 2016, o: Partial<COffice> = {}) => off('sheriff', 'sheriff', 'Sheriff', term, y, o);
const clerk = (name = 'County Clerk', term = 4, y: number | number[] = 2016, o: Partial<COffice> = {}) => off('clerk', 'county_clerk', name, term, y, o);
const courtClerk = (name = 'Clerk of the Circuit Court', term = 4, y: number | number[] = 2016, o: Partial<COffice> = {}) => off(o.key ?? 'courtclerk', 'court_clerk', name, term, y, o);
const treasurer = (term = 4, y: number | number[] = 2016, o: Partial<COffice> = {}) => off('treasurer', 'county_treasurer', o.name ?? 'Treasurer', term, y, o);
const assessor = (name = 'Assessor', term = 4, y: number | number[] = 2016, o: Partial<COffice> = {}) => off('assessor', 'county_assessor', name, term, y, o);
const auditor = (name = 'Auditor', term = 4, y: number | number[] = 2016, o: Partial<COffice> = {}) => off('auditor', 'county_auditor', name, term, y, o);
const recorder = (name = 'Register of Deeds', term = 4, y: number | number[] = 2016, o: Partial<COffice> = {}) => off('recorder', 'county_recorder', name, term, y, o);
const coroner = (term = 4, y: number | number[] = 2016, o: Partial<COffice> = {}) => off('coroner', 'coroner', 'Coroner', term, y, o);
const surveyor = (term = 4, y: number | number[] = 2016, o: Partial<COffice> = {}) => off('surveyor', 'county_surveyor', 'Surveyor', term, y, o);
const other = (key: string, name: string, term = 4, y: number | number[] = 2016, o: Partial<COffice> = {}) => off(key, 'county_official', name, term, y, o);
const board = (name: string, member: string, size: CBoard['size'], by: CBoard['by'], term: number, y: number[], o: Partial<CBoard> = {}): CBoard => ({ name, member, size, by, term, y, ...o });
const pros = (name: string, term: number, y: number | number[], o: Partial<CPros> = {}): CPros => ({ name, term, y, by: 'county', ...o });
const circuit = (name: string, term: number, y: number | number[], circuits: [string, string[]][], districtWord: string, o: Partial<CPros> = {}): CPros => ({ name, term, y, by: 'circuit', circuits, districtWord, ...o });
const generated = (name: string, term: number, y: number | number[], count: number, districtWord: string, o: Partial<CPros> = {}): CPros => ({ name, term, y, by: 'generated', count, districtWord, ...o });
const S = (...names: string[]) => names;
const BIG = 250_000;

// ---- The real multi-county prosecutorial districts of 2016 ----------------------------------------------------

const FL_CIRCUITS: [string, string[]][] = [
  ['1st', S('Escambia', 'Okaloosa', 'Santa Rosa', 'Walton')], ['2nd', S('Franklin', 'Gadsden', 'Jefferson', 'Leon', 'Liberty', 'Wakulla')],
  ['3rd', S('Columbia', 'Dixie', 'Hamilton', 'Lafayette', 'Madison', 'Suwannee', 'Taylor')], ['4th', S('Clay', 'Duval', 'Nassau')],
  ['5th', S('Citrus', 'Hernando', 'Lake', 'Marion', 'Sumter')], ['6th', S('Pasco', 'Pinellas')], ['7th', S('Flagler', 'Putnam', 'St. Johns', 'Volusia')],
  ['8th', S('Alachua', 'Baker', 'Bradford', 'Gilchrist', 'Levy', 'Union')], ['9th', S('Orange', 'Osceola')], ['10th', S('Hardee', 'Highlands', 'Polk')],
  ['11th', S('Miami-Dade')], ['12th', S('DeSoto', 'Manatee', 'Sarasota')], ['13th', S('Hillsborough')],
  ['14th', S('Bay', 'Calhoun', 'Gulf', 'Holmes', 'Jackson', 'Washington')], ['15th', S('Palm Beach')], ['16th', S('Monroe')], ['17th', S('Broward')],
  ['18th', S('Brevard', 'Seminole')], ['19th', S('Indian River', 'Martin', 'Okeechobee', 'St. Lucie')], ['20th', S('Charlotte', 'Collier', 'Glades', 'Hendry', 'Lee')],
];
const GA_CIRCUITS: [string, string[]][] = [
  ['Alapaha', S('Atkinson', 'Berrien', 'Clinch', 'Cook', 'Lanier')], ['Alcovy', S('Newton', 'Walton')], ['Appalachian', S('Fannin', 'Gilmer', 'Pickens')],
  ['Atlanta', S('Fulton')], ['Atlantic', S('Bryan', 'Evans', 'Liberty', 'Long', 'McIntosh', 'Tattnall')], ['Augusta', S('Burke', 'Columbia', 'Richmond')],
  ['Bell-Forsyth', S('Forsyth')], ['Blue Ridge', S('Cherokee')], ['Brunswick', S('Appling', 'Camden', 'Glynn', 'Jeff Davis', 'Wayne')],
  ['Chattahoochee', S('Chattahoochee', 'Harris', 'Marion', 'Muscogee', 'Talbot', 'Taylor')], ['Cherokee', S('Bartow', 'Gordon')], ['Clayton', S('Clayton')],
  ['Cobb', S('Cobb')], ['Conasauga', S('Murray', 'Whitfield')], ['Cordele', S('Ben Hill', 'Crisp', 'Dooly', 'Wilcox')],
  ['Coweta', S('Carroll', 'Coweta', 'Heard', 'Meriwether', 'Troup')], ['Dougherty', S('Dougherty')], ['Douglas', S('Douglas')],
  ['Dublin', S('Johnson', 'Laurens', 'Treutlen', 'Twiggs')], ['Eastern', S('Chatham')], ['Enotah', S('Lumpkin', 'Towns', 'Union', 'White')],
  ['Flint', S('Henry')], ['Griffin', S('Fayette', 'Pike', 'Spalding', 'Upson')], ['Gwinnett', S('Gwinnett')], ['Houston', S('Houston')],
  ['Lookout Mountain', S('Catoosa', 'Chattooga', 'Dade', 'Walker')], ['Macon', S('Bibb', 'Crawford', 'Peach')],
  ['Middle', S('Candler', 'Emanuel', 'Jefferson', 'Toombs', 'Washington')], ['Mountain', S('Habersham', 'Rabun', 'Stephens')],
  ['Northeastern', S('Dawson', 'Hall')], ['Northern', S('Elbert', 'Franklin', 'Hart', 'Madison', 'Oglethorpe')],
  ['Ocmulgee', S('Baldwin', 'Greene', 'Hancock', 'Jasper', 'Jones', 'Morgan', 'Putnam', 'Wilkinson')],
  ['Oconee', S('Bleckley', 'Dodge', 'Montgomery', 'Pulaski', 'Telfair', 'Wheeler')], ['Ogeechee', S('Bulloch', 'Effingham', 'Jenkins', 'Screven')],
  ['Pataula', S('Clay', 'Early', 'Miller', 'Quitman', 'Randolph', 'Seminole', 'Terrell')], ['Paulding', S('Paulding')], ['Piedmont', S('Banks', 'Barrow', 'Jackson')],
  ['Rockdale', S('Rockdale')], ['Rome', S('Floyd')], ['South Georgia', S('Baker', 'Calhoun', 'Decatur', 'Grady', 'Mitchell')],
  ['Southern', S('Brooks', 'Colquitt', 'Echols', 'Lowndes', 'Thomas')], ['Southwestern', S('Lee', 'Macon', 'Schley', 'Stewart', 'Sumter', 'Webster')],
  ['Stone Mountain', S('DeKalb')], ['Tallapoosa', S('Haralson', 'Polk')], ['Tifton', S('Irwin', 'Tift', 'Turner', 'Worth')],
  ['Toombs', S('Glascock', 'Lincoln', 'McDuffie', 'Taliaferro', 'Warren', 'Wilkes')], ['Towaliga', S('Butts', 'Lamar', 'Monroe')],
  ['Waycross', S('Bacon', 'Brantley', 'Charlton', 'Coffee', 'Pierce', 'Ware')], ['Western', S('Clarke', 'Oconee')],
];
const AL_CIRCUITS: [string, string[]][] = [
  ['1st', S('Choctaw', 'Clarke', 'Washington')], ['2nd', S('Butler', 'Crenshaw', 'Lowndes')], ['3rd', S('Barbour', 'Bullock')],
  ['4th', S('Bibb', 'Dallas', 'Hale', 'Perry', 'Wilcox')], ['5th', S('Chambers', 'Macon', 'Randolph', 'Tallapoosa')], ['6th', S('Tuscaloosa')],
  ['7th', S('Calhoun', 'Cleburne')], ['8th', S('Morgan')], ['9th', S('Cherokee', 'DeKalb')], ['10th', S('Jefferson')], ['11th', S('Lauderdale')],
  ['12th', S('Coffee', 'Pike')], ['13th', S('Mobile')], ['14th', S('Walker')], ['15th', S('Montgomery')], ['16th', S('Etowah')],
  ['17th', S('Greene', 'Marengo', 'Sumter')], ['18th', S('Shelby')], ['19th', S('Autauga', 'Chilton', 'Elmore')], ['20th', S('Henry', 'Houston')],
  ['21st', S('Escambia')], ['22nd', S('Covington')], ['23rd', S('Madison')], ['24th', S('Fayette', 'Lamar', 'Pickens')], ['25th', S('Marion', 'Winston')],
  ['26th', S('Russell')], ['27th', S('Marshall')], ['28th', S('Baldwin')], ['29th', S('Talladega')], ['30th', S('St. Clair')], ['31st', S('Colbert')],
  ['32nd', S('Cullman')], ['33rd', S('Dale', 'Geneva')], ['34th', S('Franklin')], ['35th', S('Conecuh', 'Monroe')], ['36th', S('Lawrence')],
  ['37th', S('Lee')], ['38th', S('Jackson')], ['39th', S('Limestone')], ['40th', S('Clay', 'Coosa')], ['41st', S('Blount')],
];
const CO_DISTRICTS: [string, string[]][] = [
  ['1st', S('Gilpin', 'Jefferson')], ['2nd', S('Denver')], ['3rd', S('Huerfano', 'Las Animas')], ['4th', S('El Paso', 'Teller')],
  ['5th', S('Clear Creek', 'Eagle', 'Lake', 'Summit')], ['6th', S('Archuleta', 'La Plata', 'San Juan')],
  ['7th', S('Delta', 'Gunnison', 'Hinsdale', 'Montrose', 'Ouray', 'San Miguel')], ['8th', S('Jackson', 'Larimer')], ['9th', S('Garfield', 'Pitkin', 'Rio Blanco')],
  ['10th', S('Pueblo')], ['11th', S('Chaffee', 'Custer', 'Fremont', 'Park')], ['12th', S('Alamosa', 'Conejos', 'Costilla', 'Mineral', 'Rio Grande', 'Saguache')],
  ['13th', S('Kit Carson', 'Logan', 'Morgan', 'Phillips', 'Sedgwick', 'Washington', 'Yuma')], ['14th', S('Grand', 'Moffat', 'Routt')],
  ['15th', S('Baca', 'Cheyenne', 'Kiowa', 'Prowers')], ['16th', S('Bent', 'Crowley', 'Otero')], ['17th', S('Adams', 'Broomfield')],
  ['18th', S('Arapahoe', 'Douglas', 'Elbert', 'Lincoln')], ['19th', S('Weld')], ['20th', S('Boulder')], ['21st', S('Mesa')], ['22nd', S('Dolores', 'Montezuma')],
];
const SC_CIRCUITS: [string, string[]][] = [
  ['1st', S('Calhoun', 'Dorchester', 'Orangeburg')], ['2nd', S('Aiken', 'Bamberg', 'Barnwell')], ['3rd', S('Clarendon', 'Lee', 'Sumter', 'Williamsburg')],
  ['4th', S('Chesterfield', 'Darlington', 'Dillon', 'Marlboro')], ['5th', S('Kershaw', 'Richland')], ['6th', S('Chester', 'Fairfield', 'Lancaster')],
  ['7th', S('Cherokee', 'Spartanburg')], ['8th', S('Abbeville', 'Greenwood', 'Laurens', 'Newberry')], ['9th', S('Berkeley', 'Charleston')],
  ['10th', S('Anderson', 'Oconee')], ['11th', S('Edgefield', 'Lexington', 'McCormick', 'Saluda')], ['12th', S('Florence', 'Marion')],
  ['13th', S('Greenville', 'Pickens')], ['14th', S('Allendale', 'Beaufort', 'Colleton', 'Hampton', 'Jasper')], ['15th', S('Georgetown', 'Horry')], ['16th', S('Union', 'York')],
];
const TN_DISTRICTS: [string, string[]][] = [
  ['1st', S('Carter', 'Johnson', 'Unicoi', 'Washington')], ['2nd', S('Sullivan')], ['3rd', S('Greene', 'Hamblen', 'Hancock', 'Hawkins')],
  ['4th', S('Cocke', 'Grainger', 'Jefferson', 'Sevier')], ['5th', S('Blount')], ['6th', S('Knox')], ['7th', S('Anderson')],
  ['8th', S('Campbell', 'Claiborne', 'Fentress', 'Scott', 'Union')], ['9th', S('Loudon', 'Meigs', 'Morgan', 'Roane')], ['10th', S('Bradley', 'McMinn', 'Monroe', 'Polk')],
  ['11th', S('Hamilton')], ['12th', S('Bledsoe', 'Franklin', 'Grundy', 'Marion', 'Rhea', 'Sequatchie')],
  ['13th', S('Clay', 'Cumberland', 'DeKalb', 'Overton', 'Pickett', 'Putnam', 'White')], ['14th', S('Coffee')], ['15th', S('Jackson', 'Macon', 'Smith', 'Trousdale', 'Wilson')],
  ['16th', S('Cannon', 'Rutherford')], ['17th', S('Bedford', 'Lincoln', 'Marshall', 'Moore')], ['18th', S('Sumner')], ['19th', S('Montgomery', 'Robertson')],
  ['20th', S('Davidson')], ['21st', S('Hickman', 'Lewis', 'Perry', 'Williamson')], ['22nd', S('Giles', 'Lawrence', 'Maury', 'Wayne')],
  ['23rd', S('Cheatham', 'Dickson', 'Houston', 'Humphreys', 'Stewart')], ['24th', S('Benton', 'Carroll', 'Decatur', 'Hardin', 'Henry')],
  ['25th', S('Fayette', 'Hardeman', 'Lauderdale', 'McNairy', 'Tipton')], ['26th', S('Chester', 'Henderson', 'Madison')], ['27th', S('Obion', 'Weakley')],
  ['28th', S('Crockett', 'Gibson', 'Haywood')], ['29th', S('Dyer', 'Lake')], ['30th', S('Shelby')], ['31st', S('Van Buren', 'Warren')],
];
const NM_DISTRICTS: [string, string[]][] = [
  ['1st', S('Los Alamos', 'Rio Arriba', 'Santa Fe')], ['2nd', S('Bernalillo')], ['3rd', S('Doña Ana')], ['4th', S('Guadalupe', 'Mora', 'San Miguel')],
  ['5th', S('Chaves', 'Eddy', 'Lea')], ['6th', S('Grant', 'Hidalgo', 'Luna')], ['7th', S('Catron', 'Sierra', 'Socorro', 'Torrance')],
  ['8th', S('Colfax', 'Taos', 'Union')], ['9th', S('Curry', 'Roosevelt')], ['10th', S('De Baca', 'Harding', 'Quay')], ['11th', S('McKinley', 'San Juan')],
  ['12th', S('Lincoln', 'Otero')], ['13th', S('Cibola', 'Sandoval', 'Valencia')],
];
const ME_DISTRICTS: [string, string[]][] = [
  ['1', S('York')], ['2', S('Cumberland')], ['3', S('Androscoggin', 'Franklin', 'Oxford')], ['4', S('Kennebec', 'Somerset')], ['5', S('Penobscot', 'Piscataquis')],
  ['6', S('Knox', 'Lincoln', 'Sagadahoc', 'Waldo')], ['7', S('Hancock', 'Washington')], ['8', S('Aroostook')],
];
const MA_DISTRICTS: [string, string[]][] = [
  ['Berkshire', S('Berkshire')], ['Bristol', S('Bristol')], ['Cape and Islands', S('Barnstable', 'Dukes', 'Nantucket')], ['Eastern', S('Essex')],
  ['Hampden', S('Hampden')], ['Middlesex', S('Middlesex')], ['Norfolk', S('Norfolk')], ['Northwestern', S('Franklin', 'Hampshire')],
  ['Plymouth', S('Plymouth')], ['Suffolk', S('Suffolk')], ['Worcester', S('Worcester')],
];

// ---- The states ------------------------------------------------------------------------------------------

const ST = (s: CountyState) => s;

export const COUNTY_2016: Record<string, CountyState> = {
  AL: ST({
    boards: [board('County Commission', 'Commissioner', [[600_000, 5], [0, 5]], 'district', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), other('probate', 'Judge of Probate', 6, 2018), other('revenue', 'Revenue Commissioner', 6, 2018), coroner(4, 2018), courtClerk('Circuit Clerk', 6, 2018)],
    pros: [circuit('District Attorney', 6, 2016, AL_CIRCUITS, 'Judicial Circuit')],
    over: { Mobile: { boards: [board('County Commission', 'Commissioner', 3, 'district', 4, [2016])] }, Madison: { boards: [board('County Commission', 'Commissioner', 6, 'district', 4, [2016, 2018], { chair: { name: 'Chairman of the County Commission', term: 4, y: 2018 } })] } },
  }),
  AK: ST({
    np: true, npFlow: 'none',
    boards: [board('Borough Assembly', 'Assembly Member', [[50_000, 9], [0, 7]], 'at_large', 3, [2015, 2016, 2017], { np: true })],
    exec: { name: 'Borough Mayor', term: 3, y: 2015, np: true },
    offices: [], pros: [], prosNone: 'District attorneys are appointed by the Attorney General.',
    noGov: { only: ['Aleutians West', 'Bethel', 'Dillingham', 'Hoonah-Angoon', 'Kusilvak', 'Nome', 'Prince of Wales-Hyder', 'Southeast Fairbanks', 'Valdez-Cordova', 'Yukon-Koyukuk'] },
    city: ['Anchorage', 'Juneau', 'Sitka', 'Wrangell', 'Yakutat', 'Skagway'],
  }),
  AZ: ST({
    boards: [board('Board of Supervisors', 'Supervisor', [[150_000, 5], [0, 3]], 'district', 4, [2016])],
    offices: [sheriff(4, 2016), recorder('Recorder', 4, 2016), treasurer(4, 2016), assessor('Assessor', 4, 2016), other('schools', 'Superintendent of Schools', 4, 2016), courtClerk('Clerk of the Superior Court', 4, 2018)],
    pros: [pros('County Attorney', 4, 2016)],
  }),
  AR: ST({
    boards: [board('Quorum Court', 'Justice of the Peace', [[300_000, 15], [50_000, 13], [20_000, 11], [0, 9]], 'district', 2, [2016])],
    exec: { name: 'County Judge', term: 2, y: 2016 },
    offices: [sheriff(2, 2016), clerk('County Clerk', 2, 2016), courtClerk('Circuit Clerk', 2, 2016), assessor('Assessor', 2, 2016), treasurer(2, 2016), other('collector', 'Collector', 2, 2016), coroner(2, 2016)],
    pros: [generated('Prosecuting Attorney', 4, 2016, 28, 'Judicial District')],
  }),
  CA: ST({
    np: true, npFlow: 'majority', onPrimary: true,
    boards: [board('Board of Supervisors', 'Supervisor', 5, 'district', 4, [2016, 2018], { np: true })],
    offices: [sheriff(4, 2018), assessor('Assessor', 4, 2018), auditor('Auditor-Controller', 4, 2018), treasurer(4, 2018, { name: 'Treasurer-Tax Collector' }),
      clerk('Clerk-Recorder', 4, 2018), other('schools', 'Superintendent of Schools', 4, 2018)],
    pros: [pros('District Attorney', 4, 2018)],
    city: ['San Francisco'],
  }),
  CO: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', [[450_000, 5], [0, 3]], 'residency', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), clerk('Clerk and Recorder', 4, 2018), treasurer(4, 2018), assessor('Assessor', 4, 2018), coroner(4, 2018), surveyor(4, 2018)],
    pros: [circuit('District Attorney', 4, 2016, CO_DISTRICTS, 'Judicial District')],
    city: ['Denver', 'Broomfield'],
    over: { Jefferson: { boards: [board('Board of County Commissioners', 'Commissioner', 3, 'residency', 4, [2016, 2018])] }, Weld: { boards: [board('Board of County Commissioners', 'Commissioner', 5, 'residency', 4, [2016, 2018])] } },
  }),
  CT: ST({ none: 'Connecticut has no county government; its sheriffs were abolished in 2000 and its state’s attorneys are appointed.', boards: [], offices: [], pros: [] }),
  DE: ST({
    boards: [board('County Council', 'Council Member', 5, 'district', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), recorder('Recorder of Deeds', 4, 2016), other('wills', 'Register of Wills', 4, 2018)],
    pros: [], prosNone: 'The Attorney General prosecutes statewide.',
    over: {
      'New Castle': { boards: [board('County Council', 'Council Member', 12, 'district', 4, [2016, 2018], { chair: { name: 'President of the County Council', term: 4, y: 2016 } })], exec: { name: 'County Executive', term: 4, y: 2016 } },
      Kent: { boards: [board('Levy Court', 'Commissioner', 6, 'district', 4, [2016, 2018], { chair: { name: 'President of the Levy Court', term: 4, y: 2016 } })] },
    },
  }),
  FL: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', [[250_000, 7], [0, 5]], 'district', 4, [2016, 2018])],
    offices: [sheriff(4, 2016), courtClerk('Clerk of the Circuit Court and Comptroller', 4, 2016), assessor('Property Appraiser', 4, 2016), other('taxcollector', 'Tax Collector', 4, 2016),
      other('elections', 'Supervisor of Elections', 4, 2016)],
    pros: [circuit('State Attorney', 4, 2016, FL_CIRCUITS, 'Judicial Circuit'), circuit('Public Defender', 4, 2016, FL_CIRCUITS, 'Judicial Circuit', { key: 'defender', kind: 'county_official' })],
    city: ['Duval'],
    over: {
      'Miami-Dade': { boards: [board('Board of County Commissioners', 'Commissioner', 13, 'district', 4, [2016, 2018])], exec: { name: 'Mayor', term: 4, y: 2016 }, drop: ['sheriff', 'taxcollector', 'elections'] },
      Orange: { boards: [board('Board of County Commissioners', 'Commissioner', 6, 'district', 4, [2016, 2018])], exec: { name: 'Mayor', term: 4, y: 2018 } },
      Broward: { boards: [board('Board of County Commissioners', 'Commissioner', 9, 'district', 4, [2016, 2018])] },
      Volusia: { boards: [board('County Council', 'Council Member', 6, 'district', 4, [2016, 2018])], exec: { name: 'County Chair', term: 4, y: 2016 } },
    },
  }),
  GA: ST({
    boards: [board('Board of Commissioners', 'Commissioner', [[500_000, 6], [50_000, 5], [0, 5]], 'district', 4, [2016, 2018], { chair: { name: 'Chairman of the Board of Commissioners', term: 4, y: 2016, where: { minPop: 50_000 } } })],
    offices: [sheriff(4, 2016), other('probate', 'Judge of Probate Court', 4, 2016), courtClerk('Clerk of Superior Court', 4, 2016), other('taxcomm', 'Tax Commissioner', 4, 2016), coroner(4, 2016)],
    pros: [circuit('District Attorney', 4, 2016, GA_CIRCUITS, 'Judicial Circuit')],
    city: ['Clarke', 'Richmond', 'Muscogee', 'Bibb', 'Chattahoochee', 'Quitman'],
    over: {
      DeKalb: { boards: [board('Board of Commissioners', 'Commissioner', 7, 'district', 4, [2016, 2018])], exec: { name: 'Chief Executive Officer', term: 4, y: 2016 } },
      Gwinnett: { boards: [board('Board of Commissioners', 'Commissioner', 4, 'district', 4, [2016, 2018], { chair: { name: 'Chairman of the Board of Commissioners', term: 4, y: 2018 } })] },
      Cobb: { boards: [board('Board of Commissioners', 'Commissioner', 4, 'district', 4, [2016, 2018], { chair: { name: 'Chairman of the Board of Commissioners', term: 4, y: 2018 } })] },
    },
  }),
  HI: ST({
    np: true, npFlow: 'majority', onPrimary: true,
    boards: [board('County Council', 'Council Member', 9, 'district', 2, [2016], { np: true })],
    exec: { name: 'Mayor', term: 4, y: 2018, np: true },
    offices: [], pros: [pros('Prosecuting Attorney', 4, 2016, { np: true, where: { not: ['Maui', 'Kalawao'] } })],
    city: ['Honolulu'], noGov: { only: ['Kalawao'] },
    over: { Kauai: { boards: [board('County Council', 'Council Member', 7, 'at_large', 2, [2016], { np: true })], exec: { name: 'Mayor', term: 4, y: 2018, np: true } } },
  }),
  ID: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', 3, 'residency', 4, [2016, 2018])],
    offices: [sheriff(4, 2016), clerk('Clerk', 4, 2018), assessor('Assessor', 4, 2018), treasurer(4, 2018), coroner(4, 2018)],
    pros: [pros('Prosecuting Attorney', 4, 2016)],
  }),
  IL: ST({
    boards: [board('County Board', 'Board Member', [[500_000, 18], [100_000, 21], [30_000, 15], [0, 9]], 'district', 4, [2016, 2018], { chair: { name: 'Chairman of the County Board', term: 4, y: 2016, where: { minPop: BIG } } })],
    offices: [sheriff(4, 2018), clerk('County Clerk', 4, 2018), treasurer(4, 2018), courtClerk('Clerk of the Circuit Court', 4, 2016), recorder('Recorder of Deeds', 4, 2016, { where: { minPop: 60_000 } }), coroner(4, 2016)],
    pros: [pros("State's Attorney", 4, 2016)],
    over: {
      Cook: { boards: [board('Board of Commissioners', 'Commissioner', 17, 'district', 4, [2018], { chair: { name: 'President of the Board of Commissioners', term: 4, y: 2018 } })], drop: ['coroner'] },
      Will: { boards: [board('County Board', 'Board Member', 26, 'district', 4, [2016, 2018])], exec: { name: 'County Executive', term: 4, y: 2016 } },
      Lake: { boards: [board('County Board', 'Board Member', 21, 'district', 4, [2016, 2018])] },
      Kane: { boards: [board('County Board', 'Board Member', 24, 'district', 4, [2016, 2018], { chair: { name: 'Chairman of the County Board', term: 4, y: 2016 } })] },
    },
  }),
  IN: ST({
    boards: [board('Board of Commissioners', 'Commissioner', 3, 'residency', 4, [2016, 2018]), board('County Council', 'Council Member', 7, 'district', 4, [2016, 2018], { key: 'council' })],
    offices: [sheriff(4, 2018), auditor('Auditor', 4, 2016), treasurer(4, 2016), recorder('Recorder', 4, 2018), courtClerk('Clerk of the Circuit Court', 4, 2016), assessor('Assessor', 4, 2016), coroner(4, 2016), surveyor(4, 2016)],
    pros: [pros('Prosecuting Attorney', 4, 2018)],
    city: ['Marion'],
  }),
  IA: ST({
    boards: [board('Board of Supervisors', 'Supervisor', [[150_000, 5], [0, 3]], 'at_large', 4, [2016, 2018])],
    offices: [sheriff(4, 2016), auditor('Auditor', 4, 2016), treasurer(4, 2018), recorder('Recorder', 4, 2018)],
    pros: [pros('County Attorney', 4, 2018)],
  }),
  KS: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', [[100_000, 5], [0, 3]], 'district', 4, [2016, 2018])],
    offices: [sheriff(4, 2016), clerk('County Clerk', 4, 2016), treasurer(4, 2016), recorder('Register of Deeds', 4, 2016)],
    pros: [pros('County Attorney', 4, 2016)],
    city: ['Wyandotte'],
    over: { Johnson: { boards: [board('Board of County Commissioners', 'Commissioner', 6, 'district', 4, [2016, 2018], { chair: { name: 'Chairman of the Board of County Commissioners', term: 4, y: 2018 } })] } },
  }),
  KY: ST({
    boards: [board('Fiscal Court', 'Magistrate', [[200_000, 8], [0, 5]], 'district', 4, [2018])],
    exec: { name: 'County Judge/Executive', term: 4, y: 2018 },
    offices: [sheriff(4, 2018), clerk('County Clerk', 4, 2018), other('jailer', 'Jailer', 4, 2018), coroner(4, 2018), assessor('Property Valuation Administrator', 4, 2018),
      courtClerk('Circuit Court Clerk', 6, 2016), off('countyatty', 'prosecutor', 'County Attorney', 4, 2018)],
    pros: [generated("Commonwealth's Attorney", 6, 2016, 57, 'Judicial Circuit')],
    city: ['Jefferson', 'Fayette'],
  }),
  LA: ST({
    boards: [board('Police Jury', 'Police Juror', [[100_000, 9], [0, 7]], 'district', 4, [2015])],
    exec: { name: 'Parish President', term: 4, y: 2015, where: { minPop: 100_000 } },
    offices: [sheriff(4, 2015), courtClerk('Clerk of Court', 4, 2015), assessor('Assessor', 4, 2015), coroner(4, 2015)],
    pros: [generated('District Attorney', 6, 2014, 42, 'Judicial District')],
    city: ['Orleans', 'East Baton Rouge', 'Lafayette', 'Terrebonne'],
    over: { Jefferson: { boards: [board('Parish Council', 'Council Member', 7, 'district', 4, [2015])], exec: { name: 'Parish President', term: 4, y: 2015 } }, 'St. Tammany': { boards: [board('Parish Council', 'Council Member', 14, 'district', 4, [2015])], exec: { name: 'Parish President', term: 4, y: 2015 } } },
  }),
  ME: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', [[200_000, 5], [0, 3]], 'district', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), recorder('Register of Deeds', 4, 2016), other('probate', 'Judge of Probate', 4, 2016), other('regprobate', 'Register of Probate', 4, 2016), treasurer(4, 2018)],
    pros: [circuit('District Attorney', 4, 2018, ME_DISTRICTS, 'Prosecutorial District')],
  }),
  MD: ST({
    boards: [board('County Council', 'Council Member', [[750_000, 9], [300_000, 7], [0, 5]], 'district', 4, [2018])],
    exec: { name: 'County Executive', term: 4, y: 2018, where: { minPop: 150_000 } },
    offices: [sheriff(4, 2018), courtClerk('Clerk of the Circuit Court', 4, 2018), other('wills', 'Register of Wills', 4, 2018)],
    pros: [pros("State's Attorney", 4, 2018)],
    city: ['Baltimore|City'],
  }),
  MA: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', 3, 'at_large', 4, [2016, 2018], { where: { only: ['Barnstable', 'Bristol', 'Norfolk', 'Plymouth'] } })],
    offices: [sheriff(6, [2016, 2018]), recorder('Register of Deeds', 6, [2016, 2018]), courtClerk('Clerk of Courts', 6, [2016, 2018]), other('regprobate', 'Register of Probate', 6, [2016, 2018])],
    pros: [circuit('District Attorney', 4, 2018, MA_DISTRICTS, 'District')],
    over: { Dukes: { boards: [board('County Commission', 'Commissioner', 7, 'at_large', 4, [2016, 2018])] } },
  }),
  MI: ST({
    boards: [board('Board of Commissioners', 'Commissioner', [[1_000_000, 15], [500_000, 17], [100_000, 9], [0, 5]], 'district', 2, [2016])],
    exec: { name: 'County Executive', term: 4, y: 2016, where: { only: ['Wayne', 'Oakland', 'Macomb'] } },
    offices: [sheriff(4, 2016), clerk('County Clerk', 4, 2016), treasurer(4, 2016), recorder('Register of Deeds', 4, 2016), other('drain', 'Drain Commissioner', 4, 2016), surveyor(4, 2016)],
    pros: [pros('Prosecuting Attorney', 4, 2016)],
    over: { Oakland: { boards: [board('Board of Commissioners', 'Commissioner', 21, 'district', 2, [2016])], exec: { name: 'County Executive', term: 4, y: 2016 } }, Macomb: { boards: [board('Board of Commissioners', 'Commissioner', 13, 'district', 2, [2016])], exec: { name: 'County Executive', term: 4, y: 2016 } } },
  }),
  MN: ST({
    np: true, npFlow: 'two',
    boards: [board('Board of Commissioners', 'Commissioner', [[300_000, 7], [0, 5]], 'district', 4, [2016, 2018], { np: true })],
    offices: [sheriff(4, 2018), auditor('Auditor-Treasurer', 4, 2018)],
    pros: [pros('County Attorney', 4, 2018, { np: true })],
  }),
  MS: ST({
    boards: [board('Board of Supervisors', 'Supervisor', 5, 'district', 4, [2015])],
    offices: [sheriff(4, 2015), clerk('Chancery Clerk', 4, 2015), courtClerk('Circuit Clerk', 4, 2015), assessor('Tax Assessor-Collector', 4, 2015), coroner(4, 2015)],
    pros: [generated('District Attorney', 4, 2015, 22, 'Circuit Court District')],
  }),
  MO: ST({
    boards: [board('County Commission', 'Associate Commissioner', 2, 'district', 4, [2016], { chair: { name: 'Presiding Commissioner', term: 4, y: 2018 } })],
    offices: [sheriff(4, 2016), clerk('County Clerk', 4, 2018), treasurer(4, 2018), other('collector', 'Collector of Revenue', 4, 2018), assessor('Assessor', 4, 2016),
      recorder('Recorder of Deeds', 4, 2018), other('pubadmin', 'Public Administrator', 4, 2016), coroner(4, 2016), courtClerk('Circuit Clerk', 4, 2018)],
    pros: [pros('Prosecuting Attorney', 4, 2018)],
    city: ['St. Louis|City'],
    over: {
      'St. Louis': { boards: [board('County Council', 'Council Member', 7, 'district', 4, [2016, 2018])], exec: { name: 'County Executive', term: 4, y: 2018 } },
      Jackson: { boards: [board('County Legislature', 'Legislator', 9, 'district', 4, [2018])], exec: { name: 'County Executive', term: 4, y: 2018 } },
      'St. Charles': { boards: [board('County Council', 'Council Member', 7, 'district', 4, [2016, 2018])], exec: { name: 'County Executive', term: 4, y: 2018 } },
    },
  }),
  MT: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', 3, 'residency', 6, [2016, 2018, 2020])],
    offices: [sheriff(4, 2018), clerk('Clerk and Recorder', 4, 2018), treasurer(4, 2018), other('schools', 'Superintendent of Schools', 4, 2018), courtClerk('Clerk of District Court', 4, 2018)],
    pros: [pros('County Attorney', 4, 2018)],
    city: ['Silver Bow', 'Deer Lodge'],
  }),
  NE: ST({
    boards: [board('Board of Commissioners', 'Commissioner', [[300_000, 7], [50_000, 5], [0, 3]], 'district', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), clerk('County Clerk', 4, 2018), treasurer(4, 2018), assessor('Assessor', 4, 2018), recorder('Register of Deeds', 4, 2018, { where: { minPop: 20_000 } }), courtClerk('Clerk of the District Court', 4, 2018)],
    pros: [pros('County Attorney', 4, 2018)],
  }),
  NV: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', [[1_000_000, 7], [100_000, 5], [0, 3]], 'district', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), clerk('Clerk', 4, 2018), treasurer(4, 2018), assessor('Assessor', 4, 2018), recorder('Recorder', 4, 2018), other('pubadmin', 'Public Administrator', 4, 2018)],
    pros: [pros('District Attorney', 4, 2018)],
    city: ['Carson City'],
  }),
  NH: ST({
    boards: [board('Board of Commissioners', 'Commissioner', 3, 'district', 2, [2016])],
    offices: [sheriff(2, 2016), recorder('Register of Deeds', 2, 2016), treasurer(2, 2016)],
    pros: [pros('County Attorney', 2, 2016)],
  }),
  NJ: ST({
    boards: [board('Board of Chosen Freeholders', 'Freeholder', [[700_000, 9], [400_000, 7], [0, 5]], 'at_large', 3, [2015, 2016, 2017])],
    exec: { name: 'County Executive', term: 4, y: [2015, 2018], where: { only: ['Atlantic', 'Bergen', 'Essex', 'Hudson', 'Mercer'] } },
    offices: [sheriff(3, [2016, 2017, 2018]), clerk('County Clerk', 5, [2015, 2016, 2017, 2018, 2019]), other('surrogate', 'Surrogate', 5, [2015, 2016, 2017, 2018, 2019])],
    pros: [], prosNone: 'County prosecutors are appointed by the Governor.',
    over: { Bergen: { boards: [board('Board of Chosen Freeholders', 'Freeholder', 7, 'at_large', 3, [2015, 2016, 2017])], exec: { name: 'County Executive', term: 4, y: 2018 } } },
  }),
  NM: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', [[50_000, 5], [0, 3]], 'district', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), clerk('County Clerk', 4, 2016), treasurer(4, 2018), assessor('Assessor', 4, 2016), other('probate', 'Probate Judge', 4, 2018)],
    pros: [circuit('District Attorney', 4, 2016, NM_DISTRICTS, 'Judicial District')],
    city: ['Los Alamos'],
  }),
  NY: ST({
    boards: [board('County Legislature', 'Legislator', [[1_000_000, 19], [500_000, 17], [100_000, 15], [0, 9]], 'district', 2, [2015])],
    exec: { name: 'County Executive', term: 4, y: [2015, 2017], where: { minPop: 150_000 } },
    offices: [sheriff(4, [2015, 2017]), clerk('County Clerk', 4, [2015, 2017])],
    pros: [pros('District Attorney', 4, [2015, 2017])],
    city: ['Bronx', 'Kings', 'New York', 'Queens', 'Richmond'],
    over: { Suffolk: { boards: [board('County Legislature', 'Legislator', 18, 'district', 2, [2015])], exec: { name: 'County Executive', term: 4, y: 2015 } }, Erie: { boards: [board('County Legislature', 'Legislator', 11, 'district', 2, [2015])], exec: { name: 'County Executive', term: 4, y: 2015 } },
      Monroe: { boards: [board('County Legislature', 'Legislator', 29, 'district', 2, [2015])], exec: { name: 'County Executive', term: 4, y: 2015 } } },
  }),
  NC: ST({
    boards: [board('Board of Commissioners', 'Commissioner', [[800_000, 9], [100_000, 7], [0, 5]], 'residency', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), recorder('Register of Deeds', 4, 2016), courtClerk('Clerk of Superior Court', 4, 2018)],
    pros: [generated('District Attorney', 4, 2018, 44, 'Prosecutorial District')],
    over: { Wake: { boards: [board('Board of Commissioners', 'Commissioner', 7, 'residency', 4, [2016, 2018])] } },
  }),
  ND: ST({
    np: true, npFlow: 'two',
    boards: [board('Board of County Commissioners', 'Commissioner', [[50_000, 5], [0, 3]], 'at_large', 4, [2016, 2018], { np: true })],
    offices: [sheriff(4, 2018), auditor('Auditor', 4, 2018), treasurer(4, 2018), recorder('Recorder', 4, 2018)],
    pros: [pros("State's Attorney", 4, 2018, { np: true })],
  }),
  OH: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', 3, 'at_large', 4, [2016, 2018])],
    offices: [sheriff(4, 2016), auditor('Auditor', 4, 2018), treasurer(4, 2016), recorder('Recorder', 4, 2016), courtClerk('Clerk of Courts', 4, 2016), coroner(4, 2016), other('engineer', 'Engineer', 4, 2016)],
    pros: [pros('Prosecuting Attorney', 4, 2016)],
    over: {
      Cuyahoga: { boards: [board('County Council', 'Council Member', 11, 'district', 4, [2016, 2018])], exec: { name: 'County Executive', term: 4, y: 2018 }, drop: ['auditor', 'treasurer', 'recorder', 'coroner', 'engineer'] },
      Summit: { boards: [board('County Council', 'Council Member', 11, 'district', 4, [2016, 2018])], exec: { name: 'County Executive', term: 4, y: 2016 } },
    },
  }),
  OK: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', 3, 'district', 4, [2016, 2018])],
    offices: [sheriff(4, 2016), clerk('County Clerk', 4, 2016), treasurer(4, 2016), assessor('Assessor', 4, 2018), courtClerk('Court Clerk', 4, 2016)],
    pros: [generated('District Attorney', 4, 2018, 27, 'District Attorney District')],
  }),
  OR: ST({
    boards: [board('Board of Commissioners', 'Commissioner', [[300_000, 5], [0, 3]], 'at_large', 4, [2016, 2018])],
    offices: [sheriff(4, 2016, { np: true }), clerk('County Clerk', 4, 2018), assessor('Assessor', 4, 2016), treasurer(4, 2016), surveyor(4, 2016)],
    pros: [pros('District Attorney', 4, 2016, { np: true })],
    over: {
      Multnomah: { boards: [board('Board of Commissioners', 'Commissioner', 4, 'district', 4, [2016, 2018], { np: true, chair: { name: 'Chair of the Board of Commissioners', term: 4, y: 2018 } })], drop: ['clerk', 'assessor', 'treasurer', 'surveyor'] },
      Washington: { boards: [board('Board of Commissioners', 'Commissioner', 4, 'district', 4, [2016, 2018], { np: true, chair: { name: 'Chair of the Board of Commissioners', term: 4, y: 2018 } })] },
      Lane: { boards: [board('Board of Commissioners', 'Commissioner', 5, 'district', 4, [2016, 2018], { np: true })] },
      Clackamas: { boards: [board('Board of Commissioners', 'Commissioner', 4, 'at_large', 4, [2016, 2018], { np: true, chair: { name: 'Chair of the Board of Commissioners', term: 4, y: 2016 } })] },
    },
  }),
  PA: ST({
    boards: [board('Board of Commissioners', 'Commissioner', 3, 'at_large', 4, [2015], { limited: 2 })],
    offices: [sheriff(4, [2015, 2017]), auditor('Controller', 4, [2015, 2017], { where: { minPop: 100_000 } }), treasurer(4, [2015, 2017]), other('wills', 'Register of Wills', 4, [2015, 2017]),
      recorder('Recorder of Deeds', 4, [2015, 2017]), courtClerk('Prothonotary', 4, [2015, 2017]), courtClerk('Clerk of Courts', 4, [2015, 2017], { key: 'clerkcourts' }), coroner(4, [2015, 2017])],
    pros: [pros('District Attorney', 4, [2015, 2017])],
    city: ['Philadelphia'],
    over: {
      Allegheny: { boards: [board('County Council', 'Council Member', 15, 'district', 4, [2015, 2017])], exec: { name: 'County Executive', term: 4, y: 2015 } },
      Erie: { boards: [board('County Council', 'Council Member', 7, 'district', 4, [2015, 2017])], exec: { name: 'County Executive', term: 4, y: 2017 } },
      Lehigh: { boards: [board('Board of Commissioners', 'Commissioner', 9, 'district', 4, [2015, 2017])], exec: { name: 'County Executive', term: 4, y: 2017 } },
      Northampton: { boards: [board('County Council', 'Council Member', 9, 'district', 4, [2015, 2017])], exec: { name: 'County Executive', term: 4, y: 2017 } },
      Delaware: { boards: [board('County Council', 'Council Member', 5, 'at_large', 4, [2015, 2017])] },
    },
  }),
  RI: ST({ none: 'Rhode Island has no county government; the Attorney General prosecutes statewide.', boards: [], offices: [], pros: [] }),
  SC: ST({
    boards: [board('County Council', 'Council Member', [[300_000, 11], [0, 7]], 'district', 4, [2016, 2018])],
    offices: [sheriff(4, 2016), coroner(4, 2016), other('probate', 'Probate Judge', 4, 2018), courtClerk('Clerk of Court', 4, 2016), auditor('Auditor', 4, 2018), treasurer(4, 2018)],
    pros: [circuit('Solicitor', 4, 2016, SC_CIRCUITS, 'Judicial Circuit')],
  }),
  SD: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', [[10_000, 5], [0, 3]], 'district', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), auditor('Auditor', 4, 2018), treasurer(4, 2018), recorder('Register of Deeds', 4, 2018)],
    pros: [pros("State's Attorney", 4, 2018)],
  }),
  TN: ST({
    onPrimary: true,
    boards: [board('County Commission', 'Commissioner', [[900_000, 13], [300_000, 11], [0, 15]], 'district', 4, [2018])],
    exec: { name: 'County Mayor', term: 4, y: 2018 },
    offices: [sheriff(4, 2018), treasurer(4, 2018, { name: 'Trustee' }), recorder('Register of Deeds', 4, 2018), clerk('County Clerk', 4, 2018), assessor('Assessor of Property', 4, 2016), courtClerk('Circuit Court Clerk', 4, 2018)],
    pros: [circuit('District Attorney General', 8, 2014, TN_DISTRICTS, 'Judicial District')],
    city: ['Davidson'],
  }),
  TX: ST({
    boards: [board('Commissioners Court', 'Commissioner', 4, 'district', 4, [2016, 2018])],
    exec: { name: 'County Judge', term: 4, y: 2018 },
    offices: [sheriff(4, 2016), clerk('County Clerk', 4, 2018), courtClerk('District Clerk', 4, 2018), assessor('Tax Assessor-Collector', 4, 2016), treasurer(4, 2018),
      off('countyatty', 'prosecutor', 'County Attorney', 4, 2016, { where: { maxPop: 600_000 } })],
    pros: [generated('District Attorney', 4, 2016, 155, 'Judicial District')],
  }),
  UT: ST({
    boards: [board('County Commission', 'Commissioner', 3, 'residency', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), clerk('Clerk-Auditor', 4, 2018), treasurer(4, 2018), recorder('Recorder', 4, 2018), assessor('Assessor', 4, 2018), surveyor(4, 2018)],
    pros: [pros('County Attorney', 4, 2018)],
    over: { 'Salt Lake': { boards: [board('County Council', 'Council Member', 9, 'district', 4, [2016, 2018])], exec: { name: 'Mayor', term: 4, y: 2016 } } },
  }),
  VT: ST({
    boards: [],
    offices: [sheriff(4, 2018), other('probate', 'Judge of Probate', 4, 2018), other('assistjudge', 'Assistant Judge', 4, 2018, { seats: 2 })],
    pros: [pros("State's Attorney", 4, 2018)],
  }),
  VA: ST({
    boards: [board('Board of Supervisors', 'Supervisor', [[300_000, 7], [0, 5]], 'district', 4, [2015])],
    offices: [sheriff(4, 2015), assessor('Commissioner of the Revenue', 4, 2015), treasurer(4, 2015), courtClerk('Clerk of the Circuit Court', 8, 2015)],
    pros: [pros("Commonwealth's Attorney", 4, 2015)],
    city: ['*City'],
    over: {
      Fairfax: { boards: [board('Board of Supervisors', 'Supervisor', 9, 'district', 4, [2015], { chair: { name: 'Chairman of the Board of Supervisors', term: 4, y: 2015 } })] },
      'Prince William': { boards: [board('Board of County Supervisors', 'Supervisor', 7, 'district', 4, [2015], { chair: { name: 'Chairman at Large', term: 4, y: 2015 } })] },
      Loudoun: { boards: [board('Board of Supervisors', 'Supervisor', 8, 'district', 4, [2015], { chair: { name: 'Chair at Large', term: 4, y: 2015 } })] },
    },
  }),
  WA: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', 3, 'residency', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), assessor('Assessor', 4, 2018), auditor('Auditor', 4, 2018), treasurer(4, 2018), clerk('County Clerk', 4, 2018)],
    pros: [pros('Prosecuting Attorney', 4, 2018)],
    over: {
      King: { boards: [board('County Council', 'Council Member', 9, 'district', 4, [2015, 2017], { np: true })], exec: { name: 'County Executive', term: 4, y: 2017, np: true }, drop: ['sheriff', 'treasurer', 'auditor', 'clerk'] },
      Pierce: { boards: [board('County Council', 'Council Member', 7, 'district', 4, [2016, 2018])], exec: { name: 'County Executive', term: 4, y: 2016 } },
      Snohomish: { boards: [board('County Council', 'Council Member', 5, 'district', 4, [2015, 2017])], exec: { name: 'County Executive', term: 4, y: 2015 } },
      Whatcom: { boards: [board('County Council', 'Council Member', 7, 'district', 4, [2015, 2017])], exec: { name: 'County Executive', term: 4, y: 2015 } },
    },
  }),
  WV: ST({
    boards: [board('County Commission', 'Commissioner', 3, 'residency', 6, [2016, 2018, 2020])],
    offices: [sheriff(4, 2016), clerk('County Clerk', 6, 2018), courtClerk('Circuit Clerk', 6, 2016), assessor('Assessor', 4, 2016)],
    pros: [pros('Prosecuting Attorney', 4, 2016)],
  }),
  WI: ST({
    boards: [board('County Board of Supervisors', 'Supervisor', [[900_000, 18], [400_000, 37], [100_000, 25], [0, 19]], 'district', 2, [2016], { np: true, spring: true })],
    exec: { name: 'County Executive', term: 4, y: 2016, where: { minPop: 150_000 }, np: true, spring: true },
    offices: [sheriff(4, 2018), clerk('County Clerk', 4, 2016), treasurer(4, 2016), recorder('Register of Deeds', 4, 2016), courtClerk('Clerk of Circuit Court', 4, 2016), coroner(4, 2016, { where: { maxPop: 100_000 } })],
    pros: [pros('District Attorney', 4, 2016)],
    over: { Waukesha: { boards: [board('County Board of Supervisors', 'Supervisor', 25, 'district', 2, [2016], { np: true, spring: true })], exec: { name: 'County Executive', term: 4, y: 2017, np: true, spring: true } } },
  }),
  WY: ST({
    boards: [board('Board of County Commissioners', 'Commissioner', [[50_000, 5], [0, 3]], 'at_large', 4, [2016, 2018])],
    offices: [sheriff(4, 2018), clerk('County Clerk', 4, 2018), treasurer(4, 2018), assessor('Assessor', 4, 2018), coroner(4, 2018), courtClerk('Clerk of District Court', 4, 2018)],
    pros: [pros('County Attorney', 4, 2018)],
  }),
  DC: ST({ none: 'The District of Columbia has no county government; its Mayor and Council are city government (Phase 7.7).', boards: [], offices: [], pros: [] }),
};

// ---- Resolving a county's offices ----------------------------------------------------------------------

/** Name key used to match a county to the lists above ("Doña Ana" → "dona ana"). */
export const nameKey = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface CountyLike { idx: number; name: string; legalType: string; pop2010: number; stateIdx: number }

/** Whether a county matches a name in a list ("Name", "Name|LegalType" or "*LegalType"). */
export function matches(c: CountyLike, list: string[] | undefined): boolean {
  if (!list) return false;
  for (const s of list) {
    if (s.startsWith('*')) { if (c.legalType === s.slice(1)) return true; continue; }
    const [n, t] = s.split('|');
    if (nameKey(n!) !== nameKey(c.name)) continue;
    // A bare name refers to a county, never to an independent city of the same name (Baltimore, St. Louis, Richmond…).
    if (t ? t !== c.legalType : c.legalType === 'City') continue;
    return true;
  }
  return false;
}

export function inWhere(c: CountyLike, w: Where | undefined): boolean {
  if (!w) return true;
  if (w.only && !matches(c, w.only)) return false;
  if (w.not && matches(c, w.not)) return false;
  if (w.minPop !== undefined && c.pop2010 < w.minPop) return false;
  if (w.maxPop !== undefined && c.pop2010 >= w.maxPop) return false;
  return true;
}

/** Seats of a board in a county. */
export function boardSize(b: CBoard, c: CountyLike): number {
  if (typeof b.size === 'number') return b.size;
  for (const [min, n] of b.size) if (c.pop2010 >= min) return n;
  return b.size[b.size.length - 1]![1];
}

/** A deterministic pick for a county among alternatives (which odd year its offices are up, etc.). */
export function pickFor(c: CountyLike, key: string, ys: number | number[]): number {
  if (typeof ys === 'number') return ys;
  let h = 2166136261;
  for (const ch of `${c.stateIdx}|${c.idx}|${key}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ys[(h >>> 0) % ys.length]!;
}

/**
 * One body (or single office) of a county, resolved: its seats, how they are elected, and each seat's cycle year.
 * `district` seats carry their district number (1-based); countywide seats 0.
 */
export interface CountyBody {
  key: string; kind: CountyKind; name: string; member: string | null;
  seats: number; by: 'single' | 'district' | 'at_large' | 'residency';
  term: number; cycles: number[]; districts: number[];
  np: boolean; spring: boolean; limited?: number;
}

/** The elected county government of one county (consolidated city-counties: row offices only). Prosecutors elected by multi-county districts are not included (see `circuitBodies`). */
export function countyBodies(usps: string, c: CountyLike): CountyBody[] {
  const st = COUNTY_2016[usps]; if (!st || st.none) return [];
  const out: CountyBody[] = [];
  const ov = Object.entries(st.over ?? {}).find(([n]) => matches(c, [n]))?.[1];
  const isCity = matches(c, st.city);
  const noGov = st.noGov ? inWhere(c, st.noGov) && !!st.noGov.only : false;
  if (noGov) return [];
  const npAll = !!st.np;
  if (!isCity) {
    for (const b of ov?.boards ?? st.boards) {
      if (!inWhere(c, b.where)) continue;
      const seats = boardSize(b, c);
      const key = b.key ?? 'board';
      const cycles: number[] = [], districts: number[] = [];
      for (let k = 0; k < seats; k++) { cycles.push(b.y[k % b.y.length]!); districts.push(b.by === 'district' || b.by === 'residency' ? k + 1 : 0); }
      out.push({ key, kind: 'county_board', name: b.name, member: b.member, seats, by: b.by, term: b.term, cycles, districts, np: !!b.np || npAll, spring: !!b.spring, ...(b.limited ? { limited: b.limited } : {}) });
      if (b.chair && inWhere(c, b.chair.where)) out.push({ key: `${key}chair`, kind: 'county_board', name: b.chair.name, member: null, seats: 1, by: 'single', term: b.chair.term, cycles: [b.chair.y], districts: [0], np: !!b.np || npAll, spring: !!b.spring });
    }
    const ex = ov && 'exec' in ov ? ov.exec : st.exec;
    if (ex && inWhere(c, ex.where)) out.push({ key: 'exec', kind: 'county_executive', name: ex.name, member: null, seats: 1, by: 'single', term: ex.term, cycles: [pickFor(c, 'exec', ex.y)], districts: [0], np: !!ex.np || npAll, spring: !!ex.spring });
  }
  const drop = new Set(ov?.drop ?? []);
  for (const o of st.offices) {
    if (drop.has(o.key) || !inWhere(c, o.where)) continue;
    const seats = o.seats ?? 1;
    const y = pickFor(c, o.key, o.y);
    out.push({ key: o.key, kind: o.kind, name: o.name, member: seats > 1 ? o.name : null, seats, by: seats > 1 ? 'at_large' : 'single', term: o.term,
      cycles: Array.from({ length: seats }, () => y), districts: Array.from({ length: seats }, () => 0), np: !!o.np || npAll, spring: false });
  }
  for (const p of st.pros) {
    if (p.by !== 'county' || !inWhere(c, p.where)) continue;
    const key = p.key ?? 'pros';
    out.push({ key, kind: p.kind ?? 'prosecutor', name: p.name, member: null, seats: 1, by: 'single', term: p.term, cycles: [pickFor(c, key, p.y)], districts: [0], np: !!p.np || npAll, spring: false });
  }
  return out;
}

/** Whether a county's governing body and executive are city government (consolidated city-counties, independent cities). */
export function isCityCounty(usps: string, c: CountyLike): boolean { return matches(c, COUNTY_2016[usps]?.city); }

/** The years an office is on the ballot: every `term` years from its cycle year. */
export function countySeatUp(cycle: number, term: number, year: number): boolean { return term > 0 && ((year - cycle) % term + term) % term === 0; }

// ---- Prosecutorial districts spanning several counties ----------------------------------------------------

export interface CircuitPlan {
  /** District (0-based) of each county of the state, indexed like `counties` (−1: none). */
  of: Map<number, number>;
  names: string[];
  /** The real 2016 districts, or generated ones (and why). */
  source: 'real' | 'generated';
  note?: string;
}

/**
 * A state's multi-county prosecutorial districts: the real 2016 circuits when every listed county is found exactly
 * once and every county is listed (otherwise, as for states without a list, generated ones), or `count` districts of
 * neighbouring counties of nearly equal population grown from the most populous counties.
 */
export function circuitPlan(p: CPros, counties: CountyLike[], adjacency: number[][]): CircuitPlan {
  if (p.circuits) {
    const of = new Map<number, number>(); let ok = true;
    const byKey = new Map<string, CountyLike[]>();
    for (const c of counties) { const k = nameKey(c.name); const l = byKey.get(k); if (l) l.push(c); else byKey.set(k, [c]); }
    p.circuits.forEach(([, names], d) => {
      for (const n of names) {
        const hits = (byKey.get(nameKey(n)) ?? []).filter((c) => c.legalType !== 'City');
        if (hits.length !== 1 || of.has(hits[0]!.idx)) { ok = false; continue; }
        of.set(hits[0]!.idx, d);
      }
    });
    if (ok && of.size === counties.length) return { of, names: p.circuits.map(([n]) => n), source: 'real' };
    const gen = generateCircuits(p.circuits.length, counties, adjacency);
    return { ...gen, note: 'the listed circuits do not match this geography' };
  }
  return generateCircuits(p.count ?? Math.max(1, Math.round(counties.length / 3)), counties, adjacency);
}

/**
 * Generated districts: the `n` most populous counties seed districts; the rest join, in order of population, the
 * neighbouring district with the least population (or, without a neighbour assigned yet, wait for one). Deterministic.
 */
export function generateCircuits(n: number, counties: CountyLike[], adjacency: number[][]): CircuitPlan {
  const N = Math.max(1, Math.min(n, counties.length));
  const order = [...counties].sort((a, b) => b.pop2010 - a.pop2010 || a.idx - b.idx);
  const of = new Map<number, number>(), pop = new Array<number>(N).fill(0);
  order.slice(0, N).forEach((c, d) => { of.set(c.idx, d); pop[d] = c.pop2010; });
  const inState = new Set(counties.map((c) => c.idx));
  let rest = order.slice(N);
  for (let guard = 0; rest.length && guard < 1000; guard++) {
    const next: CountyLike[] = [];
    for (const c of rest) {
      let best = -1;
      for (const nb of adjacency[c.idx] ?? []) { if (!inState.has(nb)) continue; const d = of.get(nb); if (d !== undefined && (best < 0 || pop[d]! < pop[best]!)) best = d; }
      if (best < 0) { next.push(c); continue; }
      of.set(c.idx, best); pop[best]! += c.pop2010;
    }
    if (next.length === rest.length) { for (const c of next) { const d = pop.indexOf(Math.min(...pop)); of.set(c.idx, d); pop[d]! += c.pop2010; } break; }
    rest = next;
  }
  return { of, names: Array.from({ length: N }, (_, d) => ordinal(d + 1)), source: 'generated' };
}

/** Ordinal for district names ("1st", "22nd", "111th"). */
export function ordinal(n: number): string { const v = n % 100; const suf = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'); return `${n}${suf}`; }

/** A state's prosecutors (and Florida's public defenders) elected by multi-county districts. */
export function circuitOffices(usps: string): CPros[] { return (COUNTY_2016[usps]?.pros ?? []).filter((p) => p.by !== 'county'); }
