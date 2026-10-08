# Deck viability

Generated 2026-10-08 from 131 players.

Counts are **unordered pairs that clear the band**, before the recently-seen
queue takes its cut. Bands are in rank distance — how far apart two players sit
in the deck's spread for the stat — and Instagram also needs the volatility floor,
exactly as the engine deals them. A stat showing 0 at a band cannot be dealt there
and will force relaxation every time the wheel picks it.

Endless's rows (Daily Ranked's too) from round 16 count under its pair rules: age, international trophies, clubs played for by their value rule instead of the band, every other stat within the band and at least 10% apart. Neither rule ever relaxes, so a 0 there for a narrow stat means it can't be dealt at all.

| Band | Rank distance | Rounds |
|---|---|---|
| opening | 0.45–no ceiling | Friendly 1–5; Endless and Daily 1–5 |
| Friendly 6–10 | 0.35–no ceiling | Friendly 6–10 |
| Friendly 11–13 | 0.06–0.16 | Friendly 11–13 |
| Friendly 14–17 | 0.02–0.08 | Friendly 14–17 |
| Friendly 18–19 | 0.02–0.04 | Friendly 18–19 |
| Friendly 20 | 0.01–0.03 | Friendly 20 |
| Endless 6–10 | 0.12–0.25 | Endless and Daily 6–10 |
| Endless 11–15 | 0.03–0.1 | Endless and Daily 11–15 |
| Endless 16–20 | 0.02–0.04 | Endless and Daily 16–20, pair rules |
| Endless 21–30 | 0.01–0.04 | Endless and Daily 21–30, pair rules |
| Endless 31+ | 0.01–0.03 | Endless and Daily 31+, pair rules |

| Stat | Eligible | Distinct | Tied pairs | opening | Friendly 6–10 | Friendly 11–13 | Friendly 14–17 | Friendly 18–19 | Friendly 20 | Endless 6–10 | Endless 11–15 | Endless 16–20 | Endless 21–30 | Endless 31+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Club goals | 124 | 105 | 26 | 2358 | 3253 | 1366 | 882 | 144 | 89 | 1623 | 1008 | 144 | 168 | 89 |
| International caps | 131 | 82 | 66 | 2644 | 3663 | 1509 | 923 | 33 | 18 | 1789 | 1166 | 33 | 40 | 18 |
| Club appearances | 131 | 118 | 13 | 2629 | 3667 | 1527 | 953 | 6 | 2 | 1816 | 1166 | 6 | 7 | 2 |
| Instagram followers | 115 | 94 | 31 | 2026 | 2843 | 379 | 73 | 11 | 3 | 1125 | 116 | 11 | 11 | 3 |
| Highest transfer fee | 108 | 93 | 20 | 1776 | 2491 | 1062 | 646 | 116 | 95 | 1237 | 736 | 116 | 156 | 95 |
| International goals | 124 | 53 | 142 | 2375 | 3257 | 1368 | 868 | 154 | 62 | 1658 | 1012 | 154 | 159 | 62 |
| Club trophies | 131 | 33 | 297 | 2594 | 3742 | 1451 | 917 | 72 | 35 | 1893 | 1195 | 72 | 86 | 35 |
| International trophies | 131 | 6 | 2307 | 2580 | 2790 | 464 | 14 | 14 | 0 | 1092 | 126 | 4498 | 4498 | 4498 |
| Clubs played for | 131 | 14 | 944 | 2600 | 3767 | 1837 | 222 | 10 | 7 | 2038 | 363 | 3214 | 3214 | 3214 |
| Age | 123 | 31 | 276 | 2362 | 3206 | 1332 | 831 | 2 | 0 | 1543 | 970 | 1967 | 1967 | 1967 |

## Problems

- **International trophies** has no valid pair at the Friendly 20 band (Friendly 20).
- **Age** has no valid pair at the Friendly 20 band (Friendly 20).

## Iconic preference

56 of 131 players are iconic. Early rounds prefer an iconic challenger (friendly 1–5, endless 1–5, ranked 1–3). An anchor with no iconic challenger in the opening band always falls back to the whole deck; `simulation.md` reports how often that happens in play.

| Stat | Iconic eligible | Anchors with an iconic challenger |
|---|---|---|
| Club goals | 53 | 124 of 124 (100%) |
| International caps | 56 | 131 of 131 (100%) |
| Club appearances | 56 | 131 of 131 (100%) |
| Instagram followers | 53 | 115 of 115 (100%) |
| Highest transfer fee | 44 | 108 of 108 (100%) |
| International goals | 53 | 124 of 124 (100%) |
| Club trophies | 56 | 131 of 131 (100%) |
| International trophies | 56 | 131 of 131 (100%) |
| Clubs played for | 56 | 131 of 131 (100%) |
| Age | 50 | 123 of 123 (100%) |

Rare stats never open a run, but the wheel can switch to them at round 3, well
inside every mode's window, so they are listed too.

## Stat correlation

Spearman rank correlation. A high value means the two stats order players the
same way, so switching between them asks the same question twice — which is what
the correlated-pair exclusion in `wheel.ts` exists to prevent.

| Pair | ρ | |
|---|---|---|
| Club goals / International goals | 0.86 | **exclude** |
| Instagram followers / Age | -0.62 |  |
| Instagram followers / Highest transfer fee | 0.52 |  |
| Highest transfer fee / Age | -0.51 |  |
| International caps / Club appearances | 0.38 |  |
| Club trophies / Age | -0.34 |  |
| Club goals / Clubs played for | 0.33 |  |
| Club appearances / Club trophies | 0.33 |  |
| International caps / Instagram followers | 0.33 |  |
| International caps / Club trophies | 0.32 |  |
| Instagram followers / Club trophies | 0.31 |  |
| International caps / International trophies | 0.27 |  |

Pairs at or above ρ = 0.8 should be in `CORRELATED_PAIRS` in `stats.ts`.
