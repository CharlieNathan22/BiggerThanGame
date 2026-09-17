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

**Bindings:** `ASSETS`, `DB` (D1), `BOARDS` (KV), `RUNS` (Durable Object namespace), `IMAGES` (R2,
served through a custom domain), `RUN_SECRET` (secret), `TURNSTILE_SECRET` (secret).

---

## 3. Repo structure

```
/
├── packages/
│   ├── core/              # framework-free TS — the game
│   │   ├── prng.ts        # seeded PRNG (xoshiro128**), never Math.random
│   │   ├── engine.ts      # matching engine, eligibility, tie exclusion
│   │   ├── ramp.ts        # gap bands by round, relaxation order
│   │   ├── wheel.ts       # tier-weighted stat selection, correlated-pair exclusion
│   │   ├── sequence.ts    # deterministic round sequence from a seed
│   │   └── types.ts
│   └── deck/
│       ├── data/          # private submodule: player YAML + image originals
│       ├── schema.ts      # Zod schema
│       └── build.ts       # validation + precompute → artifacts
├── apps/web/              # Astro + Svelte
├── worker/
│   ├── index.ts           # fetch handler, routing
│   ├── run-do.ts          # Durable Object
│   ├── token.ts           # sign / verify progress tokens
│   └── deck.full.json     # generated, bundled into the Worker
├── wrangler.toml
├── DESIGN.md
└── ARCHITECTURE.md
```

`packages/core` must not import anything browser- or Worker-specific. It is pure logic.

---

## 4. The invariants

These four are what make the leaderboard defensible. Everything else is negotiable.

1. **The client never receives a stat value it has not already been shown.** `deck.public.json`
   contains names and nationalities only — no numbers.
   The sole exception is `deck.friendly.json`, which carries full values for the Friendly pool
   (~80–100 players) because that mode runs entirely in the browser. **Nothing outside the Friendly
   pool may ever appear in a client bundle.** The build must assert this.
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

One YAML file per player, in the private submodule at `packages/deck/data/players/`:

```yaml
id: zidane-zinedine
name: Zinedine Zidane
country: France
position: MF # GK | DF | MF | FW  — drives the goals-stat exclusion
dob: 1972-06-23
deceased: false
friendly: true # in the client-side Friendly pool — full values ship publicly
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
  file: zidane-2008.jpg # original, under packages/deck/images/
  author: "Jane Smith"
  licence: CC-BY-4.0 # CC-BY-* | CC-BY-SA-* | CC0 | PD
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

---

## 6. Build pipeline

`packages/deck/build.ts` runs before the Astro build and emits:

| Artifact               | Destination         | Contents                                                |
| ---------------------- | ------------------- | ------------------------------------------------------- |
| `deck.full.json`       | bundled into Worker | ids, all stat values, eligibility                       |
| `deck.public.json`     | shipped to client   | id, name, country only — **all** players                |
| `deck.friendly.json`   | shipped to client   | full stat values, **Friendly pool only**                |
| `indexes.json`         | Worker              | per stat: players sorted by value, tie groups           |
| `img/<id>-<hash>.webp` | uploaded to R2      | derivative at display size                              |
| `credits.json`         | shipped to client   | author, licence and source per image                    |
| `viability.md`         | repo, committed     | per stat and gap band, how many valid pairs exist       |
| `simulation.md`        | repo, committed     | streak distribution and stat firing rates over 10k runs |

The build **fails** on: a stat value that is negative or non-numeric; a `club_goals` or `igoals`
value on a goalkeeper; an `ig` entry without `as_of`; a `fee` entry without `year`; an unknown stat
key; a duplicate id; a player with fewer than three eligible stats.

It also fails if an `image` block is missing any of `author`, `licence` or `source`, or if the
licence is not on the allow-list. Stats no longer carry provenance, so this is the **only** remaining
provenance guard in the pipeline — which makes it the one that matters. A player with no `image`
block is valid and renders the monogram fallback.

It also fails if `deck.friendly.json` contains any player not flagged `friendly: true`, or if the
Friendly pool exceeds its configured size. This is the guard on the one deliberate data-exposure
path in the system.

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
seed(ranked,  gameNo) = HMAC-SHA256(RUN_SECRET, "ranked:"  + gameNo)
seed(endless, runId) = HMAC-SHA256(RUN_SECRET, "endless:" + runId)
```

