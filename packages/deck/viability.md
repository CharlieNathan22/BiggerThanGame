# Deck viability

Generated 2026-09-27 from 107 players.

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
| Club goals | 102 | 89 | 16 | 1604 | 2447 | 2434 | 1977 | 1729 | 947 | 1895 | 2332 |
| International caps | 107 | 75 | 36 | 1758 | 2718 | 2710 | 2217 | 1967 | 1048 | 2096 | 2585 |
| Club appearances | 107 | 97 | 10 | 1758 | 2718 | 2734 | 2213 | 1936 | 1027 | 2088 | 2584 |
| Instagram followers | 93 | 79 | 19 | 1337 | 2056 | 1980 | 1356 | 835 | 136 | 1582 | 1947 |
| Highest transfer fee | 89 | 78 | 13 | 1218 | 1881 | 1866 | 1520 | 1350 | 745 | 1440 | 1791 |
| International goals | 102 | 50 | 94 | 1616 | 2472 | 2425 | 1970 | 1717 | 975 | 1904 | 2358 |
| Club trophies | 107 | 31 | 195 | 1725 | 2735 | 2699 | 2234 | 1960 | 965 | 2108 | 2626 |
| International trophies | 107 | 6 | 1439 | 1650 | 3020 | 2288 | 2324 | 864 | 96 | 1812 | 3240 |
| Clubs played for | 107 | 14 | 656 | 1660 | 3133 | 2899 | 2301 | 1512 | 505 | 2248 | 2439 |
| Age | 99 | 30 | 185 | 1496 | 2323 | 2310 | 1901 | 1713 | 815 | 1799 | 2207 |

## Problems

None. Every stat can be dealt at every band.

## Iconic preference

49 of 107 players are iconic. Early rounds prefer an iconic challenger (friendly 1–8, endless 1–5, ranked 1–5). An anchor with no iconic challenger in the opening band always falls back to the whole deck; `simulation.md` reports how often that happens in play.

| Stat | Iconic eligible | Anchors with an iconic challenger |
|---|---|---|
| Club goals | 46 | 102 of 102 (100%) |
| International caps | 49 | 107 of 107 (100%) |
| Club appearances | 49 | 107 of 107 (100%) |
| Instagram followers | 46 | 93 of 93 (100%) |
| Highest transfer fee | 40 | 89 of 89 (100%) |
| International goals | 46 | 102 of 102 (100%) |
| Club trophies | 49 | 107 of 107 (100%) |
| International trophies | 49 | 107 of 107 (100%) |
| Clubs played for | 49 | 107 of 107 (100%) |
| Age | 43 | 99 of 99 (100%) |

Rare stats never open a run, but the wheel can switch to them at round 3, well
inside every mode's window, so they are listed too.

## Stat correlation

Spearman rank correlation. A high value means the two stats order players the
same way, so switching between them asks the same question twice — which is what
the correlated-pair exclusion in `wheel.ts` exists to prevent.

| Pair | ρ | |
|---|---|---|
| Club goals / International goals | 0.85 | **exclude** |
| Instagram followers / Age | -0.60 |  |
| Instagram followers / Highest transfer fee | 0.49 |  |
| Highest transfer fee / Age | -0.49 |  |
| International caps / Club appearances | 0.39 |  |
| Club appearances / Club trophies | 0.37 |  |
| Club trophies / Age | -0.36 |  |
| International caps / Instagram followers | 0.34 |  |
| International caps / Club trophies | 0.33 |  |
| Instagram followers / Club trophies | 0.32 |  |
| International caps / International trophies | 0.29 |  |
| International caps / Age | -0.28 |  |

Pairs at or above ρ = 0.8 should be in `CORRELATED_PAIRS` in `stats.ts`.
