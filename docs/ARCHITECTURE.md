# Bigger Than — Architecture

**Version 2** · September 2026 · companion to `DESIGN.md`

`DESIGN.md` is the authority on what the game is. This document covers how it is built and served.
Where the two overlap, `DESIGN.md` wins on game behaviour and this document wins on
implementation.

> **For Claude Code:** the invariants in section 4 are load-bearing for anti-cheat. Do not
> introduce prefetching of hidden values, do not move the deck to the client, and do not make the
> round sequence depend on player answers. Each of those quietly breaks the leaderboard.

---

## 1. Principles

1. **The backend is small.** The deck is frozen, the engine is deterministic, there is no auth in
   v1. Resist the platform's menu.
2. **The deck lives in git, not a database.** It is small, changes twice a year, and its
   provenance matters. Version control gives diff history for free.
3. **Precompute everything that can be precomputed**, but understand that at a few hundred players
   the value is build-time validation and tuning insight, not runtime speed.
   `ramp.ts` returns a **band** (floor and ceiling), not a floor. A floor alone does not create a
   ramp — see `DESIGN.md` §8. The first band has no ceiling; every later band does. Bands are in
   **rank distance**: each stat's percentile table is computed from the deck and `now`, memoised
   per deck, and identical in every runtime, so the sequence stays a function of seed and mode.
4. **One deployment.** Static assets and API in a single Worker.
5. **The game core is framework-free TypeScript**, imported unchanged by the browser, the Worker
   and the Node test harness.

---

## 2. Deployment topology

Cloudflare now recommends **Workers with Static Assets** for new projects rather than Pages;
Workers serves static files natively and static asset requests are not billed. Pages remains
supported but is not where the investment is going. So: one Worker, one `wrangler.toml`, one
deploy.

```
Request
  │
  ├── /api/*        → Worker fetch handler
  │                     ├── Durable Object (run state)
  │                     ├── D1 (scores, board snapshots)
  │                     └── Cache API (the boards, a minute at most)
  │
  └── everything else → ASSETS binding (Astro build output)
```

Astro is configured for **static output**, not SSR. Every page is prerendered at build time; the
Worker only executes for `/api/*`. No Astro Cloudflare adapter is needed.

**Bindings:** `ASSETS`, `DB` (D1), `RUNS` (Durable Object namespace), `RUN_SECRET` (secret),
`TURNSTILE_SECRET` (secret), `FEEDBACK_TO` (secret), `FEEDBACK_EMAIL` (`send_email`, Email Routing),
`GAME_EVENTS` (Analytics Engine), and `RUN_ANSWERS`, `RUN_STARTS`, `ROUND_FLOOD`, `FEEDBACK_SENDS`,
`RUN_SUBMITS` and `BOARD_LOOKUPS` (Workers Rate Limiting). Two **cron triggers**, 00:00 and 01:30 UTC (§13).

Phase 3 (Friendly) uses `ASSETS`, `RUN_SECRET` and the round endpoint's three rate limiters, plus
`TURNSTILE_SECRET`, `FEEDBACK_TO`, `FEEDBACK_EMAIL` and `FEEDBACK_SENDS` for the feedback forms
(§8). Phase 5 (Endless, part 1) adds `RUNS`, the Durable Object namespace — class `RunDO`,
SQLite-backed (`new_sqlite_classes` migration, so it runs on the free plan), exported from
`worker/index.ts` — and reuses `TURNSTILE_SECRET` for run starts. Endless part 2 adds `DB`, the
boards' D1 database (§10), `RUN_SUBMITS`, `BOARD_LOOKUPS` and the crons; the boards are cached with the Workers
Cache API (`caches.default`, §11), which needs no binding. There is no KV. Workers Logs is on
(`[observability]` in `wrangler.toml`).

**Local development uses local resources only.** `pnpm dev` and every test run against
wrangler's local D1 (Miniflare's state under `.wrangler/`); nothing in `wrangler.toml` or the
scripts sets `remote = true` or passes `--remote`, and a test holds that. `pnpm db:migrate:local`
(which `pnpm dev` runs first), `db:seed:local` and `db:reset:local` never take `--remote`; only
`pnpm db:migrate:remote` and `pnpm db:owner` reach the real database, and each asks first.

There is **no R2 binding**. Images are served from R2 through a custom domain
(`img.biggerthangame.com`) and resized by Image Transformations, so the Worker never touches the
bucket — see section 9.

---

## 3. Repo structure

```
/
├── packages/
│   ├── core/              # framework-free TS — the game
│   │   ├── prng.ts        # seeded PRNG (mulberry32), never Math.random
│   │   ├── engine.ts      # matching engine, eligibility, tie exclusion
│   │   ├── ramp.ts        # rank-distance bands by round, relaxation order
│   │   ├── wheel.ts       # tier-weighted stat selection, correlated-pair exclusion
│   │   ├── sequence.ts    # deterministic round sequence from a seed
│   │   ├── api.ts         # /api/round/next request and response types, shared with the web app
│   │   └── types.ts
│   └── deck/
│       ├── data/          # private submodule, organised by deck type
│       │   └── legends/   # DECK = "legends"
│       │       ├── players.csv     # master copy of the deck, kept by hand
│       │       ├── image-log.csv   # photo provenance, kept by hand
│       │       ├── focus.csv       # crop focus for the few photos that need one
│       │       ├── players/        # one YAML file per player, generated by deck:import
│       │       ├── originals/      # source photos, staged locally, gitignored
│       │       └── images.json     # manifest, written by images:sync, committed
│       ├── sample/
│       │   └── legends/players/    # 24 invented players, used until data/ holds MIN_PRIVATE_DECK
│       ├── schema.ts      # Zod schema
│       ├── import.ts      # deck:import — CSVs → player YAML (import-cli.ts runs it)
│       ├── build.ts       # validation + precompute → artifacts in dist/
│       ├── dist-scan.ts   # the post-build leak scan of apps/web/dist (scan:dist)
│       └── dist/          # generated, gitignored: deck.full.json, images.json, credits.json, …
├── apps/web/              # Astro + Svelte
├── worker/
│   ├── index.ts           # entry: wires the bundled deck into src/app.ts
│   ├── src/
│   │   ├── app.ts         # routing, rate limiting, error mapping
│   │   ├── round.ts       # /api/round/next as a pure function
│   │   ├── payload.ts     # Round → declared response DTOs
│   │   ├── run-id.ts      # signed run ids and replay ids
│   │   ├── challenge.ts   # signed challenge links
│   │   ├── feedback.ts    # /api/feedback as a pure function; feedback-validate.ts parses
│   │   ├── turnstile.ts   # Siteverify
│   │   ├── mail.ts        # the plain-text MIME message for send_email
│   │   ├── analytics.ts   # game events → Analytics Engine data points (§19)
│   │   ├── log.ts         # the structured log() helper for Workers Logs (§19)
│   │   ├── deck.ts        # the only import of packages/deck/dist
│   │   ├── token.ts       # sign / verify progress and result tokens
│   │   ├── run.ts         # /api/run/start and /api/round/guess (Endless)
│   │   ├── run-ledger.ts  # the run's Durable Object's rules
│   │   ├── submit.ts      # /api/run/submit: publishing a run
│   │   ├── scores.ts      # every D1 statement for the boards
│   │   ├── board.ts       # /api/board/endless/:period, through the Cache API
│   │   ├── mine.ts        # /api/board/endless/me: this device's live rank
│   │   ├── cron.ts        # the nightly snapshot and prune
│   │   ├── moderation.ts  # the nickname blocklist check; blocklist-data.ts holds hashes only
│   │   ├── shadow.ts      # the timing heuristics
│   │   ├── stream.ts      # Twitch Mode: a match's start and guess (`stream`)
│   │   └── stream-ledger.ts # a match's Durable Object's rules
│   └── run-do.ts          # Durable Object: wiring over run-ledger.ts, daily-ledger.ts and stream-ledger.ts
├── migrations/            # D1 migrations (wrangler d1 migrations)
├── scripts/
│   ├── stats.ts           # pnpm stats — the saved Analytics Engine queries (§19)
│   ├── db.ts              # pnpm db:* — local migrate, seed and reset; remote migrate; owner tools
│   ├── blocklist.ts       # pnpm blocklist:build — the plain blocklist (gitignored) to hashes
│   └── load-test.ts       # pnpm load:local — Endless under load, against wrangler dev only
├── wrangler.toml
└── docs/
    ├── DESIGN.md
    └── ARCHITECTURE.md
```

`packages/core` must not import anything browser- or Worker-specific. It is pure logic.

**Decks are organised by type.** `DECK` (`"legends"`, in `packages/deck/src/load.ts`) scopes every
deck path — `<data|sample>/<DECK>/{players,originals,images.json}` — and the R2 key prefix for its
photos (§9), so a second deck such as managers can sit alongside with the same shape. Only one deck
exists; nothing yet selects between decks, and `dist/` is not per-deck.

The Worker bundles `deck.full.json` and `images.json` from `packages/deck/dist` at build time. It
never imports `@bt/deck` at runtime — that package reads files with `node:fs` — so `@bt/deck` is for
Worker tests only. ESLint enforces both this and the web app's ban on importing deck data.

---

## 4. The invariants

These four are what make the leaderboard defensible. Everything else is negotiable.

1. **The client never receives a stat value it has not already been shown. No exceptions.**
   **No client-bound deck artifact exists at all.** Every mode, Friendly included, fetches per
   question, so the browser's only source of player data is the round payload.
   This was previously qualified — Friendly shipped full values for a small pool because it ran in
   the browser — and the build needed a guard to stop that hole widening. Moving Friendly behind
   the endpoint removed the hole rather than policing it.
   Two surfaces still carry the risk, checked differently. The **built site bundle** is scanned
   after every build (`pnpm scan:dist`, §6), because nothing type-level connects "what was
   imported" to "what ended up in `dist`". The **round payload** is covered by an explicit response DTO plus a test —
   the compiler does most of the work there, but note that a `Round` carries `anchor` and
   `challenger` as full `Player` objects, so returning one directly leaks everything while
   typechecking cleanly.
2. **No prefetching of hidden values, not even one round ahead.** Buffering rounds for latency
   would mean several readable answers sitting in memory at all times. Prefetch _display_ data
   only — and do prefetch it: images especially must be loaded ahead of the round they appear in
   (section 9).
3. **The round sequence is a pure function of the seed and mode** and does not depend on player
   answers. The mode sets how many early rounds prefer iconic challengers (`ICONIC_ROUNDS`,
   DESIGN.md §10), which band schedule applies (`BAND_SCHEDULES`, §8) and how many rounds a run
   can have (`WIN_ROUNDS`: Friendly's twenty).
   This is what lets the server recompute any round statelessly, and what makes Daily Ranked
   identical for everyone. It holds naturally because the challenger becomes the anchor whether
   the guess was right or wrong, and a wrong guess ends the run.
4. **A progress token can be spent once.** See section 8 — this is the one place per-run state is
   unavoidable.

---

## 5. The deck

One YAML file per player, in the private submodule at `packages/deck/data/legends/players/` (the
per-deck layout is in §3). The files are **generated** by `pnpm deck:import` from `players.csv` and
its two side files (§6), which are the master copy; the YAML is what the build reads:

```yaml
id: zidane-zinedine
name: Zinedine Zidane
country: France
position: MF # GK | DF | MF | FW  — drives the goals-stat exclusion
dob: 1972-06-23
deceased: false
iconic: true # opens runs; early challengers prefer it (DESIGN.md §10)
era: 1990s # optional; decade of peak, 1900s–2020s. Not yet used by any mode
main_clubs: [Bordeaux, Juventus, Real Madrid] # optional; main senior clubs. Not the clubs stat
leagues: [Ligue 1, Serie A, La Liga] # optional; leagues played in. Not yet used by any mode
stats:
  club_goals: 125
  caps: 108
  apps: 506
  igoals: 31
  ct: 9
  it: 2
  clubs: 4
  ig: { value: 41.2, as_of: 2026-09-17 } # snapshot date is shown on the card
  fee: { value: 77.5, year: 2001 } # year is shown on the card
image: # omit entirely if no usable free image exists
  file: zidane-2008.jpg # staged in data/legends/originals/ (gitignored), archived in R2
  author: "Jane Smith"
  licence: CC-BY-4.0 # CC-BY-* | CC-BY-SA-* | CC0 | PD, or a port such as CC-BY-3.0-BR
  source: https://commons.wikimedia.org/wiki/File:...
  focus: 50 15 # optional; crop focus "x y" in percent. Not yet in any round payload
```

**Ten stats. Plain numbers, no per-stat sources** — see `DESIGN.md` §11 for why. Only `ig` and `fee`
are objects, and only because each displays an extra field on the card.

**An omitted stat means ineligible.** Never use `0` or `null` to mean "don't ask about this" — zero
is a legitimate value for international goals, international trophies and club trophies.

`position` is one of `GK | DF | MF | FW`, assigned by majority career position and never inferred at
runtime. It drives one eligibility rule today: **goalkeepers are excluded from `club_goals` and
`igoals`**. Keeping it in a field rather than in logic is what lets rules change without touching
the engine.

`age` is derived from `dob` at runtime and is unavailable when `deceased: true`.

**`era`, `main_clubs` and `leagues` are optional and not yet used by any mode.** They are there
for future themed modes (DESIGN.md §11). `era` must be a decade from `1900s` to `2020s`;
`main_clubs` and `leagues` are non-empty lists of non-blank names with no repeats, compared
ignoring case. The build carries them into `deck.full.json`, and no round payload includes them —
the response-shape test forbids the keys. `main_clubs` (`mainClubs` on the engine's `Player`) is
the player's main clubs, which is not the same thing as `stats.clubs`, the count of every senior
club.

**Images keep full provenance** even though stats do not. A licence is a legal obligation, not a
convenience, so `author`, `licence` and `source` are all required whenever an `image` block is
present.

**`image.focus` is optional** and moves the crop for a photo the default crop cuts badly: `"x y"`,
two whole-number percentages from 0 to 100 separated by one space, as CSS `object-position` reads
them (`50 15` keeps the top of a tall portrait in frame). The build carries it into
`deck.full.json` as `imageFocus` on the engine's `Player`. **No round payload includes it yet** —
M4 adds it together with the card CSS that uses it — and until then the response-shape test forbids
the keys `focus` and `imageFocus`.

**Allowed licences** (`packages/deck/src/licences.ts`): `CC0`, `PD`, `CC-BY-{2.0,2.5,3.0,4.0}`,
`CC-BY-SA-{2.0,2.5,3.0,4.0}`, and **jurisdiction ports** of CC-BY and CC-BY-SA 2.0, 2.5 and 3.0,
written as Commons names them with an upper-case two-letter suffix: `CC-BY-3.0-BR`,
`CC-BY-SA-2.5-ES`. Many good pre-2005 Commons photos carry a port. A port is a different legal
text from the unported licence, so the credits page links to the port itself
(`https://creativecommons.org/licenses/by/3.0/br/`); 4.0 has no ports, so `CC-BY-4.0-XX` is
rejected. The check is on the form of the code, not on a list of jurisdictions, so it doesn't catch
a code for a port that never existed — copy the code from the Commons file page rather than typing
it.

---

## 6. Build pipeline

### Entering players: `pnpm deck:import`

The deck is kept in three CSVs in `packages/deck/data/legends/`, and `pnpm deck:import`
(`packages/deck/src/import.ts`, run by `import-cli.ts`) regenerates `players/<player_id>.yaml`
from them. The column format is in `players-csv-format.md` at the repo root.

| File            | Required | Supplies                                                                   |
| --------------- | -------- | -------------------------------------------------------------------------- |
| `players.csv`   | yes      | one row per player: identity, flags, stats, `era`, `main_clubs`, `leagues` |
| `image-log.csv` | no       | `image: { file, author, licence, source }` for rows with a `file`          |
| `focus.csv`     | no       | `image.focus`, only for players who have an image                          |

- **Validated before anything is written.** Each row is mapped, then checked with the same zod
  schema and `validateDeck` checks as the build. Only players that pass are written, each to a
  temporary file renamed into place, so no partial or invalid YAML is ever left behind. A skipped
  row's existing file is left as it was.
- **Parsing is strict.** CSV is read by a small hand-written RFC 4180 parser (`csv.ts`: quotes,
  BOM, CRLF), with no dependency. Headers must be exactly the known columns — a misspelt header
  would otherwise read as a column of blanks. **Every row must have exactly the header's field
  count**, in all three files; any other count stops the import, naming the file, row and count.
  An unquoted comma in a source URL once split it across columns, cutting off the credit link.
  Numbers must be plain (`1,234`, `€77m` and `506 apps` are refused, naming row, column and
  value). Lists split on `;` and refuse commas.
  Blank means omitted; `0` is kept.
- **Pairs.** `ig_millions` and `ig_as_of` come together or not at all. `fee_eur_m` without
  `fee_year` is a **warning**: the fee is left out, the rest of the player imported, and the report
  lists them under "fee needs a year". `fee_year` without a fee is an error.
- **An id on two rows** of any of the three files skips that player; there is no telling which row
  is right.
- **Deterministic output.** Keys follow the §5 example; lists and `ig`/`fee` are on one line; the
  first line says the file is generated. Unchanged CSVs give byte-identical files, and files that
  would not change are not rewritten. Every file is re-read and compared with the player it came
  from before it is written.
- **The report** always prints: files written (new and changed ids), every skipped row with every
  problem, fee-without-year warnings, and cross-checks — image-log ids with no player, focus ids
  with no image, players with no image, duplicate ids, image-log files missing from `originals/`
  (a warning), and YAML files in `players/` that no row generates. Those are **kept** unless
  `--prune` is passed. `--dry-run` reports without writing. The exit code is non-zero if any row
  was skipped, so a partial import is obvious.

Run `pnpm images:sync` afterwards when photos changed; the build checks the manifest against the
image blocks the import wrote.

### Artifacts

`packages/deck/build.ts` runs before the Astro build and emits:

| Artifact                   | Destination                 | Contents                                                                                                      |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `deck.full.json`           | bundled into Worker         | ids, all stat values, eligibility, the deck version                                                           |
| `dist/images.json`         | bundled into Worker         | id → `{ key, width, height }` for deck players; no source hash                                                |
| `indexes.json`             | Worker                      | per stat: players sorted by value, tie groups                                                                 |
| `credits.json`             | read by `/credits` at build | player name, author, licence, licence URL (absent for PD) and source per image; read with `fs`, never bundled |
| `themes.json`              | read by the pages at build  | "Clear the squad" themes: id, type, name, slug and player count only; read with `fs`, never bundled           |
| `data/legends/images.json` | read, not written           | the manifest: written by `images:sync`, checked here                                                          |
| `viability.md`             | repo, committed             | per stat and gap band, how many valid pairs exist                                                             |
| `simulation.md`            | repo, committed             | per mode: streak distribution, stat firing rates and iconic-preference fallback over 20k runs                 |

**The deck version** (`deckVersion`, in `deck.full.json` as `version`) names the deck's content:
`<deck>-<players>-<hash>`, e.g. `legends-107-e68a4e1b`, the hash being the first 8 hex characters
of the SHA-256 of the players as bundled. Any changed figure, flag or player changes it; rebuilding
an unchanged deck does not. The Worker tags every analytics event with it (§19), so real play can
be split by the deck that dealt it.

**Which deck.** The private deck is used once it holds `MIN_PRIVATE_DECK` (30) schema-valid
players. Below that the build falls back to the public sample of invented players and logs why
(`using sample deck — private deck has 7 of 30 players needed`), printing the private deck's schema
problems as warnings so half-entered data doesn't hide. The image manifest follows whichever deck
was chosen. **`images:sync` ignores the minimum:** it works on the private deck as soon as that has
any player files, since photos are entered alongside the first real players, and falls back to the
sample only when the private deck is empty. **Production builds pass `--require-private`** (`pnpm build:prod`, used by the deploy
script and `deploy.yml`) and fail rather than fall back, so invented players never go live. CI and
local dev keep falling back.

The build **fails** on: a stat value that is negative or non-numeric; a `club_goals` or `igoals`
value on a goalkeeper; an `ig` entry without `as_of`; a `fee` entry without `year`; an unknown stat
key; a duplicate id; a player with fewer than three eligible stats.

It also fails if an `image` block is missing any of `author`, `licence` or `source`, or if the
licence is not on the allow-list. Stats no longer carry provenance, so this is the **only** remaining
provenance guard in the pipeline — which makes it the one that matters. A player with no `image`
block is valid and renders the monogram fallback.

**No client-bound artifact is emitted**, so there is nothing at build time to police. Instead the
built site itself is scanned: **`pnpm build` and `pnpm build:prod` end with `pnpm scan:dist`**
(`packages/deck/src/dist-scan.ts`), so CI and every deploy fail if deck data reaches
`apps/web/dist`. It reads every text file in the output against the deck the build just used and
fails on:

- **any player id**, anywhere — ids exist only in the deck and the round payload, so one in the
  bundle means deck data was imported. This check always sees the raw file.
- **any of a player's stat values within 500 characters of that player's name**, raw (`"caps":105`)
  or as a card shows it (`€72m`, `1,234`). Names legitimately appear — the credits page lists every
  photographed player — so a value only counts next to its own player's name. For this check
  alone, HTML is read as a person would read it: entities decoded, comments, link targets, Astro's
  scoping attributes, inline styles and licence codes (`CC-BY-SA-2.5`) removed, and the credits
  page's attribution line (`data-scan="attribution"`) skipped, because photographers' names can
  hold numbers ("No 10 Downing Street") and `credits.json` holds no stat values.
- **any of `pnpm dev`'s tools** (`devToolsIn`): the dev-only `?mockEnd=won` shim (§14) lives
  behind `import.meta.env.DEV` and must be stripped from production builds entirely, so the word
  `mockEnd` anywhere in the built site fails the scan.

The round payload is checked by the response-shape test with `scanForLeakedValues`, which takes text
rather than an object deliberately — it must not trust any object's shape.

Note that **image URLs are display data, not stat values**, and reach the client freely. The
scanner only looks for numbers.

**Every stat is banded**, rare ones included, and none is barred by round. Rank distance is what
made that possible: `clubs` or `it` spanning a handful of small integers still spreads across the
0–1 scale, so a band means something. Rare stats never _open_ a run (`sequence.ts`), but the wheel
can switch to them from the first switch, at round 3 — never straight after another rare stat
while an alternative exists (`wheel.ts`).

`viability.md` also reports **pairwise correlation between stats**, which is what identifies
candidates for the correlated-pair exclusion in `wheel.ts`. `club_goals`/`igoals` comes from the
report; `caps`/`apps` is kept by design — both measure career length — even though the report
ranks them only moderately together (see `DESIGN.md` §10).

`viability.md` reports per stat **and per band** — not per floor — since a band can be empty even
when a floor is well populated. It counts pairs with the engine's own test, `pairFits` on
`bandFor(stat, round, mode)`, so Instagram's volatility floor is included and the report can't
promise a pair the engine won't deal. It counts the long schedule's bands and then any band only
Friendly uses, and lists where each falls in both schedules; a test holds it to every band of
every mode. Read it after every deck change.

`simulation.md` runs the real engine 20,000 times per mode over the compiled deck, on the same
seeds for every mode, and reports the streak histogram, each stat's share of rounds played against
its `TIER_TARGET`, the opening stat's share, the same mix by round range for Friendly (rounds 1–5,
6–10, 11–20, 21+, with the rare tier's total — overall rates hide how concentrated later rounds
are), how often the early-round iconic preference had to fall back to the whole deck, and for
Friendly its **win rate** — the share of runs reaching twenty — with the streaks bucketed at its
titles. Each mode is simulated to its own cap (`roundCap`: 20 for Friendly, 150 for Endless, 60
for Ranked); a run is dealt 40 rounds first and to its cap only if a model answers all 40
(`PROBE_ROUNDS`), and the engine's reach is measured on the first 200 seeds dealt in full. For
Endless the report adds streak percentiles, reach and accuracy by round range under every model,
its pair rules, and each stat's share of the rounds from 16. This is
how the ramp and tier weights get tuned — not by guessing.
Its streaks come from a **modelled player** whose accuracy rises with rank distance. `fan`, the
default and the model Friendly is tuned with, interpolates a keen fan's accuracy between points
(0.55 at no gap to 0.99 from 0.50); `--model rank` selects the original, weaker curve (0.5 to 0.95),
which Ranked was tuned with (Friendly and Endless are tuned with `fan`); `--calibration <file.json>` replaces the fan's points with
a list of `{ rankDistance, accuracy }`, for when real play supplies one. For Friendly the report
also scores the same runs with every other model, and lists each question's band and accuracy.
Every model is an assumption until then. `--runs <n>` sets the run count. `viability.md` adds the static side: per
stat, how many anchors have any iconic challenger in the opening band.

---

## 7. Sequence derivation

```
seed(ranked,   gameNo) = HMAC-SHA256(RUN_SECRET, "ranked:"   + gameNo)
seed(endless,  runId)  = HMAC-SHA256(RUN_SECRET, "endless:"  + runBody)
seed(endless-instagram, runId)
                       = HMAC-SHA256(RUN_SECRET, "endless:instagram:" + runBody)
seed(squad:<theme id>, runId)
                       = HMAC-SHA256(RUN_SECRET, "squad:<theme id>:" + runBody)
seed(friendly, runId)  = HMAC-SHA256(RUN_SECRET, "friendly:" + runBody)
seed(stream, pool, runId)
                       = HMAC-SHA256(RUN_SECRET, "stream:<pool>:" + runBody)
```

**Endless variants** (DESIGN.md §3, `ENDLESS_VARIANTS` in `@bt/core`) each derive their seed under
their own domain (`seedDomain`): general Endless keeps `"endless:"`, Instagram Endless is
`"endless:instagram:"`, so two variants' runs can never share a sequence. A variant is part of the
sequence's input (`RunOptions.variant`): its pool filters the deck before anything is dealt (rank
distance is then measured within it), a fixed stat replaces the opening draw and the wheel, and its
band schedule and closeness floor replace Endless's. General Endless's settings are the mode's
own, so naming it deals exactly the runs Endless always dealt (a test holds it, and the golden
fingerprint).

