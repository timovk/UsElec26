# Phase 7.2 Report — Down-ballot Offices, Elected Boards and State Courts

**Status:** implemented and tested; awaiting your approval before Phase 7.3.
**Engine version:** 0.7.2 · **Schema version:** 8 · **Night record:** version 2 (unchanged) · **Geography pack:** 2016.1 (unchanged)

Phase 7.2 is the second of eight Phase 7 sub-phases ([roadmap](architecture/10-roadmap.md#phase-7-complete-electoral-coverage)).
It fills in the rest of each state's statewide ballot, its elected boards and its courts, as each state's law
stood on January 1, 2016. In total that is **860 seats**:

| Kind | Seats |
|---|---|
| State supreme courts, and the Courts of Criminal Appeals of Texas and Oklahoma | 340 |
| Appellate courts elected statewide | 192 |
| Boards of education | 104 |
| Commissions (public service, utilities, corporations, railroads) | 55 |
| University boards | 54 |
| Treasurers | 36 |
| Auditors, comptrollers and controllers | 33 |
| Superintendents of public instruction | 13 |
| Agriculture commissioners | 12 |
| Insurance commissioners | 10 |
| Land commissioners | 5 |
| Labor commissioners | 4 |
| Arizona's mine inspector and North Dakota's tax commissioner | 2 |

As agreed, regional appeals courts and court rulings are on the roadmap's new **Future ideas** list, next to live
primary nights. Education boards and regents are included. Because of them, the roadmap estimate for 7.2 went
from 4–5 hours to 6–8.

## 1. What you can do now

1. **See who holds every office.** **Government → State offices & courts** shows one state at a time:
   - its statewide officers;
   - its commissions and boards, each with a seat bar and its members;
   - its courts: every judge's seat, party, age, start date, how they got the seat (elected, retained, appointed
     and by whom) and when the seat is next on the ballot, or when the term ends.

   Tick **Every state at a glance** for each state's supreme court by party, how its justices are chosen, and its
   down-ballot officers by party.
2. **Watch the down-ballot elections.** They follow each state's 2016 rules:
   - **Partisan races** use the state's primary system: party primaries, California's and Washington's top-two,
     or Louisiana's November ballot. Michigan nominates its boards and its Supreme Court by party convention.
   - **Party nominees without labels:** Ohio's and Michigan's Supreme Courts put party nominees on a ballot
     without party labels.
   - **Nonpartisan races** are on a ballot without labels:
     - a nonpartisan primary narrows the field to two (Minnesota, North Carolina, Washington and others);
     - in Georgia, Arkansas, Idaho and Oregon a majority on primary day wins outright, and the winner is unopposed
       in November;
     - West Virginia decides its Supreme Court on primary day;
     - Mississippi's courts need a majority, or a runoff follows.
   - **Retention votes:** in 16 states (and for elected incumbents in Illinois, New Mexico and Pennsylvania),
     judges stand alone for a yes/no vote. They keep the seat with half the votes; Illinois requires 60% and New
     Mexico 57%. A judge who loses leaves when the term ends, and the seat is filled by appointment.
   - **Other calendars:** Wisconsin votes in April, after a February primary; its justices take office on
     August 1. Pennsylvania elects its courts in odd years.
3. **Watch the courts change between elections.**
   - **Vacancies** (deaths, resignations, retirements, judges who lose a retention vote) are filled by the governor,
     often from a nominating commission's list, or by the legislature in South Carolina and Virginia.
   - **Elevation:** about a third of supreme court vacancies go to a judge of the state's appellate courts, which
     opens that judge's seat.
   - **First election:** on an elected or retention court, an appointee faces the voters at the first judicial
     election at least a year away.
   - **Mandatory retirement:** judges leave at their court's retirement age (70 in many states).
   - **Appointed courts** renew judges when their terms end (New York's 14-year terms, Connecticut's 8). Renewal is
     less likely when the governor is of the other party.
4. **Find the results.**
   - **Results:** filter by **Supreme Court**, **Court of Appeals**, **Treasurer**, **Boards of education** and so
     on. A retention contest shows **Yes: retain …** and **No**, the share needed and the outcome.
   - **Election night:** the statewide officers (treasurer, auditor and so on) and the contested supreme court seats
     elected statewide are called. Pick **Other statewide** or **Supreme courts** from the office menu.
   - **People:** new filters, **Judges** and **Commissions and boards**.

## 2. Using it on a Chromebook

1. Open **https://timovk.github.io/UsElec26/** once `main` is updated. Until then the live site runs 7.1.
2. **Existing universes open and keep running.** The first time a universe saved before 7.2 opens, it gains its
   down-ballot offices and courts, with officeholders in place as of that day.
   - Their elections follow from the next filing deadline; elections already held are not changed.
   - The engine ledger records the switch to engine 0.7.2.
   - Opening takes a moment longer that first time (about 860 new people).
3. Open **Government → State offices & courts**. Choose a state from the menu, or tick **Every state at a glance**.
4. After a November election, open **Results → [year]** and pick an office in the explorer, or search for
   "retention".
5. **Speed:** a simulated year is about 8–10% slower, mostly on Election Day (§5).

## 3. What was built

| Part | Where | What it does |
|---|---|---|
| 2016 data | `src/rules/downballot2016.ts` | For each state and body: seats, terms, how members are chosen, calendar, districts, retention threshold, retirement age and who appoints. Also seat staggering, seat by seat, and when each seat is up. |
| Seats and first officeholders | `src/engine/downballot.ts`, `src/engine/universe.ts` | One office per seat, with a cycle and a term (table `office_seat`). The first officeholders are created at founding, or when an older universe first opens. Partisan seats follow the state's or district's lean. Judges and nonpartisan officers have a party too: their voters', or that of the governor who appointed them. Nobody starts past the retirement age. |
| Board districts | `src/geo/bodyDistricts.ts` | Each year's state house districts (Nebraska's legislative districts) are grouped into compact districts of nearly equal population. A district with more seats gets proportionally more population; Illinois's first Supreme Court district has three of the seven. They are redrawn when the legislative maps are. |
| Ballots by district | `src/electorate/kernel.ts` | The kernel takes extra district maps, so a board seat is voted on only by its district's voters. |
| Filing and nomination | `src/engine/elections.ts` | `downballotFiling` handles the incumbent's decision (no one runs past the retirement age), retention votes, partisan fields through the existing nomination code (refactored into `nominate`), and nonpartisan fields and primaries. Appellate judges and state legislators run for higher office. |
| Decisions | `src/engine/elections.ts` | Retention: yes share against the threshold, then a new term or a vacancy when the term ends. Nonpartisan primaries: an outright majority where state law allows, or West Virginia's primary-day decision. Wisconsin's spring election and February primary. |
| Appointments | `src/engine/downballot.ts`, `src/engine/universe.ts` | Appointment by the governor, a commission list or the legislature, usually from the appointer's party; elevation from the appellate bench; moving the seat to its first election; monthly mandatory retirement; renewal on appointed courts every January. |
| The vote | `src/engine/electionModel.ts` | Retention is Yes against No: a baseline yes, plus the judge's quality, minus distance from the judge's views. More voters skip down-ballot races: about 3% skip a treasurer race, 10–25% a court or board race. |
| Election night | `src/engine/elections.ts`, `src/engine/nightStory.ts`, `src/broadcast/story.ts` | Statewide officers and contested supreme court seats elected statewide are on the broadcast night. Boards, appellate courts, retention votes and district seats are counted and certified like legislative seats. |
| Queries and UI | `src/engine/governmentQueries.ts`, `src/engine/archiveQueries.ts`, `src/ui/screens/Government.tsx`, `ContestScreen.tsx`, `ResultsExplorer.tsx`, `People.tsx`, `ElectionNight.tsx` | State offices & courts; retention contest pages; office filters and labels shared from `src/institutions/offices.ts`. |
| Schema 8 | `src/persistence/schema.ts` | `office_seat`. Migration from schema 7 is automatic. |

