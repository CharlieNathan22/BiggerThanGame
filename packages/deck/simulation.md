# Simulation

20,000 runs per mode over 131 players, generated 2026-10-06. Every mode uses the same seeds, so the columns differ only by what the mode changes.

> Streaks come from a **modelled** player, `fan`: a keen football fan, accurate 0.55 at 0, 0.65 at 0.03, 0.78 at 0.08, 0.88 at 0.15, 0.95 at 0.3, 0.99 at 0.5 (rank distance), linear in between and flat beyond the last point. **That model is an assumption** (see Player models below), to be replaced by the accuracy curve observed in real play.

## Streak distribution

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Mean | 12.3 | 9.9 | 23.6 |
| Median | 12 | 10 | 23 |
| 75th percentile | 15 | 12 | 32 |
| 90th percentile | 17 | 16 | 39 |
| 99th percentile | 20 | 24 | 48 |
| Best | 20 | 39 | 60 |

| Streak | friendly | endless | ranked |
|---|---|---|---|
| 0 | 1.0% | 1.0% | 1.0% |
| 1–4 | 4.3% | 4.3% | 4.3% |
| 5–9 | 7.7% | 41.8% | 5.4% |
| 10–19 | 82.2% | 49.4% | 26.2% |
| 20–29 | 4.8% | 3.3% | 32.8% |
| 30+ | 0.0% | 0.2% | 30.4% |

## Friendly: the 20-question challenge

A run that answers all 20 rounds correctly is won. Share of runs:

| Streak | Runs |
|---|---|
| 0 | 1.0% |
| 1–4 | 4.3% |
| 5–9 | 7.7% |
| 10–14 | 61.6% |
| 15–19 | 20.6% |
| **20 (won)** | 4.8% |

Reached at least:

| Streak | 5 | 10 | 15 | 18 | 20 |
|---|---|---|---|---|---|
| Runs | 94.7% | 87.0% | 25.4% | 9.6% | 4.8% |

**Win rate: 4.8%.**

Reached the final question (round 20): 6.7% of runs, and 70.9% of those won.

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
| 13 | 0.06–0.16 | 59.6% | 82.0% |
| 14 | 0.02–0.08 | 48.9% | 72.2% |
| 15 | 0.02–0.08 | 35.3% | 72.0% |
| 16 | 0.02–0.08 | 25.4% | 71.3% |
| 17 | 0.02–0.08 | 18.1% | 70.7% |
| 18 | 0.02–0.04, ≥10% apart | 12.8% | 74.6% |
| 19 | 0.02–0.04, ≥10% apart | 9.6% | 70.5% |
| 20 | 0.01–0.03, ≥10% apart | 6.7% | 70.9% |

## Friendly under each player model

The same runs and the same skill draws, scored by each model. The first column
is the model that played the runs above.

| Measure | `fan` | `rank` |
|---|---|---|
| Mean streak | 12.3 | 6.7 |
| Median streak | 12 | 6 |
| Reached question 18 | 12.8% | 1.7% |
| Reached question 19 | 9.6% | 1.1% |
| Reached question 20 | 6.7% | 0.7% |
| Correct on question 18 | 74.6% | 66.5% |
| Correct on question 19 | 70.5% | 64.9% |
| Correct on question 20 | 70.9% | 66.0% |
| **Win rate** | **4.8%** | **0.5%** |

## Endless: a streak with no finish line

The same runs and skill draws under each model; the first column played the runs
the rest of this report describes.

| Measure | `fan` | `rank` |
|---|---|---|
| Mean streak | 9.9 | 5.5 |
| Median | 10 | 5 |
| 75th percentile | 12 | 8 |
| 90th percentile | 16 | 11 |
| 99th percentile | 24 | 16 |
| Reached 10 | 52.9% | 15.7% |
| Reached 20 | 3.5% | 0.3% |
| Reached 30 | 0.2% | 0.0% |
| Reached 40 | 0.0% | 0.0% |
| Reached the cap (150) | 0.0% | 0.0% |
| Correct, rounds 1–5 | 98.9% | 90.7% |
| Correct, rounds 6–10 | 89.0% | 76.1% |
| Correct, rounds 11–15 | 76.1% | 65.1% |
| Correct, rounds 16–20 | 76.5% | 65.8% |
| Correct, rounds 21–30 | 76.5% | 69.0% |
| Correct, rounds 31+ | 69.2% | — |

