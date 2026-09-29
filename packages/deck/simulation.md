# Simulation

20,000 runs per mode over 131 players, generated 2026-09-29. Every mode uses the same seeds, so the columns differ only by what the mode changes.

> Streaks come from a **modelled** player, `fan`: a keen football fan, accurate 0.55 at 0, 0.65 at 0.03, 0.78 at 0.08, 0.88 at 0.15, 0.95 at 0.3, 0.99 at 0.5 (rank distance), linear in between and flat beyond the last point. **That model is an assumption** (see Player models below), to be replaced by the accuracy curve observed in real play.

## Streak distribution

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Mean | 12.3 | 23.6 | 23.6 |
| Median | 12 | 23 | 23 |
| 75th percentile | 15 | 32 | 32 |
| 90th percentile | 17 | 39 | 39 |
| 99th percentile | 20 | 48 | 48 |
| Best | 20 | 60 | 60 |

| Streak | friendly | endless | ranked |
|---|---|---|---|
| 0 | 1.0% | 1.0% | 1.0% |
| 1–4 | 4.3% | 4.3% | 4.3% |
| 5–9 | 7.7% | 5.4% | 5.4% |
| 10–19 | 82.3% | 26.2% | 26.2% |
| 20–29 | 4.8% | 32.7% | 32.7% |
| 30+ | 0.0% | 30.4% | 30.4% |

## Friendly: the 20-question challenge

A run that answers all 20 rounds correctly is won. Share of runs:

| Streak | Runs |
|---|---|
| 0 | 1.0% |
| 1–4 | 4.3% |
| 5–9 | 7.7% |
| 10–14 | 61.6% |
| 15–19 | 20.7% |
| **20 (won)** | 4.8% |

Reached at least:

| Streak | 5 | 10 | 15 | 18 | 20 |
|---|---|---|---|---|---|
| Runs | 94.7% | 87.0% | 25.4% | 9.5% | 4.8% |

**Win rate: 4.8%.**

Reached the final question (round 20): 6.7% of runs, and 70.6% of those won.

By question: the round's scheduled band, the share of runs dealt the question,
and the share of those that answered it right.

| Question | Band | Reached | Correct |
|---|---|---|---|
| 1 | ≥0.45 | 100.0% | 99.0% |
| 2 | ≥0.45 | 99.0% | 99.0% |
| 3 | ≥0.45 | 98.0% | 98.8% |
| 4 | ≥0.45 | 96.8% | 98.9% |
| 5 | ≥0.45 | 95.8% | 98.9% |
| 6 | ≥0.35 | 94.7% | 98.3% |
| 7 | ≥0.35 | 93.1% | 98.3% |
| 8 | ≥0.35 | 91.5% | 98.4% |
| 9 | ≥0.35 | 90.0% | 98.3% |
| 10 | ≥0.35 | 88.5% | 98.3% |
| 11 | 0.06–0.16 | 87.0% | 83.2% |
| 12 | 0.06–0.16 | 72.4% | 82.3% |
| 13 | 0.06–0.16 | 59.6% | 82.1% |
| 14 | 0.02–0.08 | 48.9% | 72.2% |
| 15 | 0.02–0.08 | 35.3% | 72.0% |
| 16 | 0.02–0.08 | 25.4% | 71.2% |
| 17 | 0.02–0.08 | 18.1% | 70.7% |
| 18 | 0.02–0.04, ≥10% apart | 12.8% | 74.6% |
| 19 | 0.02–0.04, ≥10% apart | 9.5% | 70.5% |
| 20 | 0.01–0.03, ≥10% apart | 6.7% | 70.6% |

## Friendly under each player model

The same runs and the same skill draws, scored by each model. The first column
is the model that played the runs above.

| Measure | `fan` | `rank` |
|---|---|---|
| Mean streak | 12.3 | 6.7 |
| Median streak | 12 | 6 |
| Reached question 18 | 12.8% | 1.7% |
| Reached question 19 | 9.5% | 1.1% |
| Reached question 20 | 6.7% | 0.7% |
| Correct on question 18 | 74.6% | 66.4% |
| Correct on question 19 | 70.5% | 66.2% |
| Correct on question 20 | 70.6% | 66.9% |
| **Win rate** | **4.8%** | **0.5%** |

## Player models

A modelled player answers each round correctly with a probability set by how far
apart the pair sits in the deck, in rank distance like the bands.

- **`fan`** (used above): a keen football fan, accurate 0.55 at 0, 0.65 at 0.03, 0.78 at 0.08, 0.88 at 0.15, 0.95 at 0.3, 0.99 at 0.5 (rank distance), linear in between and flat beyond the last point.
- `rank`: the original, weaker curve: 0.5 at no gap rising to 0.95 at opposite ends of the deck, along d / (d + 0.2) scaled to reach it.