## 4. Test results

### 4.1 Suites

| Check | Result |
|---|---|
| Typecheck, ESLint and module boundaries (`npm run lint`) | pass: no dependency violations (133 modules, 590 dependencies) |
| Unit, property and real-data tests (`npx vitest run`) | **132 passed**, 12 skipped (opt-in long runs), 210 s; 5 new tests, 2 updated |
| End-to-end, Chromium (`npx playwright test`), this server | **4/4 passed** in 7.0 min |

### 4.2 New and updated tests

**The data** (`tests/unit/engine/downballot.test.ts`):
- **Counts:** 36 treasurers, 13 superintendents, 12 agriculture, 10 insurance, 4 labor and 5 land commissioners.
- **Supreme courts:** one in every state but DC, plus Courts of Criminal Appeals in Texas and Oklahoma.
- **Selection systems:** Texas partisan, Wisconsin nonpartisan in the spring, California retention, New York
  appointed, South Carolina by the legislature, Pennsylvania partisan then retention in odd years, Michigan party
  nominees without labels.
- **Thresholds:** Illinois 60%, New Mexico 57%.
- **Seats and calendars:** every seat has a cycle and a district matching its body, and seats on the governor's
  cycle are on it. Wisconsin elects one justice a year, Pennsylvania only in odd years, and Michigan's university
  boards two seats every even year.