From round 16, the pair rules (`PAIR_RULES`):

- **Wide stats** keep their band and must also be at least 10% apart, whatever relaxes.
- **Age**: different, and within 10% of each other, instead of the band.
- **International trophies**: 1–2 apart, instead of the band.
- **Clubs played for**: 1–2 apart, instead of the band.

By round: the scheduled band, the share of runs dealt it, and the share of those
that answered it right.

| Round | Band | Reached | Correct |
|---|---|---|---|
| 1 | ≥0.45 | 100.0% | 99.0% |
| 2 | ≥0.45 | 99.0% | 99.0% |
| 3 | ≥0.45 | 98.0% | 98.8% |
| 4 | ≥0.45 | 96.8% | 98.9% |
| 5 | ≥0.45 | 95.8% | 98.9% |
| 6 | 0.12–0.25 | 94.7% | 88.8% |
| 7 | 0.12–0.25 | 84.1% | 88.9% |
| 8 | 0.12–0.25 | 74.8% | 89.2% |
| 9 | 0.12–0.25 | 66.7% | 89.1% |
| 10 | 0.12–0.25 | 59.4% | 89.0% |
| 11 | 0.03–0.1 | 52.9% | 76.4% |
| 12 | 0.03–0.1 | 40.4% | 75.2% |
| 13 | 0.03–0.1 | 30.4% | 76.8% |
| 14 | 0.03–0.1 | 23.3% | 76.2% |
| 15 | 0.03–0.1 | 17.8% | 75.7% |
| 16 | 0.02–0.04, ≥10% apart; narrow by value | 13.5% | 76.6% |
| 17 | 0.02–0.04, ≥10% apart; narrow by value | 10.3% | 77.2% |
| 18 | 0.02–0.04, ≥10% apart; narrow by value | 8.0% | 75.6% |
| 19 | 0.02–0.04, ≥10% apart; narrow by value | 6.0% | 75.2% |
| 20 | 0.02–0.04, ≥10% apart; narrow by value | 4.5% | 77.8% |
| 21 | 0.01–0.04, ≥10% apart; narrow by value | 3.5% | 78.4% |
| 22 | 0.01–0.04, ≥10% apart; narrow by value | 2.8% | 79.0% |
| 23 | 0.01–0.04, ≥10% apart; narrow by value | 2.2% | 78.0% |
| 24 | 0.01–0.04, ≥10% apart; narrow by value | 1.7% | 73.9% |
| 25 | 0.01–0.04, ≥10% apart; narrow by value | 1.3% | 72.6% |
| 26 | 0.01–0.04, ≥10% apart; narrow by value | 0.9% | 72.1% |
| 27 | 0.01–0.04, ≥10% apart; narrow by value | 0.7% | 76.5% |
| 28 | 0.01–0.04, ≥10% apart; narrow by value | 0.5% | 71.3% |
| 29 | 0.01–0.04, ≥10% apart; narrow by value | 0.4% | 76.4% |
| 30 | 0.01–0.04, ≥10% apart; narrow by value | 0.3% | 74.5% |
| 31 | 0.01–0.03, ≥10% apart; narrow by value | 0.2% | 75.6% |
| 32 | 0.01–0.03, ≥10% apart; narrow by value | 0.2% | 61.3% |
| 33 | 0.01–0.03, ≥10% apart; narrow by value | 0.1% | 73.7% |
| 34 | 0.01–0.03, ≥10% apart; narrow by value | 0.1% | 64.3% |
| 35 | 0.01–0.03, ≥10% apart; narrow by value | 0.0% | 66.7% |
| 36 | 0.01–0.03, ≥10% apart; narrow by value | 0.0% | 66.7% |
| 37 | 0.01–0.03, ≥10% apart; narrow by value | 0.0% | 100.0% |
| 38 | 0.01–0.03, ≥10% apart; narrow by value | 0.0% | 75.0% |
| 39 | 0.01–0.03, ≥10% apart; narrow by value | 0.0% | 66.7% |
| 40 | 0.01–0.03, ≥10% apart; narrow by value | 0.0% | 0.0% |

### Stats from round 16

Share of the rounds played from the pair rules on, against the stat's target.
Every stat should still fire: the wheel never skips a stat it can deal.

