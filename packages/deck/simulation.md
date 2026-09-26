# Simulation

10,000 runs per mode over 77 players, generated 2026-09-26. Every mode uses the same seeds, so the columns differ only by what the mode changes.

> Streaks come from a **modelled** player: correct with probability rising from
> 0.5 for two players at the same point in the deck's spread to 0.95 for opposite
> ends, measured in rank distance like the bands. **That model is an assumption**,
> to be replaced by the accuracy curve observed in real play (M5c). The shape is
> informative; the absolute numbers are not, until then.

## Streak distribution

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Mean | 5.0 | 5.0 | 5.0 |
| Median | 3 | 3 | 3 |
| 75th percentile | 7 | 7 | 7 |
| 90th percentile | 12 | 12 | 12 |
| 99th percentile | 22 | 23 | 23 |
| Best | 43 | 36 | 36 |

| Streak | friendly | endless | ranked |
|---|---|---|---|
| 0 | 16.3% | 16.3% | 16.3% |
| 1–4 | 41.5% | 41.5% | 41.5% |
| 5–9 | 24.8% | 24.8% | 24.8% |
| 10–19 | 15.5% | 15.4% | 15.4% |
| 20–29 | 1.8% | 1.9% | 1.9% |
| 30+ | 0.1% | 0.1% | 0.1% |

## Stat firing rates

Share of rounds played on each stat, after tie exclusion and band filtering had
their say, against the per-stat target for its tier (`TIER_TARGET`). The wheel's
tier weights are tuned to land within about two points of it.

| Stat | Tier | Target | friendly | endless | ranked |
|---|---|---|---|---|---|
| Club goals | basic | 15% | 14.0% | 14.1% | 14.1% |
| Caps | basic | 15% | 13.5% | 13.5% | 13.5% |
| Club appearances | basic | 15% | 13.2% | 13.3% | 13.3% |
| Instagram followers | basic | 15% | 15.5% | 15.2% | 15.2% |
| Highest transfer fee | uncommon | 10% | 9.7% | 9.6% | 9.6% |
| International goals | uncommon | 10% | 9.7% | 9.8% | 9.8% |
| Club trophies | rare | 5% | 6.5% | 6.5% | 6.5% |
| International trophies | rare | 5% | 6.7% | 6.6% | 6.6% |
| Clubs played for | rare | 5% | 6.3% | 6.2% | 6.2% |
| Age | rare | 5% | 5.0% | 5.1% | 5.1% |
| _Rounds on the opening stat_ |  |  | 30.5% | 30.4% | 30.4% |

The opening stat — basic or uncommon, never rare — always holds for rounds 1 and
2, and most runs are short, so it covers a large share of all rounds. That is why
rare stats need a much larger wheel weight than their target suggests.

### By round range (Friendly)

Share of the rounds played in each range. Rare stats never open a run, so they
are absent from rounds 1–2 and would concentrate later without the wheel's
no-rare-after-rare rule. The rare row is the tier together, which should stay
under about 30% in every range.

| Stat | Tier | Rounds 1–5 | Rounds 6–10 | Rounds 11–20 | Rounds 21+ |
|---|---|---|---|---|---|
| Club goals | basic | 14.7% | 12.4% | 13.7% | 12.0% |
| Caps | basic | 14.1% | 12.7% | 12.2% | 13.1% |
| Club appearances | basic | 13.9% | 12.3% | 11.7% | 11.0% |
| Instagram followers | basic | 16.1% | 14.4% | 15.0% | 15.6% |
| Highest transfer fee | uncommon | 10.3% | 8.7% | 8.7% | 8.8% |
| International goals | uncommon | 10.2% | 9.2% | 8.8% | 8.6% |
| Club trophies | rare | 5.5% | 8.0% | 7.7% | 7.7% |
| International trophies | rare | 5.7% | 8.3% | 8.2% | 9.1% |
| Clubs played for | rare | 5.3% | 7.5% | 8.2% | 7.8% |
| Age | rare | 4.1% | 6.5% | 5.9% | 6.4% |
| **Rare, together** |  | 20.7% | 30.2% | 30.0% | 31.0% |
| _Rounds played_ |  | 36288 | 15208 | 7871 | 810 |

## Iconic preference

For the first N rounds of a run the challenger is drawn from iconic players when
one can be dealt within the band; otherwise the whole deck is used before any
other relaxation. These rows cover only rounds inside that window. A high
fallback rate means the deck is short of iconic players at the opening band.

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Window | rounds 1–10 | rounds 1–5 | rounds 1–5 |
| Rounds dealt in window | 51496 | 36288 | 36288 |
| Iconic challenger | 99.9% | 100.0% | 100.0% |
| Fell back | 0.1% | 0.0% | 0.0% |
| … to the whole deck | 0.1% | 0.0% | 0.0% |
| … and widened the band | 0.0% | 0.0% | 0.0% |
| … and ignored the seen queue | 0.0% | 0.0% | 0.0% |

## Relaxation

Each round counts once, under the furthest step it needed. `iconic` means the
iconic preference fell back to the whole deck at the round's band. `band` means
the pool was too sparse and the band had to be widened — the deck is thin in the
tails. `seen` means the band was fine but every eligible opponent was recently
used — the deck is simply too small. They need different fixes.

| Cause | friendly | endless | ranked |
|---|---|---|---|
| none | 99.9% | 100.0% | 100.0% |
| iconic | 0.1% | 0.0% | 0.0% |
| band | 0.0% | 0.0% | 0.0% |
| seen | 0.0% | 0.0% | 0.0% |

Any relaxation, by round:

| Rounds | friendly | endless | ranked |
|---|---|---|---|
| 1–10 | 0.1% | 0.0% | 0.0% |
| 11–20 | 0.0% | 0.0% | 0.0% |
| 21–30 | 0.0% | 0.0% | 0.0% |
| 31–40 | 0.0% | 0.0% | 0.0% |
| 41–50 | 0.0% | — | — |

## Engine reach

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Longest constructible run | 60 rounds | 60 rounds | 60 rounds |
| Runs the engine ran out on | 0.0% | 0.0% | 0.0% |

The second row counts runs that ended because the engine could not deal another
pair, rather than because the modelled player failed.
