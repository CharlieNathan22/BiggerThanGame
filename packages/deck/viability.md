# Deck viability

Generated 2026-09-19 from 24 players.

Counts are **unordered pairs that clear the band**, before the recently-seen
queue takes its cut. A stat showing 0 at a band cannot be dealt there and will
force relaxation every time the wheel picks it.

| Stat | Eligible | Distinct | Tied pairs | opening | early | middle | late | hard | knife edge |
|---|---|---|---|---|---|---|---|---|---|
| Club goals | 21 | 21 | 0 | 104 | 89 | 79 | 67 | 53 | 29 |
| Caps | 24 | 24 | 0 | 29 | 53 | 84 | 95 | 93 | 74 |
| Club appearances | 24 | 22 | 2 | 6 | 21 | 47 | 74 | 91 | 98 |
| Instagram followers | 21 | 21 | 0 | 121 | 79 | 70 | 58 | 49 | 29 |
| Highest transfer fee | 24 | 24 | 0 | 62 | 87 | 112 | 107 | 101 | 75 |
| International goals | 21 | 21 | 0 | 102 | 94 | 85 | 69 | 53 | 37 |
| Club trophies | 24 | 24 | 0 | 77 | 90 | 102 | 94 | 92 | 71 |
| International trophies * | 24 | 4 | 80 | 196 | 196 | 196 | 196 | 196 | 196 |
| Clubs played for * | 24 | 8 | 35 | 241 | 241 | 241 | 241 | 241 | 241 |
| Age * | 22 | 21 | 1 | 230 | 230 | 230 | 230 | 230 | 230 |

`*` band-exempt — matched on tie exclusion alone, so every band shows the same count.

## Problems

None. Every stat can be dealt at every band.

## Stat correlation

Spearman rank correlation. A high value means the two stats order players the
same way, so switching between them asks the same question twice — which is what
the correlated-pair exclusion in `wheel.ts` exists to prevent.

| Pair | ρ | |
|---|---|---|
| Club goals / International goals | 0.96 | **exclude** |
| Instagram followers / Highest transfer fee | 0.92 | **exclude** |
| Caps / Club appearances | 0.91 | **exclude** |
| Club appearances / Club trophies | 0.91 | **exclude** |
| Caps / Age | 0.91 | **exclude** |
| Club appearances / Age | 0.87 | **exclude** |
| Caps / Club trophies | 0.87 | **exclude** |
| Club trophies / Age | 0.83 | **exclude** |
| Club trophies / International trophies | 0.81 | **exclude** |
| Caps / International trophies | 0.77 |  |
| International trophies / Age | 0.73 |  |
| Instagram followers / International goals | 0.70 |  |

Pairs at or above ρ = 0.8 should be in `CORRELATED_PAIRS` in `stats.ts`.