| Stat | Tier | Target | Share |
|---|---|---|---|
| Club goals | basic | 15% | 12.9% |
| International caps | basic | 15% | 12.6% |
| Club appearances | basic | 15% | 12.8% |
| Instagram followers | basic | 15% | 14.0% |
| Highest transfer fee | uncommon | 10% | 8.2% |
| International goals | uncommon | 10% | 8.7% |
| Club trophies | rare | 5% | 7.1% |
| International trophies | rare | 5% | 9.0% |
| Clubs played for | rare | 5% | 8.7% |
| Age | rare | 5% | 6.0% |
| _Rounds played_ |  |  | 11422 |

## Instagram Endless: a streak with no finish line

The same runs and skill draws under each model; the first column played the runs
the rest of this report describes.

| Measure | `fan` | `rank` |
|---|---|---|
| Mean streak | 10.2 | 5.5 |
| Median | 10 | 5 |
| 75th percentile | 13 | 8 |
| 90th percentile | 16 | 11 |
| 99th percentile | 24 | 16 |
| Reached 10 | 56.5% | 16.7% |
| Reached 20 | 3.9% | 0.3% |
| Reached 30 | 0.2% | 0.0% |
| Reached 40 | 0.0% | 0.0% |
| Reached the cap (150) | 0.0% | 0.0% |
| Correct, rounds 1–5 | 98.9% | 90.5% |
| Correct, rounds 6–10 | 90.2% | 77.4% |
| Correct, rounds 11–15 | 77.7% | 65.0% |
| Correct, rounds 16–20 | 75.3% | 65.5% |
| Correct, rounds 21–30 | 74.9% | 63.6% |
| Correct, rounds 31+ | 64.2% | — |

By round: the scheduled band, the share of runs dealt it, and the share of those
that answered it right.

| Round | Band | Reached | Correct |
|---|---|---|---|
| 1 | ≥0.45, ≥2.00× apart | 100.0% | 98.9% |
| 2 | ≥0.45, ≥2.00× apart | 98.9% | 99.0% |
| 3 | ≥0.45, ≥2.00× apart | 97.9% | 98.8% |
| 4 | ≥0.45, ≥2.00× apart | 96.8% | 98.9% |
| 5 | ≥0.45, ≥2.00× apart | 95.7% | 98.9% |
| 6 | 0.12–0.3, ≥1.60× apart | 94.7% | 90.0% |
| 7 | 0.12–0.3, ≥1.60× apart | 85.2% | 90.1% |
| 8 | 0.12–0.3, ≥1.60× apart | 76.8% | 90.3% |
| 9 | 0.12–0.3, ≥1.60× apart | 69.4% | 90.3% |
| 10 | 0.12–0.3, ≥1.60× apart | 62.6% | 90.2% |
| 11 | 0.035–0.11, ≥1.45× apart | 56.5% | 78.4% |
| 12 | 0.035–0.11, ≥1.45× apart | 44.3% | 77.0% |
| 13 | 0.035–0.11, ≥1.45× apart | 34.1% | 77.9% |
| 14 | 0.035–0.11, ≥1.45× apart | 26.6% | 77.6% |
| 15 | 0.035–0.11, ≥1.45× apart | 20.6% | 77.4% |
| 16 | 0.03–0.09, ≥1.35× apart | 16.0% | 74.5% |
| 17 | 0.03–0.09, ≥1.35× apart | 11.9% | 76.0% |
| 18 | 0.03–0.09, ≥1.35× apart | 9.0% | 75.3% |
| 19 | 0.03–0.09, ≥1.35× apart | 6.8% | 74.5% |
| 20 | 0.03–0.09, ≥1.35× apart | 5.1% | 77.7% |
| 21 | 0.03–0.09, ≥1.30× apart | 3.9% | 77.3% |
| 22 | 0.03–0.09, ≥1.30× apart | 3.0% | 71.7% |
| 23 | 0.03–0.09, ≥1.30× apart | 2.2% | 80.3% |
| 24 | 0.03–0.09, ≥1.30× apart | 1.8% | 74.3% |
| 25 | 0.03–0.09, ≥1.30× apart | 1.3% | 72.3% |
| 26 | 0.03–0.09, ≥1.30× apart | 0.9% | 70.2% |
| 27 | 0.03–0.09, ≥1.30× apart | 0.7% | 71.2% |
| 28 | 0.03–0.09, ≥1.30× apart | 0.5% | 75.5% |
| 29 | 0.03–0.09, ≥1.30× apart | 0.4% | 78.9% |
| 30 | 0.03–0.09, ≥1.30× apart | 0.3% | 67.9% |
| 31 | 0.02–0.06, ≥1.25× apart | 0.2% | 73.7% |
| 32 | 0.02–0.06, ≥1.25× apart | 0.1% | 50.0% |
| 33 | 0.02–0.06, ≥1.25× apart | 0.1% | 71.4% |
| 34 | 0.02–0.06, ≥1.25× apart | 0.1% | 30.0% |
| 35 | 0.02–0.06, ≥1.25× apart | 0.0% | 100.0% |
| 36 | 0.02–0.06, ≥1.25× apart | 0.0% | 66.7% |
| 37 | 0.02–0.06, ≥1.25× apart | 0.0% | 50.0% |
| 38 | 0.02–0.06, ≥1.25× apart | 0.0% | 100.0% |
| 39 | 0.02–0.06, ≥1.25× apart | 0.0% | 100.0% |
| 40 | 0.02–0.06, ≥1.25× apart | 0.0% | 100.0% |

