# Deck viability

Generated 2026-09-26 from 77 players.

Counts are **unordered pairs that clear the band**, before the recently-seen
queue takes its cut. Bands are in rank distance — how far apart two players sit
in the deck's spread for the stat — and Instagram also needs the volatility floor,
exactly as the engine deals them. A stat showing 0 at a band cannot be dealt there
and will force relaxation every time the wheel picks it.

| Stat | Eligible | Distinct | Tied pairs | opening | early | middle | late | hard | knife edge |
|---|---|---|---|---|---|---|---|---|---|
| Club goals | 73 | 66 | 8 | 825 | 1272 | 1276 | 1021 | 911 | 494 |
| Caps | 77 | 62 | 15 | 917 | 1414 | 1409 | 1147 | 1013 | 536 |
| Club appearances | 77 | 74 | 3 | 907 | 1424 | 1407 | 1142 | 1034 | 560 |
| Instagram followers | 66 | 60 | 7 | 671 | 1018 | 997 | 685 | 427 | 56 |
| Highest transfer fee | 61 | 55 | 6 | 581 | 889 | 890 | 712 | 639 | 343 |
| International goals | 73 | 42 | 49 | 824 | 1240 | 1260 | 1028 | 892 | 504 |
| Club trophies | 77 | 30 | 96 | 920 | 1403 | 1399 | 1142 | 1033 | 484 |
| International trophies | 77 | 6 | 741 | 875 | 1586 | 1182 | 1205 | 372 | 70 |
| Clubs played for | 77 | 13 | 327 | 865 | 1608 | 1406 | 1212 | 806 | 267 |
| Age | 69 | 26 | 78 | 742 | 1095 | 1134 | 922 | 858 | 423 |

## Problems

None. Every stat can be dealt at every band.

## Iconic preference

41 of 77 players are iconic. Early rounds prefer an iconic challenger (friendly 1–10, endless 1–5, ranked 1–5). An anchor with no iconic challenger in the opening band always falls back to the whole deck; `simulation.md` reports how often that happens in play.

| Stat | Iconic eligible | Anchors with an iconic challenger |
|---|---|---|
| Club goals | 38 | 73 of 73 (100%) |
| Caps | 41 | 77 of 77 (100%) |
| Club appearances | 41 | 77 of 77 (100%) |
| Instagram followers | 39 | 66 of 66 (100%) |
| Highest transfer fee | 33 | 61 of 61 (100%) |
| International goals | 38 | 73 of 73 (100%) |
| Club trophies | 41 | 77 of 77 (100%) |
| International trophies | 41 | 77 of 77 (100%) |
| Clubs played for | 41 | 77 of 77 (100%) |
| Age | 35 | 69 of 69 (100%) |

Rare stats never open a run, but the wheel can switch to them at round 3, well
inside every mode's window, so they are listed too.

## Stat correlation

Spearman rank correlation. A high value means the two stats order players the
same way, so switching between them asks the same question twice — which is what
the correlated-pair exclusion in `wheel.ts` exists to prevent.

| Pair | ρ | |
|---|---|---|
| Club goals / International goals | 0.84 | **exclude** |
| Instagram followers / Age | -0.60 |  |
| Instagram followers / Highest transfer fee | 0.57 |  |
| Highest transfer fee / Age | -0.49 |  |
| Club appearances / Club trophies | 0.46 |  |
| Club trophies / Age | -0.45 |  |
| Caps / Club appearances | 0.45 |  |
| Caps / International trophies | 0.38 |  |
| Caps / Instagram followers | 0.37 |  |
| Caps / Club trophies | 0.36 |  |
| Caps / Age | -0.35 |  |
| Instagram followers / International trophies | 0.35 |  |

Pairs at or above ρ = 0.8 should be in `CORRELATED_PAIRS` in `stats.ts`.
