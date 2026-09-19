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
   ramp — see `DESIGN.md` §8. The first band has no ceiling; every later band does.
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
  │                     ├── D1 (scores, reports)
  │                     └── KV (cached boards)
  │
  └── everything else → ASSETS binding (Astro build output)
```

Astro is configured for **static output**, not SSR. Every page is prerendered at build time; the
Worker only executes for `/api/*`. No Astro Cloudflare adapter is needed.

**Bindings:** `ASSETS`, `DB` (D1), `BOARDS` (KV), `RUNS` (Durable Object namespace), `RUN_SECRET` (secret),
`TURNSTILE_SECRET` (secret), `ROUND_BURST` and `ROUND_SUSTAINED` (Workers Rate Limiting).

Phase 3 (Friendly) uses only `ASSETS`, `RUN_SECRET` and the two rate limiters. The rest arrive with
Ranked and Endless.

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
│   │   ├── ramp.ts        # gap bands by round, relaxation order
│   │   ├── wheel.ts       # tier-weighted stat selection, correlated-pair exclusion
│   │   ├── sequence.ts    # deterministic round sequence from a seed
│   │   ├── api.ts         # /api/round/next request and response types, shared with the web app
│   │   └── types.ts
│   └── deck/
│       ├── data/          # private submodule, organised by deck type
│       │   └── legends/   # DECK = "legends"
│       │       ├── players/        # one YAML file per player
│       │       ├── originals/      # source photos, staged locally, gitignored
│       │       ├── images.json     # manifest, written by images:sync, committed
│       │       └── image-log.csv   # kept by hand; not read by the build or sync
│       ├── sample/
│       │   └── legends/players/    # 24 invented players, used until data/ holds MIN_PRIVATE_DECK
│       ├── schema.ts      # Zod schema
│       ├── build.ts       # validation + precompute → artifacts in dist/
│       └── dist/          # generated, gitignored: deck.full.json, images.json, credits.json, …
├── apps/web/              # Astro + Svelte
├── worker/
│   ├── index.ts           # entry: wires the bundled deck into src/app.ts
│   ├── src/
│   │   ├── app.ts         # routing, rate limiting, error mapping
│   │   ├── round.ts       # /api/round/next as a pure function
│   │   ├── payload.ts     # Round → declared response DTOs
│   │   └── deck.ts        # the only import of packages/deck/dist
│   ├── run-do.ts          # Durable Object (Phase 5)
│   └── token.ts           # sign / verify progress tokens (Phase 5)
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
   with `scanForLeakedValues`, because nothing type-level connects "what was imported" to "what
   ended up in `dist`". The **round payload** is covered by an explicit response DTO plus a test —
   the compiler does most of the work there, but note that a `Round` carries `anchor` and
   `challenger` as full `Player` objects, so returning one directly leaks everything while
   typechecking cleanly.
2. **No prefetching of hidden values, not even one round ahead.** Buffering rounds for latency
   would mean several readable answers sitting in memory at all times. Prefetch _display_ data
   only — and do prefetch it: images especially must be loaded ahead of the round they appear in
   (section 9).
3. **The round sequence is a pure function of the seed** and does not depend on player answers.
   This is what lets the server recompute any round statelessly, and what makes Daily Ranked
   identical for everyone. It holds naturally because the challenger becomes the anchor whether
   the guess was right or wrong, and a wrong guess ends the run.
4. **A progress token can be spent once.** See section 8 — this is the one place per-run state is
   unavoidable.

---

## 5. The deck

One YAML file per player, in the private submodule at `packages/deck/data/legends/players/` (the
per-deck layout is in §3):

```yaml
id: zidane-zinedine
name: Zinedine Zidane
country: France
position: MF # GK | DF | MF | FW  — drives the goals-stat exclusion
dob: 1972-06-23
deceased: false
iconic: true # recognisable enough to open a run on (DESIGN.md §10)
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

**Images keep full provenance** even though stats do not. A licence is a legal obligation, not a
convenience, so `author`, `licence` and `source` are all required whenever an `image` block is
present.

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

`packages/deck/build.ts` runs before the Astro build and emits:

| Artifact                   | Destination                 | Contents                                                                                                      |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `deck.full.json`           | bundled into Worker         | ids, all stat values, eligibility                                                                             |
| `dist/images.json`         | bundled into Worker         | id → `{ key, width, height }` for deck players; no source hash                                                |
| `indexes.json`             | Worker                      | per stat: players sorted by value, tie groups                                                                 |
| `credits.json`             | read by `/credits` at build | player name, author, licence, licence URL (absent for PD) and source per image; read with `fs`, never bundled |
| `data/legends/images.json` | read, not written           | the manifest: written by `images:sync`, checked here                                                          |
| `viability.md`             | repo, committed             | per stat and gap band, how many valid pairs exist                                                             |
| `simulation.md`            | repo, committed             | streak distribution and stat firing rates over 10k runs                                                       |

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

**No client-bound artifact is emitted**, so there is nothing at build time to police. The leak
scanner (`scanForLeakedValues`) instead runs against the built site bundle and, from Phase 5,
against the round payload. It takes text rather than an object deliberately — it must work on a JS
bundle as readily as on JSON, and it must not trust any object's shape.

Note that **image URLs are display data, not stat values**, and reach the client freely. The
scanner only looks for numbers.

Band-exempt stats (`clubs`, and any other flagged narrow stat) are matched on tie exclusion alone
and are **barred from the first 10 rounds** — otherwise a rare stat landing at round 3 ends a run
during the phase meant to build confidence.

`viability.md` also reports **pairwise correlation between stats**, which is what identifies
candidates for the correlated-pair exclusion in `wheel.ts`. `caps`/`igoals` and
`club_goals`/`apps` are the expected pairs and must never be switched between directly — confirm
the full list from the report rather than assuming it (see `DESIGN.md` §10).

`viability.md` reports per stat **and per band** — not per floor — since a band can be empty even
when a floor is well populated. With ten stats and four of them rare and tie-prone, it is what tells
you which stats can actually fire at the late bands, and whether the 30–80% band is reachable at
all. Read it after every deck change.

`simulation.md` runs the real engine 10,000 times over the compiled deck and reports the streak
histogram and how often each stat actually fires after tie and gap filtering. This is how the
ramp and tier weights get tuned — not by guessing.

---

## 7. Sequence derivation

```
seed(ranked,   gameNo) = HMAC-SHA256(RUN_SECRET, "ranked:"   + gameNo)
seed(endless,  runId)  = HMAC-SHA256(RUN_SECRET, "endless:"  + runId)
seed(friendly, runId)  = HMAC-SHA256(RUN_SECRET, "friendly:" + runId)
```

Ranked's seed depends only on the game number, so **every player gets the same sequence** — that is what
makes the board comparable. Endless and Friendly are per-run.

**Friendly run ids** are `YYYYMMDD-<uuid>`, minted by the server with the UTC date. The date fixes
the run's reference `now` (00:00 UTC that day), from which age is computed, so no value moves
between rounds of one run. The server refuses a run id dated more than one day from its own UTC
date, so a caller can't choose an arbitrary reference date. The client never sees or chooses a seed.

> **Phase 5 note — seeds collapse to 32 bits.** `createRng` turns the seed string into the
> generator's state through `hashSeed` (FNV-1a, 32-bit), so however strong the HMAC, there are at
> most 2³² distinct runs. That is fine for Friendly. For Ranked and Endless, someone holding the deck
> could brute-force the state from the first few observed rounds and read the rest of the sequence
> — not the hidden values, which are public facts anyway, but the upcoming pairings. Decide in
> Phase 5 whether that matters; widening the state changes every golden fingerprint.

`sequence.ts` takes a seed and a round number and replays the engine deterministically from round
one. Twenty rounds is well under a millisecond, so the server recomputes rather than storing.

**Game numbering.** `gameNo = floor((now - EPOCH) / 86400000) + 1`, `EPOCH` being launch day at
00:00 UTC. **Game 1 is launch day and the epoch is never moved** — game numbers become permanent
the moment people start sharing them. Rollover is UTC midnight.

**Puzzles are labelled "Game 123", never by date** — a date label disagrees with the local calendar
for anyone west of UTC, where rollover lands the previous evening. The UI shows a countdown to the
next game rather than a clock time.

A run belongs to the game it was minted against. A Ranked run started at 23:58 UTC finishes on that
game's board, with a grace window on submission.

**Deck versioning.** Each game pins the deck version it was minted against, so a correction landing
mid-game cannot shift the sequence under players who have already played. Deck changes take effect
at the next rollover.

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

`base64url(payload) + "." + base64url(HMAC(RUN_SECRET, payload))`

```ts
type Progress = {
  runId: string;
  mode: "ranked" | "endless";
  gameNo: number;
  // Friendly issues no token — it uses /api/round/next and carries no state.
  round: number;
  streak: number;
  anchorId: string;
  challengerId: string;
  stat: StatKey;
  anchorValue: number; // already shown — safe
  issuedAt: number; // authoritative timer start
  nonce: string;
};
```

The token is signed, **not encrypted** — assume the client reads it. That is fine: it carries only
what is already on screen. The challenger's value is never in it.

### Endpoints

**`POST /api/run/start`** → `{ mode, turnstileToken }`
Verifies Turnstile. For Ranked, checks the signed device-day token and refuses a second run.
Creates the DO, returns round one's display payload and the first progress token.

**`POST /api/round/next`** — Friendly, Phase 3. Stateless: no storage, no token, no nonce, no
timer. Types live in `packages/core/src/api.ts`, shared by the Worker and the web app.

```jsonc
// start
→ { "mode": "friendly" }
← { "runId": "20260919-<uuid>", "round": RoundPayload }            // round 1

// answer
→ { "mode": "friendly", "runId": "…", "round": 7, "guess": "higher" | "lower" }
← { "reveal": { "round": 7, "value": 88, "display": "88m", "qualifier"?: "…", "correct": true },
    "next": RoundPayload }                                          // correct, run continues
← { "reveal": { … }, "end": "wrong" | "deck-exhausted" }            // run over
```

`RoundPayload` is `{ index, stat: { key, label, tier, statChanged }, anchor, challenger }`. The
anchor carries `id, name, country, position, image?` plus its `value`, `display` and `qualifier?`;
the challenger carries **only** `id, name, country, position, image?`. The challenger's qualifier
(fee year, follower snapshot date) is stat-derived, so it is withheld with the value and arrives in
`reveal`. `display` is always `STATS[key].format(value)`.

Each request derives the seed from `runId` (§7), replays the run to one round past the one answered,
and **decides correctness server-side**. A run that reaches `MAX_ROUNDS` (60) — or can deal no next
round — ends with `deck-exhausted`. Every response is an explicitly declared DTO built field by field
in `worker/src/payload.ts`; a `Round` is never returned. Requests are validated strictly — unknown
mode, extra keys, malformed or out-of-range `runId`, a `round` that isn't an integer in 1–60, or a
bad guess are all `400` — and every `/api/*` response is `cache-control: no-store`.

Because it is stateless, anyone can mint run ids or ask any round of a run. Each request still
reveals at most one hidden value, so the **rate limit** does the real work (DESIGN.md §3): it is the
only thing between the deck and a determined scraper, so it is load-bearing rather than hygiene.
Numbers in §12.

**Phase 5 hardens this same endpoint** rather than replacing it: Ranked and Endless add the progress
token (signed, spent once via the Durable Object), the server-owned timer and Turnstile on top of
the same payloads — the round, reveal and end shapes stay as they are. How the token sits alongside
`runId` and `round` in the request is settled in Phase 5. `/api/run/start` and `/api/round/guess`
below describe the enforcement that hardening adds.

**`POST /api/round/guess`** → `{ token, guess }`

1. Verify HMAC.
2. Ask the DO to spend the nonce. Already spent → `409`, run void.
3. Check `now - issuedAt` against the round's limit plus a **3s network grace**. The **server** owns
   the clock; `clientElapsedMs` is telemetry only, never trusted — a client-reported send time would
   make the grace whatever a cheater claims. Where latency compensation is wanted, derive it
   server-side from observed round-trip times on the connection, not from anything the client says.
4. Recompute the sequence to this round, read the true values, decide correctness.
5. Return the challenger's value, and if correct, the next round's display payload and token.

**`POST /api/run/submit`** → `{ token, nickname, publish }`
Validates the final token chain, moderates the nickname, writes to D1 if `publish` is true.
Local-only scores never reach this endpoint.

**`POST /api/report`** → `{ playerId, stat, note }` — rate-limited, writes to D1 and sends an
email notification to the maintainer. Corrections land in the deck repo and take effect at the next
rollover, never mid-game.

**`GET /api/board/:mode/:gameNo`** — served from KV.

### Disconnection

Offline continuation is impossible by construction: the client does not hold the next value and
nothing can supply it while the network is down. So the behaviour is **retry visibly, then bank
and end**. Every round up to the drop is already verified by the token chain, so the player keeps
the streak they earned and it submits when connectivity returns. There is no "unranked offline
mode" — there is nothing to play offline with.

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

**The reveal count-up (~640ms) runs on every question**, not only on stat changes — there is a
number to reveal every round. That is the masking budget.

Sequence after a tap:

```
0ms      guess sent; challenger's number starts scrambling from local state
25–430ms response lands (see table)
640ms    count-up settles on the true value
~680ms   correct/incorrect colour
~1400ms  next pair deals
```

On anything but a genuinely bad connection the response arrives well before the animation would
have finished, so perceived latency is zero.

**If the response has not arrived by 640ms, hold the scramble — never snap or freeze.** The number
keeps rolling and settles when the answer lands. It degrades as "the reveal took a beat", which is
tolerable, rather than as a stall, which is not.

The 1.3s wheel spin on stat-change rounds is additional cover, not load-bearing. Do not design
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
- **Image Transformations** (enabled on the `biggerthangame.com` zone, sources restricted to that
  zone) resize and convert on first request and cache the result at the edge. `format=auto` serves
  AVIF or WebP by `Accept` header and counts as **one** transformation. `fit=scale-down` never
  enlarges. `onerror=redirect` falls back to the original rather than a broken image.
- **Two widths only: 800 and 1600.** Every distinct URL is a separate transformation against the
  free allowance of 5,000 a month; 300 players × 2 widths is 600. Widths are fixed constants
  (`DISPLAY_WIDTHS`), **never computed per device**. Past the allowance, new transformations fail
  and `onerror=redirect` serves the original — slower, never broken, never billed on the free plan.
- **`srcset` across both widths**, built by `srcsetFor(base, key)`, with `width`/`height` from the
  manifest so the card reserves its box and does not jump.

Sync validates every source before uploading anything: exists, readable, shortest edge ≥ 1200px
(`MIN_IMAGE_EDGE`), aspect ≤ 3:1, no two players sharing a file. It is idempotent — unchanged hashes
are skipped.

The minimum sits below the 1600 display width on purpose. Many of the best freely licensed photos of
pre-2005 players are 1200–1600px, and rejecting them would push those legends onto the monogram. A
1200px source covers the 800w rendition with room to spare, so phones stay sharp; the 1600w
rendition uses `fit=scale-down`, which never enlarges, so a smaller original is served at its own
size rather than upscaled — slightly soft on a large retina screen, acceptable for a darkened
background layer.

### Image prefetch — requirement, not optimisation

**Player images must never be fetched at reveal time.** That would put a second round trip inside
the same 640ms window and is the one thing that would actually make the game feel slow.

Images are _display_ data, and the next round's display payload arrives with the current answer.
So:

1. **The moment a round response lands, preload the one new card's image** — the next challenger.
   Each response introduces exactly one new player: the next round's anchor is the challenger just
   revealed, already on screen with its image loaded. Preload the same URL the `srcset` will pick
   (same `srcset` and `sizes`), or the browser fetches twice. The player spends several seconds
   thinking while the fetch completes, and the image is in cache before it is needed.
2. **Serve R2 through a custom domain**, never `r2.dev` — it is rate-limited and unsupported for
   production, and Transformations need a hostname on the zone.
3. **Resized at the edge, not HD originals.** An 800w AVIF of a portrait is typically well under
   100KB.
4. **Immutable cache headers with hashed keys.** A returning player accumulates most of the deck
   locally over a few sessions.

### Degradation

- The **3s timer grace** (section 8) absorbs slow rounds so a laggy connection does not cost the
  player their run.
- **Bank and end** covers a genuine drop.
- There is **no offline mode**. Friendly gave that up when it moved behind the endpoint, which was
  the price of not shipping the deck to every browser.

Honest summary: Ranked and Endless need a working connection at roughly 50–150ms typical, and the
animation hides it. They will feel sluggish on genuinely poor mobile, which is what the grace window
and banking exist for.

---

## 10. D1 schema

```sql
CREATE TABLE scores (
  id           TEXT PRIMARY KEY,
  mode         TEXT NOT NULL,          -- 'ranked' | 'endless'
  game_no      INTEGER NOT NULL,
  nickname     TEXT NOT NULL,
  nickname_normalised TEXT NOT NULL,
  streak       INTEGER NOT NULL,
  elapsed_ms   INTEGER NOT NULL,       -- tiebreaker only
  device_hash  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  name_flagged INTEGER DEFAULT 0,      -- retire a name without deleting the score
  shadow       INTEGER DEFAULT 0       -- excluded from public board, player still sees it
);
CREATE UNIQUE INDEX idx_ranked_name ON scores (game_no, nickname_normalised)
  WHERE mode = 'ranked';
CREATE INDEX idx_board ON scores (mode, game_no, streak DESC, elapsed_ms ASC);

CREATE TABLE ranked_attempts (
  device_hash TEXT NOT NULL,
  game_no     INTEGER NOT NULL,
  PRIMARY KEY (device_hash, game_no)
);

CREATE TABLE error_reports (
  id TEXT PRIMARY KEY, player_id TEXT, stat TEXT, note TEXT,
  created_at INTEGER NOT NULL, ua TEXT
);
```

`device_hash` is a salted hash of a first-party random id in localStorage plus coarse request
signals. It is **friction, not identity** — clearing storage resets it. Log how often a device
requests a second Ranked run; if that number is high, accounts need bringing forward.

---

## 11. KV

`board:ranked:<gameNo>` and `board:endless:<gameNo>` hold the top 100 as prebuilt JSON. Rebuilt on
write when a submission lands in the top 100, otherwise on a short TTL. D1 stays out of the read
path entirely — the board is the same for everyone, so it should be served from cache.

---

## 12. Abuse surface

- **Turnstile** on run start and on submission.
- **Rate limits** per device and per IP: Endless run starts, submissions, error reports.
- **Friendly (`/api/round/next`)** is limited by two Workers Rate Limiting bindings, keyed on the
  IPv4 address or the IPv6 /64 (a subscriber is usually handed a whole /64 and could otherwise
  rotate through it): `ROUND_BURST` **20 per 10s** and `ROUND_SUSTAINED` **90 per 60s**. A fast
  honest player makes about one request every two seconds, nearer one a second with reduced
  motion, so neither is visible in play. Over the limit is `429` with `retry-after`, and the UI shows
  a calm "slow down" state rather than ending the run. Cloudflare advises against IP keys because
  addresses are shared (CGNAT, offices); a stateless endpoint has nothing else to key on, which is
  why the numbers are generous. Counters are per location and approximate — a speed bump that makes
  reconstructing the deck take many IP-hours, not a wall. The numbers live in `wrangler.toml` and
  are mirrored by `RATE_LIMITS` in `worker/src/rate-limit.ts`; a test fails if they drift.
- **Nicknames:** default to a generated name (adjective + football noun + number); most people keep
  the suggestion, which shrinks the moderation surface to the minority who type their own.
  Validation normalises first — strip zero-width characters, fold unicode homoglyphs to ASCII,
  collapse repeated characters — _then_ checks the blocklist. A raw blocklist is defeated by
  leetspeak in a day.
- **Nickname uniqueness is per game, Ranked only.** A unique index on
  `(mode, game_no, nickname_normalised)` where `mode = 'ranked'`. A taken name returns `409` and the
  UI asks for another. Uniqueness resets at rollover, so no name is ever owned and no account system
  is implied. Endless has no uniqueness constraint.
- **Endless submissions are unlimited but rate-limited** — Endless keeps the best single submitted
  run per device per game, so honest players submit rarely. The cap should be one abusers hit and
  normal players never notice; set the numbers when the endpoint is built.
- **Shadow-flagging, not blocking.** A flagged score submits and is quietly excluded from the
  public board. Visible rejection just tells a cheater to iterate.

### Telemetry signals (Workers Analytics Engine)

Log per round: stat, gap band, round number, server-measured elapsed time, correctness. This gives
you both the anti-cheat signals and the ramp-tuning data from one pipeline.

Bot detection is **behavioural, not structural** — the stats are public facts, so a script with its
own copy of the data can always answer correctly. What it cannot easily fake is human timing
variance. A run of sub-400ms answers at the 30% gap band is not a person. Perfect accuracy at the
knife-edge bands is a second signal.

---

## 13. Cron triggers

- **00:00 UTC** — roll over `gameNo`, snapshot the closing boards, warm the new day's KV keys.
- **Hourly** — prune `ranked_attempts` older than a few days; recompute weekly aggregates.

---

## 14. Frontend

**Astro** prerenders the shell, the about page, the board pages and the
`/football-higher-or-lower` SEO page. **Svelte** hydrates one island: the game.

- The game island is `client:load`, not `client:visible` — it is above the fold and the first
  interaction must not wait on an intersection observer.
- `packages/core` holds all game logic; Svelte components render state and nothing more.
- **Port the prototype's CSS as-is.** It is plain CSS with custom properties. Rewriting it into a
  utility framework would cost days and guarantee visual drift, and `DESIGN.md` §12 requires the
  look to match.
- Local leaderboard lives in `localStorage`, wrapped in try/catch, and works with no network.
- The reveal count-up (~640ms) is what masks the round trip — see section 9 for the full budget,
  the hold-don't-snap rule, and the image prefetch requirement.

---

## 15. Testing

- **Unit:** `packages/core` under Vitest. The PRNG, ramp, tie exclusion and eligibility rules are
  pure functions and should be covered properly. Cover the relaxation path explicitly: ceiling
  first, then floor, then the seen queue, never tie exclusion.
- **Determinism:** the same seed must produce an identical sequence in the browser, the Worker and
  Node. Assert this explicitly; it is the foundation of Daily Ranked.
- **Simulation:** 10,000-run harness producing `simulation.md`. Run it on every deck change.
- **Worker, Phase 3:** vitest in Node. Handler logic is pure functions (request → response, given
  deck, secret and clock), and routing is tested through `createApp` with mocked bindings. The
  **response-shape test** walks many complete runs and asserts no response carries a hidden value or
  any part of a `Player`, with `scanForLeakedValues` as a backstop.
- **Worker, Phase 5:** Miniflare/workerd integration tests covering token forgery, replay, timer
  expiry and the ranked one-attempt rule, and the determinism test run under workerd.
- **Latency:** test the reveal under artificial delay (0ms, 200ms, 800ms, 3s). The count-up must
  hold and settle rather than snap or freeze, and no image fetch may occur inside the reveal window.

---

## 16. Cost

Static asset requests are unbilled. At 10,000 plays a day averaging a dozen questions you are
around 120k Worker requests daily plus the same in DO messages — one of each per question, since
the answer and the next round's display payload travel in a single response — just past the free tier and well
inside the $5/month plan's included requests. D1 and KV usage at this scale is negligible. R2
storage for ~300 originals is a few hundred MB, inside the free 10GB, and R2 egress is free. Image
Transformations use ~600 of the free 5,000 unique transformations a month. Verify
current numbers against Cloudflare's pricing page before launch.

---

## 17. Build order

Note that **images are v1 scope**, and licence verification across ~400 players is a long pole in
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

Ranked and Endless ship together once the round protocol, Durable Object, D1 schema and moderation
are complete.

---

## 18. Deferred

- **Accounts.** The real fix for the one-attempt rule and for cross-device history.
- **Multiplayer.** A Durable Object per lobby is the canonical pattern when it arrives; the DO
  namespace introduced here is a useful precedent.
- **Weekly and all-time boards**, Ranked only.

---

_Bigger Than — architecture, version 2._