### How close the pairs get

Over the pairs dealt at each question (runs that reached it): the larger count
as a multiple of the smaller. The closeness floor is the round's `≥n× apart`.
Names and figures of the closest are printed by `pnpm simulate`, not kept here.

| Question | Pairs dealt | Closest | 10th percentile | Median | Under 1.5× |
|---|---|---|---|---|---|
| 10 | 12529 | 1.60× | 1.92× | 2.99× | 0.0% |
| 20 | 1013 | 1.35× | 1.36× | 1.56× | 38.7% |
| 30 | 56 | 1.30× | 1.33× | 1.50× | 50.0% |

Relaxation: 0.1% of rounds widened the band or ignored the seen queue; the closeness floor never gives. Runs the engine ran out on: 0.0%.

## Player models

A modelled player answers each round correctly with a probability set by how far
apart the pair sits in the deck, in rank distance like the bands.

- **`fan`** (used above): a keen football fan, accurate 0.55 at 0, 0.65 at 0.03, 0.78 at 0.08, 0.88 at 0.15, 0.95 at 0.3, 0.99 at 0.5 (rank distance), linear in between and flat beyond the last point.
- `rank`: the original, weaker curve: 0.5 at no gap rising to 0.95 at opposite ends of the deck, along d / (d + 0.2) scaled to reach it.

`fan` is the default and the model Friendly and Endless are tuned with. `rank` was
the only model until Friendly's retune; it is far weaker than a real football fan,
so bands tuned with it proved too soft in real play. Ranked was tuned with it. The
fan model has no clock, so Endless, with ten seconds a question, plays harder still.

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
| International caps | basic | 15% | 12.7% | 12.7% | 12.5% |
| Club appearances | basic | 15% | 12.8% | 12.7% | 12.7% |
| Instagram followers | basic | 15% | 13.8% | 14.7% | 14.0% |
| Highest transfer fee | uncommon | 10% | 9.1% | 9.0% | 8.9% |
| International goals | uncommon | 10% | 9.2% | 9.2% | 9.0% |
| Club trophies | rare | 5% | 7.8% | 7.0% | 7.5% |
| International trophies | rare | 5% | 6.2% | 7.4% | 7.4% |
| Clubs played for | rare | 5% | 7.4% | 7.4% | 7.6% |
| Age | rare | 5% | 6.9% | 6.1% | 6.7% |
| _Rounds on the opening stat_ |  |  | 15.0% | 18.2% | 8.1% |

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
| International caps | basic | 13.0% | 12.5% | 12.5% | 0.0% |
| Club appearances | basic | 13.2% | 12.6% | 12.5% | 0.0% |
| Instagram followers | basic | 15.6% | 14.0% | 11.1% | 0.0% |
| Highest transfer fee | uncommon | 9.5% | 8.8% | 9.1% | 0.0% |
| International goals | uncommon | 9.5% | 9.3% | 8.8% | 0.0% |
| Club trophies | rare | 6.4% | 7.4% | 9.9% | 0.0% |
| International trophies | rare | 6.5% | 7.6% | 3.9% | 0.0% |
| Clubs played for | rare | 6.6% | 7.7% | 8.0% | 0.0% |
| Age | rare | 5.5% | 6.7% | 8.8% | 0.0% |
| **Rare, together** |  | 25.0% | 29.5% | 30.7% | 0.0% |
| _Rounds played_ |  | 97907 | 91571 | 75166 | 0 |

