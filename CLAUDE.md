# CLAUDE.md

Working notes for Claude Code in this repo.

**This file is about how to work here. It is not the spec.**

- **[DESIGN.md](DESIGN.md)** — what the game is. Modes, stats, ramp, matching engine, decisions.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how it's built. Deployment, round protocol, latency,
  anti-cheat.

Read both before starting anything non-trivial. Where this file and those disagree, **they win** —
except on the invariants below, which are repeated here precisely because they're easy to break by
accident.

---

## Hard invariants

Breaking any of these silently breaks the leaderboard. They are not preferences.

1. **The client never receives a stat value it hasn't already been shown.** `deck.public.json` is
   names and nationalities only. The one exception is `deck.friendly.json`, which carries full
   values for the ~80–100 player Friendly pool because that mode runs entirely in the browser.
   Nothing outside that pool may ever reach a client bundle.
2. **Never prefetch hidden values** — not one round ahead, not ever. Display data (names, images)
   _must_ be prefetched; values must not.
3. **The round sequence is a pure function of the seed** and must not depend on player answers.
   This is what makes Daily Ranked identical for everyone and lets the server recompute any round.
4. **A progress token is spent once.** The Durable Object nonce check is what prevents replay. Do
   not "optimise" it away — without it a player can resubmit a round with the other answer.
5. **Seeded PRNG only.** `Math.random` anywhere in `packages/core` is a bug.
6. **Never fetch an image at reveal time.** See ARCHITECTURE.md §9.
7. **The server owns the clock.** Client-reported timings are telemetry, never trusted.

If a change seems to require breaking one of these, stop and ask.

---

## Commands

```bash
pnpm dev          # Friendly Mode against the sample deck
pnpm test         # unit tests (vitest)
pnpm simulate     # 10k-run difficulty simulation → simulation.md
pnpm build        # validates deck, emits artifacts, builds site
pnpm typecheck
```

`pnpm build` fails on invalid deck data by design. A failing build usually means a data problem,
not a code problem — read the error before changing code.

---

## Layout and boundaries

```
packages/core/    framework-free TypeScript. The game.
packages/deck/    schema, validation, build pipeline. Data is a private submodule.
apps/web/         Astro + Svelte
worker/           fetch handler, Durable Object, token signing
```

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
- Worker changes get Miniflare/workerd tests covering token forgery, replay, timer expiry and the
  ranked one-attempt rule.
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

Friendly Mode ships first — client-side, clock-free, leaderboard-exempt. It needs `packages/core`,
the Astro shell and the Svelte island, and none of the round protocol, Durable Object, D1 or KV.
Don't build backend machinery until Friendly Mode is done.

---

## Data

The deck is a **private submodule**; a small sample deck is committed so the repo runs standalone.

Every figure carries `source` and `as_of`. Never add a number without both — the build rejects it,
and the provenance is what makes corrections tractable when someone disputes a value.

Figures in the original HTML prototype are approximate and from memory. **Do not copy them into the
deck.** They exist to test the feel of the game, nothing else.

---

## Commits

Small and focused. Conventional prefixes (`feat:`, `fix:`, `chore:`, `docs:`). If a change alters
game behaviour, say which DESIGN.md section it implements or changes.

**If you change game behaviour, update DESIGN.md in the same commit.** The docs being accurate is
what makes them worth reading.
