# Deck viability

Generated 2026-09-27 from 108 players.

Counts are **unordered pairs that clear the band**, before the recently-seen
queue takes its cut. Bands are in rank distance — how far apart two players sit
in the deck's spread for the stat — and Instagram also needs the volatility floor,
exactly as the engine deals them. A stat showing 0 at a band cannot be dealt there
and will force relaxation every time the wheel picks it.

| Stat | Eligible | Distinct | Tied pairs | opening | early | middle | late | hard | knife edge |
|---|---|---|---|---|---|---|---|---|---|
| Club goals | 103 | 90 | 16 | 1645 | 2510 | 2513 | 2020 | 1769 | 957 |
| International caps | 108 | 75 | 37 | 1788 | 2742 | 2736 | 2241 | 1990 | 1059 |
| Club appearances | 108 | 98 | 10 | 1781 | 2750 | 2723 | 2240 | 1961 | 1037 |
| Instagram followers | 94 | 80 | 19 | 1367 | 2089 | 2031 | 1399 | 848 | 131 |
| Highest transfer fee | 90 | 79 | 13 | 1232 | 1910 | 1908 | 1590 | 1372 | 754 |
| International goals | 103 | 50 | 96 | 1636 | 2531 | 2490 | 2017 | 1790 | 983 |
| Club trophies | 108 | 31 | 196 | 1763 | 2752 | 2769 | 2254 | 1992 | 970 |
| International trophies | 108 | 6 | 1445 | 1692 | 3047 | 2331 | 2340 | 894 | 112 |
| Clubs played for | 108 | 14 | 678 | 1673 | 3036 | 2714 | 2353 | 1530 | 505 |
| Age | 100 | 30 | 189 | 1546 | 2358 | 2381 | 1949 | 1719 | 824 |

## Problems

None. Every stat can be dealt at every band.

## Iconic preference

49 of 108 players are iconic. Early rounds prefer an iconic challenger (friendly 1–10, endless 1–5, ranked 1–5). An anchor with no iconic challenger in the opening band always falls back to the whole deck; `simulation.md` reports how often that happens in play.

| Stat | Iconic eligible | Anchors with an iconic challenger |
|---|---|---|
| Club goals | 46 | 103 of 103 (100%) |
| International caps | 49 | 108 of 108 (100%) |
| Club appearances | 49 | 108 of 108 (100%) |
| Instagram followers | 46 | 94 of 94 (100%) |
| Highest transfer fee | 40 | 90 of 90 (100%) |
| International goals | 46 | 103 of 103 (100%) |
| Club trophies | 49 | 108 of 108 (100%) |
| International trophies | 49 | 108 of 108 (100%) |
| Clubs played for | 49 | 108 of 108 (100%) |
| Age | 43 | 100 of 100 (100%) |

Rare stats never open a run, but the wheel can switch to them at round 3, well
inside every mode's window, so they are listed too.

## Stat correlation

Spearman rank correlation. A high value means the two stats order players the
same way, so switching between them asks the same question twice — which is what
the correlated-pair exclusion in `wheel.ts` exists to prevent.

| Pair | ρ | |
|---|---|---|
| Club goals / International goals | 0.85 | **exclude** |
| Instagram followers / Age | -0.61 |  |
| Highest transfer fee / Age | -0.51 |  |
| Instagram followers / Highest transfer fee | 0.51 |  |
| International caps / Club appearances | 0.40 |  |
| Club appearances / Club trophies | 0.38 |  |
| Club trophies / Age | -0.38 |  |
| International caps / Instagram followers | 0.35 |  |
| International caps / Club trophies | 0.34 |  |
| Instagram followers / Club trophies | 0.34 |  |
| International caps / International trophies | 0.30 |  |
| International caps / Age | -0.30 |  |

Pairs at or above ρ = 0.8 should be in `CORRELATED_PAIRS` in `stats.ts`.