## Iconic preference

For the first N rounds of a run the challenger is drawn from iconic players when
one can be dealt within the band; otherwise the whole deck is used before any
other relaxation. These rows cover only rounds inside that window. A high
fallback rate means the deck is short of iconic players at the opening band.

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Window | rounds 1–5 | rounds 1–5 | rounds 1–5 |
| Rounds dealt in window | 97907 | 97907 | 97907 |
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
| none | 98.2% | 94.7% | 100.0% |
| iconic | 0.0% | 0.0% | 0.0% |
| band | 1.8% | 5.3% | 0.0% |
| seen | 0.0% | 0.0% | 0.0% |

Any relaxation, by round:

| Rounds | friendly | endless | ranked |
|---|---|---|---|
| 1–10 | 0.0% | 0.7% | 0.0% |
| 11–20 | 6.3% | 21.8% | 0.0% |
| 21–30 | — | 40.1% | 0.0% |
| 31–40 | — | 46.6% | 0.1% |
| 41–50 | — | — | 1.9% |
| 51–60 | — | — | 0.9% |

## Engine reach

| Measure | friendly | endless | ranked |
|---|---|---|---|
| Longest constructible run | 20 rounds | 150 rounds | 60 rounds |
| Runs the engine ran out on | 0.0% | 0.0% | 0.0% |

The second row counts runs that ended because the engine could not deal another
pair, rather than because the modelled player failed.

## Clear the squad

20,000 runs per theme. A run deals each of the theme's players once and is cleared by answering every question. Bands ramp by progress through the squad, blended by its size (`squadSchedule`, ramp.ts). Targets: cleared 4–8% for small squads, 2–5% for big leagues.

| Theme | Players | Cleared | Short deals | Followers under 2× | Median progress | 90th percentile | Relaxed |
|---|---|---|---|---|---|---|---|
| Barcelona | 35 | 3.9% | 0.0% | 0 | 17/34 | 28/34 | 0.5% |
| AC Milan | 27 | 4.9% | 0.0% | 0 | 12/26 | 22/26 | 0.9% |
| Juventus | 27 | 4.9% | 0.0% | 0 | 12/26 | 22/26 | 1.0% |
| Real Madrid | 26 | 4.8% | 0.0% | 0 | 12/25 | 21/25 | 0.9% |
| Manchester United | 23 | 7.0% | 0.0% | 0 | 10/22 | 18/22 | 2.7% |
| Inter | 22 | 5.0% | 0.0% | 0 | 10/21 | 17/21 | 1.4% |
| Chelsea | 21 | 5.9% | 0.0% | 0 | 9/20 | 16/20 | 1.9% |
| Bayern Munich | 15 | 5.1% | 0.0% | 0 | 4/14 | 9/14 | 6.0% |
| Arsenal | 11 | 9.6% | 0.0% | 0 | 3/10 | 9/10 | 11.7% |
| Manchester City | 10 | 13.2% | 0.0% | 0 | 2/9 | 9/9 | 31.7% |
| La Liga | 69 | 2.6% | 0.0% | 0 | 35/68 | 58/68 | 0.0% |
| Premier League | 66 | 2.8% | 0.0% | 0 | 33/65 | 55/65 | 0.1% |
| Serie A | 65 | 2.7% | 0.0% | 0 | 32/64 | 54/64 | 0.0% |
| Ligue 1 | 35 | 3.5% | 0.0% | 0 | 17/34 | 28/34 | 0.3% |
| Bundesliga | 22 | 6.1% | 0.0% | 0 | 9/21 | 17/21 | 2.5% |
| 2000s | 51 | 3.5% | 0.0% | 0 | 25/50 | 43/50 | 0.2% |
| 2010s | 37 | 3.4% | 0.0% | 0 | 17/36 | 30/36 | 0.3% |
| 1990s | 29 | 4.0% | 0.0% | 0 | 13/28 | 23/28 | 0.7% |
| Classic Era | 14 | 4.6% | 0.0% | 0 | 4/13 | 8/13 | 4.2% |

