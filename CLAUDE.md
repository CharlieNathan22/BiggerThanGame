# CLAUDE.md

Working notes for Claude Code in this repo.

**This file is about how to work here. It is not the spec.**

- **[DESIGN.md](docs/DESIGN.md)** — what the game is. Modes, stats, ramp, matching engine,
  decisions.
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how it's built. Deployment, round protocol, latency,
  anti-cheat.

Read both before starting anything non-trivial. Where this file and those disagree, **they win** —
except on the invariants below, which are repeated here precisely because they're easy to break by
accident.

---

## Hard invariants

Breaking any of these silently breaks the leaderboard. They are not preferences.

1. **The client never receives a stat value it hasn't already been shown. No exceptions.** No
   client-bound deck artifact exists: every mode, Friendly included, gets player data per question
   from `/api/round/next`. `apps/web` never imports `@bt/deck`, `deck.full.json` or anything under
   `packages/deck/{dist,data}` (ESLint enforces it; the leak scan of the built site is the
   backstop). Round responses are explicitly declared DTOs — never return a `Round`, whose
   `anchor` and `challenger` are full `Player` objects.
2. **Never prefetch hidden values** — not one round ahead, not ever. Display data (names, images)
   _must_ be prefetched; values must not.
3. **The round sequence is a pure function of the seed** and must not depend on player answers.
   This is what makes Daily Ranked identical for everyone and lets the server recompute any round.
4. **A progress token is spent once** (Phase 5, Ranked and Endless; Friendly issues no token).
   The Durable Object nonce check is what prevents replay. Do not "optimise" it away — without it a
   player can resubmit a round with the other answer.
5. **Seeded PRNG only.** `Math.random` anywhere in `packages/core` is a bug.
6. **Never fetch an image at reveal time.** See ARCHITECTURE.md §9.
7. **The server owns the clock.** Client-reported timings are telemetry, never trusted.

If a change seems to require breaking one of these, stop and ask.

---

## Commands

```bash
pnpm dev          # the site (Astro dev server)
pnpm dev:api      # builds the deck, then the Worker on :8787 (wrangler dev, secret from .dev.vars)
pnpm test         # unit tests (vitest) — core, deck and Worker
pnpm simulate     # 10k-run difficulty simulation → simulation.md
pnpm build        # validates deck, emits artifacts, builds site (sample deck allowed)
pnpm build:prod   # same, but refuses the sample deck — production and deploy only
pnpm typecheck    # needs the deck artifacts: run a deck build first on a clean checkout
pnpm lint
```

`pnpm build` fails on invalid deck data by design. A failing build usually means a data problem,
not a code problem — read the error before changing code.

---

## Layout and boundaries

```
packages/core/    framework-free TypeScript. The game.
packages/deck/    schema, validation, build pipeline. Data is a private submodule.
apps/web/         Astro + Svelte
worker/           fetch handler and /api/round/next; Durable Object and tokens arrive in Phase 5
```

**The Worker bundles the deck from `packages/deck/dist` via `worker/src/deck.ts` and nothing else.**
It never imports `@bt/deck` at runtime — that package reads files with `node:fs`. `@bt/deck` is for
Worker tests only. Handler logic lives in pure functions under `worker/src/`; `worker/index.ts` is
wiring.

**`packages/core` imports nothing browser- or Worker-specific.** No `window`, no `fetch`, no
Cloudflare types. It runs in three places — browser, Worker, Node tests — and server-side
verification depends on it behaving identically in all of them. If you need a platform API, it
belongs in `apps/web` or `worker/`.

**Svelte components render state and nothing more.** Game logic lives in `core`. If you're writing
an `if` about game rules inside a `.svelte` file, it's in the wrong place.

---

## Conventions

- **Plain CSS with custom properties. Do not introduce Tailwind or any utility framework.** The
  visual design is ported from a prototype and must match it; converting the styling would
  guarantee drift. See DESIGN.md §12.
- TypeScript strict mode. No `any` without a comment explaining why.
- Prefer pure functions in `core` — they're the ones under test and under simulation.
- No new dependencies in `packages/core` without asking. It should stay dependency-free.

