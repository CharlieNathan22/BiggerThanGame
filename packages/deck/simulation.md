# Simulation

10,000 runs per mode over 107 players, generated 2026-09-27. Every mode uses the same seeds, so the columns differ only by what the mode changes.

> Streaks come from a **modelled** player: correct with probability rising from
> 0.5 for two players at the same point in the deck's spread to 0.95 for opposite
> ends, measured in rank distance like the bands. **That model is an assumption**,
> to be replaced by the accuracy curve observed in real play (M5c). The shape is
> informative; the absolute numbers are not, until then.

## Streak distribution

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Mean | 8.1 | 8.2 | 8.2 |
| Median | 7 | 7 | 7 |
| 75th percentile | 13 | 12 | 12 |
| 90th percentile | 19 | 18 | 18 |
| 99th percentile | 20 | 29 | 29 |
| Best | 20 | 43 | 43 |

| Streak | friendly | endless | ranked |
|---|---|---|---|
| 0 | 9.5% | 9.5% | 9.5% |
| 1–4 | 28.3% | 28.3% | 28.3% |
| 5–9 | 25.4% | 24.9% | 24.9% |
| 10–19 | 27.2% | 29.5% | 29.5% |
| 20–29 | 9.6% | 6.9% | 6.9% |
| 30+ | 0.0% | 0.9% | 0.9% |

## Friendly: the 20-question challenge

A run that answers all 20 rounds correctly is won. Share of runs:

| Streak | Runs |
|---|---|
| 0 | 9.5% |
| 1–4 | 28.3% |
| 5–9 | 25.4% |
| 10–14 | 16.1% |
| 15–19 | 11.1% |
| **20 (won)** | 9.6% |

Reached at least:

| Streak | 5 | 10 | 15 | 18 | 20 |
|---|---|---|---|---|---|
| Runs | 62.2% | 36.9% | 20.7% | 13.7% | 9.6% |

**Win rate: 9.6%.**

Reached the final question (round 20): 11.8% of runs, and 81.6% of those won.

## Stat firing rates

Share of rounds played on each stat, after tie exclusion and band filtering had
their say, against the per-stat target for its tier (`TIER_TARGET`). The wheel's
tier weights are tuned to land within about two points of it.

| Stat | Tier | Target | friendly | endless | ranked |
|---|---|---|---|---|---|
| Club goals | basic | 15% | 14.1% | 14.0% | 14.0% |
| International caps | basic | 15% | 12.8% | 12.9% | 12.9% |
| Club appearances | basic | 15% | 12.9% | 12.9% | 12.9% |
| Instagram followers | basic | 15% | 14.7% | 14.6% | 14.6% |
| Highest transfer fee | uncommon | 10% | 9.4% | 9.4% | 9.4% |
| International goals | uncommon | 10% | 9.4% | 9.3% | 9.3% |
| Club trophies | rare | 5% | 7.0% | 7.1% | 7.1% |
| International trophies | rare | 5% | 7.0% | 7.0% | 7.0% |
| Clubs played for | rare | 5% | 6.8% | 6.8% | 6.8% |
| Age | rare | 5% | 5.8% | 5.8% | 5.8% |
| _Rounds on the opening stat_ |  |  | 21.1% | 20.6% | 20.6% |

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
| Club goals | basic | 14.6% | 13.2% | 14.4% | 0.0% |
| International caps | basic | 13.6% | 12.3% | 11.8% | 0.0% |
| Club appearances | basic | 13.5% | 12.4% | 12.4% | 0.0% |
| Instagram followers | basic | 15.7% | 14.2% | 13.5% | 0.0% |
| Highest transfer fee | uncommon | 10.1% | 9.0% | 8.8% | 0.0% |
| International goals | uncommon | 9.9% | 9.1% | 8.8% | 0.0% |
| Club trophies | rare | 6.1% | 7.7% | 8.1% | 0.0% |
| International trophies | rare | 6.1% | 7.9% | 7.7% | 0.0% |
| Clubs played for | rare | 5.8% | 7.7% | 7.6% | 0.0% |
| Age | rare | 4.7% | 6.5% | 7.1% | 0.0% |
| **Rare, together** |  | 22.7% | 29.8% | 30.4% | 0.0% |
| _Rounds played_ |  | 41580 | 25604 | 22983 | 0 |

## Iconic preference

For the first N rounds of a run the challenger is drawn from iconic players when
one can be dealt within the band; otherwise the whole deck is used before any
other relaxation. These rows cover only rounds inside that window. A high
fallback rate means the deck is short of iconic players at the opening band.

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Window | rounds 1–8 | rounds 1–5 | rounds 1–5 |
| Rounds dealt in window | 58482 | 41580 | 41580 |
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
| iconic | 0.0% | 0.0% | 0.0% |
| band | 0.0% | 0.0% | 0.0% |
| seen | 0.0% | 0.0% | 0.0% |

Any relaxation, by round:

| Rounds | friendly | endless | ranked |
|---|---|---|---|
| 1–10 | 0.1% | 0.0% | 0.0% |
| 11–20 | 0.0% | 0.0% | 0.0% |
| 21–30 | — | 0.0% | 0.0% |
| 31–40 | — | 0.0% | 0.0% |
| 41–50 | — | 0.0% | 0.0% |

## Engine reach

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Longest constructible run | 20 rounds | 60 rounds | 60 rounds |
| Runs the engine ran out on | 0.0% | 0.0% | 0.0% |

The second row counts runs that ended because the engine could not deal another
pair, rather than because the modelled player failed.