Short deals are runs the dealer ended before the last player because the players left couldn't be dealt under any stat; they count as cleared. Followers under 2× counts the follower pairs dealt closer than the 2× floor, over every run dealt in full: the floor gives way only when no other stat can be dealt.

### Accuracy by stretch of the squad

| Theme | first 20% | to 45% | to 70% | to 85% | last 15% |
|---|---|---|---|---|---|
| Barcelona | 98.2% | 96.2% | 89.7% | 85.7% | 81.8% |
| AC Milan | 97.7% | 94.1% | 86.8% | 81.2% | 82.6% |
| Juventus | 97.9% | 94.0% | 86.8% | 81.3% | 82.8% |
| Real Madrid | 97.6% | 93.7% | 86.2% | 81.3% | 81.1% |
| Manchester United | 97.8% | 92.4% | 84.5% | 81.1% | 86.8% |
| Inter | 97.6% | 92.1% | 83.6% | 77.6% | 80.5% |
| Chelsea | 97.4% | 91.0% | 82.0% | 77.4% | 83.9% |
| Bayern Munich | 95.6% | 79.0% | 67.7% | 82.4% | 87.3% |
| Arsenal | 91.8% | 67.9% | 68.4% | 84.9% | 91.3% |
| Manchester City | 89.6% | 69.5% | 77.2% | 89.1% | 91.8% |
| La Liga | 98.9% | 98.4% | 95.1% | 91.9% | 86.9% |
| Premier League | 98.9% | 98.3% | 94.8% | 91.1% | 86.7% |
| Serie A | 98.8% | 98.2% | 94.8% | 91.2% | 86.6% |
| Ligue 1 | 98.2% | 96.1% | 89.8% | 85.0% | 81.1% |
| Bundesliga | 97.0% | 91.9% | 83.5% | 78.9% | 84.7% |
| 2000s | 98.6% | 97.6% | 93.3% | 89.9% | 84.8% |
| 2010s | 98.1% | 96.0% | 90.3% | 86.0% | 81.2% |
| 1990s | 97.9% | 94.4% | 87.4% | 83.2% | 80.5% |
| Classic Era | 96.0% | 75.3% | 67.3% | 81.5% | 91.6% |

### The last 3 questions

Every pair dealt in a run's last three questions, whether or not the player got there: rank distance (the fan model's scale) and the larger figure as a multiple of the smaller. Names and figures of the closest are printed by `pnpm simulate`, not kept here.

| Theme | Median distance | Closest ratio | Median ratio | Under 1.25× |
|---|---|---|---|---|
| Barcelona | 0.108 | 1.10× | 1.48× | 31.2% |
| AC Milan | 0.093 | 1.10× | 1.44× | 27.5% |
| Juventus | 0.112 | 1.10× | 1.46× | 29.6% |
| Real Madrid | 0.088 | 1.10× | 1.33× | 41.0% |
| Manchester United | 0.228 | 1.10× | 1.56× | 28.6% |
| Inter | 0.106 | 1.10× | 1.40× | 31.1% |
| Chelsea | 0.154 | 1.10× | 1.44× | 31.3% |
| Bayern Munich | 0.254 | 1.10× | 2.00× | 14.9% |
| Arsenal | 0.196 | 1.10× | 1.50× | 28.6% |
| Manchester City | 0.257 | 1.10× | 1.45× | 28.5% |
| La Liga | 0.154 | 1.10× | 1.46× | 28.1% |
| Premier League | 0.154 | 1.10× | 1.44× | 31.4% |
| Serie A | 0.154 | 1.10× | 1.35× | 35.6% |
| Ligue 1 | 0.102 | 1.10× | 1.33× | 33.6% |
| Bundesliga | 0.203 | 1.10× | 1.67× | 15.6% |
| 2000s | 0.138 | 1.10× | 1.44× | 31.1% |
| 2010s | 0.108 | 1.10× | 1.43× | 31.4% |
| 1990s | 0.092 | 1.10× | 1.35× | 33.4% |
| Classic Era | 0.232 | 1.10× | 2.00× | 17.2% |