**Board districts:**
- every unit gets a district;
- no building block is split;
- the result is deterministic;
- every district is within 20% of its target population, including with weighted seats (3, 1, 1, 1, 1).

**A fixture universe, January 2016 to January 2018:**
- **Starting state:** all 860 seats are filled, nobody is past the retirement age, and Texas's board districts
  cover the state.
- **Mandatory retirement:** a Texas justice who turns 75 retires that month. The governor appoints a successor,
  and the seat moves to a later election year, both in memory and in the database.
- **2016 races:** treasurer, auditor, superintendent, supreme court, appellate, commission, education board and
  regent races all take place.
- **Retention votes:** more than 20, each with two options (the judge and "no"), the outcome matching the
  threshold, certified and nonpartisan.
- **Ballot labels:** North Carolina's, Minnesota's, Washington's, Ohio's and Michigan's supreme court ballots are
  nonpartisan; Texas's are not. Nonpartisan primaries occur.
- **Calendars:** Wisconsin votes in April and its justice takes office on August 1. Pennsylvania's supreme court
  races are in odd years.
- **District seats:** a Texas board seat's ballots are between 1/30 and 1/5 of the state's.
- **Election night:** treasurer races are on the broadcast night.
- **Queries:** the state's offices, boards and courts (Texas Railroad Commission; nine justices); the national
  summary; a retention contest with "Yes: retain …" and "No".
- **Integrity:** the database integrity checks pass.

**Older universe** (`tests/unit/engine/compat.test.ts`): the Phase 1 save now also gains the 860 seats when it
opens, marked as created when the universe gained them, and elects some in 2016.

**Updated tests:**
- **Election law:** "only Nebraska is nonpartisan" now applies to legislative seats; courts elsewhere are
  nonpartisan now.
- **Archive audit:** it no longer expects a night feed for contests that are off the broadcast night (boards,
  appellate courts, retention votes, district seats), as it already did for legislative seats.

### 4.3 The 2016 down-ballot elections on the real geography

From a Node run of January 2016 to February 2017 (seed SPEED-1):

| | |
|---|---|
| Contests in 2016 | 193 general elections, 58 retention votes, 19 party primaries, 17 nonpartisan primaries |
| Votes cast as a share of ballots | treasurer 97%, superintendent 96%, auditor 92%, commissions 90%, retention 86–88%, supreme court races 83%, boards of education 82%, university boards 81%, appellate courts 75% |
| Retention votes | median 69% yes, range 59–79%; nobody lost (in reality few judges do) |
| Uncontested | a third of supreme court races, a third of board of education seats; no treasurer race |

For comparison, real retention votes usually win 60–75% yes, and real court races lose 10–25% of voters.

## 5. Measurements

| Measurement | 7.1 | 7.2 |
|---|---|---|
| Node, real geography, January 1 → December 1, 2016 | 56.0 s | 60.4 s (+8%) |
| of which November (Election Day) | 27.1 s | 31.9 s |
| Chromium: January 1 → November 8, 2016 (season test) | 44.5 s | 53.3 s and 48.6 s in two runs |
| Chromium: to the 2016 ballot lock (elections test) | 56.1 s | 61.3 s |
| Chromium: the Election Day step | 17.7 s | 22.0 s (counting 8.9 → 12.6 s) |
| Chromium: universe creation | 5.4 s | 6.0 s |
| Chromium: 2016 archive audit | 141.7 s | 136.8 s |
| Broadcast playback frames (median, p95) | 16.7, 16.8 ms | 16.7, 16.8 ms |
| Database size, real geography, February 1, 2017 | 54.7 MB | 61.0 MB (+6.3 MB, +11%) |

**Where the time goes:**
- **Election Day:** each voter's ballot now carries a few more races (eight more in Texas in 2016),
  and about 60 more races are on the broadcast night.