`fan` is the default and the model Friendly is tuned with. `rank` was the only
model until Friendly's retune; it is far weaker than a real football fan, so bands
tuned with it proved too soft in real play. Endless and Ranked were tuned with it.

- `pnpm simulate` uses `fan`; `pnpm simulate --model rank` uses `rank`.
- `pnpm simulate --calibration <file.json>` replaces the fan's points with a list
  of `{ "rankDistance": 0.1, "accuracy": 0.8 }` points (any order, each from 0 to
  1), interpolated linearly and flat beyond the first and last. Build it from real
  play: `pnpm stats distance` gives correct rate by rank distance.
- `--runs <n>` sets the runs per mode (default 20,000).

**Every model is an assumption** until a calibration file from real play replaces
it. The shape of the results is informative; the absolute numbers are indicative.

## Stat firing rates

Share of rounds played on each stat, after tie exclusion and band filtering had
their say, against the per-stat target for its tier (`TIER_TARGET`). The wheel's
tier weights are tuned to land within about two points of it.

| Stat | Tier | Target | friendly | endless | ranked |
|---|---|---|---|---|---|
| Club goals | basic | 15% | 14.2% | 13.7% | 13.7% |
| International caps | basic | 15% | 12.7% | 12.5% | 12.5% |
| Club appearances | basic | 15% | 12.8% | 12.6% | 12.6% |
| Instagram followers | basic | 15% | 13.8% | 14.1% | 14.1% |
| Highest transfer fee | uncommon | 10% | 9.1% | 8.9% | 8.9% |
| International goals | uncommon | 10% | 9.2% | 9.0% | 9.0% |
| Club trophies | rare | 5% | 7.7% | 7.5% | 7.5% |
| International trophies | rare | 5% | 6.1% | 7.4% | 7.4% |
| Clubs played for | rare | 5% | 7.4% | 7.6% | 7.6% |
| Age | rare | 5% | 6.9% | 6.7% | 6.7% |
| _Rounds on the opening stat_ |  |  | 15.0% | 8.1% | 8.1% |

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
| Club goals | basic | 14.2% | 13.3% | 15.4% | 0.0% |
| International caps | basic | 13.0% | 12.5% | 12.4% | 0.0% |
| Club appearances | basic | 13.2% | 12.6% | 12.5% | 0.0% |
| Instagram followers | basic | 15.6% | 14.0% | 11.2% | 0.0% |
| Highest transfer fee | uncommon | 9.5% | 8.8% | 9.1% | 0.0% |
| International goals | uncommon | 9.5% | 9.3% | 8.8% | 0.0% |
| Club trophies | rare | 6.4% | 7.4% | 9.9% | 0.0% |
| International trophies | rare | 6.5% | 7.6% | 3.9% | 0.0% |
| Clubs played for | rare | 6.6% | 7.7% | 8.0% | 0.0% |
| Age | rare | 5.5% | 6.7% | 8.8% | 0.0% |
| **Rare, together** |  | 25.0% | 29.5% | 30.6% | 0.0% |
| _Rounds played_ |  | 97909 | 91567 | 75172 | 0 |

## Iconic preference

For the first N rounds of a run the challenger is drawn from iconic players when
one can be dealt within the band; otherwise the whole deck is used before any
other relaxation. These rows cover only rounds inside that window. A high
fallback rate means the deck is short of iconic players at the opening band.

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Window | rounds 1–5 | rounds 1–5 | rounds 1–5 |
| Rounds dealt in window | 97909 | 97909 | 97909 |
| Iconic challenger | 100.0% | 100.0% | 100.0% |
| Fell back | 0.0% | 0.0% | 0.0% |
| … to the whole deck | 0.0% | 0.0% | 0.0% |
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
| none | 98.2% | 100.0% | 100.0% |
| iconic | 0.0% | 0.0% | 0.0% |
| band | 1.8% | 0.0% | 0.0% |
| seen | 0.0% | 0.0% | 0.0% |

Any relaxation, by round:

| Rounds | friendly | endless | ranked |
|---|---|---|---|
| 1–10 | 0.0% | 0.0% | 0.0% |
| 11–20 | 6.3% | 0.0% | 0.0% |
| 21–30 | — | 0.0% | 0.0% |
| 31–40 | — | 0.1% | 0.1% |
| 41–50 | — | 1.8% | 1.8% |
| 51–60 | — | 0.8% | 0.8% |

## Engine reach

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Longest constructible run | 20 rounds | 60 rounds | 60 rounds |
| Runs the engine ran out on | 0.0% | 0.0% | 0.0% |

The second row counts runs that ended because the engine could not deal another
pair, rather than because the modelled player failed.
