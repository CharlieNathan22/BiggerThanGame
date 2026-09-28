# Deck viability

Generated 2026-09-28 from 131 players.

Counts are **unordered pairs that clear the band**, before the recently-seen
queue takes its cut. Bands are in rank distance — how far apart two players sit
in the deck's spread for the stat — and Instagram also needs the volatility floor,
exactly as the engine deals them. A stat showing 0 at a band cannot be dealt there
and will force relaxation every time the wheel picks it.

| Band | Rank distance | Rounds |
|---|---|---|
| opening | 0.45–no ceiling | 1–10; Friendly 1–8 |
| early | 0.25–0.7 | 11–18; Friendly 18–19 |
| middle | 0.15–0.5 | 19–26; Friendly 20 |
| late | 0.1–0.35 | 27–34 |
| hard | 0.05–0.25 | 35–42 |
| knife edge | 0.02–0.12 | 43+ |
| Friendly 9–13 | 0.4–no ceiling | Friendly 9–13 |
| Friendly 14–17 | 0.3–0.8 | Friendly 14–17 |

| Stat | Eligible | Distinct | Tied pairs | opening | early | middle | late | hard | knife edge | Friendly 9–13 | Friendly 14–17 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Club goals | 124 | 105 | 26 | 2358 | 3641 | 3640 | 2979 | 2570 | 1436 | 2791 | 3484 |
| International caps | 131 | 82 | 66 | 2644 | 4066 | 4074 | 3296 | 2885 | 1578 | 3143 | 3883 |
| Club appearances | 131 | 118 | 13 | 2629 | 4068 | 4067 | 3311 | 2921 | 1583 | 3127 | 3893 |
| Instagram followers | 115 | 94 | 31 | 2026 | 3128 | 3034 | 2072 | 1284 | 178 | 2405 | 2971 |
| Highest transfer fee | 108 | 93 | 20 | 1776 | 2749 | 2729 | 2245 | 1967 | 1043 | 2131 | 2612 |
| International goals | 124 | 53 | 142 | 2375 | 3648 | 3645 | 2974 | 2595 | 1427 | 2788 | 3476 |
| Club trophies | 131 | 33 | 297 | 2594 | 4052 | 4050 | 3200 | 2872 | 1471 | 3145 | 3914 |
| International trophies | 131 | 6 | 2307 | 2580 | 4486 | 3210 | 3292 | 1204 | 126 | 2790 | 4950 |
| Clubs played for | 131 | 14 | 944 | 2600 | 4007 | 4173 | 3429 | 2791 | 795 | 2756 | 3728 |
| Age | 123 | 32 | 263 | 2356 | 3582 | 3616 | 2950 | 2608 | 1334 | 2794 | 3398 |

## Problems

None. Every stat can be dealt at every band.

## Iconic preference

56 of 131 players are iconic. Early rounds prefer an iconic challenger (friendly 1–8, endless 1–5, ranked 1–5). An anchor with no iconic challenger in the opening band always falls back to the whole deck; `simulation.md` reports how often that happens in play.

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
| Club trophies / Age | -0.35 |  |
| Club goals / Clubs played for | 0.33 |  |
| Club appearances / Club trophies | 0.33 |  |
| International caps / Instagram followers | 0.33 |  |
| International caps / Club trophies | 0.32 |  |
| Instagram followers / Club trophies | 0.31 |  |
| International caps / International trophies | 0.27 |  |

Pairs at or above ρ = 0.8 should be in `CORRELATED_PAIRS` in `stats.ts`.
