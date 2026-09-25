# Simulation

10,000 runs per mode over 24 players, generated 2026-09-25. Every mode uses the same seeds, so the columns differ only by what the mode changes.

> Streaks come from a **modelled** player: correct with probability rising from
> 0.5 at no gap to 0.95 at a blowout. That model is an assumption. The shape is
> informative; the absolute numbers are not, until real play replaces them.

## Streak distribution

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Mean | 5.5 | 5.5 | 5.5 |
| Median | 4 | 4 | 4 |
| 75th percentile | 8 | 8 | 8 |
| 90th percentile | 13 | 13 | 13 |
| 99th percentile | 24 | 24 | 24 |
| Best | 38 | 39 | 39 |

| Streak | friendly | endless | ranked |
|---|---|---|---|
| 0 | 15.2% | 15.2% | 15.2% |
| 1–4 | 39.2% | 39.2% | 39.2% |
| 5–9 | 24.9% | 25.3% | 25.3% |
| 10–19 | 18.0% | 17.5% | 17.5% |
| 20–29 | 2.5% | 2.6% | 2.6% |
| 30+ | 0.2% | 0.2% | 0.2% |

## Stat firing rates

What the wheel actually produced, after tie exclusion and band filtering had
their say. Compare against the intended 17.5 / 11 / 2 per stat.

| Stat | Tier | Intended | friendly | endless | ranked |
|---|---|---|---|---|---|
| Club goals | basic | 17.5% | 27.9% | 28.0% | 28.0% |
| Caps | basic | 17.5% | 24.0% | 23.9% | 23.9% |
| Club appearances | basic | 17.5% | 1.5% | 1.6% | 1.6% |
| Instagram followers | basic | 17.5% | 29.5% | 29.2% | 29.2% |
| Highest transfer fee | uncommon | 11% | 8.1% | 8.4% | 8.4% |
| International goals | uncommon | 11% | 4.5% | 4.5% | 4.5% |
| Club trophies | rare | 2% | 3.7% | 3.7% | 3.7% |
| International trophies | rare | 2% | 0.3% | 0.3% | 0.3% |
| Clubs played for | rare | 2% | 0.3% | 0.2% | 0.2% |
| Age | rare | 2% | 0.2% | 0.2% | 0.2% |

## Iconic preference

For the first N rounds of a run the challenger is drawn from iconic players when
one can be dealt within the band; otherwise the whole deck is used before any
other relaxation. These rows cover only rounds inside that window. A high
fallback rate means the deck is short of iconic players at the opening band.

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Window | rounds 1–10 | rounds 1–5 | rounds 1–5 |
| Rounds dealt in window | 54225 | 37215 | 37215 |
| Iconic challenger | 69.0% | 77.9% | 77.9% |
| Fell back | 31.0% | 22.1% | 22.1% |
| … to the whole deck | 28.3% | 20.4% | 20.4% |
| … and widened the band | 2.8% | 1.7% | 1.7% |
| … and ignored the seen queue | 0.0% | 0.0% | 0.0% |

## Relaxation

Each round counts once, under the furthest step it needed. `iconic` means the
iconic preference fell back to the whole deck at the round's band. `band` means
the pool was too sparse and the band had to be widened — the deck is thin in the
tails. `seen` means the band was fine but every eligible opponent was recently
used — the deck is simply too small. They need different fixes.

| Cause | friendly | endless | ranked |
|---|---|---|---|
| none | 73.4% | 85.4% | 85.4% |
| iconic | 23.5% | 11.6% | 11.6% |
| band | 3.1% | 3.0% | 3.0% |
| seen | 0.0% | 0.0% | 0.0% |

Any relaxation, by round:

| Rounds | friendly | endless | ranked |
|---|---|---|---|
| 1–10 | 31.0% | 16.8% | 16.8% |
| 11–20 | 4.7% | 4.0% | 4.0% |
| 21–30 | 2.5% | 2.7% | 2.7% |
| 31–40 | 3.6% | 4.2% | 4.2% |

## Engine reach

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Longest constructible run | 60 rounds | 60 rounds | 60 rounds |
| Runs the engine ran out on | 0.0% | 0.0% | 0.0% |

The second row counts runs that ended because the engine could not deal another
pair, rather than because the modelled player failed.
