# 04 — Statistical Methodology

This is the core of the simulation. Notation is defined once in §4.0, and every later section builds on the
same latent electorate. Parameter values given here are **initial priors**. Phases 1–2 tune them against the
calibration targets in §4.7, with automated tests on many seeds.

## 4.0 Notation and units

| Symbol | Meaning |
|---|---|
| `b` | Base Unit (2010 block group ∩ 2016 districts; §6.3) |
| `c(b)`, `s(b)`, `R(b)` | County, state, Census division of `b` |
| `k ∈ 1..64` | Demographic cohort: age(4) × sex(2) × education(2) × race/ethnicity(4) |
| `h ∈ 1..4` | Cohort *class*: a per-universe clustering of cohorts with similar issue positions |
| `g ∈ 1..16` | Latent partisanship bin |
| `τ = (h, g)` | Voter **type** (64 types) |
| `z` | Latent partisan predisposition, logit scale; `z > 0` leans Democratic |
| `e` | Contest; `j ∈ J_e` candidates/options of contest `e` |
| `m` | Ballot mode: Election-Day in person, early in person, mail/absentee, provisional |
| `t` | Simulated time |

**Unit convention.** Model quantities live on the logit scale. Near a 50/50 split, **1 point of two-party
share ≈ 0.04 logit units** (the slope of the logistic function at 0 is ¼). Variances below are quoted in
*points* for readability.

## 4.1 Latent issue space and the coalition generator

Politics happens in an `L = 3` dimensional issue space: (1) economic role of government, (2) cultural
and social, (3) orientation (nationalist–cosmopolitan or institutional trust). Each axis is standardized.

**Cohort positions.** Each cohort has features `f_k` (indicators for age band, sex, education and
race/ethnicity, plus interactions). Its position is

```
x_k  = B · f_k + u_k                     B ∈ ℝ^{L×F} drawn once per universe
x_{k,R} = x_k + Δ_{k,R}                  regional modifiers, spatially smooth across divisions
```

`B` is **drawn per universe** from a prior with realistic magnitudes but random sign. That is why Texas may be
blue and Massachusetts red: which groups align with which party is a property of the universe, not an
import of 2016 reality. The prior on `B` bounds how polarized any single group can be: a typical group
splits between 55/45 and 80/20, and only rarely goes beyond 85/15, consistent with the dispersion seen in
American electorates in general.

**Party platforms.** Each party has a position `P_D(t)` and `P_R(t)`. At creation they are drawn to be distinct
(separated by about 1–1.5 SD on at least one axis) and to give the parties roughly comparable coalitions.

**Cohort class.** Cohorts are clustered into `H = 4` classes by `k`-means on their positions `x_k`. The
classes are the "groups that move together". They are what makes swings demographically correlated (§4.6),
and they give voter types an issue dimension beyond partisanship (§4.4).

## 4.2 Partisan identity and its dynamics

Long-run partisanship is a slowly moving stock per (county, cohort):

```
μ*_{c,k}(t) = λ · ( ‖x_{k,R} − P_R(t)‖² − ‖x_{k,R} − P_D(t)‖² )      issue-proximity pull
            + a_k(t)                                                 group–party attachment (identity)
            + G_c(t)                                                 geographic political culture (§4.3)
            + β_urb(t) · log density_c + β_inc · income_c + …        place covariates (random-sign slopes)

μ_{c,k}(t+1) = μ_{c,k}(t) + ρ · (μ*_{c,k}(t) − μ_{c,k}(t)) + ξ,     ρ ≈ 0.05–0.12 per year
```

- **Generational replacement.** Cohorts are age bands, so each year a fraction of each band ages into the next band
  and carries its `μ`. Eighteen-year-olds enter at `μ*` of the current era with no legacy attachment.
  Realignments therefore start with the young and spread, as observed in real electorates.
- **Migration** moves people *with* their partisanship (partly adapting to the destination's culture
  over time), so political geography sorts realistically.
- Within a cell, individual predispositions are heterogeneous: `z ~ N(μ_{c(b),k} + γ_b, σ_k²)`, with
  `σ_k ≈ 1.2–1.8` logits. **Groups are never homogeneous** (spec §4.4).
- `γ_b` is the Base Unit's local deviation (neighbourhood effect, §4.3).

**As implemented in Phase 6** (`electorate/dynamics.ts`, `population/evolution.ts`), one step each January 1:
- **Platforms** move under four forces:
  - vote seeking: the out-party moves toward the electorate's centre at 0.006 + 0.004 × terms out of the White
    House, the in-party at 0.002;
  - activist pull (0.03) toward the party's identity: 85% its founding positions, 15% its current coalition
    (beyond its centre);
  - the presidential nominee's imprint (0.03 in a nomination year);
  - noise (SD 0.02).

  They are kept at least 0.7 apart. In 50-year runs they settle about 0.9–1.0 apart (from about 1.3); an
  earlier calibration let them converge onto the floor within 20 years.
