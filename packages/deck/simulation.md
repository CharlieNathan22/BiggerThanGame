# Simulation

10,000 runs over 24 players, generated 2026-09-18.

> Streaks come from a **modelled** player: correct with probability rising from
> 0.5 at no gap to 0.95 at a blowout. That model is an assumption. The shape is
> informative; the absolute numbers are not, until real play replaces them.

## Streak distribution

| Measure         | Rounds |
| --------------- | ------ |
| Mean            | 5.9    |
| Median          | 4      |
| 75th percentile | 9      |
| 90th percentile | 14     |
| 99th percentile | 24     |
| Best            | 38     |

| Streak | Share                 |
| ------ | --------------------- |
| 0      | 13.0% █████           |
| 1–4    | 38.2% ███████████████ |
| 5–9    | 26.7% ███████████     |
| 10–19  | 19.0% ████████        |
| 20–29  | 2.9% █                |
| 30+    | 0.2%                  |

## Stat firing rates

What the wheel actually produced, after tie exclusion and band filtering had
their say. Compare against the intended 17.5 / 11 / 2 per stat.

| Stat                   | Tier     | Share | Intended |
| ---------------------- | -------- | ----- | -------- |
| Club goals             | basic    | 27.6% | 17.5%    |
| Caps                   | basic    | 23.2% | 17.5%    |
| Club appearances       | basic    | 2.2%  | 17.5%    |
| Instagram followers    | basic    | 29.0% | 17.5%    |
| Highest transfer fee   | uncommon | 9.2%  | 11%      |
| International goals    | uncommon | 4.3%  | 11%      |
| Club trophies          | rare     | 3.6%  | 2%       |
| International trophies | rare     | 0.4%  | 2%       |
| Clubs played for       | rare     | 0.3%  | 2%       |
| Age                    | rare     | 0.2%  | 2%       |

## Relaxation

`band` means the pool was too sparse and the band had to be widened — the deck
is thin in the tails. `seen` means the band was fine but every eligible opponent
was recently used — the deck is simply too small. They need different fixes.

| Cause | Share |
| ----- | ----- |
| none  | 97.0% |
| band  | 3.0%  |
| seen  | 0.0%  |

| Rounds | Relaxed |
| ------ | ------- |
| 1–10   | 2.9%    |
| 11–20  | 3.5%    |
| 21–30  | 2.6%    |
| 31–40  | 8.3%    |

## Engine reach

Longest run the engine could construct: **60 rounds**.
Runs that ended because the engine ran out rather than the player failing: **0.0%**.
