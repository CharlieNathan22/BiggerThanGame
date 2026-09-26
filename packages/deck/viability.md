# Deck viability

Generated 2026-09-26 from 77 players.

Counts are **unordered pairs that clear the band**, before the recently-seen
queue takes its cut. A stat showing 0 at a band cannot be dealt there and will
force relaxation every time the wheel picks it.

| Stat | Eligible | Distinct | Tied pairs | opening | early | middle | late | hard | knife edge |
|---|---|---|---|---|---|---|---|---|---|
| Club goals | 73 | 66 | 8 | 1012 | 975 | 995 | 897 | 714 | 458 |
| Caps | 77 | 62 | 15 | 45 | 127 | 387 | 656 | 1023 | 1080 |
| Club appearances | 77 | 74 | 3 | 0 | 0 | 5 | 47 | 262 | 778 |
| Instagram followers | 66 | 60 | 7 | 1399 | 748 | 579 | 461 | 351 | 226 |
| Highest transfer fee | 61 | 55 | 6 | 1006 | 635 | 511 | 402 | 351 | 269 |
| International goals | 73 | 42 | 49 | 1068 | 1048 | 997 | 871 | 715 | 506 |
| Club trophies | 77 | 30 | 96 | 498 | 603 | 855 | 901 | 981 | 874 |
| International trophies * | 77 | 6 | 741 | 2185 | 2185 | 2185 | 2185 | 2185 | 2185 |
| Clubs played for * | 77 | 13 | 327 | 2599 | 2599 | 2599 | 2599 | 2599 | 2599 |
| Age * | 69 | 26 | 78 | 2268 | 2268 | 2268 | 2268 | 2268 | 2268 |

`*` band-exempt — matched on tie exclusion alone, so every band shows the same count.

## Problems

- **Club appearances** has no valid pair at the opening band (1–10).
- **Club appearances** has no valid pair at the early band (11–18).

## Iconic preference

41 of 77 players are iconic. Early rounds prefer an iconic challenger (friendly 1–10, endless 1–5, ranked 1–5). An anchor with no iconic challenger in the opening band always falls back to the whole deck; `simulation.md` reports how often that happens in play.

| Stat | Iconic eligible | Anchors with an iconic challenger |
|---|---|---|
| Club goals | 38 | 73 of 73 (100%) |
| Caps | 41 | 35 of 77 (45%) |
| Club appearances | 41 | 0 of 77 (0%) |
| Instagram followers | 39 | 66 of 66 (100%) |
| Highest transfer fee | 33 | 61 of 61 (100%) |
| International goals | 38 | 73 of 73 (100%) |
| Club trophies | 41 | 77 of 77 (100%) |

Band-exempt stats are left out: they cannot be dealt in the opening rounds.

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