**"Clear the squad"** (DESIGN.md §3) is one variant per theme, `squad:<theme id>`
(`squad:club-barcelona`), with the seed domain `"squad:<theme id>:"`. Which themes exist is the
deck's business, so its config is built from the deck (`resolveVariant(id, deck)`; `squadThemes`
in `themes.ts`), and a squad id that names no theme of the deck is refused wherever it arrives.
Its run deals each of the theme's players once (the seen queue is every player dealt, never
dropped), measures distance over the whole deck, ramps by progress through the squad
(`BandRules.questions`: the schedule's rows are fractions of the run), lands the wheel where the
round's band can be met, and deals first any player who would otherwise be stranded. When nobody
left can be dealt the run ends, cleared. It has its own goldens; the other modes' are unchanged.

**Twitch Mode** (DESIGN.md §3, `stream.ts` in @bt/core) deals a match with Endless's engine on its
pool's variant (`endless`, `endless-instagram` or `squad:<theme id>`), under a domain of its own,
`"stream:" + pool + ":"`, so a match can't be learned from an Endless run nor one pool's from
another's. `buildStreamRun` cuts the run at the match's length and passes the match's own band
rules (`RunOptions.bands`, from `streamBands`: a friendly opening of 2 or 3 questions, then
`STREAM_SCHEDULE`, `STREAM_SQUAD_SCHEDULE` or `STREAM_INSTAGRAM_SCHEDULE`, each row a share of the
match's questions; DESIGN.md §8), in place of the pool's schedule and pair rules. Without that
option `buildRun` is unchanged, and the sequence-level `Mode` and every table keyed by it are
untouched, so every other mode's golden fingerprint holds. Matches have their own goldens
(`stream.test.ts` in @bt/core).

Ranked's seed depends only on the game number, so **every player gets the same sequence** — that is what
makes the board comparable. Endless and Friendly are per-run.

**Run ids** are `YYYYMMDD-<uuid>.<sig>`, minted by the server with the UTC date, in Friendly and
Endless alike. **They are signed per mode**: Friendly's signature covers `"run:" + runBody`, as it
always has, and Endless's `"run:endless:" + runBody`, so an id only verifies in the mode it was
minted for and can't be played as the other (a Friendly id from before Endless still verifies).
Each Endless variant signs under its own prefix too — Instagram Endless's is
`"run:endless:instagram:" + runBody`, a squad's `"run:squad:<theme id>:" + runBody` — so a run id
verifies only as the variant it was minted for, and a Barcelona run can't be played as Chelsea's. The body,
`YYYYMMDD-<uuid>` (`runBody` above), names the run; `sig` is the first 16 bytes of
`HMAC-SHA256(RUN_SECRET, "run:" + runBody)` as unpadded base64url (22 characters). The server
answers only run ids it signed: unsigned, tampered and malformed ids are `400`. The signature is
what lets answers be rate-limited per run (§12) — a caller can't mint a fresh id per request — and
what challenge links rely on (below). **The seed derives from the body alone**: the signature is
itself a function of the body and the secret, so it would add nothing, and leaving it out means the
sequence doesn't depend on how the signature is encoded or truncated.

The date fixes the run's reference `now` (00:00 UTC that day), from which age is computed, so no
value moves between rounds of one run. The server refuses a fresh run id dated more than one day
from its own UTC date, so a caller can't choose an arbitrary reference date. The client never sees
or chooses a seed.

**Challenge links, Endless only** (DESIGN.md §13, `CHALLENGES`):
`/football-higher-or-lower/legends/endless?challenge=<runId>&score=<n>&sig=<sig>` — the server
issues the three signed parts with every Endless run's end (§8), for the score that run reached,
and the client builds the URL. `sig` signs the run and the score together — the first 16 bytes of
`HMAC-SHA256(RUN_SECRET, "challenge:endless:" + runBody + ":" + score)`, unpadded base64url — so
neither the run nor the "Beat n" number can be edited. Instagram Endless signs under
`"challenge:endless:instagram:"`, and its links open `/legends/endless/instagram?challenge=…`; a
squad signs under `"challenge:squad:<theme id>:"`, and its links open its theme's page
(`/legends/clubs/barcelona?challenge=…`, "Beat 21/34"). A link checks out only in the variant it
was set in, so one opened on another page starts a plain run with the usual note.

- **A link sets the score to beat, never the sequence.** A start carrying one mints an ordinary
  fresh run — its own run id, its own seed — framed as "Beat n". There are no replay ids in
  Endless; a challenge run is an ordinary run (run kind `challenge` in analytics, §19), and is
  published to the boards like any other (`/api/run/submit`, §8).
- A genuine link is accepted for **10 days** from the run's date (`CHALLENGE_DAYS`), and its score
  is at most Endless's cap, 150. A forged, edited or broken link, or one past its 10 days, starts a
  plain run instead, and the response says why so the page can show a short note.
- **The score was earned**: Endless's spent-once token chain (§8) is what the server signed it
  from, unlike Friendly's stateless answers.

**Friendly's challenge links are retired.** They replayed the challenged run under a replay id,
`YYYYMMDD-<uuid>~<uuid>.<sig>`, and signed `"challenge:" + runBody + ":" + score`. Friendly is
stateless, so answering a late round directly yielded a signed "Beat n" for a score never played.
Now `/api/round/next` refuses a challenge start and a replay id with `400`, as do the leave beacon
and corrections, and a Friendly run's end carries no link. The run id grammar still recognises the
replay form so it can be refused by name; the page shows an old link arriving at
`/friendly?challenge=` as "This challenge link has expired — play Friendly", and never sends it.

**Seeds are 32 bits of PRNG state, on purpose.** `createRng` turns the seed string into the
generator's state through `hashSeed` (FNV-1a, 32-bit), so however strong the HMAC, there are at
most 2³² distinct runs per mode. Someone holding the deck could brute-force the state from a run's
first few observed rounds and predict its upcoming pairings — not its hidden values, which are
public facts anyway, and the photo lookahead already shows the next challenger a round early.
Decided in Phase 5 to keep it: the deck is private, predicting pairings gains little over looking
the figures up, the clock and timing heuristics are what catch a bot, and widening the state
would change every golden fingerprint.

`sequence.ts` takes a seed, a mode and a round number and replays the engine deterministically
from round one. The mode is part of the input because it sets how many early rounds prefer iconic
challengers (`ICONIC_ROUNDS`), the band schedule (`BAND_SCHEDULES`) and the cap on its length
(`roundCap`: Friendly's twenty, `WIN_ROUNDS`, else the mode's `MAX_ROUNDS`, 150 for Endless and
60 for Ranked); the same seed under a different mode is a different run. Twenty rounds is well
under a millisecond and an Endless run's first thirty a few, so the server recomputes rather than
storing.

**Game numbering.** `gameNo = floor((now - EPOCH) / 86400000) + 1`, `EPOCH` being launch day at
00:00 UTC: `DAILY_EPOCH` in `packages/core/src/daily.ts` (`gameNoAt`, `gameStartsAt`,
`nextGameAt`). **Game 1 is launch day and the epoch is never moved** — game numbers become
permanent the moment people start sharing them. Rollover is UTC midnight. While `DAILY_EPOCH` is
`null`, dev and tests run on a fixed dev epoch (`DEV_DAILY_EPOCH`), and the deck build's
`--require-private` path — `pnpm build:prod`, the deploy script, `deploy.yml` — fails, so the site
can't go live without one. Before launch day `gameNo` is below 1: starts are refused
(`409 not_started`), resume and `/me` answer `none`, the board is empty with Game 1's start as its
countdown, and the cron does nothing for Daily.

**Puzzles are labelled "Game 123", never by date** — a date label disagrees with the local calendar
for anyone west of UTC, where rollover lands the previous evening. The UI shows a countdown to the
next game rather than a clock time.

A run belongs to the game it was minted against. A Ranked run started at 23:58 UTC finishes on that
game's board. Its run id is `YYYYMMDD-<uuid>.<sig>` with the game's date, signed under
`"run:ranked:" + runBody`.

**Frozen at midnight** (`worker/src/daily-game.ts`). A game is dealt once and stored in D1
(`daily_games`, §10): seed `HMAC(RUN_SECRET, "ranked:" + gameNo)`, `buildRun` in mode `ranked` with
the game's day as its reference date, the twenty questions and the bonus rounds up to Endless's
cap of 150. Each stored round keeps its stat, band, and both players' display fields and figures,
so a deploy, a deck correction or an image change during the day can't change today's questions,
names or values; the row records the deck version and a hash of the Ranked rules
(`RULES_VERSION`). The 00:00 cron freezes the new game; if that failed, the first start does
(`ensureDailyGame`): `INSERT … ON CONFLICT (game_no) DO NOTHING`, then the row is read back, so two
racing builders end up playing the same stored game. A stored row's day must match its game's date
by the epoch in force — it can only differ if the epoch moved, and is then refused. Every Daily
request plays from the stored game, never a fresh deal. **Only the photo is resolved live**: image
keys are content-hashed (`legends/originals/<id>.<hash16><ext>`), so a re-cropped photo changes its
key; the payload uses the stored key while the current manifest still has it, else the player's
current image by id, else none (the monogram). The stored rounds hold hidden values and never reach
a response: each payload is built field by field (`daily-payload.ts`), and the response-shape test
and the leak scan cover them.

---

## 8. Round protocol

### Correction to an earlier claim

I previously said no Durable Object was needed. That was wrong, and the reason matters. A purely
stateless signed token can be **replayed**: guess "higher", see the reveal, then resubmit the same
round-N token with "lower". Since the response is deterministic, the player always finds the right
answer and always receives a valid round-N+1 token. Signing alone cannot prevent this — the server
has to remember which tokens have been spent. That requires per-run state, and a **Durable
Object** is the right primitive: strongly consistent, placed near the player, and cheap at roughly
twenty messages per run.

_Simpler alternative if you want one less moving part:_ a single D1 row per run with an atomic
compare-and-set (`UPDATE runs SET round = ?2 WHERE id = ?1 AND round = ?3`), checking rows
affected. Correct, but D1 is regional rather than edge-local, so it adds latency the DO does not.

### Progress token

`base64url(JSON payload) + "." + base64url(HMAC-SHA256(RUN_SECRET, "token:" + payloadB64))`
(`worker/src/token.ts`)

```ts
type ProgressPayload = {
  v: 1;
  runId: string; // the signed Endless run id
  mode: "endless"; // Ranked will add gameNo
  variant?: "endless-instagram" | `squad:${string}`; // an Endless variant; absent for general Endless
  // Friendly issues no token — it uses /api/round/next and carries no state.
  round: number;
  streak: number; // round - 1: the answers so far were all right
  anchorId: string;
  challengerId: string;
  stat: StatKey;
  anchorValue: number; // already shown — safe
  issuedAt: number; // the server's clock, ms: the timer's start
  deadline: number; // issuedAt + the animation allowance + the limit + 3 s
  // (a variant with no wheel, Instagram Endless, has no spin in its allowance on any round)
  nonce: string; // spent once, by the run's Durable Object
};
```

The token is signed, **not encrypted** — assume the client reads it. That is fine: it carries only
what is already on screen. The challenger's value is never in it. The HMAC is over the encoded
payload under its own prefix (`"token:"`), so no other use of `RUN_SECRET` makes a valid token;
verification compares in constant time and parses strictly — a missing, extra or mistyped field,
or a `streak` that isn't `round - 1`, is no token. `variant` is written only for a variant other
than general Endless, so general Endless's tokens are byte-for-byte what they were; one naming
anything else is no token, and the guess handler verifies the run id, deals the sequence and works
out the deadline under the token's variant. The fields are copied in a fixed order, so the
same payload always makes the same bytes. The web app keeps the latest token **in memory only**:
a page reload ends the run.

A finished run also gets a **result token**, the same shape under `"result:"`: `{ v, runId, mode,
variant?, score, end, startedOn, elapsedMs, endedAt }`, `elapsedMs` being the sum of the server-measured
answer times. `POST /api/run/submit` takes it to publish the run.

### The run's Durable Object

One per Endless run, named by the run key (`RUNS.idFromName`), class `RunDO` (`worker/run-do.ts`,
wiring only; the rules are `worker/src/run-ledger.ts`, tested in Node and under workerd).
SQLite-backed: a `run` table holding the run's record, and `answers`, one row per accepted answer
with its server-measured time. **Single job: spend each nonce once.**

- `begin` records round one's token when the run starts.
- `advance` spends a nonce and records the answer, its time and what it led to — the next nonce,
  issue time and deadline, or the end — in one call, which the object runs one at a time.
- **A resend of the latest step is answered the same.** If the nonce is the one most recently
  spent, its next token still unused, and the guess is the same, the ledger hands back the stored
  outcome, and the Worker rebuilds the byte-identical response — the same next token, issue time
  and deadline, so a retry after a lost response is safe and buys no clock time.
- **Anything else is `409` and voids the run:** the same token with the other guess, an older
  token once its next has been used, a nonce never issued, another round. A void run takes nothing
  more, not even its genuine next token.
- **A run that is over refuses every answer** (`409 over`), and its streak stands.
- **The alarm.** While a question is open it is set `DISCONNECT_MARGIN_MS` (5 s) past the deadline.
  A connected client always answers, or sends its own timeout, before then — so if nothing came,
  the client went away: the run is closed as `disconnected`, keeping the streak it had verified,
  and its `run_end` and `end` event are written from the object (§19). A late guess after that is
  `409 over`. Once a run is over, the alarm is set `RETAIN_MS` (6 h) after its last activity and
  deletes everything, so runs don't accumulate.
- **Publishing.** `claimForSubmit(claim)` checks a submission against the run in one step: this
  object's own run (only `/api/run/start` creates one, so a run found here was dealt fresh), not
  void, over, the streak and end the token says, not yet published, and ended no more than 30
  minutes ago (`SUBMIT_WINDOW_MS`); it hands back the run and its answer times. A run banked after
  a dropped connection is claimed with its latest progress token: if the alarm hasn't closed it
  yet, the claim closes it as `disconnected` at the streak the token proves — the player gives up
  the open question, and gains nothing. `markSubmitted()` marks it published, once the score is
  stored. Storage outlives the 30 minutes by hours, so `RETAIN_MS` is unchanged.

### Endpoints

**`POST /api/run/start`** (Endless) → `{ mode: "endless", variant?, turnstileToken, challenge? }`
— `variant` is `"endless-instagram"` for Instagram Endless, `"squad:<theme id>"` for a "Clear the
squad" theme, absent for general Endless. A squad id whose theme the deck doesn't have is `400`
("variant names no theme in this deck"), before Turnstile. The run's Durable Object records the
variant, so its alarm can rebuild a silent run's open round. A squad's guess that answers its last
question right ends the run **`won`** (cleared), as does one after which nobody left can be dealt;
a token naming a theme the deck has since lost is `409 token_mismatch`, and a leave or correction
for one is refused.

```jsonc
← { "runId": "20260929-<uuid>.<sig>", "round": RoundPayload, "token": "…",
    "challenge"?: { "accepted": true, "score": 23 } | { "accepted": false, "reason": "invalid" | "expired" } }
```

In order: the flood limit, then `RUN_STARTS`; strict parsing (`challenge` is `{ runId, score, sig }`,
score 0–150); Turnstile Siteverify (`403 verification_failed` on a fail,
`502 unavailable` if it can't be asked); the challenge link checked (it sets the target only);
a fresh Endless run id minted; rounds one and two dealt (two for `upcoming`); the run's Durable
Object told about the first token (`503` if it can't be); the response. A start with
`mode: "ranked"` is Daily Ranked's (below).

**`POST /api/round/next`** — Friendly, Phase 3. Stateless: no storage, no token, no nonce, no
timer. Types live in `packages/core/src/api.ts`, shared by the Worker and the web app.

```jsonc
// start
→ { "mode": "friendly" }
← { "runId": "20260919-<uuid>.<sig>", "round": RoundPayload }      // round 1

// answer
→ { "mode": "friendly", "runId": "…", "round": 7, "guess": "higher" | "lower" }
← { "reveal": { "round": 7, "value": 88, "display": "88m", "qualifier"?: "…", "correct": true },
    "next": RoundPayload }                                          // correct, run continues
← { "reveal": { … }, "end": "wrong" | "deck-exhausted" | "won" }  // run over
```

**No challenge links in Friendly** (§7): a start carrying one (`{ mode, challenge, score, sig }`,
as the old links sent) is `400` "challenge links are off in Friendly", and an answer on a replay id
`400` too.

`RoundPayload` is `{ index, stat: { key, label, tier, statChanged }, anchor, challenger,
upcoming? }`. The anchor carries `id, name, country, position, image?` plus its `value`,
`display` and `qualifier?`; the challenger carries **only** `id, name, country, position, image?`.
The challenger's qualifier (fee year, follower snapshot date) is stat-derived, so it is withheld
with the value and arrives in `reveal`. `display` is always `STATS[key].format(value)`. `image` is
`{ key, width, height, focus? }`: the manifest entry plus the deck's optional crop focus (`"x y"`
percentages), present only alongside a photo. `upcoming` is the `image` of the challenger in the
round after this one — nothing else about that player — so its photo loads a round early (§9). It
is absent on the last round the run can deal and when that player has no photo.

Each request derives the seed from `runId` (§7), replays the run in mode `friendly` to one round
past the one answered,
and **decides correctness server-side**. **Friendly is a 20-question challenge** (`WIN_ROUNDS`):
a correct answer to round 20 ends the run with `won`, and no round past 20 is ever dealt, so round
20 carries no `upcoming`. A run that can deal no next round before then ends with
`deck-exhausted`; a wrong answer, at any round, with `wrong`. (Endless and Ranked have no win
target; they cap at their `MAX_ROUNDS`, 150 and 60.) Every response is an explicitly declared DTO built field by field
in `worker/src/payload.ts`; a `Round` is never returned. Requests are validated strictly — unknown
mode, extra keys, a malformed, unsigned, tampered or out-of-range `runId`, a `round` that isn't an
integer in 1–20, or a bad guess are all `400` — and every `/api/*` response is `cache-control: no-store`.

Because it is stateless, anyone can mint run ids or ask any round of a run. Each request still
reveals at most one hidden value, so the **rate limit** does the real work (DESIGN.md §3): it is the
only thing between the deck and a determined scraper, so it is load-bearing rather than hygiene.
Numbers in §12.

**Phase 5 shares this endpoint's payloads** rather than replacing them: Endless has its own two
endpoints, `/api/run/start` and `/api/round/guess`, which add the progress token (signed, spent once
via the Durable Object), the server-owned clock and Turnstile around the same round, reveal and end
shapes. Friendly keeps `/api/round/next`, unchanged.

**`POST /api/round/guess`** (Endless) → `{ token, guess: "higher" | "lower" | "timeout", clientElapsedMs? }`

```jsonc
← { "reveal": Reveal, "next": RoundPayload, "token": "…" }               // right: the next question
← { "reveal": Reveal, "end": "wrong" | "timeout" | "deck-exhausted",
    "challenge": { "runId": "…", "score": 6, "sig": "…" }, "result": "…" }  // over
← 409 { "error": "conflict", "detail": "spent" | "out_of_order" | "over" | "void" | … }
```

1. The flood limit; strict parsing.
2. Verify the token's HMAC (`400` if it fails: forged, edited, another key) and its run id's
   Endless signature.
3. `RUN_ANSWERS`, keyed on the run key.
4. Note the **server's** time of receipt. The server owns the clock; `clientElapsedMs` is checked for
   type and dropped — a client-reported time would make the grace whatever a cheater claims.
5. Recompute the sequence to this round from the seed and check the token names exactly the round
   dealt — stat, anchor, challenger, anchor's figure (`409 token_mismatch` if not: the deck changed).
6. Judge: `guess: "timeout"`, or any answer received after the token's `deadline`, ends the run as
   `timeout`; a wrong pick as `wrong`; no next round as `deck-exhausted`; otherwise a next token is
   made, issued now.
7. The Durable Object spends the nonce (`409` as above), or answers a resend of the latest step
   with its stored outcome.
8. The reveal — the challenger's figure, even on a timeout — and the next round's display payload
   and token **in the same response**; or the end, with the challenge link for the score reached
   and the signed result. Recorded once, never for a resend (§19).

**The deadline** (`deadlineFor` in `packages/core/src/clock.ts`): the question's limit (15 s for
question one, 10 s after, `QUESTION_LIMITS`) starts when the question becomes answerable, so the
server adds the most animation an honest client plays first, from the same timing constants the
web app uses (`ANSWER_TIMINGS`, which the tokens.css test holds to the CSS), and a **3 s network
grace**:

| Token for      | Allowance before answerable                                                 | Deadline after issue    |
| -------------- | --------------------------------------------------------------------------- | ----------------------- |
| question 1     | title 1.8 s + hold 1 s (+3 s for photos) + intro 1 s + beat and spin 2.54 s | 9.34 + 15 + 3 = 27.34 s |
| a stat change  | reveal to verdict 2.54 s + next 1.4 s + beat and spin 2.54 s                | 6.48 + 10 + 3 = 19.48 s |
| the stat holds | reveal to verdict 2.54 s + next 1.4 s + hold 0.34 s                         | 4.28 + 10 + 3 = 17.28 s |

A later token's allowance assumes the worst case, a response that lands the instant the guess
goes. The client counts down only from when the question is answerable and sends `timeout` at
zero, so an honest player never meets the server's deadline except on a connection slower than the
grace. Skipping the title card gains a player nothing: their own clock still runs out first.

**`POST /api/run/submit`** (Endless) → `{ token, nickname, deviceId, turnstileToken, showCountry }`
(`worker/src/submit.ts`). Publishing is **opt-in**: the page sends nothing here unless the player
presses Publish.

```jsonc
← { "id": "<uuid>", "nickname": "SwiftVolley42", "streak": 23,
    "periods": { "day":   { "key": "2026-09-29", "current": true, "rank": 412, "total": 3208,
                            "resetsAt": 1790726400000, "entryId": "<uuid>", "best": 23,
                            "improved": true },
                 "week":  { "key": "2026-W40", … }, "month": { "key": "2026-09", … } } }
← 400 { "error": "bad_request", "detail": "zero" | "nickname_short" | … }
← 403 { "error": "verification_failed" }
← 409 { "error": "conflict", "detail": "unknown" | "void" | "not_ended" | "mismatch" | "submitted" | "expired" }
← 422 { "error": "nickname_rejected" }   // "try another name", whatever the reason
← 429 { "error": "rate_limited" }         // with retry-after
← 503 { "error": "unavailable", "detail": "scores" }
```

1. The flood limit, then `RUN_SUBMITS` (per IP), before any other work.
2. Strict parsing: exactly those four keys; `deviceId` a v4 uuid; the nickname's form
   (`checkNickname`, @bt/core): 3–20 characters, Latin letters, digits, space, `_ - .`. A name in
   another script is a `422`, like a blocked one.
3. **The token**: the run's signed result, or, for a run banked after a dropped connection, its
   latest progress token. The run id in it must be an Endless one this server signed, never a
   retired replay id (`400`); a variant without boards (Instagram Endless, every squad) is `400 no_boards`,
   recorded as a refused `submit` and refused before its Durable Object, Turnstile or D1 are
   touched; the streak it proves must be above 0 (`400 zero`).
4. **The run's Durable Object agrees** (`claimForSubmit`, above): only `/api/run/start` creates
   one, so a run it holds was dealt fresh from a random seed — challenge runs included, since a
   link only sets the score to beat. A run the server never dealt, however well signed, is
   `409 unknown`, so no sequence a player could have learned in advance reaches a board.
5. Turnstile Siteverify.
6. **Moderation** (§12): `422 nickname_rejected`.
7. **The timing heuristics** (§12): a flagged score is stored, shadowed.
8. **The insert.** `run_id` is unique: a second publish of one run is `409 submitted` even if the
   object was never told. A D1 failure is a calm `503`, logged as an `error`. Then the object
   marks the run published.
9. **The ranks**, as the player sees them: the device's best in each of the run's periods, ranked
   among every other device's public best, out of those and itself (`ownStanding`, §10). A
   shadowed player sees an ordinary rank. The periods are the run's own — the UTC date its run id
   carries — so a run started at 23:58 counts on that day's boards; `current` is false once that
   period has reset, and the page says "yesterday" instead of "today". Each period also says
   whether this run is now the device's entry (`improved`) and what that entry's streak is
   (`best`, the device's own rows counted even if shadowed). A run that doesn't beat the device's
   best is still stored and answered `200`: the page offers Publish only for a run that beats the
   day's best it knows of (`bt:published`), but storage can be cleared and another tab can
   publish, so the server's answer is the one the dialog words, and the page keeps it either way.

The device id is a random id the browser keeps (`bt:device`). Only `HMAC(RUN_SECRET, "device:" +
id)` is stored, never the id; it is friction, not identity — clearing storage makes a new one.
Nothing about the request is logged but the run key, the score, the ranks and whether it was
shadowed; never the nickname or the device.

**`POST /api/feedback`** — the three feedback forms, Phase 3. Types in `packages/core/src/api.ts`,
handler in `worker/src/feedback.ts`. Stateless: it sends a plain-text email and logs one line with
what was sent (§19), and stores nothing else.

```jsonc
→ { "kind": "suggest", "name": "…", "note"?: "…", "turnstileToken": "…" }
→ { "kind": "correction", "mode"?: "endless", "variant"?: "endless-instagram", "runId": "…", "round": 7, "note"?: "…", "turnstileToken": "…" }
→ { "kind": "problem", "note": "…", "page": "/about", "turnstileToken": "…" }
← 200 { "ok": true }
← 400 { "error": "bad_request", "detail": "<short code>" }   // e.g. unexpected_key, invalid_run
← 403 { "error": "verification_failed" }                     // Turnstile said no
← 429 { "error": "rate_limited" }                            // with retry-after
← 502 { "error": "send_failed" | "unavailable" }            // the email, or Siteverify
```

- **Strict.** Known kinds only, strings where text belongs, no extra keys, a size cap on the body,
  `name` up to 80 characters and `note` up to 1,000 (`FEEDBACK_LIMITS`, counted in code points);
  a problem's `note` is required and its `page` must be one of the site's own paths
  (`SITE_PAGES`, which a test holds to the pages Astro builds).
  Text is trimmed and stripped of control characters; a note keeps its line breaks. Anything else is
  `400` with a short code.
- **A correction carries the run id and round index only.** The Worker verifies the run id's
  signature (and that the run is still answerable, §7), rebuilds that round from the seed, and
  writes the two players, the stat and both values into the email itself. A value from the client
  is an unexpected key. The response is `{ "ok": true }` whatever the round held, so nothing reaches
  the client that it hasn't been shown (§4).
- **A problem report** is anything that isn't a card: a bug, a typo. It carries the page it was
  sent from and nothing else about the sender.
- **Turnstile** is checked server-side with Siteverify before anything is sent. The widget's script
  loads only when a form opens.
- **Email** goes through the `send_email` binding (Email Routing) as a hand-built `text/plain`
  UTF-8 message (`mail.ts`). The subject is fixed per kind (three subjects); user text appears in the
  base64-encoded body and the `feedback` log line, never in a header or a response. The
  destination is the `FEEDBACK_TO` secret and is not in the repo. A failed send is a calm `502`.
- **Privacy.** No email field and no other personal details. The IP is used for rate limiting and
  nothing else: it is not sent to Siteverify, written into the email or logged. Once a message is
  accepted (valid, and Turnstile passed) what was sent is logged, whether or not the email then
  goes: the name and note, the note and page, or the note and the round as the form showed it
  (§19). That text is kept in Workers Logs for 3 days, with the country and nothing else about
  the sender.

Corrections land in the deck repo and take effect at the next update (for Ranked, the next rollover),
never mid-game.

**`POST /api/run/leave`** — a beacon from the game page when it is hidden or closed mid-run
(`navigator.sendBeacon`, `game/leave.ts`). Telemetry only: handler in `worker/src/leave.ts`.

```jsonc
→ { "mode": "friendly" | "endless", "variant"?: "endless-instagram", "runId": "…", "round": 7, "phase": "question", "trigger": "hidden" }
← 204 (no body)
← 400 { "error": "bad_request", "detail": "…" }
```

- **Strict.** Exactly those five keys and a body of at most 512 bytes; `round` 0 to the mode's cap
  (20 Friendly, 150 Endless), with 0 (and only 0) for `phase: "intro"`; `phase` one of `intro`, `question`, `reveal`, `other`;
  `trigger` `hidden` or `pagehide`. The run id must be one the server signed and still
  answers (§7), and a round above 0 one the run has.
- **Changes nothing.** Friendly keeps no state, an Endless run's Durable Object is never touched,
  and the handler only records: a `run_leave` log
  line and a `leave` data point (§19), with the round rebuilt from the seed and only the figures
  the player had been shown. Behind the flood limit (§12) like every round request.
- **Once per trigger per run**, only while a run is in progress (after Start, before it ends).

**`GET /api/board/endless/:period`** — `day`, `week` or `month`, the current period only
(`worker/src/board.ts`); anything else under the path is a `404`. Behind the flood limit. Served
through the Cache API (§11), a minute stale at most.

```jsonc
← { "mode": "endless", "period": "day", "key": "2026-09-29", "resetsAt": 1790726400000,
    "total": 3208,
    "entries": [ { "id": "<uuid>", "rank": 1, "nickname": "SwiftVolley42", "streak": 41,
                   "tied": false, "thinkMs": null, "country": "GB" },
                 { "id": "<uuid>", "rank": 2, "nickname": null, "streak": 39,
                   "tied": true, "thinkMs": 102345, "country": null }, … ],   // top 50
    "previous": { "key": "2026-09-28",
                  "winner": { "nickname": "…", "streak": 44, "country": "BR" } | null } }
```

A retired name is `null` ("Retired name" on the page): the name never leaves the database; it
keeps its flag. `tied` is true when another device's public best in the period — anywhere in it,
not just the 50 returned — has the same streak; only then is `thinkMs`, the tiebreak, given.
`country` is a flag's two-letter code or `null`, never anything finer. No device hash or shadow
flag is in it. `previous` is the period before's winner, from
its midnight snapshot (§13), or from the scores until the snapshot exists; a name retired since the
snapshot shows as retired. `cache-control: public, max-age=60`.

**`POST /api/board/endless/me`** → `{ deviceId }` (`worker/src/mine.ts`): where this device stands
**now** in each current period. The rank a publish came back with goes out of date as soon as
anyone else publishes, so the board page asks here once as it loads — only when the device has
published to a current period. Never cached (it's per player: `no-store`). Behind the flood limit,
then `BOARD_LOOKUPS` per IP.

```jsonc
← { "periods": { "day":   { "key": "2026-10-05", "entryId": "<uuid>", "rank": 151, "total": 193,
                            "streak": 4, "nickname": "LowScore", "tied": true,
                            "thinkMs": 61234, "country": "GB" },
                 "week":  { … } | null, "month": { … } | null } }
← 400 { "error": "bad_request" }   // anything but { deviceId: <v4 uuid> }
← 429 { "error": "rate_limited" }  // with retry-after
← 503 { "error": "unavailable", "detail": "scores" }
```

Each entry is the owner's view (`ownStanding`, §10), as at submit: the device's best in the period,
shadowed runs included, ranked among everyone else's public bests, so a shadowed player sees an
ordinary rank. `null` for a period the device has nothing in; a retired name is `null`. `tied`,
`thinkMs` and `country` follow the board's rules. The device id is hashed exactly as at submit,
used for the query and never stored or logged.

### Daily Ranked

The same machinery as Endless — signed per-question tokens, the run's Durable Object spending each
nonce once, the server's clock — around the stored game (§7) and its rules (DESIGN.md §3). Handlers
are pure functions in `worker/src/daily.ts`, the run's state is `daily-ledger.ts`, posting is
`daily-post.ts` and the board's SQL `daily-scores.ts`.

- **Its token** is the progress token's shape under its own prefix, `"daily:"`
  (`signDailyToken`): `{ v, runId, mode: "ranked", gameNo, round, correct, anchorId, challengerId,
stat, anchorValue, issuedAt, deadline, nonce }`, with `correct` in place of `streak` (a wrong
  answer doesn't end the run). Strict parse; Endless's tokens are unchanged. `POST
/api/round/guess` routes on the prefix.
- **Its Durable Object** is the same `RunDO` class, named by the run key, with tables of its own
  (`daily_run`, `daily_answers`), so no new Durable Object migration. It keeps the device hash,
  the round, the nonce, the deadline, the right/wrong marks, and each answer's time and the
  allowance it was measured against. The resend rule is Endless's. **A refused answer doesn't void
  a Daily run** (`409`, the first answer stands): voiding the day's only attempt would be harsh, and
  a replay still gains nothing; the page recovers through resume.
- **The rules**: questions 1–19 always carry on; question 20 carries on only after twenty right;
  in the bonus the first miss ends the run (`finished`, `wrong` or `timeout`); the cap ends it
  `deck-exhausted`.
- **The idle alarm.** While a run is in play the alarm is set `IDLE_FINISH_MS` (5 minutes) past
  its last activity. If nothing came, the run is finished `abandoned`: the open question and every
  unanswered question of the twenty count as wrong. Then it is posted to D1 from the object; a
  failed post is retried by the alarm a minute later, and posting is idempotent. Once posted, the
  record is deleted six hours later.
- **Thinking time** (`dailyThinkMs`): as Endless's (§10), each answer from question 2 less its
  allowance, clamped to 0 – its limit; but a **timeout counts its full limit** (question 1's
  included), and in an abandoned run so does every question never answered. So running the clock
  down or leaving can never improve a time.

**`POST /api/run/start`** with `{ mode: "ranked", nickname, showCountry, deviceId, turnstileToken }`
→ `{ runId, gameNo, round, token, country, nickname }`. In order: the flood limit and
`RUN_STARTS`; strict parsing; the game in play by the server's clock (`409 not_started` before
Game 1); the name's form (`400`) and the blocklist (`422 nickname_rejected`); Turnstile; the stored
game; then one **atomic D1 batch** inserting the device's `ranked_attempts` row and the
`daily_entries` row that reserves the name. If either unique constraint fails the batch rolls back,
so nothing is used, and a follow-up read says which: `409 already_played` or `409 name_taken` (as
the detail). Only then the run's Durable Object (if it can't be told, the entry and attempt are
released) and the response. The connection count (§12) is written last.

**`POST /api/run/resume`** `{ deviceId, runId? }` → `{ state: "none" }` | `{ state: "playing",
runId, gameNo, round, token, remainingMs, results, nickname, country }` | `{ state: "finished",
result }`. The server finds the device's unfinished entry for today's game or yesterday's (a run
started at 23:58) in `daily_entries`; the run id the page kept is only a hint, so a lost key still
resumes. The Durable Object checks the device hash again (another device's run is `409`). The open
question comes back under a fresh nonce with its **original deadline** (`remainingMs` is what is
left); if that has passed it is recorded as a timeout and the next question is dealt fresh, with
the resume allowance (`resumeAllowance` in @bt/core) in place of the animation. Limited per run by
`RUN_ANSWERS`.

**`GET /api/board/daily`** → `{ mode: "ranked", gameNo, nextGameAt, total, entries, previous }`:
today's game, its top 50 (score, then thinking time, then finish; shadowed entries left out; a
time only on a tied score), and the previous game's winner from its snapshot. Cached (§11).
**`POST /api/board/daily/me`** `{ deviceId }` → this device's entry for today: `none`, `playing`
(with the name), or `finished` with the result and its own row as its owner sees it (shadowed
entries still visible to their owner). `no-store`, behind `BOARD_LOOKUPS`.

`/api/run/leave` and the correction form accept `mode: "ranked"`, rebuilding the round from the
stored game. `/api/run/submit` refuses a Daily token: Daily scores post themselves.

### Twitch Mode

A match (`stream`, DESIGN.md §3) runs on the same machinery as Endless: a signed token per
question, its nonce spent once by the run's Durable Object, the server's own clock and deadline,
and Turnstile at the start. Handlers are pure functions in `worker/src/stream.ts`, the match's
state is `stream-ledger.ts`.

- **Its deal** is Endless's engine on the pool's variant (`buildStreamRun`, `stream.ts` in
  @bt/core), cut at the match's length, under the seed `HMAC(RUN_SECRET, "stream:<pool>:" +
runBody)` (§7), by the match's own bands (`streamBands`), which ramp over its questions.
- **Its run id** signs under `"run:stream:<pool>:"`, so it verifies only as a match on its own
  pool, never as any other mode's run.
- **Its token** is the progress token's shape under its own prefix, `"stream-token:"`
  (`signStreamToken`; deliberately not `"stream:"`, the seed domain): `{ v, runId, mode: "stream",
pool, questions, limit, round, correct, anchorId, challengerId, stat, anchorValue, issuedAt,
deadline, nonce }`, with `correct` (the streamer's right answers so far) in place of `streak`.
  Strict parse: `limit` one of `STREAM_LIMITS`, `questions` at most 20, `correct < round`, no
  stray key. `POST /api/round/guess` routes on the prefix, as it does for Daily's.
- **Its ledger** spends each nonce once and answers a resend of the latest step from what it kept,
  as Endless's does, and records `results[]` (right or wrong per question) as Daily's does. Every
  answer leads to the next question until the match's length (`finished`), or the end of what the
  pool can deal (`deck-exhausted`). **A refused answer never voids a match**: the same token with
  the other guess, an older token or one never issued is `409` and changes nothing; the first
  answer stands and the genuine next token plays on. Its alarm is Endless's: a match silent past
  `deadline + DISCONNECT_MARGIN_MS` is closed as `disconnected` (a refresh ends a match), and its
  storage goes `RETAIN_MS` after its last activity. It lives in the same `RunDO` class under a
  table of its own (`stream_run`, one row, the whole record), created `IF NOT EXISTS`, so no
  Durable Object migration.
- **Telemetry from chat.** Each guess may carry `chat: { pick, voters }` (`ChatPick`: `higher`,
  `lower`, `split` or `none`; `voters` an integer, `none` exactly when it's 0). The server judges
  the pick against the round itself and keeps chat's score and the peak voters on one question,
  for the data points and the `run_end` line only. It never changes the match, and nothing else
  from chat (no message, name or id) is ever sent.

**`POST /api/run/start`** with `{ mode: "stream", pool, questions, limit, turnstileToken }` →
`{ runId, round, token, questions, limit }`. In order: the flood limit and `RUN_STARTS`; strict
parsing (`pool` an Endless variant id, never Daily; `questions` 10 or 20; `limit` 10, 20, 30 or
60: anything else is `400`); a squad the deck doesn't have is `400`, before Turnstile; the length
capped at the squad's size less one and echoed back; Turnstile; a fresh match id; rounds one and
two dealt; the Durable Object told (`streamBegin`); the response. The deadline on every question is
`deadlineWithLimit(issuedAt, round, statChanged, limit × 1000, wheel)`: the usual animation
allowance (§8 above, no spin for Instagram), the chosen limit, and the 3 s grace.

**`POST /api/round/guess`** with a match's token → `{ token, guess, clientElapsedMs?, chat? }`:
the answers limit on the match key; the round recomputed and the token held to it (`409
token_mismatch`); a timeout or anything past the deadline is wrong; then `{ reveal, next, token }`,
or at the end `{ reveal, end: "finished" | "deck-exhausted", score }`. No challenge link and no
result token. `/api/run/submit` refuses a match's token with `400 no_boards` (recorded as a refused
`submit`) before its Durable Object, Turnstile or D1 are touched. The page sends no leave beacon
for a match (it is often hidden while streamed) and offers no correction form.

### Disconnection

Offline continuation is impossible by construction: the client does not hold the next value and
nothing can supply it while the network is down. So the behaviour is **retry visibly, then bank
and end**. Every round up to the drop is already verified by the token chain, so the player keeps
the streak they earned: the page shows "Connection lost — your streak of n is saved" and keeps the
latest token in memory, so the run can still be published (`publishToken()`). On the server the run's Durable
Object closes it as `disconnected` a few seconds past the deadline, with the same streak. A `409`
(a spent or out-of-order token) banks the run the same way. There is no "unranked offline mode" —
there is nothing to play offline with.

---

## 9. Latency budget

Ranked and Endless make **one round trip per question** — not several. The guess response carries
both the answer and the next round's display payload, so there is no separate "fetch next card"
call. There is exactly one moment per question that depends on the network.

### The budget

| Leg                              | Broadband    | Good 4G       | Poor mobile    |
| -------------------------------- | ------------ | ------------- | -------------- |
| Client → PoP → client            | 15–40ms      | 40–90ms       | 150–400ms      |
| Worker → Durable Object → Worker | 2–15ms       | same          | same           |
| Sequence recompute + nonce spend | 5–15ms       | same          | same           |
| **Total**                        | **~25–70ms** | **~50–120ms** | **~160–430ms** |

Indicative, not guaranteed. The DO hop is cheap because objects are placed near the requesting PoP
on creation and hold state in memory — the nonce spend is a small write to an already-warm object,
not a database query.

### What masks it

**The reveal count-up (~2500ms, `--dur-count`) runs on every question**, not only on stat changes — there is a
number to reveal every round. That is the masking budget.

Sequence after a tap:

```
0ms      guess sent; challenger's number shows 0 from local state
25–430ms response lands (see table)
2500ms   count-up settles on the true value
~2540ms  correct/incorrect colour
~3940ms  next pair deals
```

On anything but a genuinely bad connection the response arrives well before the animation would
have finished, so perceived latency is zero.

**If the response has not arrived by 2500ms, hold at zero — never snap.** The number stays at 0
until the answer lands, then counts up for at least `--dur-settle`. It degrades as "the reveal took
a beat". A number that moved before the answer existed read as the answer flashing up, so it
waits; the connection note under the challenger says when something is actually wrong.

The 1.8s wheel spin on stat-change rounds is additional cover, not load-bearing. Do not design
anything to depend on it, since it only fires on a switch.

### Image pipeline

**Originals only, resized at the edge.** Nothing is resized at build or sync time.

```
data/legends/originals/zidane-zinedine.jpg      local staging, gitignored
        │
        │  pnpm images:sync   (occasional — needs R2 credentials)
        ▼
  validate → hash → upload original → write data/legends/images.json (committed)
        │
        ▼
R2  legends/originals/zidane-zinedine.a3f9c21e0b1d4e7f.jpg    immutable, year-long cache
        │
        │  served via custom domain img.biggerthangame.com
        ▼
img.biggerthangame.com/cdn-cgi/image/width=800,quality=80,fit=scale-down,
                       format=auto,onerror=redirect/legends/originals/zidane-….jpg
```

- **R2 is the archive.** Originals never enter git; they stage locally, go to R2 at full resolution,
  and the staging folder can be cleared.
- **Keys are content-hashed and deck-scoped** (`<DECK>/originals/<id>.<sha256[0:16]><ext>`, e.g.
  `legends/originals/…`). A replaced photo gets a new key, so immutable cache headers are safe and
  there is never a stale object to purge. The deck prefix means the same person in two decks — a
  legend who also appears as a manager — can't collide.
- **`images.json` is committed in the deck submodule**, one per deck (`data/legends/images.json`),
  and maps id → key, width, height and source
  hash. It stores keys, never URLs — the domain comes from config. It exists so `pnpm build` stays
  offline: the build checks that deck and manifest agree and never touches the network.
- **Image Transformations** (enabled on the `biggerthangame.com` zone, sources restricted to the
  photo path on this zone) resize and convert on first request and cache the result at the edge.
  `format=auto` serves AVIF or WebP by `Accept` header and counts as **one** transformation.
  `fit=scale-down` never enlarges. `onerror=redirect` falls back to the original rather than a
  broken image.
- **Two widths only: 800 and 1600.** Every distinct URL is a separate transformation against the
  free allowance of 5,000 a month; 300 players × 2 widths is 600. Widths are fixed constants
  (`DISPLAY_WIDTHS`), **never computed per device**. Past the allowance, new transformations fail
  and `onerror=redirect` serves the original — slower, never broken, never billed on the free plan.
- **`srcset` across both widths**, built by `srcsetFor(base, key)`, with `width`/`height` from the
  manifest so the card reserves its box and does not jump.
- **`img.` is protected by Cloudflare rules** that the owner configures in the dashboard. They
  depend on the exact image URL format, and they are deliberately not described here.

The image URL format (DISPLAY_WIDTHS, the transform options and their order) must not change
without the owner updating the Cloudflare configuration first.

Sync validates every source before uploading anything: exists, readable, shortest edge ≥ 800px
(`MIN_IMAGE_EDGE`), aspect ≤ 3:1, no two players sharing a file. It is idempotent — unchanged hashes
are skipped.

**Two size thresholds, both on the shortest edge**, so a wide landscape can't pass on its width:

- **Minimum, 800px (`MIN_IMAGE_EDGE`) — hard.** Below it, sync fails. It sits at the smaller display
  width on purpose: many of the best freely licensed photos of pre-2005 players are small, and
  rejecting them would push those legends onto the monogram. An 800px source exactly covers the
  800w rendition, so nothing is ever upscaled; the 1600w rendition uses `fit=scale-down`, which
  never enlarges, so a smaller original is served at its own size — soft on 3× phones and retina
  screens, acceptable for a darkened, desaturated background layer. A test keeps the minimum at or
  above the smallest display width.
- **Recommended, 1200px (`RECOMMENDED_IMAGE_EDGE`) — soft.** Images from 800 up to 1199px pass, but
  sync lists every one of them as a warning — "usable, upgrade if a larger free image exists" — on
  every run, synced this time or not, so the list doubles as a to-do. **Warnings never fail the
  sync.**

### Image prefetch — requirement, not optimisation

**Player images must never be fetched at reveal time.** That would put a second round trip inside
the same 2500ms window and is the one thing that would actually make the game feel slow.

Images are _display_ data, and the next round's display payload arrives with the current answer.
So:

1. **The moment a round response lands, preload the one new card's image** — the next challenger.
   Each response introduces exactly one new player: the next round's anchor is the challenger just
   revealed, already on screen with its image loaded. Preload the same URL the `srcset` will pick
   (same `srcset` and `sizes`), or the browser fetches twice. The player spends several seconds
   thinking while the fetch completes, and the image is in cache before it is needed.
   **The round payload also carries the upcoming challenger's image** (`upcoming`), so that photo
   starts loading a round early, as soon as the current round is on screen — a whole round's head
   start on a cold resize. It is the image only, never a value: the sequence doesn't depend on
   answers, so the server knows who is next without revealing anything the player hasn't been
   shown. The per-answer preload stays as a backstop.
2. **Serve R2 through a custom domain**, never `r2.dev` — it is rate-limited and unsupported for
   production, and Transformations need a hostname on the zone.
3. **Resized at the edge, not HD originals.** An 800w AVIF of a portrait is typically well under
   100KB.
4. **Immutable cache headers with hashed keys.** A returning player accumulates most of the deck
   locally over a few sessions.

### Degradation

- The **3s timer grace** (section 8) absorbs slow rounds so a laggy connection does not cost the
  player their run.
- **Bank and end** covers a genuine drop. The client retries a failed request visibly —
  "Connection lost. Trying again…" under the challenger, with the number still at 0 — after
  0.5s, 1s, then every 2s, and banks the streak once the connection has been gone for 5s
  (`RECONNECT` in `apps/web/src/game/machine.ts`). A request unanswered for 8s counts as dropped.
  A refusal retrying can't fix (a `4xx` other than `429`) banks at once.
- **A `429` never ends a run.** The client shows a calm "slow down" note, rests the number at "?",
  waits out `retry-after` and sends the same request again; the count-up then plays in full from
  the retry. A `429` on a run start waits the same way on the start panel.
- There is **no offline mode**. Friendly gave that up when it moved behind the endpoint, which was
  the price of not shipping the deck to every browser.

Honest summary: Ranked and Endless need a working connection at roughly 50–150ms typical, and the
animation hides it. They will feel sluggish on genuinely poor mobile, which is what the grace window
and banking exist for.

---

## 10. D1 schema

In `migrations/` (wrangler's D1 migrations; `0001_scores.sql` is the first). Applied locally by
`pnpm db:migrate:local`, which `pnpm dev` runs first, and to production only by the owner, with
`pnpm db:migrate:remote`. Never edit an applied migration; add the next.

```sql
CREATE TABLE scores (
  id                  TEXT PRIMARY KEY,               -- uuid
  mode                TEXT NOT NULL CHECK (mode IN ('endless', 'ranked')),
  day_key             INTEGER NOT NULL,               -- YYYYMMDD (UTC) the run started
  game_no             INTEGER,                        -- Daily Ranked's game; NULL in Endless
  nickname            TEXT NOT NULL,
  nickname_normalised TEXT NOT NULL,                  -- the moderation skeleton
  streak              INTEGER NOT NULL CHECK (streak > 0),
  think_ms            INTEGER NOT NULL,               -- thinking time; the tiebreak
  country             TEXT,                           -- a flag's 2-letter code, or NULL
  device_hash         TEXT NOT NULL,
  run_id              TEXT NOT NULL UNIQUE,           -- the run key: a run publishes once
  created_at          INTEGER NOT NULL,
  name_flagged        INTEGER NOT NULL DEFAULT 0,     -- "Retired name", score kept
  shadow              INTEGER NOT NULL DEFAULT 0,     -- hidden from all but its owner
  shadow_reason       TEXT                            -- the heuristics that fired
);
CREATE INDEX idx_scores_board  ON scores (mode, day_key, streak DESC, think_ms, created_at);
CREATE INDEX idx_scores_device ON scores (mode, device_hash, day_key);
CREATE INDEX idx_scores_day    ON scores (day_key);
CREATE UNIQUE INDEX idx_ranked_name ON scores (game_no, nickname_normalised) WHERE mode = 'ranked';

CREATE TABLE ranked_attempts (device_hash TEXT NOT NULL, game_no INTEGER NOT NULL,
  PRIMARY KEY (device_hash, game_no));

CREATE TABLE board_snapshots (
  mode TEXT NOT NULL, period TEXT NOT NULL, period_key TEXT NOT NULL,  -- day | week | month
  taken_at INTEGER NOT NULL, total INTEGER NOT NULL, entries TEXT NOT NULL,  -- JSON top 50
  PRIMARY KEY (mode, period, period_key)
);
```

`error_reports` is gone: `/api/feedback` (§8) emails reports and stores nothing. Daily Ranked
(`0002_daily.sql`) adds its own tables, because `scores` can't hold a Daily run — its `streak > 0`
check rules out 0/20, and its rows are written at publish, where a Daily name is reserved at the
start. So `scores.mode = 'ranked'` and `idx_ranked_name` stay unused; `ranked_attempts` is used.

```sql
CREATE TABLE daily_games (            -- the frozen game (§7): server-only, values included
  game_no INTEGER PRIMARY KEY, day_key INTEGER NOT NULL, deck_version TEXT NOT NULL,
  rules_version TEXT NOT NULL, created_at INTEGER NOT NULL, rounds TEXT NOT NULL);

CREATE TABLE daily_entries (          -- one per run: inserted at the start, finished at the end
  id TEXT PRIMARY KEY, game_no INTEGER NOT NULL, run_key TEXT NOT NULL UNIQUE,
  device_hash TEXT NOT NULL, nickname TEXT NOT NULL, nickname_normalised TEXT NOT NULL,
  country TEXT, started_at INTEGER NOT NULL,
  finished_at INTEGER, score INTEGER, correct INTEGER, bonus INTEGER, think_ms INTEGER,
  results TEXT, end_reason TEXT,      -- results: the right/wrong marks, as "1"s and "0"s
  name_flagged INTEGER NOT NULL DEFAULT 0, shadow INTEGER NOT NULL DEFAULT 0, shadow_reason TEXT);
-- unique (game_no, nickname_normalised): a name once per game
-- unique (game_no, device_hash): one entry per device per game
-- (game_no, score DESC, think_ms, finished_at) WHERE finished_at IS NOT NULL: the board

CREATE TABLE daily_connections (      -- the repeat count (§12): kept 48 hours
  game_no INTEGER NOT NULL, ip_hash TEXT NOT NULL, run_key TEXT NOT NULL,
  created_at INTEGER NOT NULL);
```

A Daily board is every finished, unshadowed entry for the game — one per device by construction —
ranked by `score`, then `think_ms`, then `finished_at` (then the id). Posting is an idempotent
`UPDATE … WHERE run_key = ? AND finished_at IS NULL`. Retention: entries go 100 days after their
game, like scores; stored games and attempts after `DAILY_KEEP_DAYS` (3); connection hashes after
48 hours; snapshots (`board_snapshots`, `mode = 'ranked'`, `period = 'day'`, the game number as the
key) are kept. The owner tools (`pnpm db:owner`) find, retire names and shadow in both tables.

- **Periods are ranges of `day_key`.** A day is one key; an ISO week or a calendar month is a
  range, `from` to `to` inclusive (`periods.ts` in @bt/core), since day keys sort as dates do
  across month and year ends. Nothing is stored per week or month.
- **One entry per device per period.** A board is each device's single best run in the range —
  highest `streak`, then lower `think_ms`, then earlier `created_at` (then the id) — picked with
  `ROW_NUMBER() OVER (PARTITION BY device_hash …)` over the unshadowed rows, and ranked in the same
  order. The total is the number of distinct devices. All of it is `worker/src/scores.ts`.
- **Thinking time** (`think_ms`, `thinkMs` in `shadow.ts`, computed at submit): for each answer
  from round 2, the server-measured time less `answerAllowance(round, statChanged)` from @bt/core
  — the verdict, the gap to the next deal, then the beat and spin on a stat change or the short
  hold — with `statChanged` from the run's own sequence (a pure function of its seed). Round 1 is
  left out (its title card can be skipped, its photos load in their own time); a timeout's time
  counts. A reduced-motion client waits exactly the same (it holds still for the spin's time and
  the verdict keeps its moment; a controller test holds the wait to `answerAllowance`), so the
  clock and the tiebreak are the same for everyone. The shadow heuristics keep their own fixed
  floor, which errs long on purpose.
- **Ties.** An entry is `tied` when another device's public best in the range has the same streak,
  counted with `COUNT(*) OVER (PARTITION BY streak)` over all the bests before the limit, so a tie
  with the 51st counts. The owner's view counts other devices' public bests the same way.
- **Country.** At submit, Cloudflare's `request.cf.country`, kept only if `showCountry` is true and
  @bt/core `flagCountry` has a flag for it (`XX` unknown and `T1` Tor never). Nothing finer about
  location is read, kept or logged. The run start response hands the same code to the page, so
  the publish dialog can show the flag before the player chooses.
- **A player's own standing** (in the submit response) counts their own rows even if shadowed:
  their best in the range, ranked among every _other_ device's public best, out of those plus
  themselves. So a shadowed player sees an ordinary rank, and nobody else sees them.
- **Retention.** The nightly job deletes scores whose run started more than 100 days ago (§13).
  Snapshots are kept.
- **Owner tools** (`pnpm db:owner`, run by the owner against the remote database, asking first):
  `flag-name <id>` and `unflag-name`, `shadow <id>` and `unshadow`, and `find <nickname>` to get
  the id. `--local` tries them on the local database.

`device_hash` is `HMAC(RUN_SECRET, "device:" + id)` over a random first-party id the browser keeps
(`bt:device`), cut to 128 bits. The raw id is never stored. It is **friction, not identity** —
clearing storage resets it. Daily Ranked sends it at the start and keeps its hash with the entry
and in `ranked_attempts`. `pnpm stats daily` counts how often one connection starts more than one
run a game; if that number is high, accounts need bringing forward.

---

## 11. Board caching

There is **no KV**. The boards are served through the **Workers Cache API** (`caches.default`):
`GET /api/board/endless/:period` answers from the cache when it holds the period's board, and
otherwise reads D1 and puts the answer back (`ctx.waitUntil`), with `max-age=60`. The cache key
includes the period's own key (`…/day?k=2026-09-29`), so a reset is a miss on the new key, never
an hour of yesterday's board. A cache failure is logged as an `error` and served from D1.

Why not KV: the free plan allows 1,000 writes a day, and writing a board per submission would
spend that by lunchtime; and nothing needs the board fresher than a minute. The player who has
just published sees themselves anyway: their own entry and ranks come back in the submit response
and are kept on their device (`bt:published:…`), and the board page merges them in until the
cached board catches up. **Daily Ranked's board** (`GET /api/board/daily`) uses the same cache,
with the game number in the key (`…/daily?g=12`), so midnight is a miss on the new game. The
player's own row comes from `/api/board/daily/me`, never cached.

---

## 12. Abuse surface

- **Turnstile** on Endless's and Daily Ranked's run start (executed on the Start or Play press,
  `interaction-only`, so most players never see it), on the feedback forms, and on publishing a
  run. Its script loads on those game pages once the page is idle, or on the first press, never
  in `<head>` or on another page.
- **Daily Ranked** reuses the same bindings: `RUN_STARTS` and `ROUND_FLOOD` on its start,
  `RUN_ANSWERS` on each guess and resume keyed on the run, and `BOARD_LOOKUPS` on `/me`. No new
  limits. The one-attempt rule is the device's `ranked_attempts` row (friction, not identity: see
  DESIGN.md §3).
- **Endless** reuses the round endpoint's three limiters: `RUN_STARTS` on `/api/run/start` before
  Turnstile is asked, `RUN_ANSWERS` keyed on the verified run key, and `ROUND_FLOOD` on both. No new
  limits. What stops a replayed answer is the Durable Object's spent-once nonce (§8), not a limit.
- **Twitch Mode** reuses the same bindings too: `ROUND_FLOOD` and `RUN_STARTS` (then Turnstile) on
  a match's start, `RUN_ANSWERS` on each guess keyed on the match. A 60-second window is far
  slower than an Endless answer, so no limit needs changing, and there is no new one.
- **Feedback** (`/api/feedback`, §8) is rate-limited, checked before any other work, as well as
  protected by Turnstile. Nothing it receives reaches a response.
- **Rate limits** per IP: Endless run starts, submissions (`RUN_SUBMITS`, sized so a classroom
  publishing together never meets it; the numbers are in `wrangler.toml`), live rank lookups
  (`BOARD_LOOKUPS`, likewise), feedback.
- **Friendly (`/api/round/next`)** is limited by three Workers Rate Limiting bindings. The tight
  limit is on the **run**, not the IP, because schools, offices, VPNs and mobile carriers put many
  players behind one address and Cloudflare advises against IP-only keys:

  | Binding       | Counts                   | Key                       | Limit           |
  | ------------- | ------------------------ | ------------------------- | --------------- |
  | `RUN_ANSWERS` | answers                  | the signed run id's body  | **20 per 10s**  |
  | `RUN_STARTS`  | run starts               | IPv4 address, or IPv6 /64 | **60 per 60s**  |
  | `ROUND_FLOOD` | every request (backstop) | IPv4 address, or IPv6 /64 | **800 per 60s** |

  Keying answers on the run only works because run ids are **signed** (§7): a caller can't invent a
  fresh id per request, and a forged or tampered id is refused with `400` before it is counted
  against any run. A challenge link starts an ordinary fresh run (§7), so a link shared to a group chat doesn't
  put everyone who opens it on one run's allowance; each is a run start like any other. Each new run costs a start, counted per IP. IPv6 is cut to its /64 because a
  subscriber is usually handed a whole /64 and could otherwise rotate through it.

  A fast honest player answers about once every two seconds — the quickest round the game can show
  is 1.78s from tap to the next pick with no wheel spin, 3.3s with one — so no single run comes near
  20 in 10s. The flood backstop is sized for a classroom: 30 players at a fast 2.4s per answer is
  750 requests a minute; at a flat 2s it would allow about 26. Real play, with thinking time and
  spins, is slower. Over any limit is `429` with `retry-after` (the limit's period), and the UI
  shows a calm "slow down" state and then carries on with the same round — it never ends the run.
  Counters are per Cloudflare location and approximate: a speed bump, not accounting. The numbers
  live in `wrangler.toml` and are mirrored by `RATE_LIMITS` in `worker/src/rate-limit.ts`; a test
  fails if they drift. Periods can only be 10 or 60 seconds.

  **The trade-off: shared IPs against scraping cost.** Each answer reveals one hidden value, so the
  per-IP ceiling is what a scraper on one address gets: 800 values a minute, where the old IP-only
  limits allowed 90. Reconstructing the deck (DESIGN.md §3) drops from hours per IP to under an
  hour. That is the price of never blocking a classroom. Two things keep it bounded: a run's
  pairings are fixed by its seed, so one run yields at most 60 distinct hidden values however often
  it is asked, and every run start is counted. **If scraping becomes a problem, the next step is an
  invisible Turnstile check at run start**: each run then costs a solved challenge, which caps a
  scraper at about 60 values per challenge without adding friction for players. Friendly already
  has the single start request to hang it on.

- **Nicknames** (`nickname.ts` in @bt/core, `worker/src/moderation.ts`): default to a generated
  name (adjective + football noun + a 2–3 digit number, skipping hate codes and the crude ones);
  most people keep the suggestion, which shrinks the moderation surface to the minority who type
  their own. A name is 3–20 characters once cleaned (NFKC, trimmed, spaces collapsed): Latin
  letters, accented ones included, digits, space and `_ - .`. **Latin only**, because moderation
  can only read what its blocklist can; another script gets the same "try another name" as a
  blocked name.
  Moderation reads the name's **skeleton** — zero-width and direction characters stripped, NFKC,
  homoglyphs from other scripts and leetspeak folded to a–z, accents dropped — as runs of letters,
  so `fuuuck` matches `fuck` while a term spelt with a double letter still needs one. The whole
  name and each word (split at separators and camel case, with and without the digits at its
  ends) are checked. **Anywhere** terms (long, unambiguous) match inside the name; **word** terms
  (short ones, and impersonation such as `admin`, `moderator` and `biggerthan`) only as a whole
  word or the whole name, so Scunthorpe and badminton pass; a few innocent words holding an
  anywhere term are allowed through. A raw blocklist is defeated by leetspeak in a day.
- **The blocklist is not in the repo as text.** The repo is public, so `blocklist-data.ts` holds
  each term only as a salted 52-bit hash of its letters, with its tier, length and the repeats it
  needs; anyone can test a guess against it, nobody can read it. The plain list is
  `worker/blocklist.local.txt`, gitignored and kept privately by the owner; `pnpm blocklist:build`
  regenerates the data from it, and `--check <name>` tries a name. A test runs every name the
  generator can make through the shipped list.
- **Nickname uniqueness is per game, Ranked only.** A unique index on
  `(mode, game_no, nickname_normalised)` where `mode = 'ranked'`. A taken name returns `409` and the
  UI asks for another. Uniqueness resets at rollover, so no name is ever owned and no account system
  is implied. Endless has no uniqueness constraint.
- **Endless submissions are unlimited but rate-limited** — the boards keep each device's best
  run per period, so honest players publish rarely. Each publish also needs a real finished run
  (§8) and a Turnstile pass.
- **Shadow-flagging, not blocking** (`worker/src/shadow.ts`). A flagged score is stored with
  `shadow = 1` and the heuristics that fired: its player sees their entry and rank as normal, and
  it is left out of everyone else's boards and every total. Visible rejection just tells a cheater
  to iterate. Three heuristics over the answer times the run's Durable Object measured: several
  right answers faster than a person could think, think times that barely vary, and perfect
  accuracy deep into the knife-edge bands at fast times. **Think time** is the measured time less
  the animation every honest client plays before a question from round two on (the verdict, the
  gap to the next pair and the short hold: 4.28 s, even with reduced motion); round one, whose
  title card can be skipped, and
  timeouts are left out. The thresholds are named constants in the code and are deliberately kept
  out of these docs. Each flag is a `score_shadowed` warning (§19); `pnpm db:owner shadow` and
  `unshadow` set it by hand. **Daily Ranked** runs the same heuristics on every posted run, plus
  a **replay** check of its own: a near-perfect run whose early questions were answered implausibly
  fast, the shape of an answer sheet carried over from another device. Like the others, its
  thresholds are constants in the code (`daily-post.ts`) and not in these docs.
- **Counting repeat connections, Daily only** (`daily_connections`). At each Daily start the server
  stores `HMAC(RUN_SECRET, "ip:" + gameNo + ":" + rateLimitKey(ip))` — the address salted per game,
  so it can't be reversed or linked across days — with the run key. The number of earlier starts
  with the same hash in the game goes into the `run_start` line and data point, and nowhere else:
  **it never shadows, hides or changes a score**. Rows are deleted after 48 hours. This is the one
  place an IP-derived value is kept (§19), and the privacy page says so.

### Telemetry signals

**Workers Logs** carries a structured line for every refusal (400s, 429s) and failure, and
**Workers Analytics Engine** a data point per run start, judged answer and run end — mode, round,
stat, band, correct, streak, country; no IP, user agent or hidden values. §19 has the schema and
the queries. A burst of `rate_limited` warnings from one route is what a scraper looks like there.

**Bot timing.** Bot detection is **behavioural, not structural**: the stats are public facts, so a
script with its own copy of the data can always answer correctly. What it cannot easily fake is
human timing variance — a run of fast answers at the knife-edge band is not a person, and perfect
accuracy at the late bands is a second signal. Since Phase 5 every Endless answer records its
**server-measured time**, token issue to guess received (`double6`, §19; `pnpm stats clock`), and
each run's Durable Object keeps them per round, under the same no-personal-data rule. The
heuristics run on every publish (shadow-flagging, above).

---

## 13. Cron triggers

Two triggers in `wrangler.toml`, `0 0 * * *` and `30 1 * * *`, both running the Worker's
`scheduled` handler (`worker/src/cron.ts`, `runNightly`):

- **Snapshot** the periods that closed at the most recent 00:00 UTC — the day, and on a Monday the
  ISO week, and on the 1st the month — as their public top 50 and total, into `board_snapshots`.
  That is where the winner line comes from ("HardyOffside889 got a 23 streak yesterday"). A
  snapshot replaces an earlier one of the same period, so the **01:30 run** takes it again,
  catching runs started before midnight and published after it (a run can last most of an hour,
  and publishing is open for 30 minutes after it ends).
- **Prune** scores whose run started more than 100 days ago.
- **Daily Ranked.** At **00:00** only, freeze the new game (§7); the first start does it if this
  failed. On **both** runs, snapshot the game that has just closed (its public top 50 and total),
  so the 01:30 run catches runs started before midnight and finished after it; the previous
  game's winner line comes from it. Prune Daily entries by the 100-day rule, stored games and
  `ranked_attempts` after `DAILY_KEEP_DAYS`, and connection hashes after 48 hours. Nothing for a
  game before Game 1. No new triggers.

Each run logs one `nightly` line (§19), with the Daily counts; a D1 failure logs an `error` and
throws, so Cloudflare's cron history shows it failed.

**Locally:** `pnpm dev` runs `wrangler dev --test-scheduled`; fire the job with
`curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+0+*+*+*&time=<ms>"`, where `time`
(ms since the epoch) fakes the moment it runs. The older `/__scheduled` route is caught by the
static site's 404 here. To try a rollover, seed around the last day of the period
(`pnpm db:seed:local --date <day>`) and fire the job at the next midnight.

---

## 14. Frontend

**Astro** prerenders the shell, the homepage, the football hub, the deck pages, the about page
and the board pages. **Svelte** hydrates one island: the game, on its own page. The URL tree is in `DESIGN.md`
§17; the paths live in `apps/web/src/lib/paths.ts`.

| Path                                                    | Page                                                | JS                              |
| ------------------------------------------------------- | --------------------------------------------------- | ------------------------------- |
| `/`                                                     | homepage: brand, one line, a card per game          | none                            |
| `/football-higher-or-lower`                             | the football hub: general intro, a card per deck    | none                            |
| `/football-higher-or-lower/legends`                     | the Legends deck: breadcrumb, intro, the mode cards | a small island (the Daily card) |
| `/football-higher-or-lower/legends/friendly`            | the game (Friendly, Legends deck)                   | the island                      |
| `/football-higher-or-lower/legends/endless`             | the game (Endless)                                  | the island                      |
| `/football-higher-or-lower/legends/endless/leaderboard` | Endless's boards and this device's runs             | an island                       |
| `/football-higher-or-lower/legends/daily`               | the game (Daily Ranked)                             | the island                      |
| `/football-higher-or-lower/legends/daily/leaderboard`   | Daily Ranked's board: today's game                  | an island                       |
| `/football-higher-or-lower/legends/multiplayer`         | the Multiplayer hub: a card per multiplayer mode    | none                            |
| `/football-higher-or-lower/legends/multiplayer/twitch`  | the game (Twitch Mode)                              | the island                      |
| `/about`, `/credits`, `/privacy`                        | the stats and how to play; credits; privacy         | none                            |

- The game island is `client:load`, not `client:visible` — it is above the fold and the first
  interaction must not wait on an intersection observer.
- `packages/core` holds all game logic; Svelte components render state and nothing more.
- **Port the prototype's CSS as-is.** It is plain CSS with custom properties. Rewriting it into a
  utility framework would cost days and guarantee visual drift, and `DESIGN.md` §12 requires the
  look to match.
- **Every design value is a token** in `apps/web/src/styles/tokens.css` — colours, fonts, type
  sizes, dimensions, radii, shadows, easings, durations — so a restyle edits one file. Global
  styles live in `styles/` (`base.css`, `fonts.css`, `prose.css`); component styles are scoped.
- **Fonts are self-hosted** from `@fontsource-variable/archivo` (width axis, `"Archivo Variable"`)
  and `@fontsource/cinzel` (400 and 600 — the weights the prototype renders), Latin and Latin
  Extended subsets. Latin Archivo is preloaded everywhere; Latin Cinzel 600, the title bar's
  "Legends", only on the Legends pages. No third-party font requests.
- `TitleBar.svelte` renders server-side with no JS on static pages; the game island reuses it. Its
  `legends` prop adds "— Football Legends", set on `/football-higher-or-lower/legends` and every
  page under it (`isLegendsPath`); elsewhere the bar is the brand alone, at the same height. On
  short landscape screens (at most 500px tall) it drops "— Football Legends" as well, so the bar is
  one row and the game fits down to 568 × 320. On the game it shows the scores: "Streak n" and
  "Best n", or in a mode with a win target (`WIN_ROUNDS`, Friendly's 20) "n / 20" (with a hidden
  "Score" label) and "Best n/20".
- **Progress track** (`Track.svelte`, steps from `trackSteps` in `game/view.ts`): in a mode with a
  win target, a thin row of segments directly under the title bar, one per round — `--track-h`,
  6px on phones, 4px on short landscape screens, 8px from 780px, so it costs the fixed-height game
  almost nothing. Built from the round history: an answered round fills in gold (`--track-hit`), the
  miss in `--miss`, a round to come is faint, and the round on screen is lit with a gold glow and
  pulses while it waits (no pulse with reduced motion). It is a `progressbar` whose value text is
  "Question 7 of 20"; the live region starts each question with the same words, and the title bar
  has the score in text, so colour is never the only signal. Other modes have no track. The last
  segment is the **final question** (`isFinalRound` in `@bt/core`, `isFinalQuestion` in
  `game/view.ts`): tinted gold (`--track-final`) before it is reached, gold while asked. On the
  final question a gold "Final question" tag (`--final-tag-*`, text `final.tag`) hangs under the
  track's right end, over the pitch so it costs no height, and another sits on the plaque's top
  edge, which gains a gold ring (`--shadow-plaque-final`). Both tags drop in (`--dur-pop`; none with
  reduced motion) and are `aria-hidden`: the live region and the progressbar's value text say
  "Final question — question 20 of 20".
- **Endless on the game page** (`mode="endless"`, the same island and layout, driven by per-mode
  settings in `@bt/core`):
  - **API**: `createEndlessApi` in `game/api.ts` talks to `/api/run/start` and `/api/round/guess`
    and holds the progress token in memory only (`latestToken()`), and a finished run's signed
    result (`resultToken()`); `publishToken()` is whichever proves the run to the boards. A
    Turnstile refusal is a `verification` failure: the
    start panel says "We couldn't check your connection. Press Start to try again."
  - **Turnstile** (`game/turnstile.ts`): `loadWhenIdle` loads the script once the page is idle
    (`requestIdleCallback`, else the `load` event); `createHumanCheck` renders the widget into
    the start panel, `appearance: "interaction-only"` and `execution: "execute"`, and executes
    it on each Start press (reset first), with a 30 s time-out. Every start gets a fresh token,
    never a reused one. The start panel unmounts while a run is played, so the widget is
    removed with it (`release()`, from an `{@attach}` on its element) and rendered afresh in the
    next panel; a widget whose element has gone, or that won't reset, is replaced the same way.
    (Before this, Play again reset a widget whose element had gone, and every later start failed
    with "We couldn't check your connection" until a reload; `play-again.test.ts` holds it.)
  - **The clock**: the machine sets `clock` (`{ startedAt, limitMs }`) as a question becomes
    answerable — the `dealt` or `spun` event carries the time — and clears it at the guess; the
    controller's one timer in `awaiting` fires `timeout`, which goes to the server as a guess.
    At the answer the machine keeps what was left (`stopped`; 0 at a timeout) until the next
    question's clock starts. `Game.svelte` runs one `requestAnimationFrame` loop while a clock
    runs and hands the same `now` to both drawings, so they can't disagree with each other or the
    timeout. **The big clock** (`Clock.svelte`, from `topClock` and `clockState` in
    `game/view.ts`, `--game-clock-*`): whole seconds, rounded up, in a pill at the top of the
    pitch — centred, or at the top left beside the plaque on a landscape phone — calm, then
    `warning` from `WARN_MS` (5 s, orange, glow), then `urgent` from `URGENT_MS` (3 s: a red
    pill, scaled 1.15, one shake per second tick); frozen and dimmed from the answer; stepping
    aside (opacity and transform) while the score badge holds its spot, which `Game.svelte` tracks
    from the badge's own animation. Only transform and opacity animate. `role="timer"`, not a live
    region; a polite region beside it says "5 seconds left" and "3 seconds left" once each
    (`clockAnnouncement`). Reduced motion: no scale or shake; urgent also gets a heavier figure
    and an outline. **The plaque's line** (`clockView`): a bar along its bottom edge
    (`--clock-*`), orange from 5 s, red from 3 s, stepped a second at a time with reduced motion.
  - **No track**: the streak title so far sits in a chip under the clock (`titleChip`,
    `--chip-*`; at the top right on a landscape phone), and the score badge, which shows "n" and
    each new title, takes the clock's spot for its two seconds.
  - **Start panel**: subtitle "ENDLESS", the clock, a link to Friendly and one to the
    leaderboard. The subtitle ("ENDLESS", "INSTAGRAM", "FRIENDLY") is one size on every start
    panel, `--fs-modename`: 20px, never bigger than the deck's name above it (18px at 320 wide and
    on landscape phones).
  - **Game-over panel**: the score, the title, the stat and the two players that ended the run
    (with "Out of time." for a timeout), the best, then Play again, **Publish to leaderboard**
    directly under it (or, when the run can't improve the day's board, "Your best today is n —
    beat it…" in its place), Share and Save/Share image, and **Challenge a friend** ("Beat n" and
    the link, `challengeText`). Instagram Endless has no boards, so neither row.
    A dropped connection reads "Connection lost — your streak of n is saved". The local best is
    `bt:best:legends:endless`, saved as the streak grows.
  - **Publishing** (`PublishModal.svelte`, `game/publish.ts`): a run that scored offers "Publish to
    leaderboard", a row of its own straight under Play again. It opens a dialog (the feedback form's
    pattern and focus handling): the nickname, prefilled with the last name published from this
    device (`bt:nickname`), or a generated one the first time, with storage blocked, or when the
    stored name no longer passes the rules, and a button for a generated one; the line "We store your nickname and your score, and nothing else about you. There's
    no account."; Turnstile (`action: "submit"`, a fresh token per try); Publish. Refusals are
    calm and say what to do: another name, too late (30 minutes), already published, try again.
    Once published it shows the three ranks and a link to the board, and the panel's row becomes
    the day's rank and a "Leaderboard" link.
  - **This device** (`game/device.ts`): `bt:device`, the random id sent with a publish;
    `bt:runs:legends:endless`, the 10 best runs with their date and score, recorded at every end
    (the controller's `onOver`), published or not; `bt:published:legends:endless`, the
    standings from the last publish per period, for the board page; and `bt:nickname`, the name
    last published, saved only once a publish has gone through (`rememberPublished`), so a
    refused or abandoned name is never kept. A name typed and left unpublished still comes back
    within the same visit, from memory. All wrapped: without storage
    they last the visit.
- **The leaderboard page** (`/football-higher-or-lower/legends/endless/leaderboard`, a static page
  with the `Leaderboard.svelte` island): tabs for Today, This week and This month (the ARIA tabs
  pattern: one tab stop, arrows, Home and End), each the top 50 (`BOARD_SIZE`, @bt/core, which the
  board query and the snapshots share) in an accessible table (caption, `th scope`), "Retired
  name" for a retired one, the player's own row highlighted and marked "You", the total, "Resets in
  5 hours 12 minutes" and the previous period's winner in one line ("HardyOffside889 got a 23
  streak yesterday", "last week", "last month"; nothing when there was none); the framing line "Every run is different. Longest streak wins."; links to play; and "On this device", the 10 best
  runs. The 50 are shown **ten to a page**, client-side, with no further requests: Previous, the
  page numbers and Next under the table (secondary buttons, disabled at the ends), "1–10 of 50",
  and "Page 2 of 5" said politely as the page changes; focus stays on the control pressed. A new
  tab starts on page 1. The table keeps ten rows' height on every page (each row one line, a long
  name ending in an ellipsis), plus the pinned row's when the player has one, so the controls never
  move. **Every rank is the server's**: a row shows the rank it came with, never its place in the
  list, and nothing is ever put into the list. The player's own position is **live**: on load,
  if `bt:published` holds a publish to a current period, the page asks
  `POST /api/board/endless/me` once (`loadMine` in `game/leaderboard.ts`). When their row isn't on the
  page on show — another page, or below the top 50, or not on the minute-old cached board yet — it
  is **pinned above the table, apart from it** (a gap and a gold rule, in the "You" style), with
  the live rank and "151st of 193" (`pinnedRow`); in the top 50 it is a button to its page, which
  then moves focus to the row. If the lookup fails, the rank the publish came back with is shown,
  marked "when published", never as if it were current. Loading and a failure are calm, with a
  retry. The Legends page's Endless card and the Endless start panel link here.
  It looks like the Legends page: its centred two-line heading in the gold glow and drifting gold
  lights, the site's call to action (prose.css `.cta`, which now has the game's glow, hover and
  press), the boards in the cards' glass, tabs as the secondary button's outlined pills (prose.css
  `.secondary`, which "Try again" uses too), the previous winner and the streaks in gold. The board
  keeps a minimum height while it loads, fails or is empty, so "On this device" doesn't jump, and
  each board fades up as the game's card text does.
  - **Friendly** hides challenges entirely; an old `?challenge=` link there is `retired`
    (`readChallenge`), never sent, and noted on the start panel.