Ranked's seed depends only on the game number, so **every player gets the same sequence** — that is what
makes the board comparable. Endless is per-run.

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
  mode: "ranked" | "endless" | "friendly";
  gameNo: number;
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

Originals live in `packages/deck/images/`, committed. The build produces derivatives — **WebP and
AVIF at display size, 30–50KB**, content-hashed filenames — and uploads them to R2. Transformation
happens at build time, not per request: the deck changes twice a year, so on-the-fly resizing would
be paying repeatedly for work done once.

R2 is served through a **custom domain** so Cloudflare's CDN caches at the edge. Hashed filenames
allow immutable cache headers, so a returning player accumulates the deck locally.

### Image prefetch — requirement, not optimisation

**Player images must never be fetched at reveal time.** That would put a second round trip inside
the same 640ms window and is the one thing that would actually make the game feel slow.

Images are _display_ data, and the next round's display payload arrives with the current answer.
So:

1. **The moment a guess response lands, preload the next two cards' images.** The player then spends
   several seconds thinking while the fetch completes in the background, and the image is in cache
   before it is needed.
2. **Serve R2 through a custom domain** so Cloudflare's CDN caches at the edge rather than hitting
   the bucket on every request.
3. **WebP or AVIF at display size, 30–50KB per image** — not HD originals.
4. **Immutable cache headers with hashed filenames.** A returning player accumulates most of the
   deck locally; 400 players at 40KB is roughly 16MB total, which builds up over a few sessions.

This holds regardless of whether images ship in v1 — it is the constraint that makes adding them
later safe.

### Degradation

- The **3s timer grace** (section 8) absorbs slow rounds so a laggy connection does not cost the
  player their run.
- **Bank and end** covers a genuine drop.
- **Friendly Mode is entirely local**, so there is always a mode that works with no connection.

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
- **Worker:** Miniflare/workerd integration tests covering token forgery, replay, timer expiry and
  the ranked one-attempt rule.
- **Latency:** test the reveal under artificial delay (0ms, 200ms, 800ms, 3s). The count-up must
  hold and settle rather than snap or freeze, and no image fetch may occur inside the reveal window.

---

## 16. Cost

Static asset requests are unbilled. At 10,000 plays a day averaging a dozen questions you are
around 120k Worker requests daily plus the same in DO messages — one of each per question, since
the answer and the next round's display payload travel in a single response — just past the free tier and well
inside the $5/month plan's included requests. D1 and KV usage at this scale is negligible. Verify
current numbers against Cloudflare's pricing page before launch.

---

## 17. Build order

Note that **images are v1 scope**, and licence verification across ~400 players is a long pole in
its own right — see `DESIGN.md` §13. Friendly Mode can ship with images for its pool only, which is
a far smaller verification job and validates the pipeline early.

**Friendly Mode first**, shipped publicly on its permanent 80-to-100 player pool. It is
client-side, clock-free and leaderboard-exempt, so it needs none of sections 7 to 12 —
`packages/core`, the Astro shell and the Svelte island only. The Worker never executes; Astro
builds, Workers serves the files. Nothing about it is rework: when the backend lands, Friendly Mode
keeps running exactly as built.

That gets feedback on feel and comprehension while the two long poles — hand-entering the deck and
building the server-authoritative stack — proceed in parallel. It does **not** validate the
difficulty ramp; see `DESIGN.md` §3. Ramp tuning comes from `simulation.md` run against the full
deck, which is independent of what ships to the client.

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