- **Attachments** drift slowly and revert toward their founding values.
- **Party competition** (the long-run guardrail): the trailing party recruits and rebrands, and a dominant
  coalition frays. μ\* shifts against the national leader by 0.028 per point of the current neutral national
  margin, plus an accumulated 0.0015 per point per year (stored with the electorate's state). A lopsided
  electorate erodes over decades without swinging to the other side: on the fixture, D+8 → about 0 and R+7 →
  R+2.4 in 50 years.
- **Founding balance:** a new universe's national two-party target is drawn from N(50%, 1.5) clipped to
  47.5–52.5% (within about ±5 points of margin). It was N(50, 2.2) clipped to 45.5–54.5% before Phase 6's
  acceptance run, which showed a D+9 founding staying lopsided for decades.
- **μ relaxes toward μ\*** at age-band rates 0.12, 0.07, 0.045 and 0.03 a year (18–29 … 65+). Ageing carries μ
  into the next band, new adults start at the current μ\*, and in-migrants bring their group's national μ, half
  adapted to the destination.
- **Demography:** mortality by band (0.12%, 0.22%, 0.75%, 4.2% a year), ageing out of each band after its span,
  new adults at about 1.7% of the electorate a year (slowly declining), naturalization of 0.28%, international
  arrivals of 0.02%, and internal migration between counties driven by persistent county trends (persistence 0.93).
  The race and education mix follows national trends, and the 18–29 college share trends up. The accounting
  identities (stock = previous + entries − deaths ± migration) are unit-tested.
- Partisanship and the group structure were also recalibrated: county fields are centred within states, and
  the generator targets a realistic voter-level spread between groups (cohort leans 0.45–0.76 logits apart).

## 4.3 Geographic political culture (multiscale spatial fields)

Nearby places correlate without becoming identical. The geographic field is a sum of scales, each a
spatially smoothed Gaussian field:

```
G_c = g_{R(c)} + g_{s(c)} + g_c          (division, state, county)
γ_b = g_b                                (Base Unit within county)

g_level ~ smooth( N(0, σ²_level) )   where smooth = n iterations of  v ← (1−α)·v + α·mean_{neighbours}(v)
                                       followed by rescaling to the target variance
```

- Adjacency comes from the TopoJSON topology (shared arcs), so the "neighbours" are real geographic
  neighbours. The same operator produces fields on states, counties and Base Units.
- The **urban–rural slope** `β_urb` and other place slopes are drawn with **random sign** per universe. In
  some universes cities lean Republican.
- Fields evolve as mean-reverting random walks at each scale. Combined with slowly evolving cohort
  partisanship, this makes counties develop **recognizable, persistent trends** that can still reverse.

## 4.4 Computational representation: voter types per Base Unit

The spec requires cross-race correlation without instantiating 250 million voters (§6.2). The chosen
representation is a **weighted synthetic electorate of 64 types per Base Unit**.

```
type τ = (h, g):   cohort class h (4) × partisanship bin g (16, centres ẑ_g on [−4.5, 4.5])

E_{b,τ} = Σ_{k ∈ class h}  E_{b,k} · [ Φ((ẑ_{g+½} − μ_{b,k})/σ_k) − Φ((ẑ_{g−½} − μ_{b,k})/σ_k) ]
          (eligible electorate of b, split by class and partisanship bin; Φ tabulated)
```

`E_{b,k}` (eligible voters by cohort) comes from the population model (§6.4): county joint cohort tables
raked to Base Unit marginals. The 64-number vector `E_{b,·}` is the electorate of the Base Unit. **All**
turnout, mode and vote-choice computations for every contest on the ballot use this same vector. That is
what "shared electorate" means operationally.

## 4.5 Turnout, mode, vote choice and the ballot kernel

### 4.5.1 Turnout

```
p^T_{b,τ,E} = logistic( τ_E                         election type (presidential, midterm, primary, special, municipal)
                       + τ_h                          class propensity (age/education-driven)
                       + τ_b                          persistent local civic culture
                       + β_int · |ẑ_g|                strong partisans vote more
                       + β_enth · tanh(ẑ_g/2) · ε_N   partisan enthusiasm gap this cycle
                       + β_comp · comp_{s,E}          perceived competitiveness of top races (public forecast)
                       + policy_{s}                   registration and voting rules (SDR, ID, all-mail…)
                       + ν_s + ν_c )                  correlated state/county turnout shocks
```

Turnout depends on `ẑ_g`, so turnout shocks change the *partisan composition* of the electorate. Turnout
and preference are separate processes (spec §6.4) that interact through the type distribution.

**Eligibility.** `E_{b,k}` is the voting-eligible population. The formula is
`VEP_b = VAP2010_b × (county pop2016 / pop2010) × r̂_b × (1 − felony_s)`. Here
`r̂_b = clamp((CVAP_b + κ·r_county) / (VAP2010_b + κ), 0.2, 1)` with κ = 400. In words: block-group CVAP is a noisy
survey estimate (29.5% of Base Units exceed their 2010 adult count), so it is shrunk toward the county
citizenship rate and capped. The exact decennial adult count supplies the base. Turnout is reported against
VEP, and VAP is also available. Turnout cannot exceed VEP, because ballots are drawn as `Binomial(E, p)`.

### 4.5.2 Ballot mode

```
π_{m | b,τ} = softmax_m( availability_{s,m}  (rules: all-mail states, no-excuse absentee, early-voting days)
                       + α_{m,h}             (older classes favour mail, etc.)
                       + γ_m(t) · ẑ_g        (partisan mode gap: universe- and era-specific, evolves with events)
                       + α_{m,b} )           (local habits; urban early-vote infrastructure)
```

The partisan mode gap `γ_m(t)` starts small in 2016 and can grow or flip, for example when party leaders attack
or promote mail voting. That mode gap is the only source of election-night "mirages" (§8.4). Nothing
manufactures them.

### 4.5.3 Vote choice in contest `e`

For a voter of type `τ` in Base Unit `b`:

```
U_j = w_e · s_j · (ẑ_g + Δ_b)                          partisan pull; s_D = +½, s_R = −½, s_other = 0
    + V_{e,j}(b, h)                                    contest-specific candidate valence
    + ε_j                                              Gumbel → multinomial logit

V_{e,j}(b, h) = q_j + inc_j + home_j(b) + camp_{j}(geo(b)) + scan_j
              − λ_I · ( ‖x̄_h − x_j‖² − ‖x̄_h − P_{party(j)}‖² )    ideology fit vs. the party default
              + c_j · 𝟙[minor] − ω_e · nonviable_j                  minor-party base and strategic-voting penalty
U_abstain = A_e + A_h − κ_e · recognition_e                         roll-off (undervote) option
```

- `w_e` is the partisan weight of the office: presidential 1.0, Senate ≈ 0.95, House ≈ 0.9, governor ≈ 0.7,
  low-information statewide offices ≈ 0.95 with low valence variance, nonpartisan offices 0.
  Governors run with high candidate-specific information, which is how a Republican can win Massachusetts.
- `Δ_b` is the **short-term environment** shared by every contest on the ballot (§4.6). It is the main
  source of cross-race correlation.
- The ideology-fit term rewards candidates who deviate from their party toward a class's position.
  Moderates over-perform in hostile territory, and a candidate's appeal differs by class. This is how ticket
  splitting arises from candidate characteristics rather than from noise.
- `x̄_h` is the class's mean position, so it varies by type through `h`.

Choice probabilities `P_e(j | τ, geo)` vary by geography only through terms defined at state, district or
county level (`home`, `camp`, `Δ`). They are therefore computed **per (contest, county) for 64 types**, not per
Base Unit. Pres: 3,142 counties × 64 types × ≈4 options ≈ 0.8 M `exp` evaluations, which is cheap.

### 4.5.4 Expected ballots and probabilities per Base Unit

```
λ_{b,m}       = Σ_τ  E_{b,τ} · p^T_{b,τ} · π_{m|b,τ}                       expected ballots by mode
P̄_{b,m,e,j}  = Σ_τ  E_{b,τ} · p^T_{b,τ} · π_{m|b,τ} · P_e(j | τ, c(b)) / λ_{b,m}
```

This is a (4 × 64) · (64 × Σ_e|J_e|) matrix product per Base Unit, about 8 k multiply-adds, or about 2–3 GFLOP nationally.
It is deterministic and parallel by state.

### 4.5.5 Realization (the ballot kernel)

The stochastic step happens once per election, at ballot lock, in the compute pool:

```
for each Base Unit b (sharded by state, RNG stream = H(seed, "ballots", electionId, b)):
    ν_b       ~ N(0, σ²_ν)                                  local turnout shock (overdispersion)
    B_b       ~ Binomial( E_b, p̄^T_b(ν_b) )                ballots cast (≤ eligible, by construction)
    (B_{b,m}) ~ Multinomial( B_b, π̄_{b,·} )                split by mode (sums exactly)
    ζ_{b,m}   ~ N(0, σ²_ζ / B_{b,m})                       shared realized-electorate shock (who showed up)
    for each contest e on b's ballot:                        (ballot eligibility = jurisdiction membership)
        p ← P̄_{b,m,e,·} + ζ_{b,m} · ∂P̄_{b,m,e,·}/∂z       linearized shared shock (precomputed derivative)
        p ← logit-shift(p, η_{b,e})                         small local contest-specific effect
        (v_{b,m,e,j})_j, u_{b,m,e} ~ Multinomial( B_{b,m}, (p_j, p_abstain) )
```

The `ζ` shock is common to all contests in the unit, so realization noise is correlated across contests:
if the voters who happened to turn out lean one way, every race sees it.

**Coherence guarantees (spec §1.2, §6.5), all by construction:**

1. `B_b ≤ E_b`. Turnout never exceeds the eligible electorate.
2. `Σ_m B_{b,m} = B_b`.
3. For every contest on the ballot: `Σ_j v_{b,m,e,j} + u_{b,m,e} (+ overvotes) = B_{b,m}` exactly. Every
   ballot is accounted for in every contest it contains.
4. Contests not on `b`'s ballot get no votes from `b`.
5. **Every aggregate is a sum** of Base Unit integers. County, district, state and national totals are
   never sampled separately.
6. Counting batches partition `(reporting jurisdiction, mode)` totals exactly (§8.3), so the night can
   never count a vote twice or exceed the cast total.

**Joint ballot structure.** Within a type, choices across contests are conditionally independent given
`τ`. Ballot-pattern distributions are therefore exact mixtures:
`P(j in e₁, i in e₂ | b, m) = Σ_τ w_{b,m,τ} P_{e₁}(j|τ) P_{e₂}(i|τ)`. They are used for split-ticket analytics
and the voter survey. Within-unit ballot patterns are not realized individually, because nothing observable
requires it.

**Measured cost** (spike, 2.1 GHz Xeon, single thread): 230 k units × 4 modes × 8 contests (22 M
binomial draws) takes **2.8 s**. An earlier design that realized per latent stratum took 15.5 s and was rejected. See
[15-feasibility-spikes.md](15-feasibility-spikes.md). Estimated reference-Chromebook time with a 3–4 worker
pool: about 2–5 s for realization and 1–2 s for aggregation.

**Write-ins and overvotes.** A write-in option exists where the law allows it. Overvotes are a tiny per-mode
rate in jurisdictions without precinct-count scanners (rule data) and are recorded separately.

**Special methods.** RCV contests store the full ranking distribution as a choice sequence. Each round's
transfers are computed per type from the same utilities, conditional on the remaining candidates (a
Plackett–Luce model), then realized. Vote-for-N contests use sequential choice without replacement.
Top-two primaries are a single contest with all candidates. Runoffs are new elections with their own
lock.

## 4.6 Short-term forces and the correlation structure

The environment `Δ_b` shared by all contests on a ballot is a hierarchy of persistent shocks:

```
Δ_b(t) = δ_N(t)                     national: fundamentals (approval, economy, midterm penalty) + η_N
       + Σ_h share_{b,h} · δ_h(t)   class swings: correlated across all places with similar demographics
       + δ_{R(b)}(t) + δ_{s(b)}(t)  division and state
       + δ_{c(b)}(t) + δ_b(t)       county (spatially smoothed) and local
```

| Component | SD per cycle (points of margin) | Persistence across cycles |
|---|---|---|
| National `η_N` | 3–4 | ρ ≈ 0.3 |
| Class `δ_h` | 3 | ρ ≈ 0.6 (trends) |
| Division | 1.5 | ρ ≈ 0.5 |
| State | 2 | ρ ≈ 0.5 |
| County | 2.5 | ρ ≈ 0.6 |
| Base Unit | 2 | ρ ≈ 0.7 |

Within a cycle, each component follows a daily AR(1) process with small innovations, so campaigns have
real movement that polls can detect. Office-specific environment terms (a midterm penalty for the
president's party, generic-ballot drift for Congress) apply to all contests of that office type.

As a result, state outcomes are correlated through national, class and regional components, and states
with similar demographics move together. **Polling misses are correlated the same way** (§4.8). Elections
can be decisive (a large `δ_N`) or knife-edge, and surprises come from the components, not from forced
closeness.

**Phase 5 implementation notes (daily dynamics).** Each cycle's national, class, division and state components
are split into a cycle level and a daily AR(1) deviation (`electorate/environment.ts`, `DAILY`): persistence
0.995 a day; stationary SDs 0.05 (national), 0.035 (class), 0.02 (division) and 0.025 (state) logit. That is about
3 points of national margin over a campaign and 0.3 points a day. The level SDs are reduced so the totals
match the table above. Each day's innovation comes from its own stream (`environment-day`, year, day), so the
path does not depend on how the clock was advanced. Election Day uses that day's values.

## 4.7 Calibration to stylized facts (not to real partisanship)

After drawing the universe, a calibration pass rescales variance components and intercepts so that
the **initial universe** and **long-run behaviour** fall inside target ranges taken from the general shape of
American electoral history. Partisan direction is never constrained.

| Statistic (two-party, presidential unless noted) | Target range |
|---|---|
| National Democratic two-party share, first election | 45–55% (drawn) |
| SD of state margins (50 states; DC excluded by convention) | 10–20 points |
| SD of county margins | 22–32 points |
| Share of counties won with >60% two-party share | 45–85% |
| States decided by <5 points | 3–14 |
| Moran's I of county margins | 0.5–0.8 |
| SD of county margin swing between consecutive presidentials | 3–8 points |
| Senate races won by the party losing that state's presidential vote | 0–20% |
| Presidential turnout (VEP) | 52–66%; midterm 36–52% |
| Undervote rate, presidential / House / down-ballot | ≈0.5–1.5% / 2–6% / 5–20% |
| National popular vote, long run (100-year runs) | 95% of elections within 40–60% |
| Party control of presidency changes | Roughly every 1–3 terms on average, no permanent lock |

The calibration is iterative: draw, simulate a "phantom" baseline election analytically from
expectations, measure, rescale, repeat. It converges in a few passes. The targets are tests: CI runs
the generator on 100+ seeds and asserts the distribution of each statistic.

**Phase 1 implementation notes.**
- *Controls.* The calibrator uses two damped controls. A "between-state" scale (coalition composition,
  place covariates, regional fields) steers the state spread. A "within-state" scale (county fields) steers the
  county spread. An unsmoothed county component tunes Moran's I, and the intercept fixes the national share.
- *Retries.* If an attempt misses any range, the generator redraws with the next attempt index (deterministic) and
  keeps the best attempt. On the real Census geography, 10/10 test seeds landed inside every range, in 1–3 s each.
- *Ranges.* Two ranges were widened from the Phase 0 values to span modern U.S. history rather than a single
  election. Lopsided counties ran from about 50% (2000) to over 80% (2016); close states ran from 4 to 14.
- *Cell evaluation.* Expected cell values are tabulated per cohort on a fine grid of cell means (step 0.04 logit),
  so a universe-wide evaluation of 265k Base Units × 64 cohorts takes about 1.3–2.3 s.

## 4.8 Polling

**Pollsters.** There are 25–40 fictional organizations. Each has a methodology (live phone, IVR/text, online
panel, mixed), a house effect `h_p ~ N(0, 1.5²)` points that drifts slowly, class coverage biases
`κ_{p,h}`, a likely-voter screen quality, a typical sample size, a frequency, geographic coverage, an optional
herding tendency, and a sponsor.

**Fieldwork.** A poll of contest `e` in jurisdiction `J` by pollster `p`, in the field over `[t₁, t₂]`:

```
π_true   = electorate.measure(J, e, population, [t₁,t₂])         intended vote among the pollster's target
                                                                 population, including undecided share
y        = π_true
         + h_p                                                   house effect
         + Σ_h (κ_{p,h} + κ_{cycle,h}) · comp_{J,h}             coverage/nonresponse bias by class
                                                                 (κ_cycle shared by all pollsters → correlated misses)
         + LV-screen error (mixes RV composition into LV)
         + sampling noise ~ Multinomial(n_eff, ·)/n_eff,  n_eff = n / deff,  deff ∈ [1.3, 2.2]
reported = round(y) with undecided/other; MoE = 1.96·√(0.25/n) (as pollsters report, ignoring deff)
```

`electorate.measure` evaluates the aggregated type model (§4.4–4.5) for the jurisdiction at the field
dates. It uses a per-(state, contest) **swing-response cache**, which tabulates expected shares against a scalar
shift in `Δ`, so daily polling is fast. Polls are noisy measurements of the current state and **cannot**
reveal the final result: the environment keeps moving, `κ_cycle` biases all pollsters together, and the
undecided vote breaks according to the model at ballot lock.

Undecided share depends on salience, time to election and candidate recognition. Some pollsters push
leaners and others don't. Herding pollsters shrink toward the public average.

**Phase 5 implementation notes (as built).**
- *Pollsters* (`polling/pollsters.ts`): 32 fictional organizations (9 national, 10 multi-state, 13 single-state),
  with names from invented word lists and a guard against real pollsters' names.
  - House effect `N(0, 0.02)` utility (about 1.2 points of margin) with a slow, bounded drift.
  - Class coverage biases `N(0, 0.035–0.06)` log weights by method; partisan nonresponse `N(0, 0.006)` per unit
    of latent partisanship.
  - A likely-voter screen of quality `q ∈ [0.45, 0.95]` whose error has a direction: the sample's weights are the
    true likely electorate's times `(LV/RV)^τ`, with `τ = (1 − q)·N(0, 1.2²)`. `τ = −1` is a registered-voter
    sample; positive `τ` over-screens. Screen errors therefore lean either way and average out across
    pollsters, instead of always favouring the party of low-propensity voters.
  - `deff ∈ [1.2, 1.8]`; national samples of 1,000–2,000.
  - The cycle's shared bias is `N(0, 0.04)` per class plus `N(0, 0.008)` partisan nonresponse.
  - Measured spread on a test electorate: pollster systematic error RMS 1.4 points (max 3.9 over 192
    pollsters); cycle miss RMS 1.1 points (`tests/unit/polling/polls.test.ts`).
- *Measurement port* (`electorate/measure.ts`): `measureTypes` runs the kernel's step 1 to give expected
  likely and registered voters by (county × district) piece and voter type. `fieldPoll` aggregates a state's
  pieces (home counties kept apart), applies the design, samples a multinomial of size `n/deff`, and returns
  counts only.
  - The types are cached from the cycle's *level*. A poll applies the day's deviation as a shift per class,
    which keeps saved and reloaded universes identical.
  - Primary polls derive the primary electorate from the general types by party participation and an
    intensity factor (an approximation; the primaries themselves are realized by the full kernel).
- *What gets polled:* a general election only once every primary and runoff feeding it has chosen its nominee.
  Presidential general polls always pair the two presumptive nominees.

## 4.9 Polling averages

The primary average is a **Kalman filter (local-level model)** per contest, on the margin and on each
candidate's share:

```
state:        θ_t = θ_{t−1} + w_t,          w_t ~ N(0, q)           (daily drift; q larger near events)
observation:  y_i = θ_{t_i} + ĥ_{p(i)} + v_i,  v_i ~ N(0, σ²_samp,i + σ²_pollster)
```

- `ĥ_p` (house effects) are estimated jointly across all contests and shrunk by empirical Bayes.
- A poll's weight comes out of its variance: sample size, pollster reliability (from in-universe track record,
  available only after elections) and recency through the state dynamics. Multiple releases from one
  pollster within the window are down-weighted to avoid flooding.
- Outputs are the mean, an 80% band, and the history of snapshots. Each published average is stored permanently
  as of its date (§7). A simple recency-weighted average is computed alongside for transparency.

**Phase 5 implementation notes (as built, `polling/average.ts`).**
- One local-level Kalman filter per option share (q = 0.04 points² a day) and one on the Democratic−Republican
  margin (q = 0.08), with observation variance from the sample size (×1.6 on the margin).
- House effects are estimated from every published general-election poll's residual against its race's average,
  shrunk by empirical Bayes (k = 6 polls).
- **Likely-voter adjustment:** registered-voter polls are moved toward the likely electorate by the gap between
  RV and LV polls of the same races in the final 80 days. The gap is shrunk toward a prior of 2 points until
  both kinds exist. It is estimated from published polls only and shown on each race page.
- Flooding guard: a pollster's poll followed by another of its own within 7 days counts for less.

## 4.10 Forecasting

The forecast is a Bayesian-flavoured Monte Carlo that uses only the Public Record.

1. **Fundamentals prior** per state and district: lagged results (the last two comparable elections, recast to
   current boundaries), a national-environment forecast from approval, economy and incumbency
   (regression fitted *in-universe* on past simulated cycles, with weak priors in the first cycles),
   home-state effects, candidate quality and fundraising.
2. **Poll update:** state polling averages (house-effect-adjusted) are combined with the prior, with precision
   weighting. The national average informs a uniform-plus-class swing for poorly polled states.
3. **Error model:** final margin = estimate + ε, with

```
ε_s = ε_N + Σ_h comp_{s,h} · ε_h + ε_{R(s)} + ε_s'
ε_N ~ t_5(0, σ_N(T)),  σ_N grows with days-to-election T;  similar for other components
```

4. **Simulate** S = 20,000 draws (sharded across the pool). Each draw produces all state, district, Senate and
   governor outcomes jointly. Electoral votes apply the Maine/Nebraska district rules and contingent-election logic.
5. **Outputs:** win probabilities, the EV distribution (0–538 histogram), expected EV, 80/95% intervals, the
   tipping-point distribution (for each draw, the state that delivers the 270th EV when states are sorted by margin),
   Senate, House and governor seat distributions, district-level probabilities, and "forecast changes since last
   run" attributions.
6. **Cadence and storage:** weekly from the start of the general-election campaign, daily in the final 100 days.
   Each run stores summaries (probabilities, quantiles, histograms). **Old runs are never modified.**
7. **Honesty:** the forecast reports probabilities rounded to a whole percent, never "100%" (it shows ">99%"),
   and the in-universe calibration report (Brier score, reliability diagram) grows with every cycle.

**Phase 5 implementation notes (as built, `forecasting/model.ts`, `engine/season.ts`).**
- *Prior* per race: the lean index plus the national estimate plus candidate effects (incumbency 1.5–3 points,
  including incumbents still in an unheld primary; relative cash on hand up to ±2), with SD 5 (presidential states)
  to 8 (House, governors). The lean index is the previous presidential result in the archive. In the first
  cycle it is a public index: the true expected lean with regional, state and district error (2.5–3.5 points),
  because no past result exists yet.
- *National:* fundamentals (midterm penalty, third-term penalty; SD 5) updated by the national presidential average
  (or the generic ballot) with a 2.5-point systematic polling-miss term.
- *Poll update:* precision-weighted, with 3 points of systematic error per race plus staleness.
- *Error model:* national, division (SD 2) and state errors, each Student-t(5). The national SD grows with days
  left (0.6 + 2.2·√(T/120) points).
- These SDs were widened after the full-engine calibration (Phase 5 report §5). The first settings gave
  well-calibrated win probabilities, but their 80% intervals covered only about 70% of presidential-state results.
- *Simulation:* 1,500 draws (in the engine; about 2.5 s per run on real geography). House seats are integrated
  analytically every fifth draw. Per-race intervals are analytic.
- *Outputs per run:* the EV histogram, tipping-point shares, Senate seats with the Vice President's tiebreak, House
  seats, governors, every race's probability and 80/95% interval. Stored gzip-compressed in `forecast_run`;
  never modified.
- Races whose primaries have not chosen nominees are forecast as contested from the prior alone.
- *Cadence:* weekly from June 1, daily in the final 100 days. The final run before Election Day becomes the
  desks' prior for that night (§4.13).

## 4.11 Career decisions (summary)

For person `i` considering office `o` in a filing season:

```
EU(run o) = P̂(win o) · Value(o) − Cost(o) − (1 − P̂(win o)) · Loss(current office forfeited)
          + Ambition_i · Prestige(o) − AgePenalty(age_i, o) − ScandalRisk_i
Run if EU(run o) > EU(stay) and EU(run o) is the max over feasible o (eligibility, residency, term limits)
```

`P̂(win)` is the person's *perceived* chance, from public information plus a small personal bias
(over-confidence varies by trait). Retirement hazards rise with age, tenure, a bad environment for the person's
party, scandal and redistricting. Appointments (cabinet, judgeships, Senate vacancies) choose from networks of
relationships plus ideology and qualification. Party switching is a rare event that requires sustained
ideological mismatch with the party and a hostile primary environment.

**As implemented in Phase 6** (`careers/model.ts`), monthly hazards:
- **Scandal:** 0.00045 × scrutiny (President 2.2 … secretary of state 0.5) × (0.3 + 2.2 (1 − integrity)²).
  Severity is u^1.6 scaled by integrity. Resignation over a scandal of severity above 0.35 decays over about
  four months.
- **Other exits:** 0.045% a month for elected officials (rising after 70); cabinet secretaries 1/32 a month.
- **Party switches:** only when an officeholder is more than 0.35 closer to the other platform; at most 0.07% a
  month.
- **Retirement at filing** adds 0.8% a year of tenure beyond 12 years, 35% × the scandal's lingering weight, and
  1.2% per point of a district that became hostile.

## 4.12 Economy and approval

- **National macro (monthly):** a two-state Markov regime (expansion/recession; mean expansion
  ≈ 6–8 years, mean recession ≈ 11 months), AR(1) GDP growth around the regime mean, unemployment via an
  Okun-type link with inertia, inflation as AR(1) around a target with a Phillips-curve term and rare supply
  shocks. Initial conditions are the real January 2016 values. From there the paths are simulated and diverge.
- **States:** `g_s = g_N + β_s (g_N − ḡ) + AR(1)_s`, with β_s (cyclical sensitivity) drawn once per state.
- **Releases** follow a realistic calendar (jobs report on the first Friday, quarterly GDP advance
  estimates), and the Public Record sees only released values.
- **Approval** is not an independent number. It is computed from the electorate: the share approving is
  `Σ_τ w_τ · logistic(a · s_pres · ẑ_g + econ_perception_τ + events + honeymoon/decay)`, where
  economic perception is filtered by partisanship (opposition partisans perceive the economy as worse). Approval
  polls measure it with noise.

**As implemented in Phase 6** (`economy/macro.ts`, `engine/economyEngine.ts`, `electorate/measure.ts`):
- Monthly. An expansion ends with probability 0.85% + 0.004% × its age in months; a recession ends with
  probability 3% in its first four months and 11% after. GDP growth is AR(1) toward 3.4% early in a recovery,
  2.1% later, or −3.4% in recession, with shock SD 0.9. Unemployment follows Okun (−0.05 × (g − 2)) with drift to
  a slowly moving natural rate. Inflation is AR(1) toward 2% with a Phillips term and rare supply shocks.
  States follow with their own cyclical sensitivity. The January 2016 start is 1.6% growth, 4.9% unemployment and
  1.4% inflation.
- **Releases** (Public Record): the jobs report on the first Friday, CPI on the second Wednesday, the GDP advance
  estimate on the last Thursday of January, April, July and October. They feed the news, the published
  fundamentals of the forecast and the Government page.
- **Approval** per voter type is logistic(1.7 ẑ + 0.4 · perceived + standing + honeymoon − 0.35), where
  perceived = econ index + 0.45 tanh(ẑ) (partisan filtering) and standing is an AR process moved by events
  (scandals, laws, vetoes, overrides). Its effect on elections is `sign × (0.035 × econ index + 0.6 × standing)`
  on the national environment. Fifteen national pollsters publish approval polls (house effects, design
  effects, sampling error).

## 4.13 Race projection statistics (election night)

Each decision desk `n` models contest `e` from the wire feed. For each reporting jurisdiction `r`:

```
Counted:   C_r (by candidate), and mode composition where the feed reports it
Expected:  T̂_r ± σ_{T,r}   (wire's expected-vote model: registration, pre-election early-vote reports,
                           historical turnout, updated as returns arrive)
Remaining: R̂_r = max(0, T̂_r − C_r)
Remaining margin per vote: m̂_r = blend( observed margin in r adjusted for the mode mix still outstanding,
                                        prior for r + statewide swing estimated from completed units,
                                        voter-survey estimate )
Final margin:  M = M_counted + Σ_r R_r · m_r
               m_r = m̂_r + ε_sys + ε_r;   ε_sys ~ N(0, σ²_sys) common to the contest
```

Under the normal approximation:

```
E[M]   = M_c + Σ_r R̂_r m̂_r
Var[M] = Σ_r ( R̂_r² σ²_{m,r} + m̂_r² σ²_{T,r} + σ²_{m,r} σ²_{T,r} ) + (Σ_r R̂_r)² σ²_sys
P(lead holds) = Φ( E[M] / √Var[M] )
```

When `|E[M]|/√Var[M] < 4` (near a call threshold), a 5,000-draw Monte Carlo with t-distributed errors
replaces the normal approximation, because tail behaviour matters there. Call, Too-Early, Too-Close and
retraction rules are in §8.5.

## 4.14 Voter survey (exit poll)

For each state on Election Day the survey samples `n ≈ 2,000–15,000` respondents from the **realized**
electorate's type weights by mode. It applies nonresponse bias correlated with the cycle's polling
error (`κ_cycle`, partially) and design effects. It yields vote shares and crosstabs by age, sex, education,
race and class. Desks receive a first wave at poll closing and weight it to counted votes during the night. The
crosstabs shown to the user are the **survey's estimates**. The true crosstabs exist as labeled
*simulation truth* in Analyst Mode after the election.

## 4.15 How the methodology is validated

- **Analytic tests:** the expected-value pipeline reproduces closed-form results on toy electorates.
- **Property-based tests:** for random electorates and ballots, every invariant in §4.5.5 holds.
- **Calibration tests:** the targets in §4.7 hold across seeds.
- **Recovery tests:** fit the polling average and forecast on simulated data and check coverage. 80%
  intervals should contain the outcome about 80% of the time over many simulated cycles.
- **Long-run tests:** 100-year headless runs on many seeds check stability (no degenerate one-party lock-in, no
  collapse to uniform 50/50 geography, minor parties bounded).