- **Site navigation** is in the title bar on every page (`lib/nav.ts`): the brand links to `/`,
  then Play (`/football-higher-or-lower/legends`), Leaderboards (Endless's board page), How to
  play (`/about#how-to-play`) and About. The current page's link carries `aria-current="page"`; a
  link to a section never does. Play also stands for its `section`, the football pages: on
  `/football-higher-or-lower` and the game page it carries `aria-current="true"`, styled the
  same, except where another link is the page itself — on the leaderboard page only Leaderboards
  is current (`navCurrent`).
  From 1000px the links sit inline (below that the game page's scores and five links would wrap
  the bar). Below that, and on short landscape screens, a "Menu" built on
  `<details>`/`<summary>` opens them with no JS and from the keyboard. Esc (returning focus to
  "Menu" when it was inside) and a click outside close it: on the game page through the island,
  which hydrates the bar, and on the static pages through a few lines of inline script in
  `Page.astro` that find it by `data-menu` — no framework, no second island. With JS off it
  still opens and closes by tapping "Menu". Its padding overflows into
  the bar's, so it adds no height to the row it shares, and the open list is an overlay hanging
  from the bar (`--z-topbar`), so the game's fixed-height screen loses nothing. Both lists are
  in the markup; only one is ever displayed.
- The footer links Credits, Privacy and GitHub, then the two feedback forms. About and How to
  play are in the title bar, not repeated here, which keeps the footer to one row down to 320px;
  below 360px GitHub steps out (`roomy` in `Footer.astro`), as the three site links and the
  forms don't fit one row there and the game page's Start would go under the footer. The title bar and
  footer are raised surfaces (`--bar-bg`, `--foot-bg`, a `--chrome-rule` hairline and a shadow on
  the edge facing the page) with bold links (`--fv-nav`, `--fv-foot`). They stay compact on the game
  page on phones (`--bar-pad-y`, `--foot-pad-y`, 11.5px footer text so it stays one row at 320px)
  and grow on the static pages and on the game at desktop sizes. A gold glow (`--glow`,
  `--glow-hover`, and `--glow-filter` for the gradient "Legends" and the clipped names) sits on the
  brand, the title bar's and footer's links, the Menu button, the names, figures, "?" and plaque,
  and the game's buttons; clickable things grow it on hover, press and `:focus-visible`, which keeps
  its gold outline too. The title bar's links have no underline: the current page's is gold, and
  hover, press and focus turn a link gold with a stronger glow (`--glow-strong`). On the card text it sits outside the dark halo. The chrome and the whole
  game UI are `user-select: none` with no tap highlight, except the copy-by-hand share box. So is
  the content of every static page (`Page.astro`'s default), About included, and the heading and
  intro of Credits; Credits' list of photos passes `selectable` and selects as usual, as does the
  feedback form. On About and Credits, the long pages, the title bar stays at the top as the page
  scrolls (`stickyBar`, `position: sticky`). There is no visible page scrollbar (`scrollbar-width:
none` and `::-webkit-scrollbar`); longer pages still scroll by wheel, touch and keyboard.
- Only the game page gets the fixed-height, no-scroll layout (`Base.astro`'s `game` flag); every
  other page scrolls.
- **Search and link previews** (`lib/seo.ts`, written into every head by `Base.astro`): `<html
lang="en-GB">`; the page's own title and meta description; an absolute canonical on
  `https://biggerthangame.com`; Open Graph (`og:type`, `og:site_name`, `og:locale` `en_GB`,
  `og:title`, `og:description`, `og:url`, `og:image` with type, size and alt) and Twitter
  (`summary_large_image`) tags; and JSON-LD: `WebSite` on every page, a `BreadcrumbList`
  following the URL down from the homepage on the football hub, the Legends page and the game
  (the Legends page's visible breadcrumb is that trail without Home, by construction), and one
  `VideoGame` entity (free, single player, a quiz in the browser) on the Legends page and the
  game. The 404 has no canonical and is `noindex`. The Endless page is a game page like
  Friendly's, with the default preview image; the leaderboard page has its own title and
  description, the default image and a `BreadcrumbList` (Home › Football › Legends › Endless ›
  Leaderboard), which it also shows. The game page's one `<h1>` is the start
  panel's "Football Legends"; "Bigger Than Game" above it is a plain brand line, looking exactly
  as before. During a run the panel goes and a visually hidden `<h1>` takes its place, so there
  is never more than one. Link previews are 1200 × 630 PNGs under
  200 KB, with no player photos: `public/og-image.png` for every page but the game, which has
  its own `og-friendly.png` (the start panel's names, "Friendly · 20 questions" and a plaque
  asking "International caps", "Higher or lower?"; `image` on `Base.astro`). They and the app
  icons (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, from `favicon.svg`) are drawn
  by `pnpm site:images` (`scripts/site-images.ts`), which renders HTML pages in headless Chrome
  with the real tokens and fonts inlined, draws the floodlit background at a sixteenth of the size
  and scales it up (Chrome dithers gradients, and the noise would double the file), and
  recompresses every PNG losslessly with Node's zlib (`scripts/png.ts`). They are committed. `site.webmanifest` names the site and
  uses `--ink`. `public/robots.txt` allows everything but `/api/` and names the sitemap;
  Cloudflare's managed robots.txt prepends its content-signals notice to it. `sitemap.xml` is an
  Astro endpoint (`pages/sitemap.xml.ts`): every page but the 404, at its canonical URL, with
  `lastmod` from the last commit to the page's `.astro` file (the build date for uncommitted
  changes or without git; a shallow clone gives every page its one commit's date). The copy that
  search reads is visible text: each page's long read sits below its cards in `.reading`
  (`prose.css`), a narrower column. **`pnpm check:site`** (`scripts/check-site.ts` over
  `site-check.ts`) runs after the leak scan in `pnpm build` and `build:prod`, and fails the
  build on a page without a title, description, canonical, preview tags, `lang`, viewport or
  exactly one `<h1>`; a title or description another page shares or outside its length range;
  structured data that doesn't parse or lacks its required fields; an internal link to nothing, or
  a word glued to a link; a sitemap or robots.txt that disagrees with the pages; or a generated
  image at the wrong size.
- Pages build to files (`about.html`, `football-higher-or-lower/legends/friendly.html`) and are
  served without the extension and with no trailing slash — `/about` — which is also the
  canonical URL. Every page is canonical to itself; `Base.astro` can take another `canonical`
  path for a duplicate (there are none) or `false` (the 404). Workers Static Assets redirects
  `/about.html`, `/about/` and `/index.html` to the canonical path (307), Cloudflare sends
  `www` and `http` to the apex over https (301), and a missing page is a real `404` with the
  404 page (`not_found_handling = "404-page"`), never a soft 404.
- **Cards** (`Card.astro`, `Cards.astro`) list the games on `/`, the decks on the football hub
  (a grid, with room for more; the homepage's with more room, `roomy`) and the modes on the Legends
  page, with their titles and text centred. The modes stack on a phone; from 560px Friendly
  (`wide`) takes a whole row with the others two to a row below it, and from 900px they spread
  across a band wider than the text (`--cards-wide-w`, up to 1160px); from 900px
  every card is taller with more padding. Each is a raised surface: a gentle gradient
  (`--card-surface`, ending in `--card-bg`, which the contrast test measures), light on its top
  edge, a thin gold-tinted border and two shadows beneath, a close crisp one and a wide soft one
  (`--card-shadow`). An open one is a single link, named by its heading. On hover and keyboard
  focus it lifts (`--card-lift-y`, `--card-lift-scale`), its shadows grow deeper and softer in a
  gold glow (`--card-shadow-lifted`), a sheen crosses it once (`--card-sheen`), and its title turns
  gold with the larger glow; pressed, it settles (`--card-press-*`). On a mouse it also tilts
  towards the pointer, up to `--card-tilt-max` degrees, easing back to flat when the pointer leaves:
  a few lines of inline script in `Page.astro` set `--tilt-x` and `--tilt-y`; on touch, with JS off
  or with reduced motion it is a plain lift. "Coming soon" cards have the same surface, dimmed and
  dashed, and never move. With reduced motion only colours and glows change. Everything moves by
  transform, so nothing shifts, and the page frame clips sideways so a lifted card at the edge
  can't make the page scroll.
- **Breadcrumb** (`Breadcrumb.astro`): "Football › Legends" above the Legends page's heading, a
  `<nav aria-label="Breadcrumb">` around an ordered list, the last item a link with
  `aria-current="page"` and the separators `aria-hidden`. Not on the game page, which has no
  height to spare on a phone (`DESIGN.md` §17).
- **Landscape phones** (`orientation: landscape` and at most 500px tall) get a tighter static page
  so its first card fits on the screen: less room at the top (`--prose-pad-top`), smaller headings,
  shorter and wider cards, and no breadcrumb. The game's start panel there puts the names and the
  text side by side, centred on one line, with a bigger, wider Start centred beneath both
  (`--start-cta-*`, `--start-row-gap`). Portrait phones and desktops are unaffected.
- `/credits` reads `packages/deck/dist/credits.json` with `fs` at build time. It is never imported,
  so it can't enter the module graph. **`themes.json`** is read the same way (`lib/themes.ts`), by
  the Legends page (a section and a card per theme), the theme pages
  (`pages/football-higher-or-lower/legends/[kind]/[slug].astro`, one per theme from
  `getStaticPaths`), the sitemap and `check:site`, which also fails on a theme with no built page.
  The Worker never reads it: it derives the same themes from its own deck (`squadThemes`), which
  is also what the feedback endpoint uses to accept a theme page's path.
- **`?mockEnd=won`** (`pnpm dev` only, `game/dev.ts`): the guess goes to the server as usual, and
  its verdict for that round comes back rewritten as a right answer that ends the run `won`, so a
  squad's "Squad cleared" panel, share text and local best can be seen without knowing the answers.
  The figures are the server's; only the verdict and the ending are made up. It sits behind
  `import.meta.env.DEV` in a dynamic import, so a production build drops it, and `scan:dist` fails
  if it ever ships.
- **Local best** is one number per deck and mode in `localStorage`, `bt:best:<deck>:<mode>`
  (`bt:best:legends:friendly`; `game/best.ts`), shown only on the game pages — as "Best 12/20" in
  Friendly. A "Clear the squad" theme's, `bt:best:legends:squad:<theme id>`, is JSON instead —
  `{"best":21,"cleared":false}`, the furthest through the squad and whether it was ever cleared,
  merged on every save so neither is lost (`readSquadBest`, `saveSquadBest`). It is saved as soon as the streak passes it. The run compares itself with the best it
  started from (`bestBefore`; `bestOutcome` and `onNewBest` in `game/view.ts`): the game-over
  panel's best line becomes "New high score" (gold caps, the gold glow, popping in after
  `--highscore-delay` with one brighter pulse; none with reduced motion) or a quieter "Matched your
  best", announced once by the live region, and only when there was a best to beat. Mid-run the
  title bar's Best glows gold (`--best-rising-*`) once the streak is past it. The game page passes
  its deck and mode to the island. Every read and write is wrapped: with storage blocked, full or
  throwing, the best lasts as long as the page and the game plays normally. The local
  leaderboard, when it comes, lives there the same way.
- **Sharing** at game over (`game/share.ts`, `share-image.ts`, `share-actions.ts`): the Wordle-style
  text is built from the round history alone — score, streak title, one square per answered round in
  tier colour and ❌ for the miss, the stat that ended it, and the challenge link — with no names,
  values or answers. The **share image** is a 1080×1350 PNG drawn on a canvas from the tokens (sizes
  are `--share-*`): score, title, grid, ending stat, and the final round's two players with their
  revealed figures. **No photos**: their licences need attribution a shared image can't carry. It
  waits for `document.fonts` and uses only fonts and data already on the page, so it works offline
  once the run has ended. Everything takes the mode: in Friendly the score is "7/20", the grid is
  always two rows of ten (⬛ in the text and empty outlines in the image and on the panel for the
  rounds not reached), and a won run's score line is "🏆 20/20" with a drawn gold trophy in the
  image and a challenge to match rather than beat. On touch devices both go to the share sheet (the image as a file);
  elsewhere the text is copied, with a visible "Copied", and the image downloads. Each result note —
  "Copied", "Image saved" or a failure — is announced once and shows for `--dur-notice` (5 s), then
  fades over `--dur-notice-fade` and clears (no fade with reduced motion; `game/notice.ts`). Another
  tap restarts it; a new run clears it at once. Its space on the panel is reserved, so nothing moves
  when it goes. "Play again" is the panel's primary button; "Share result" and "Save image" ("Share
  image" on touch) are secondary buttons beside each other under it — the same height, radius and
  type, with a gold outline and gold text, a share or download icon (`aria-hidden`), and the gold
  glow (`--btn2-*`, `--cta-*`). The two feedback links stay text links. On short screens the panel's
  spacing tightens and, on a short landscape screen, it lays out in two columns (the score beside
  the actions), so it fits without scrolling down to 320 × 568 and 568 × 320. In Friendly the
  score carries a smaller, dimmer "/20". A **won** run opens the panel with a gold trophy and "You
  won" in the gold-leaf gradient, rising in over a burst of gold with one shine across the words
  (`--won-*`, `--dur-win*`); every part animates from hidden to its natural state, so with reduced
  motion the finished panel is simply there.
- **Challenge links** are read from the game page's URL on load (`game/challenge.ts`) and sent
  with the first start; a score above the mode's cap (20 in Friendly) is a broken link. The start
  panel says "Beat n" ("Beat 7/20", or "Match 20/20" for a won run). The parameters are removed from the
  address bar once the run starts, and "Play again" is a fresh run. See §7.
- The reveal count-up (~2500ms) is what masks the round trip — see section 9 for the full budget,
  the hold-don't-snap rule, and the image prefetch requirement. The challenger's number shows 0 from
  the tap — the stat's `zero` from `@bt/core`, in its usual shape (`€0.0m`, `0`), which gives
  nothing away — until the response lands, then counts up from zero until the nominal 2500ms or, for
  a late response, for at least `--dur-settle` (380ms), so it never snaps. It eases out
  (`--count-ease`, a power: at 3 half the time covers 88% and the last 40% eases through the last
  6%) and moves on every frame; the final value lands exactly at the end of the window. Every
  in-between number takes the final figure's prefix, unit and decimals (`countFormat`: counting to
  €100.5m shows €12.3m, never €850k or €37.18m), centred in a box sized by an invisible copy of the
  final figure, where the 0 already sat. Digits are tabular (`.num`), so nothing clips, and a digit
  is only gained in the fast early part of the count.
- **The plaque** (`Plaque.svelte`) spins its reel as a **drum**: the labels sit round a cylinder
  (`--drum-step`, `--drum-radius-ratio`, seen through `--drum-perspective`) and the drum turns as one
  transform on the spin's own timing, so each label tilts away and shrinks towards the top and
  bottom edges, fading there (`--drum-fade`), with the middle one flat. On landing the drum is
  swapped for a flat line, so the stat is crisp. The plaque keeps its size, position and tier
  colours, and looks like a glazed drum: shade at its top and bottom edges and a band of
  reflection just above the middle (`--plaque-gloss`), an inner bevel (`--plaque-bevel`), a gold
  metallic rim drawn inside its edge on every tier (`--plaque-rim`, a gradient ring, with no dark
  outline round it), a soft shadow under it (`--shadow-plaque`) and a soft glow in its own tier's
  colour (`--plaque-glow-*`; the colour is one token, `--plaque-glow-colour`,
  set on the plaque so it follows the tier; `var(--gold)` makes it always gold; no glow where
  `color-mix` isn't supported). A sheen (`--plaque-sheen`, `--dur-sheen`) sweeps across when the
  wheel lands and as the title card hands over "Question 1 of 20". The final question adds a gold
  ring outside the rim (`--shadow-plaque-final`). With reduced motion the label just changes: no drum and no sheen; the gloss, rim and
  glow stay. The timing doesn't change: the plaque holds still for the spin's time, and the
  verdict comes when the count-up would have settled, so a question becomes answerable at the
  same moment with or without motion (`spinDelay`, `verdictAt` in `game/machine.ts`).
- **Photos** are a background layer in each half (`Photo.svelte`): `object-fit: cover`, positioned
  by the payload's `focus` through `--focus`, else `--photo-focus` (`50% 25%`); lightly muted and
  dimmed, drawn at partial opacity over the half's colour, which tints it teal at rest and green or
  red on the verdict. A background layer, never the hero (tokens `--photo-*`). The card's text
  starts just under the middle of its half (`Side.svelte`, `--text-top-gap`) — side by side, just
  under the plaque, or from 1024px wide, where the halves are wide enough, level with its lower
  edge, with the two names level (the anchor keeps the room of the challenger's Higher / Lower) —
  below the face at the default focus. A half too short for that puts it as low as fits instead; on
  stacked phones the top half's stops short of the plaque (`--plaque-clear`) and the bottom half's
  starts below it (`--plaque-clear-below`). The text and the button slot are never squeezed: on a
  short half the space above the text gives way. Short portrait phones (to 320 × 568) tighten the
  card's type and gaps and the buttons' height, never below `--target-min`. A name ends in an
  ellipsis after `--name-lines` lines — three, two on short screens, where no deck name needs more —
  with the whole name still in the page for screen readers; its halo is a filter (`--halo-filter`)
  so the clip can't cut it, and its box is never narrower than its longest word. Only over a photo,
  the name and country carry a tint (`--tint-*`): a deeper, wider dark shadow drawn from the letters
  themselves (`filter: drop-shadow` on their block), so it follows the text's shape with no box, and
  the photo shows between and around the words. The figure, the "?" and the qualifier have no tint;
  the figure is always gold (`--fig-colour`, whatever the tier; the plaque carries the tier colour),
  the figure and the "?" have a gold glow (`--fig-glow*`), and the qualifier a dark `text-shadow`
  halo (`--halo-*`); an optional gold hairline sits under the
  name (`--name-rule-*`). Higher and Lower (`--pick-*`) carry an up and a down arrow (inline SVG,
  `aria-hidden`); hover, only where the device has one, and keyboard focus turn the button white
  inside a gold ring (`--pick-ring*`); a press turns it white and pushes it in, which is what touch
  sees. Higher / Lower and the connection note share one slot that keeps its room whether they show
  or not, so the text never moves between rounds. `srcset` comes from `srcsetFor`; `sizes` from
  `photoSizes`, which allows for a wide photo drawn wider than its half by the cover crop. The
  monogram shows when there is no photo or it fails to load, including a `403`, and for a photo
  that hasn't arrived after `--photo-wait` (2s); never just because a photo is still loading. Until
  then the half is its plain tinted panel with the text on it. Every photo **develops in** as soon
  as it has loaded, each on its own and on every card of every round (a cached one as soon as its
  card appears): it fades up behind the text and settles from `--photo-develop-scale` (1.04) over
  `--dur-photo-develop` (500ms), over the monogram if that had appeared. With reduced motion it
  only fades. The controller preloads round one's two photos when the run starts, each new
  challenger's photo when an answer lands, and the round's `upcoming` photo as soon as the round
  is on screen, through an off-screen `Image` with the card's own `sizes` and `srcset`
  (`game/photos.ts`). A photo already fetched is not fetched again; the preload's promise settles
  when it has loaded or failed, which is what a run's hold waits on.
- **The first deal** of every run (Start, Play again, a challenge link) opens with a **title
  card**. The pitch is empty; "Question 1 of 20" ("Question 1" without a win target; "Beat 7/20"
  or "Match 20/20" for a replayed challenge, `titleCard` in `game/view.ts`) rises in large in the
  centre, then shrinks and glides into the plaque, which fades in under it reading "Question 1 of
  20" (`plaqueLead`): the machine's `title` phase, `--dur-title` (1.8s) on the first run of a
  visit and `--dur-title-quick` (0.9s) on Play again (`repeat`). The plaque then **holds**
  (`holding`) with a band of light sweeping across it and a gold glow breathing round it
  (`--plaque-shimmer`, `--plaque-aura`), while round one's two photos load: at least
  `--dur-hold-min` (1s), longer until both have loaded or failed, and no more than
  `--dur-hold-extra` (3s) longer. Then round one's halves slide in from opposite edges to meet
  (`intro`, `--dur-intro-min`), names on them; their photos are normally in by then, and one
  that isn't develops in as usual. Round one's beat and spin follow, and the first spin starts from
  the plaque's line and scrolls on into the stat. A tap, a click or any key during the title card
  or the hold skips straight to the cards (`canSkipTitle`), and is used for nothing else. The live
  region says "Question 1 of 20" once as the title card comes up and asks the question when the
  plaque lands; focus is untouched. Transform and opacity only, every value a token. With reduced
  motion the title fades in and out where it stands and the plaque fades in, with no glide or
  scaling; the hold still waits for the photos, without the shimmer, and the cards' text fades in
  rather than sliding. Later rounds deal without any of it.
- **The score badge** (Friendly, from `WIN_ROUNDS`; `scoreBadge` in `game/view.ts`): after each
  right answer but the winning one, the new score ("3/20") shows in a small gold pill at the top of
  the pitch, centred on the screen: over the divide at the top on a desktop, just under the plaque
  on a landscape phone, and at the top of the top half on a portrait phone, close to the track and
  above the face. It rises in, a sheen crosses it and its glow pulses, it holds, then it leaves:
  `--dur-score-badge` (2s) from the verdict, so it is going as the next question settles. At 5, 10
  and 15 it adds the streak title ("5/20 · Squad player") and glows more. Overlaid, so nothing moves;
  `aria-hidden`, as the live region says the score; with reduced motion it only fades. Other modes
  show none. While it shows, the refused-challenge note at the top of round one steps aside.
- **The slide to the next pair** after a right answer is a carousel, the machine's `sliding`
  phase: the challenger's whole card (photo, name, country, revealed figure and qualifier) moves
  into the anchor's place, the anchor's card slides off, and the next challenger comes in with
  "?" — leftwards side by side, upwards when stacked. The halves are cards keyed by the round they
  were dealt in (`pitchCards` in `game/view.ts`), each drawn at its place by transform
  (`Side.svelte`), so the carried card is the same element throughout: its photo doesn't redevelop
  or flicker. Its text glides from the challenger's layout to the anchor's (FLIP, a transform), and
  its verdict colour fades back to rest on the way; the verdict label has gone by then. The slide
  is the last `--dur-slide` (600ms, `--ease-slide`) of the usual `--dur-next`, so rounds take no
  longer; the plaque stays put and any wheel spin comes after, as before. The carried figure stays
  on the anchor (`anchorFigure`) when the stat holds. On a stat change it stays until the wheel
  starts, then fades out with its qualifier (`anchorFading`, `--dur-figure-out`) and the new stat's
  figure appears when the wheel lands, so the old number is never shown beside the new stat. The incoming photo develops in as usual
  (normally it was preloaded a round early). No slide after a wrong answer or a win, on the first
  deal, or with reduced motion, where the pair simply changes at the same moment. Focus and
  announcements are unchanged.
- **Accessibility:** every control is a native button or link with a visible focus ring; the game
  plays from the keyboard (arrow keys, and focus returns to Higher and to Play again);
  `prefers-reduced-motion` stops the reel, the count-up and every transition; live regions announce
  the question (and a stat change), the verdict, slow-downs and share results; the grid has a text
  label, so tier colour is never the only signal; touch targets are at least 44px (`--target-min`;
  small footer links grow an invisible hit area). Card text sits on the photo with a dark halo round
  every glyph, and the name and country with the deeper tint too; their legibility over the photos
  is judged by eye.
- **Short landscape screens** (`orientation: landscape` and at most 500px tall) put the halves side
  by side and the plaque at the top of the divide, with that strip kept clear, so it never covers
  a card.
- **Dev-only delay switch** (`pnpm dev`): 0, 200, 800ms or 3s before every round request, from a
  small panel or `?delay=800`. The same panel runs **axe-core** over the page (the "a11y" button,
  or `window.__btAxe()` in a headless browser) and logs the violations. Its "auto" button (or
  `?auto=1`) is an autopilot that answers every question right, to reach Friendly's win screen: it
  asks the server about the round on screen first — possible only because Friendly is stateless
  (§7) — then presses the right button. It lives in `game/dev.ts`, loaded by a dynamic import behind
  `import.meta.env.DEV`, so production builds don't contain it.
- The island's flow is a plain-TS state machine in `apps/web/src/game/` (`machine.ts`, a pure
  reducer: idle → starting → title → holding → intro → dealing → spinning → awaiting → revealing →
  verdict → [sliding →] dealing … → over, with the title card, hold and intro on the first deal
  only and `sliding` after a right answer), run by
  `controller.ts` with the API, clock and timers injected so it is tested in Node. It keeps a
  **round history** of `{ index, stat, tier, correct }` per answered round — no values — for the
  share grid and image. Script timers read the `--dur-*` tokens at runtime; a test keeps their
  fallbacks equal to `tokens.css`.
- **Feedback forms** (`FeedbackModal.svelte`, logic in `game/feedback.ts`): "Report an error" on
  the game-over panel, about the round that ended the run; "Suggest a legend" there too; and
  "Suggest a legend" and "Report a problem" in the footer of every page. The forms live in the one
  island, on the game page, so there the footer links (`data-feedback`) open the modal directly,
  and on every other page they go to `/football-higher-or-lower/legends/friendly#suggest` and
  `#problem`, which open the form on load. A problem report names the page it came from — the
  referrer's path when it is one of the site's pages (`SITE_PAGES`), else the game page — and
  nothing else. One modal dialog in the island: labelled, `aria-modal`, focus held inside and
  returned to the opener, Esc and a close button, 44px targets. **A click on the backdrop closes
  it too** (`game/modal.ts`, shared with the publish dialog): only when the press both starts and
  ends on the backdrop, so selecting text in a field and letting go outside doesn't, and never
  while a send is in flight. What was typed comes back if the form is opened again (kept in
  memory for the page's lifetime, never in storage; a report's draft is about its own card), and
  is cleared once the send goes through. After a send goes through,
  "Thanks" is announced and shows for `--dur-thanks` (5 s), then the modal fades and closes itself
  (no fade with reduced motion; the pause stays). Esc, the close button or a click anywhere closes
  it at once, and focus goes back to the button or link that opened it.
  The report shows the two players, the stat and both figures the player has already seen, and
  sends only the run id and round. The Turnstile script (`game/turnstile.ts`) is added on first
  open, never for someone who only plays; the site key is in `config.ts` (Cloudflare's always-pass
  test key under `pnpm dev`). The form shows sending, sent and failed states, and a calm note on
  `429`.
- **Twitch Mode on the game page** (`mode="stream"`, the same island; logic in
  `apps/web/src/game/stream/`, components in `components/stream/`):
  - **The `ChatSource` seam** (`stream/chat-source.ts`): `connect(channel)`, `onMessage`,
    `onStatus`, `close()`. The game never knows how chat is read. Today's source is
    `stream/twitch-anon.ts`: Twitch's public chat WebSocket (`wss://irc-ws.chat.twitch.tv:443`)
    with an anonymous guest login (`justinfan<n>`; no token, OAuth or app), the tags capability
    for the user id, joined only once Twitch sends `ROOMSTATE` (a join it never confirms within
    10 s reads as no such channel; a refusing `NOTICE` says so), `PING` answered, Twitch's
    `RECONNECT` followed at once, and a dropped connection reconnected with exponential backoff
    and jitter (1 s doubling to 30 s, ±20%); a source that has never got through gives up after
    four attempts and says Twitch can't be reached. A line whose text is longer than any command
    is dropped before its tags are read, so a big chat costs little. An official, login-based
    source (EventSub) can be added later behind the same four calls without touching the game.
    Socket, timers, clock and randomness are injected; the tests use a fake socket.
  - **Votes** (`stream/commands.ts`, `stream/votes.ts`): the six commands in one config per
    language (`VOTE_COMMANDS`); a `VoteBox` keyed on the user id, open only while the question's
    clock runs, its counts kept as votes arrive and read four times a second for the screen. It
    is emptied at each question; the stream API closes it as the answer goes and sends only
    `{ pick, voters }`.
  - **The machine**: in `stream` a pick is locked in (`locked`) rather than sent; the clock's
    own timeout or "End voting" (`close`, allowed by `canEndVoting`) sends it, or `timeout`. The
    limit is the match's, on every question (`limitOf`). Every answer goes on to the next question,
    as in Daily Ranked. Chat's result per question is worked out at the reveal
    (`stream/match.ts`) against the figures it shows.
  - **The page**: the setup (`StreamSetup.svelte`, a centred, scrolling page rather than a
    panel: Start, the channel and its status, the settings, the pool picker from `themes.json`,
    and Start again) in the start panel's place, and again from full time for
    Change questions or Change channel; a two-row track (`DualTrack.svelte`) and a strip with the
    scoreboard, command hint, chat status, vote count and the reveal's split
    (`StreamHud.svelte`) over the pitch; "Locked in" in the picks' place and "End voting" under
    the clock; full time (`StreamResult.svelte`). Every new match, Play again included, starts
    through the setup panel's own Turnstile widget, a fresh token each time (the Play again fix,
    `play-again.test.ts`; `stream-play.test.ts` holds it for matches). The settings are
    remembered under `bt:stream:channel`, `bt:stream:pool`, `bt:stream:length` and
    `bt:stream:timer`; `?pool=<theme slug>` preselects. The channel is only filled in on return:
    chat connects when Connect is pressed, never on load. No leave beacon, no local best.
  - **`?mockChat=1`** (`pnpm dev` only, `stream/mock-chat.ts`, behind `import.meta.env.DEV` in a
    dynamic import): a fake `ChatSource` with a crowd of made-up voters (`viewers`, `split`,
    `fickle`, `spam`), and `window.__btDropChat()` to cut it and watch the reconnect. `mockChat`
    is in `DEV_TOOL_MARKERS`, so `scan:dist` fails if it ships.
  - **No Content-Security-Policy is set** by the site (no `_headers`, no meta, and the Worker
    never answers for the static pages), so nothing had to be allowed for the chat WebSocket. If
    one is added later, `connect-src` needs `wss://irc-ws.chat.twitch.tv` and nothing broader.
  - **Privacy**: chat goes from Twitch to the streamer's browser and nowhere else. No message,
    viewer name or user id is stored, logged or sent; only the pick and the count per question
    reach the server, as telemetry (§19). The privacy page says so.
- **All visible game text is in `apps/web/src/i18n/en.ts`**, a flat keyed object with
  `{placeholder}` interpolation (`t()`). Components hold no user-facing string literals. Another
  language is another file with the same keys; there is no language switching yet.

---

## 15. Testing

- **Unit:** `packages/core` under Vitest. The PRNG, ramp, tie exclusion and eligibility rules are
  pure functions and should be covered properly. Cover the relaxation path explicitly: the
  early-round iconic preference first, then ceiling, then floor, then the seen queue, never tie
  exclusion.
- **Determinism:** the same seed must produce an identical sequence in the browser, the Worker and
  Node. Assert this explicitly; it is the foundation of Daily Ranked.
- **Simulation:** 20,000-run harness producing `simulation.md`. Run it on every deck change.
- **Worker, Phase 3:** vitest in Node. Handler logic is pure functions (request → response, given
  deck, secret and clock), and routing is tested through `createApp` with mocked bindings. The
  **response-shape test** walks many complete runs and asserts no response carries a hidden value or
  any part of a `Player`, with `scanForLeakedValues` as a backstop.
- **Worker, Phase 5:** in Node, the Endless handlers against a memory ledger per run
  (`run.test.ts`, `run-ledger.test.ts`, `token.test.ts`, `endless-app.test.ts`): token forgery
  (payload or signature edited, another key, another run's signature), tampered round, mode, stat
  and anchor, replay (`409`, run void), the latest-step resend, older and out-of-order tokens, the
  deadline (on it, just past it, question one's 15 s, the spin allowance), Turnstile's fail and
  error, Friendly's refusals, challenge runs, and the response-shape test over
  many complete Endless runs, tokens decoded.
- **Worker, Endless part 2:** in Node, publishing (`submit.test.ts`: forged, spent, mismatched and
  already-published tokens, the 30-minute window, a streak the Durable Object doesn't agree with,
  a streak of 0, a never-started run with a genuine signature, a challenge run publishing, a banked
  run, Turnstile, moderation, D1 failing, the unique backstop), the board SQL over **real SQLite**
  (`scores.test.ts`, through `__tests__/d1-sqlite.ts`: Node's `node:sqlite` running the real
  migrations — one best entry per device per period, the tiebreak, shadowed scores and retired
  names, weeks and months at the edges), the cache (`board.test.ts`: a hit never reads D1), the
  cron across a midnight, a Monday, a month's end and ISO week 53 (`cron.test.ts`), the
  heuristics, moderation (with every name the generator can make), and the routes
  (`boards-app.test.ts`). Under workerd, one whole run is published into the harness's local D1,
  read back from the board and snapshotted by the scheduled handler. Under **workerd** (`workerd.test.ts`, wrangler's
  `createTestHarness`, on the test Worker `worker/test/entry.ts`): the real SQLite-backed
  `RunDO` spending a nonce once, the resend rule, the alarm closing a silent run and refusing its
  late guess, a whole run over HTTP, and an Endless seed dealing the same run as in Node.
- **Worker, Daily Ranked:** in Node (`daily.test.ts`, `daily-parts.test.ts`, `daily-app.test.ts`),
  against a memory ledger and real SQLite: game numbers at the UTC edges and before launch; the game
  frozen once (two racing builders included) and unchanged by a deck edit, with a stored image
  falling back to the current one; wrong answers and timeouts carrying on to 20, the bonus only
  after 20/20 and ending on its first miss; a refused or taken name, or a failed check, using no
  attempt, and a second start refused; resume keeping the deadline, turning an expired question
  into a timeout, refusing another device, and working with no run id or a stale one; the idle
  alarm finishing and posting an abandoned run, and retrying a failed post; auto-posting on every
  ending; ranking, ties and the think-time rules (a timeout and an unanswered question count the
  full limit); the replay check shadowing without hiding the run from its owner, and the repeat
  count never touching a score; the cron's freeze, snapshot and prunes; and the **response-shape
  test** over many complete Daily runs and resumes, tokens decoded. Under workerd: a whole Daily
  run over HTTP, the real `RunDO` alarm finishing a silent run into the harness's D1, and the Daily
  seed dealing the same game as in Node.
- **Twitch Mode:** in Node, the match dealer and its goldens (`stream.test.ts` in @bt/core: each
  pool's players only, a squad never repeating, the caps, the stream bands (the friendly opening,
  then never easier, by progress through the match), and every other mode's runs unchanged); the handlers and ledger (`worker/src/__tests__/stream.test.ts`:
  strict starts, only the four limits, the deadline on the chosen one, misses and timeouts playing
  on to the end, the resend rule, conflicts refused without voiding and the match then played to
  its end, forged and edited tokens, the alarm, chat's telemetry, and `submit` refusing a match);
  the response-shape test over whole matches on every pool, tokens decoded; and the observability
  test. Under workerd, one whole match over HTTP with a refused replay, and a match's seed dealing
  the same rounds as in Node. In the web app: chat parsing, the channel input and the anonymous
  source over a fake socket (`stream-chat.test.ts`), the scoring, share and settings
  (`stream-match.test.ts`), and the controller with fake Turnstile and server
  (`stream-play.test.ts`).
- **Latency:** test the reveal under artificial delay (0ms, 200ms, 800ms, 3s). The count-up must
  hold and settle rather than snap or freeze, and no image fetch may occur inside the reveal window.
  In Endless the question's clock must not run while the answer is in flight, and the next
  question's must start only once it can be answered (`apps/web/src/game/__tests__/endless.test.ts`).

---

## 16. Cost

Static asset requests are unbilled. At 10,000 plays a day averaging a dozen questions you are
around 120k Worker requests daily plus the same in DO messages — one of each per question, since
the answer and the next round's display payload travel in a single response — just past the free tier and well
inside the $5/month plan's included requests. D1 usage at this scale is negligible: a
publish is a handful of reads and one write, and a board is read from D1 at most once a minute per
period per Cloudflare location (§11). R2
storage for ~300 originals is a few hundred MB, inside the free 10GB, and R2 egress is free. Image
Transformations use ~600 of the free 5,000 unique transformations a month. Verify
current numbers against Cloudflare's pricing page before launch.

---

## 17. Build order

Note that **images are v1 scope**, and licence verification across ~300 players is a long pole in
its own right — see `DESIGN.md` §13. Friendly Mode ships on whatever the deck holds; players without a
verified image render the monogram fallback.

**Friendly Mode first**, shipped publicly on the full deck. It needs `packages/core`, the Astro
shell, the Svelte island, and **one stateless endpoint** (`/api/round/next`) plus a rate limit. It
does not need the Durable Object, D1, KV, progress tokens or Turnstile.

Building that endpoint is not a detour. It is the same sequence-derivation work Phase 5 needs, and
Phase 5 hardens it in place rather than replacing a throwaway — so this is less total work than
building Friendly fully client-side and bolting a server path on afterwards.

That gets feedback on feel, comprehension and the difficulty ramp while the long pole —
hand-entering the deck — proceeds in parallel. `simulation.md` remains the primary instrument for
ramp tuning; live Friendly play is the check on it.

Endless shipped first, with its boards, once the round protocol, Durable Object, D1 schema and
moderation were complete (Phase 6A); Daily Ranked (Phase 6B) followed on the same machinery.

---

## 18. Deferred

- **Accounts.** The real fix for the one-attempt rule and for cross-device history.
- **Multiplayer**, beyond Twitch Mode (which needs no lobby: chat is read in the streamer's
  browser). For 1v1 and Last Man Standing, a Durable Object per lobby is the canonical pattern
  when they arrive; the DO namespace introduced here is a useful precedent.
- **Weekly and all-time boards for Ranked.** Endless has today, this week and this month
  (DESIGN.md §13, §14); no all-time board.

---

## 19. Observability

Two instruments, both on the Worker and both configured in `wrangler.toml`. Neither can change a
response or its timing.

- **Workers Logs** — one structured line for every request the API refuses or fails, one for each
  run's start and end, and one for each feedback message accepted (`worker/src/log.ts`). Free
  plan: 200,000 events a day, kept 3 days.
- **Workers Analytics Engine** — one data point for each run start, each judged answer, each
  run end, each page left mid-run and each attempt to publish a run (`worker/src/analytics.ts`), in the dataset `biggerthan_game_events` through the
  `GAME_EVENTS` binding. The dataset is created by the first write after a deploy and keeps three
  months. Queried with SQL through Cloudflare's API: `pnpm stats` (CLAUDE.md) runs the saved
  queries below.

**Invocation logs are off, on purpose.** Cloudflare's automatic invocation logs record every
request with its IP, location, user agent and headers, which the rules below forbid. So
`wrangler.toml` sets `invocation_logs = false` under `[observability.logs]`, beside
`[observability]` `enabled = true` and `head_sampling_rate = 1`. The only lines in Workers Logs are
the Worker's own `log()` lines. Don't switch invocation logs back on.

### Never recorded

Nothing personal and nothing hidden, in either instrument:

- no IP address. It is a rate-limit key (§12), and the one exception is Daily Ranked's repeat
  count: a per-game salted hash kept 48 hours in D1 (`daily_connections`), used only to count,
  never logged — the log line and data point carry the count alone
- no user agent, no cookie, no request headers, and nothing kept in the browser for analytics
- no `RUN_SECRET` or other secret, no seed, no HMAC or signature, no full run id — the **run key**
  (the run id's body, before the ".") stands in for it
- no Turnstile token and no `FEEDBACK_TO` address
- no hidden stat value. The data points carry none, the player's own score apart; the **rank
  distance** is a position in the deck, written only after the answer, when both figures have been
  shown, and never sent to the client. The `run_end` line carries the final round's two players
  and figures, which the response ending the run has just revealed. A `run_leave` line names the
  two players on screen and carries only the figures the player had seen: the anchor's from the
  question on, the challenger's only once revealed. Nothing else names a player or a value.

Feedback text is the one exception to "nothing the player typed": an accepted message's `feedback`
line holds what was sent (below), kept in Workers Logs for 3 days, with the country and nothing
else about the sender. It never appears in a refusal or failure line.

Country is the only thing about the player: Cloudflare's `request.cf.country`, `XX` when unknown.
Tests hold all of this: `worker/src/__tests__/observability.test.ts` walks complete runs and checks
every data point and log line for IPs, user agents, secrets, seeds and signed ids; checks that no
player id or name appears outside `run_end`'s final round, and that round against the deck; and
runs the deck's leak scanner over the rest. `leave.test.ts` holds a `run_leave` line to the
figures shown, and never the challenger's during a question.

### Log lines

One object per line, written with the console method that matches its level, so Workers Logs
indexes every field, nested ones included (a string would only be searchable as text). Every line
has `level`, `message`, `event` and `route`; most have a `reason`. `message` is what the dashboard
lists as the line:

- `run_start`, `run_end`, `run_resume`, `run_leave` or `run_submit` for the run lines, exactly;
- `nightly` for the cron's line;
- `Legend suggested`, `Problem reported` or `Card error reported` for an accepted feedback message;
- `<event> · <reason>` for a refusal or failure, e.g. `bad_request · invalid_json`, or the event
  alone when there's no reason.

| Level   | `event`               | When                                                                    | `reason`                                                                                        |
| ------- | --------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `info`  | `run_start`           | a run starts (fresh or challenge)                                       | —                                                                                               |
| `info`  | `run_end`             | an answer ends a run, or a silent one closes                            | the end: `wrong`, `won`, `deck-exhausted`, `timeout`, `disconnected`, `finished` or `abandoned` |
| `info`  | `run_resume`          | a Daily run is picked up after a refresh                                | —                                                                                               |
| `info`  | `run_leave`           | the game page is hidden or closed mid-run                               | —                                                                                               |
| `info`  | `feedback`            | a feedback message is accepted                                          | —                                                                                               |
| `info`  | `run_submit`          | a run is published to the boards                                        | —                                                                                               |
| `info`  | `nightly`             | the cron's snapshot and prune (§13)                                     | —                                                                                               |
| `warn`  | `score_shadowed`      | a published run trips a timing heuristic (§12)                          | the heuristics, e.g. `fast,flat`                                                                |
| `warn`  | `nickname_rejected`   | a 422: the nickname didn't pass                                         | `nickname_blocked` or `nickname_script`                                                         |
| `warn`  | `bad_request`         | a 400 from either endpoint                                              | the response's `detail`                                                                         |
| `warn`  | `rate_limited`        | a 429                                                                   | the limit: `flood`, `starts`, `answers`, `feedback` or `submits`                                |
| `warn`  | `method_not_allowed`  | anything but POST                                                       | —                                                                                               |
| `warn`  | `verification_failed` | Turnstile said no (403)                                                 | —                                                                                               |
| `warn`  | `conflict`            | an Endless token spent, out of order, run over; a publish refused       | the refusal, e.g. `spent`, `void`, `mismatch` or `expired` (§8)                                 |
| `error` | `internal`            | a 500                                                                   | `not_configured` (`cause` names the missing secrets), or the exception's name, with its `cause` |
| `error` | `unavailable`         | a 503 or 502: the deck, a run's DO, Siteverify, D1, the cache, the cron | the 503's `detail`, or `run_store`, `turnstile`, `scores`, `board_cache`, `cron`                |
| `error` | `send_failed`         | a feedback email couldn't be sent                                       | the send error's code, e.g. `E_SENDER_NOT_VERIFIED`                                             |
| `error` | `analytics_failed`    | a data point write threw — once per isolate                             | the exception's name, with its `cause`                                                          |

Refusals and failures also carry `status`. Nothing else is logged: no successful answer (the
dataset has those), and no 404 under `/api/`, which scanners probe all day.

**Run lines**, so runs can be watched live:

```jsonc
{ "level": "info", "message": "run_start", "event": "run_start", "route": "/api/round/next",
  "mode": "friendly", "run": "20260928-<uuid>", "runKind": "fresh",
  "deckVersion": "legends-107-e68a4e1b", "country": "GB" }
{ "level": "info", "message": "run_end", "event": "run_end", "route": "/api/round/next",
  "mode": "friendly", "run": "20260928-<uuid>", "runKind": "fresh",
  "deckVersion": "legends-107-e68a4e1b", "country": "GB", "reason": "wrong", "score": 6,
  "endStat": { "id": "caps", "label": "International caps" }, "guess": "higher",
  "players": [
    { "role": "anchor", "id": "…", "name": "…", "value": 108, "display": "108" },
    { "role": "challenger", "id": "…", "name": "…", "value": 91, "display": "91" } ] }
```

`run` is the run key, so a start and its end can be paired. Endless's lines carry `"mode":
"endless"` and come from `/api/run/start` and `/api/round/guess`; an Endless variant's add
`"variant": "endless-instagram"` (filter on `variant` to watch one). A "Clear the squad" run's lines
say `"mode": "squad"` and its `"theme": "club-barcelona"` instead (filter on `theme`), and its
`run_end` reason is `won` when the squad was cleared. **Daily Ranked's** lines say `"mode":
"ranked"` and carry `gameNo` (filter on it to watch one game); its `run_start` adds
`repeatFromConnection`, how many runs of the game had already started from the same connection (a
count, §12 — never the hash), and its `run_end` adds `correct` and `bonus`, with the reason
`finished` (question 20 answered, not a perfect run), `wrong` or `timeout` (a bonus round missed),
`deck-exhausted` or `abandoned` (finished by the idle alarm, logged from the Durable Object with
`"route": "run-do"`). A `run_resume` line (`round`, `expired`) marks each pick-up after a
refresh, and `run_submit` (with `rank`, the run's place in its game) each run posted to its board.
`run_end` adds the round that
ended the run: the miss on `wrong`, the timed-out question on `timeout` (`guess` is then
`timeout`), the final question on `won`, the last answer on `deck-exhausted`. That's `endStat`
(the stat's id and label), `guess` and `players`, each with the figure its card showed
(`display`, plus `qualifier` for a stat that has one) and its raw `value`. An Endless run closed
as `disconnected` is logged by its Durable Object's alarm (`"route": "run-do"`), with the open
round as the player saw it: the anchor's figure, and the challenger's name only.

**The leave line**, when the game page reports being hidden (`visibilitychange`) or closed
(`pagehide`) mid-run: after Start, before the run ends, at most once per trigger per run
(`game/leave.ts`). The page sends its run id, the round on screen and what was showing; the
Worker rebuilds that round from the seed.

```jsonc
{
  "level": "info",
  "message": "run_leave",
  "event": "run_leave",
  "route": "/api/run/leave",
  "mode": "friendly",
  "run": "20260928-<uuid>",
  "runKind": "fresh",
  "deckVersion": "legends-107-e68a4e1b",
  "country": "GB",
  "round": 7,
  "phase": "question",
  "trigger": "hidden",
  "stat": { "id": "caps", "label": "International caps" },
  "players": [
    { "role": "anchor", "id": "…", "name": "…", "value": 108, "display": "108" },
    { "role": "challenger", "id": "…", "name": "…" },
  ],
}
```

`phase` is `intro` (the title card and the cards sliding in; `round` is 0 and there's no `stat`
or `players`), `question` (waiting for an answer, or for it to come back), `reveal` (the answer
on screen) or `other` (dealing, or the wheel spinning). The anchor's figure is there in
`question` and `reveal`, not while the cards are dealt or the wheel spins; the challenger's only
in `reveal`. `trigger` is `hidden` (the tab switched away, the phone locked) or `pagehide` (the
page closed or navigated away); closing a page usually sends both.

**The feedback line**, one per message accepted (valid, and Turnstile passed), whether or not the
email then sends. A failed send still logs its `send_failed` line after it.

```jsonc
{ "level": "info", "message": "Legend suggested", "event": "feedback", "route": "/api/feedback",
  "kind": "suggest", "country": "GB", "submitted": { "name": "…", "note": "…" } }
{ "level": "info", "message": "Problem reported", "event": "feedback", "route": "/api/feedback",
  "kind": "problem", "country": "GB", "submitted": { "note": "…", "page": "/about" } }
{ "level": "info", "message": "Card error reported", "event": "feedback", "route": "/api/feedback",
  "kind": "correction", "country": "GB",
  "submitted": { "note": "…", "run": "20260928-<uuid>", "round": 7,
    "stat": { "id": "fee", "label": "Highest transfer fee" },
    "players": [ { "role": "anchor", "name": "…", "display": "€77.5m", "qualifier": "2001" },
                 { "role": "challenger", "name": "…", "display": "…", "qualifier": "…" } ] } }
```

`submitted` holds what the sender typed, already trimmed, capped and stripped of control characters
(§8), and kept as plain text inside the JSON. For a correction it adds the round as the form
showed it, with the run key and never the run id. A note left blank is left out.

**The publish line**, one per run published: the run key, the new entry's id, the score, where it
stands today, this week and this month as its owner sees it, and whether it was shadowed. Never the
nickname, and never the device.

```jsonc
{
  "level": "info",
  "message": "run_submit",
  "event": "run_submit",
  "route": "/api/run/submit",
  "mode": "endless",
  "run": "20260929-<uuid>",
  "runKind": "fresh",
  "deckVersion": "legends-107-e68a4e1b",
  "country": "GB",
  "score": 23,
  "shadowed": "no",
  "id": "<uuid>",
  "ranks": { "day": 412, "week": 1030, "month": 2114 },
}
```

A shadowed one also has a `score_shadowed` warning with the heuristics that fired, the run key,
the entry id and the score, so the owner can look at it (`pnpm db:owner`).

**Filtering in the dashboard** (Workers & Pages → biggerthangame → Observability → Logs; switch on
live to stream):

- runs: `message` equals `run_start` or `run_end`; add `reason` equals `wrong` or `won`
- where players leave: `message` equals `run_leave`; add `phase`, `round` or `trigger`
- where runs end: `endStat.id` (or `endStat.label`) equals a stat; `players.name` finds a player
- feedback: `event` equals `feedback`, with `kind` equals `suggest`, `problem` or `correction`
- publishing: `message` equals `run_submit`; shadow flags: `event` equals `score_shadowed`;
  the nightly job: `message` equals `nightly`
- failures: `level` equals `error`

`npx wrangler tail biggerthangame --format pretty --search run_end` does the same from a terminal,
for as long as it runs.

**Quota.** Each 429 is a line, so a scraper hammering past the limits can spend the day's 200,000
log events, and lines past the allowance may not be kept. The game is unaffected. If that starts
happening, sample the `rate_limited` lines rather than dropping them.

### Event schema

One layout for every event, so a column means the same thing everywhere. Blobs are strings,
doubles numbers; unused columns are empty. **`blob2` is the mode, or an Endless variant's id**:
`friendly`, `endless`, `endless-instagram`, and `squad` for every "Clear the squad" theme. Every
query below groups or filters on it, so Instagram Endless and the squads show as modes of their
own and never mix into general Endless's figures (`pnpm stats endless` stays general Endless's).
**`blob10` is a squad's theme id** (`club-barcelona`), on every one of its events — the event's own
blobs are padded with empties to reach it — and absent (so empty) for every other mode, whose
data points are exactly as before. Split the squads by `blob10`.

| Column    | `start`      | `answer`                          | `end`              | `leave`                                       | `submit`                 |
| --------- | ------------ | --------------------------------- | ------------------ | --------------------------------------------- | ------------------------ |
| `index1`  | run key      | run key                           | run key            | run key                                       | run key                  |
| `blob1`   | `start`      | `answer`                          | `end`              | `leave`                                       | `submit`                 |
| `blob2`   | mode         | mode                              | mode               | mode                                          | mode                     |
| `blob3`   | run kind     | run kind                          | run kind           | run kind                                      | run kind                 |
| `blob4`   | deck version | deck version                      | deck version       | deck version                                  | deck version             |
| `blob5`   | country      | country                           | country            | country                                       | country                  |
| `blob6`   |              | stat id (`caps`)                  | end reason (below) | phase: `intro`, `question`, `reveal`, `other` | published: `1` or `0`    |
| `blob7`   |              | tier: `basic`, `uncommon`, `rare` |                    | trigger: `hidden`, `pagehide`                 | shadowed: `1` or `0`     |
| `blob8`   |              | band: `0.45+`, `0.30-0.80`, …     |                    | stat id; empty on the intro                   | day rank bucket, `1-10`… |
| `blob9`   |              | final question: `1` or `0`        |                    |                                               | refusal, e.g. `expired`  |
| `blob10`  | theme id     | theme id                          | theme id           | theme id                                      | theme id                 |
| `double1` |              | round, 1–150                      | final score        | round on screen (0 the intro)                 | the run's score          |
| `double2` |              | correct: 1 or 0                   |                    |                                               |                          |
| `double3` |              | streak after the answer           |                    |                                               |                          |
| `double4` |              | relaxation step, 0–3              |                    |                                               |                          |
| `double5` |              | rank distance of the pair, 0–1    |                    |                                               |                          |
| `double6` |              | answer ms (Endless; absent → 0)   |                    |                                               |                          |
| `double7` |              | Daily: the game number            |                    |                                               |                          |

- **When.** `start` once a run's first round is dealt. `answer` once the server has judged the
  guess and built the response — a request that fails after the judgement records nothing, and an
  Endless resend answered from the ledger (§8) records nothing again. `end` straight after the
  answer that ends the run, or, for an Endless run that went silent, from its Durable Object's
  alarm. A run with a start and no end was **abandoned**.
  `leave` when the game page reports being hidden or closed mid-run (`POST /api/run/leave`, §8),
  at most once per trigger per run; it says where an abandoned run stopped, and that a run which
  carried on had been put down for a while. `submit` for each attempt to publish a run whose
  token checked out (`POST /api/run/submit`, §8): published, with the day rank's bucket (never
  the exact rank) and whether it was shadowed, or refused, with why. Never the nickname.
- **Run key** (`index1`): the run id's body, `YYYYMMDD-<uuid>` (45 bytes); older data has
  Friendly's retired replay keys, `YYYYMMDD-<uuid>~<uuid>` (82). Both fit Analytics Engine's 96;
  the run id grammar (§7) allows nothing longer, and a test holds it.
- **Mode**: `friendly`, `endless` (and its variants, above) or `ranked` (Daily Ranked).
- **Daily Ranked** fills a few more columns, every other mode's points being exactly as before:
  `start` double1 the game number and double2 the repeat count from the same connection (a count;
  never the hash); `answer` double7 the game; `end` double2 the game, double3 the right answers out
  of twenty and double4 the bonus rounds, with the end reasons `finished` and `abandoned` as well;
  `submit` (the run posted to its board, there being no submit step) double2 the game and blob8
  the bucket of its rank in the game. A sixth event, **`resume`**: blob6 whether the open question
  had run out (`1` or `0`), double1 the game and double2 the round on screen after it. Daily's
  final question is round 20.
- **Run kind**: `fresh`; `challenge` for an Endless run started from a challenge link that checked
  out (fresh rounds, against the link's score, §7); `replay` for Friendly's challenge replays
  before challenges moved to Endless. A link that fails its check starts a fresh run, recorded as
  one. An Endless run's leave beacon records `fresh` whatever its kind; join on the run key.
- **End reason**: `wrong`, `won` (Friendly), `deck-exhausted`, and in Endless `timeout` (the
  answer came after the deadline, or the client's clock ran out) and `disconnected` (no answer
  came: the run's Durable Object closed it a little past the deadline, keeping the streak, and
  wrote its `end` itself).
- **Answer ms** (`double6`, Endless): the server's own measure, from the token's issue to the guess
  reaching the Worker — the animation before the question, the thinking and the network. Never the
  client's. Friendly writes no `double6`, which reads as 0. The input to the timing heuristics
  (§12).
- **Deck version**: `deckVersion` (§6), e.g. `legends-107-e68a4e1b`.
- **Streak after the answer**: the run's score once this answer is counted — the round if right,
  one less if wrong. One life, so a wrong answer's streak is also the run's final score.
- **Band**: the band the round was **scheduled** for in its mode (§8, DESIGN.md §8), as floor and
  ceiling: `0.45+` is uncapped, `0.30-0.80` capped. Labels sort by difficulty. Relaxation can
  deal a round outside it; `double4` says whether it did, and `double5` where the pair really sat.
- **Relaxation step**: 0 dealt as scheduled, 1 the iconic preference gave, 2 the band gave, 3 the
  recently-seen queue was shortened — the ladder in DESIGN.md §8, from `Round.relaxation`.
- **Rank distance**: how far apart the two figures sit in the deck for the stat, 0 to 1, computed
  by the engine's own `percentiles` and `rankDistance` on the tables it dealt from.
- **Final question**: round 20 of Friendly (`isFinalRound`); a Twitch Mode match's last.
- **Twitch Mode** (`stream` in blob2, whatever the pool) writes, on every event, blob10 the theme
  id for a squad pool (else empty) and blob11 the pool (`endless`, `endless-instagram`,
  `squad:<theme id>`). Its `start` has double1 the questions and double2 the limit in seconds;
  each `answer` adds blob12 chat's outcome (`right`, `wrong`, `split`, `none`, or empty when the
  page sent none) and double8 that question's voters, with double3 the streamer's right answers
  so far and double7 0; its `end` (blob6 `finished`, `deck-exhausted` or `disconnected`) has
  double1 the streamer's score, double2 the questions, double3 the limit, double4 chat's score and
  double5 the peak voters on one question. Counts only: no message, name or id from chat. Its
  `run_start` and `run_end` lines say `"mode": "stream"` with `pool`, `questions` and `limit`, and
  `run_end` adds `chatScore` and `peakVoters`.

**What the numbers can and can't say.** Friendly is stateless (§7): a resent answer is judged and
recorded again, and a technical caller can answer rounds out of order or without ever starting.
So Friendly's are counts of answers the server judged, not of verified runs — near enough for
tuning, not for a leaderboard. Endless's are verified: each answer spent its token once. A run that started before the query's window but ended inside it counts as
an end without a start, so `abandoned` can dip below zero on a short window. Local `wrangler dev`
simulates the binding and writes nothing to the real dataset.

**Limits.** Up to 20 blobs, 20 doubles and one index of at most 96 bytes per point; 250 points per
request (these write at most three). Workers Free includes 100,000 points written and 10,000 read
queries a day; Workers Paid, 10 million written and 1 million read a month. A Friendly run writes
its rounds answered plus two, about a dozen for a typical run, so the free allowance covers several
thousand runs a day. Analytics Engine isn't billed yet; check the pricing page before relying on
that.

### Queries

Analytics Engine's SQL reads one table at a time — no joins, no subqueries — so each query is a
single `SELECT`. Counts are `SUM(_sample_interval)`, never `count()`, which stays right if
Analytics Engine samples at high volume. Here each covers the last 7 days and every deck;
`pnpm stats` takes `--days` and `--deck`, and computes the extra columns noted. A test holds these
blocks to the queries the script runs (`scripts/stats-queries.ts`).

**Runs** (`summary`, shown by default): started, finished and abandoned, and win rate, per mode.

```sql
SELECT
  blob2 AS mode,
  sumIf(_sample_interval, blob1 = 'start') AS started,
  sumIf(_sample_interval, blob1 = 'end') AS finished,
  sumIf(_sample_interval, blob1 = 'start') - sumIf(_sample_interval, blob1 = 'end') AS abandoned,
  sumIf(_sample_interval, blob1 = 'end' AND blob6 = 'won') AS won,
  round(100 * sumIf(_sample_interval, blob1 = 'end' AND blob6 = 'won')
    / sumIf(_sample_interval, blob1 = 'end'), 1) AS win_pct
FROM biggerthan_game_events
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY mode
ORDER BY mode
```

**Final scores** (`scores`, shown by default): the spread of finished runs' scores.

```sql
SELECT
  blob2 AS mode,
  SUM(_sample_interval) AS runs,
  round(SUM(_sample_interval * double1) / SUM(_sample_interval), 1) AS mean,
  min(double1) AS min,
  quantileExactWeighted(0.25)(double1, _sample_interval) AS p25,
  quantileExactWeighted(0.5)(double1, _sample_interval) AS median,
  quantileExactWeighted(0.75)(double1, _sample_interval) AS p75,
  max(double1) AS max
FROM biggerthan_game_events
WHERE blob1 = 'end'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY mode
ORDER BY mode
```

**Streak histogram** (`streaks`): finished runs by final score, per mode.

```sql
SELECT
  blob2 AS mode,
  double1 AS score,
  SUM(_sample_interval) AS runs
FROM biggerthan_game_events
WHERE blob1 = 'end'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY mode, score
ORDER BY mode, score
```

**How runs end** (`endings`): finished runs per mode and end reason — in Endless also `timeout`
(out of time) and `disconnected` (no answer came; the ledger closed the run with its streak).

```sql
SELECT
  blob2 AS mode,
  blob6 AS reason,
  SUM(_sample_interval) AS runs,
  round(SUM(_sample_interval * double1) / SUM(_sample_interval), 1) AS mean_score
FROM biggerthan_game_events
WHERE blob1 = 'end'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY mode, reason
ORDER BY mode, runs DESC
```

**Endless answer times** (`clock`): the server-measured time from a question's token to its
answer (`double6`), per scheduled band — the animation before the question plus the thinking.
The raw material of the timing heuristics (§12): very fast, right answers late in a run are what
a bot looks like.

```sql
SELECT
  blob8 AS band,
  SUM(_sample_interval) AS answers,
  quantileExactWeighted(0.1)(double6, _sample_interval) AS p10_ms,
  quantileExactWeighted(0.5)(double6, _sample_interval) AS median_ms,
  quantileExactWeighted(0.9)(double6, _sample_interval) AS p90_ms,
  round(100 * SUM(_sample_interval * double2) / SUM(_sample_interval), 1) AS correct_pct
FROM biggerthan_game_events
WHERE blob1 = 'answer'
  AND blob2 = 'endless'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY band
ORDER BY band DESC
```

**Friendly win rate and the final question** (`friendly`): win rate of finished runs, the share of
started runs that reached question 20, and how many of those answered it right — the three figures
`simulation.md` models.

```sql
SELECT
  sumIf(_sample_interval, blob1 = 'start') AS started,
  sumIf(_sample_interval, blob1 = 'end') AS finished,
  sumIf(_sample_interval, blob1 = 'end' AND blob6 = 'won') AS won,
  round(100 * sumIf(_sample_interval, blob1 = 'end' AND blob6 = 'won')
    / sumIf(_sample_interval, blob1 = 'end'), 1) AS win_pct,
  sumIf(_sample_interval, blob1 = 'answer' AND blob9 = '1') AS reached_final,
  round(100 * sumIf(_sample_interval, blob1 = 'answer' AND blob9 = '1')
    / sumIf(_sample_interval, blob1 = 'start'), 1) AS reached_final_pct,
  round(100 * sumIf(_sample_interval, blob1 = 'answer' AND blob9 = '1' AND double2 = 1)
    / sumIf(_sample_interval, blob1 = 'answer' AND blob9 = '1'), 1) AS final_pass_pct
FROM biggerthan_game_events
WHERE blob2 = 'friendly'
  AND timestamp > NOW() - INTERVAL '7' DAY
```

**Correct rate per stat** (`stats`): answers and correct rate per stat. The script adds `share_pct`,
the stat's share of its mode's answers — its firing rate, to set against `TIER_TARGET`.

```sql
SELECT
  blob2 AS mode,
  blob6 AS stat,
  blob7 AS tier,
  SUM(_sample_interval) AS answers,
  round(100 * SUM(_sample_interval * double2) / SUM(_sample_interval), 1) AS correct_pct
FROM biggerthan_game_events
WHERE blob1 = 'answer'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY mode, stat, tier
ORDER BY mode, answers DESC
```

**Correct rate by rank distance** (`distance`): in buckets 0.1 wide. This is the real player
behind the modelled one in `simulation.md` (the `fan` model, 0.55 at a distance of 0 to 0.99 from
0.50): once there are a few thousand answers, write it as a calibration file and run
`pnpm simulate --calibration <file.json>`.

```sql
SELECT
  blob2 AS mode,
  floor(double5, 1) AS distance,
  SUM(_sample_interval) AS answers,
  round(100 * SUM(_sample_interval * double2) / SUM(_sample_interval), 1) AS correct_pct
FROM biggerthan_game_events
WHERE blob1 = 'answer'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY mode, distance
ORDER BY mode, distance
```

**Correct rate by band** (`bands`): per scheduled band, with how often it had to relax.

```sql
SELECT
  blob2 AS mode,
  blob8 AS band,
  SUM(_sample_interval) AS answers,
  round(100 * SUM(_sample_interval * double2) / SUM(_sample_interval), 1) AS correct_pct,
  round(100 * sumIf(_sample_interval, double4 > 0) / SUM(_sample_interval), 1) AS relaxed_pct
FROM biggerthan_game_events
WHERE blob1 = 'answer'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY mode, band
ORDER BY mode, band DESC
```

**Drop-off by round** (`dropoff`): how many answers each round got and how many were right. The
script adds `left`: runs that got round _n_ right and never answered _n_ + 1, which is where
players walk away rather than lose.

```sql
SELECT
  blob2 AS mode,
  double1 AS round,
  SUM(_sample_interval) AS reached,
  SUM(_sample_interval * double2) AS correct,
  round(100 * SUM(_sample_interval * double2) / SUM(_sample_interval), 1) AS correct_pct
FROM biggerthan_game_events
WHERE blob1 = 'answer'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY mode, round
ORDER BY mode, round
```

**Leaves by round and phase** (`leaves`): runs whose page was hidden (switched away from, the
phone locked) or closed mid-run, by the round on screen (0 is the title card and the intro) and
what was showing. Each trigger counts at most once per run, and closing a page usually fires both,
so the two columns overlap rather than add up.

```sql
SELECT
  blob2 AS mode,
  double1 AS round,
  blob6 AS phase,
  sumIf(_sample_interval, blob7 = 'hidden') AS hidden,
  sumIf(_sample_interval, blob7 = 'pagehide') AS closed
FROM biggerthan_game_events
WHERE blob1 = 'leave'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY mode, round, phase
ORDER BY mode, round, phase
```

**Answers in one run** (`run`, as `pnpm stats run <runKey>`; not part of `all`): every answer the
server judged for one run key, oldest first, with `answer_ms` (Endless's server-measured answer
time; 0 in Friendly), and `gap_s`, the seconds since the answer before. The
script prints a summary under it: how many answers, any round answered more than once (Friendly is
stateless, so a resent answer is judged again, §7), the fastest gap between two answers and the
time from the first answer to the last. The key is the run id before the "."; a whole run id works
too, and anything that isn't a run key is refused before a request is made. Shown here with an
example key.

```sql
SELECT
  timestamp,
  double1 AS round,
  blob6 AS stat,
  double2 AS correct,
  double3 AS streak,
  double6 AS answer_ms
FROM biggerthan_game_events
WHERE blob1 = 'answer'
  AND index1 = '20260928-00000000-0000-4000-8000-000000000000'
  AND timestamp > NOW() - INTERVAL '7' DAY
ORDER BY timestamp, round
LIMIT 1000
```

**Challenge runs** (`replays`): the share of runs started from a challenge link — Endless's
`challenge` runs, and Friendly's `replay`s from before challenges moved to Endless.

```sql
SELECT
  blob2 AS mode,
  SUM(_sample_interval) AS started,
  sumIf(_sample_interval, blob3 = 'challenge' OR blob3 = 'replay') AS challenged,
  round(100 * sumIf(_sample_interval, blob3 = 'challenge' OR blob3 = 'replay')
    / SUM(_sample_interval), 1) AS challenged_pct
FROM biggerthan_game_events
WHERE blob1 = 'start'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY mode
ORDER BY mode
```

**Endless: runs, scores and publishing** (`endless`): Endless runs started and finished, the
spread of their scores, and attempts to publish, with how many were published and how many of
those were shadow-flagged. The script blanks the columns that don't apply to a row, and prints the
publish rate (published / finished) and the shadow rate (shadowed / published) under it.

```sql
SELECT
  blob1 AS event,
  SUM(_sample_interval) AS events,
  round(SUM(_sample_interval * double1) / SUM(_sample_interval), 1) AS mean_score,
  quantileExactWeighted(0.5)(double1, _sample_interval) AS median_score,
  quantileExactWeighted(0.9)(double1, _sample_interval) AS p90_score,
  max(double1) AS max_score,
  sumIf(_sample_interval, blob1 = 'submit' AND blob6 = '1') AS published,
  sumIf(_sample_interval, blob1 = 'submit' AND blob6 = '1' AND blob7 = '1') AS shadowed
FROM biggerthan_game_events
WHERE blob2 = 'endless'
  AND (blob1 = 'start' OR blob1 = 'end' OR blob1 = 'submit')
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY event
ORDER BY event
```

**Daily Ranked: per game** (`daily`): for each game, its players (runs started), runs finished,
the mean score, perfect twenties, runs finished by the idle alarm (`abandoned`), resumes after a
refresh, shadowed posts, and starts from a connection that had already started a run of the game.
The game number is `double1` on a start or a resume and `double2` on an end or a post. The script
prints the rates over every game shown under it: the 20/20 rate, resumes and repeat connections
as a share of starts, and alarm finishes and shadowed posts as a share of finished runs. The
score spread is `scores` and `streaks` under mode `ranked`.

```sql
SELECT
  if(blob1 = 'start' OR blob1 = 'resume', double1, double2) AS game,
  sumIf(_sample_interval, blob1 = 'start') AS players,
  sumIf(_sample_interval, blob1 = 'end') AS finished,
  round(sumIf(_sample_interval * double1, blob1 = 'end')
    / sumIf(_sample_interval, blob1 = 'end'), 1) AS mean_score,
  sumIf(_sample_interval, blob1 = 'end' AND double3 = 20) AS perfect,
  sumIf(_sample_interval, blob1 = 'end' AND blob6 = 'abandoned') AS abandoned,
  sumIf(_sample_interval, blob1 = 'resume') AS resumes,
  sumIf(_sample_interval, blob1 = 'submit' AND blob7 = '1') AS shadowed,
  sumIf(_sample_interval, blob1 = 'start' AND double2 > 0) AS repeat_connection
FROM biggerthan_game_events
WHERE blob2 = 'ranked'
  AND (blob1 = 'start' OR blob1 = 'end' OR blob1 = 'resume' OR blob1 = 'submit')
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY game
ORDER BY game DESC
```

**Twitch Mode: matches** (`stream`): per pool, length and timer, matches finished, the streamer's
and chat's mean scores, how often the streamer beat chat or drew, the mean peak voters on one
question, and matches the alarm closed because the page went away.

```sql
SELECT
  blob11 AS pool,
  double2 AS questions,
  double3 AS limit_s,
  sum(_sample_interval) AS matches,
  round(sum(_sample_interval * double1) / sum(_sample_interval), 1) AS streamer_mean,
  round(sum(_sample_interval * double4) / sum(_sample_interval), 1) AS chat_mean,
  sumIf(_sample_interval, double1 > double4) AS streamer_won,
  sumIf(_sample_interval, double1 = double4) AS draws,
  round(sum(_sample_interval * double5) / sum(_sample_interval), 1) AS mean_peak_voters,
  sumIf(_sample_interval, blob6 = 'disconnected') AS disconnected
FROM biggerthan_game_events
WHERE blob2 = 'stream'
  AND blob1 = 'end'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY pool, questions, limit_s
ORDER BY matches DESC
```

**Latest 50 starts and ends** (`latest`): newest first, for a look at what's happening now. The
script blanks the end columns on a start.

```sql
SELECT
  timestamp,
  blob1 AS event,
  blob2 AS mode,
  blob3 AS run_kind,
  blob5 AS country,
  blob6 AS end_reason,
  double1 AS score,
  index1 AS run
FROM biggerthan_game_events
WHERE (blob1 = 'start' OR blob1 = 'end')
  AND timestamp > NOW() - INTERVAL '7' DAY
ORDER BY timestamp DESC
LIMIT 50
```

---

_Bigger Than — architecture, version 2._