- **Primary days:** the nonpartisan primaries held on primary day cost a little more.
- **The rest of the year:** unchanged in Node. The browser's two season runs differed by 5 seconds on their own.

**2016 differs from 7.1 for the same seed.** The final forecast in the season test went from 73% / 304 EV to 61% /
289 EV, and the Brier score from 0.031 to 0.043. The 860 new officeholders shift the draws that later depend on
people's ids, so it is a different 2016. It is still deterministic: the same seed and version give the same
universe.

## 6. Fixes and decisions

- **Board districts are drawn by the simulation.** The geography pack has no board or court district lines, so
  each state's house districts are grouped by population. The groups are compact but not guaranteed contiguous.
- **Seats elected together statewide** are separate contests until "vote for N" ballots arrive in 7.4. These are
  Michigan's boards, which elect two seats every even year, and Arizona's Corporation Commission.
- **Primary-day courts** (Georgia, Arkansas, Idaho, Oregon): a majority wins outright and the winner is unopposed
  in November; otherwise the top two meet in November. Georgia really holds that runoff in July. A race with only
  two candidates goes straight to November.
- **Judges have parties.** It lets the courts' balance be shown, and appointments follow the appointer's party;
  the ballot still shows no label where the law says so.
- **Illinois** Supreme Court vacancies are filled by the court itself in reality; here the governor appoints
  from a commission list. **New Jersey's** seven-year first term followed by tenure is modelled as tenure to 70.
- **Found while checking the screens:**
  - a seat elected in November showed that year as "next";
  - a retention page repeated the district in its heading;
  - its vote-method table was headed by the judge's surname instead of Yes and No.

  All three are fixed.

## 7. Known limitations

- **Not polled or forecast:** down-ballot races, as before for legislative seats. On election night the desk
  calls statewide officers and supreme court seats without a forecast.
- **Not on the broadcast night:** boards, commissions, appellate courts, retention votes and district seats.
  They are counted and certified, and are in Results. Retention votes could join the night with the yes/no desk
  calls of 7.3.
- **No campaigns against judges.** Retention defeats are therefore rare (none in 2016 on the real geography).
  Campaigns triggered by court rulings are on the future ideas list.
- **Wisconsin's spring elections** are decided when the polls close, without a canvass, and are not counted on an
  election night.
- **Estimates in the data:**
  - the year each seat is up (its staggering), unless the data gives it;
  - a few retirement ages (Alabama, Arkansas, Michigan, Ohio and Pennsylvania have eligibility or pension rules
    rather than a fixed age);
  - no term limits for down-ballot officers.
- **An existing inconsistency is now visible:** the attorney general and secretary of state are still elected
  with the governor everywhere. In Pennsylvania, Oregon and North Dakota they are really elected in other years,
  so Pennsylvania's attorney general (on the governor's years) and treasurer (2016) are now on different cycles.
- **Not included:**
  - regional appellate courts and appointed intermediate courts (regional appeals courts are on the future ideas
    list);
  - DC's courts (appointed by the President);
  - a few other elected bodies: Hawaii's Office of Hawaiian Affairs, the Massachusetts Governor's Council, New
    Hampshire's Executive Council, and South Carolina's adjutant general.
- **Speed and storage:** about 8–10% more time per simulated year and 11% more storage.

## 8. Changelog

- Roadmap: 7.2 now includes boards of education and university boards (6–8 h). A **Future ideas** list holds live
  primary nights, regional appellate courts and court rulings.
- `bffc22a` Phase 7.2: down-ballot offices, elected boards and state courts (data, seats, districts, kernel
  district maps, filing, retention, nonpartisan primaries, spring elections, appointments, retirement,
  reappointment, queries, UI, tests); engine 0.7.2, schema 8.
- This commit:
  - fixes from checking the screens: the next-election column, the retention page heading, Yes/No column labels;
  - docs: architecture 03, 05 and 10, README;
  - this report.

## 9. Next: Phase 7.3 — Ballot measures (awaiting your approval)

- **Statewide initiatives and referendums,** decided by voters' issue positions rather than party.
- **Topics** come from the parties' platforms and the electorate's issues.
- **Coverage:** the archive, and election night with desk calls. Retention votes can then join the broadcast night
  as yes/no calls too.
- **Ballot-measure reform:** as noted in 7.1, citizens' initiatives can then also change election law, for
  example adopting ranked-choice voting or top-four primaries the way Maine and Alaska did.

The estimate is 4–5 hours.
