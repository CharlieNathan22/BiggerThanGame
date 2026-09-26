# Simulation

10,000 runs per mode over 77 players, generated 2026-09-26. Every mode uses the same seeds, so the columns differ only by what the mode changes.

> Streaks come from a **modelled** player: correct with probability rising from
> 0.5 at no gap to 0.95 at a blowout. That model is an assumption. The shape is
> informative; the absolute numbers are not, until real play replaces them.

## Streak distribution

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Mean | 5.9 | 5.9 | 5.9 |
| Median | 4 | 4 | 4 |
| 75th percentile | 9 | 9 | 9 |
| 90th percentile | 14 | 14 | 14 |
| 99th percentile | 24 | 24 | 24 |
| Best | 39 | 35 | 35 |

| Streak | friendly | endless | ranked |
|---|---|---|---|
| 0 | 14.4% | 14.4% | 14.4% |
| 1–4 | 37.9% | 37.9% | 37.9% |
| 5–9 | 24.9% | 24.7% | 24.7% |
| 10–19 | 19.6% | 19.7% | 19.7% |
| 20–29 | 3.0% | 3.2% | 3.2% |
| 30+ | 0.2% | 0.2% | 0.2% |

## Stat firing rates

What the wheel actually produced, after tie exclusion and band filtering had
their say. Compare against the intended 17.5 / 11 / 2 per stat.

| Stat | Tier | Intended | friendly | endless | ranked |
|---|---|---|---|---|---|
| Club goals | basic | 17.5% | 29.4% | 29.4% | 29.4% |
| Caps | basic | 17.5% | 21.2% | 21.0% | 21.0% |
| Club appearances | basic | 17.5% | 0.0% | 0.0% | 0.0% |
| Instagram followers | basic | 17.5% | 32.0% | 31.6% | 31.6% |
| Highest transfer fee | uncommon | 11% | 7.6% | 7.8% | 7.8% |
| International goals | uncommon | 11% | 5.1% | 5.0% | 5.0% |
| Club trophies | rare | 2% | 3.9% | 4.1% | 4.1% |
| International trophies | rare | 2% | 0.4% | 0.4% | 0.4% |
| Clubs played for | rare | 2% | 0.3% | 0.3% | 0.3% |
| Age | rare | 2% | 0.2% | 0.2% | 0.2% |

## Iconic preference

For the first N rounds of a run the challenger is drawn from iconic players when
one can be dealt within the band; otherwise the whole deck is used before any
other relaxation. These rows cover only rounds inside that window. A high
fallback rate means the deck is short of iconic players at the opening band.

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Window | rounds 1–10 | rounds 1–5 | rounds 1–5 |
| Rounds dealt in window | 55940 | 37772 | 37772 |
| Iconic challenger | 96.6% | 96.3% | 96.3% |
| Fell back | 3.4% | 3.7% | 3.7% |
| … to the whole deck | 0.3% | 0.1% | 0.1% |
| … and widened the band | 3.1% | 3.6% | 3.6% |
| … and ignored the seen queue | 0.0% | 0.0% | 0.0% |

## Relaxation

Each round counts once, under the furthest step it needed. `iconic` means the
iconic preference fell back to the whole deck at the round's band. `band` means
the pool was too sparse and the band had to be widened — the deck is thin in the
tails. `seen` means the band was fine but every eligible opponent was recently
used — the deck is simply too small. They need different fixes.

| Cause | friendly | endless | ranked |
|---|---|---|---|
| none | 97.0% | 97.3% | 97.3% |
| iconic | 0.2% | 0.1% | 0.1% |
| band | 2.8% | 2.7% | 2.7% |
| seen | 0.0% | 0.0% | 0.0% |

Any relaxation, by round:

| Rounds | friendly | endless | ranked |
|---|---|---|---|
| 1–10 | 3.4% | 3.1% | 3.1% |
| 11–20 | 1.3% | 1.1% | 1.1% |
| 21–30 | 0.7% | 0.6% | 0.6% |
| 31–40 | 0.0% | 0.0% | 0.0% |

## Engine reach

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Longest constructible run | 60 rounds | 60 rounds | 60 rounds |
| Runs the engine ran out on | 0.0% | 0.0% | 0.0% |

The second row counts runs that ended because the engine could not deal another
pair, rather than because the modelled player failed.