---

## Testing expectations

- Anything in `core` gets unit tests. The PRNG, ramp bands, tie exclusion, eligibility and
  relaxation order are pure and should be covered properly.
- **Determinism is a test, not an assumption.** The same seed must produce an identical sequence in
  browser, Worker and Node. Assert it.
- Worker changes get tests. In Phase 3 they are vitest in Node against the pure handler functions
  and `createApp` with mocked bindings — including the response-shape test, which must never be
  weakened. **Miniflare/workerd tests arrive in Phase 5**, covering token forgery, replay, timer
  expiry and the ranked one-attempt rule, and the determinism test runs under workerd there.
- Run `pnpm simulate` after any change to the deck, the ramp or the wheel, and mention what moved.

---

## Ask, don't guess

DESIGN.md §15 lists the genuinely open questions. If a task touches one, ask rather than picking a
default and moving on — a plausible guess that gets built is harder to undo than a question.

Also ask before:

- adding a stat, or changing a stat's tier or definition
- changing the ramp bands or the wheel weighting
- anything that would put deck values in a client bundle
- adding a dependency to `packages/core`
- changing the visual design

---

## Don't build these

DESIGN.md §16 and ARCHITECTURE.md §18 list deferred scope. In particular: **multiplayer, other
sports, current players, accounts, weekly and all-time boards.** They're deferred deliberately, not
overlooked. Don't scaffold them speculatively.

---

## Build order

Friendly Mode ships first — clock-free, leaderboard-exempt, on the full deck. It needs
`packages/core`, the Astro shell, the Svelte island, and **one stateless, rate-limited endpoint**
(`POST /api/round/next`). It needs none of the Durable Object, D1, KV, progress tokens or
Turnstile. Don't build that enforcement machinery until Friendly Mode is done; Phase 5 hardens
`/api/round/next` in place rather than replacing it.

---

## Data

The deck is a **private submodule**; a 24-player sample of invented players is committed so the
repo runs standalone. The private deck is used only once it holds **`MIN_PRIVATE_DECK` (30)**
schema-valid players; until then dev and CI fall back to the sample and say so in the build log.
Production builds (`pnpm build:prod`, the deploy script, `deploy.yml`) pass `--require-private` and
fail instead, so invented players can never go live. `images:sync` ignores the minimum and uses the
private deck whenever it has any player files.

**Decks are organised by type.** `DECK` (`"legends"`, in `packages/deck/src/load.ts`) scopes every
path: `packages/deck/data/legends/{players,originals,images.json,image-log.csv}` in the submodule
and `packages/deck/sample/legends/players/` in the sample. R2 keys are
`legends/originals/<id>.<hash16><ext>`, so the same person in two decks can't collide. Use the
path helpers (`deckDirFor`, `imagesDirFor`, `manifestPathFor`) rather than joining paths by hand.
Only one deck exists; don't build deck selection until a second one is actually needed. **Never
create or edit files inside the `packages/deck/data` submodule from this repo.**

Stat figures are plain numbers with no per-stat source (DESIGN.md §11). Instagram followers carry
`as_of` and the transfer fee carries `year`, because both are shown on the card. **Images keep full
provenance** — `author`, `licence` and `source` are required, and the build rejects an image block
without them.

Image size is checked by `images:sync` on the **shortest edge**: under `MIN_IMAGE_EDGE` (800px) the
sync fails; from 800 up to `RECOMMENDED_IMAGE_EDGE` (1200px) the image passes but is listed as a
warning to upgrade. Warnings never fail the sync. See ARCHITECTURE.md §9.

Figures in the original HTML prototype are approximate and from memory. **Do not copy them into the
deck.** They exist to test the feel of the game, nothing else.

---

## Commits

Small and focused. Conventional prefixes (`feat:`, `fix:`, `chore:`, `docs:`). If a change alters
game behaviour, say which DESIGN.md section it implements or changes.

**If you change game behaviour, update DESIGN.md in the same commit.** The docs being accurate is
what makes them worth reading.
