# BiggerThanGame

**A higher-or-lower game for football fans, where the stat keeps changing underneath you.**

[biggerthangame.com](https://biggerthangame.com)

---

## The idea

Two footballers, side by side. A wheel spins and lands on a stat — career goals, caps, Instagram
followers, highest transfer fee. One player's number is showing, the other is hidden. Higher or
lower? Get it right and the run continues.

The difference from every other game in this genre is that **the stat changes mid-run**. You beat
someone on caps, which primes you to think of them as a decorated international, and then the
question flips to Instagram followers and the veteran loses to a winger with a boot deal. The gap
between football importance and internet fame is the joke, and only a mixed-stat game can tell it.

Built for football fans, not casual quizzers. The deck assumes you know who Pirlo is.

---

## Status

**In development.** Friendly Mode ships first; ranked play and leaderboards follow.

|               |                       |
| ------------- | --------------------- |
| Friendly Mode | In progress           |
| Daily Ranked  | Not started           |
| Endless       | Not started           |
| Deck          | Being entered by hand |

---

## Modes

**Daily Ranked** — one fixed sequence per day, identical for every player worldwide, one attempt.
Because everyone faces the same cards, the score is a fair comparison. This is the competitive
board.

**Endless** — randomised sequence, unlimited attempts. Best single submitted run per day.

**Friendly** — no clock, no leaderboard, smaller pool, runs entirely in your browser. Exists partly
as a warm-up and partly because a 10-second timer excludes players with motor or cognitive
impairments.

All three modes use one life. One wrong answer ends the run.

---

## The stats

| Stat                   | Definition                                                                    |
| ---------------------- | ----------------------------------------------------------------------------- |
| Career goals           | Senior career goals, club and country. Not applicable to goalkeepers.         |
| Caps                   | Senior international appearances only.                                        |
| International goals    | Senior international goals. Not applicable to goalkeepers.                    |
| Club appearances       | Senior club appearances, all competitions, all clubs.                         |
| Instagram followers    | Snapshot-dated. The date is shown on the card.                                |
| Highest transfer fee   | Largest single reported fee, shown with the year. **Not** inflation-adjusted. |
| World Cup appearances  | World Cup finals matches played.                                              |
| Club trophies          | See below.                                                                    |
| International trophies | Major international honours.                                                  |
| Clean sheets           | Goalkeepers and defenders only.                                               |
| Clubs played for       | Count of senior clubs.                                                        |
| Age                    | Computed from date of birth. Living players only.                             |

**Club trophies counts:** domestic leagues, domestic cups, continental competitions and cups
(Champions League, Europa League, Copa Libertadores and equivalents), and the Club World Cup.

**Club trophies does not count:** single-match trophies — Community Shield, UEFA Super Cup, domestic
super cups and equivalents.

Transfer fees are deliberately left un-adjusted. Football fees have risen far faster than consumer
prices, so a CPI adjustment would barely change any answer while implying a rigour it doesn't have.
The year is shown so you can judge for yourself.

---

## Stack

- **[Astro](https://astro.build)** — static site, prerendered
- **[Svelte](https://svelte.dev)** — the game island
- **[Cloudflare Workers](https://workers.cloudflare.com)** with static assets — one deployment for
  site and API
- **Durable Objects** — per-run state
- **D1** — leaderboards
- **KV** — cached board reads
- **R2** — player images
- Plain CSS with custom properties. No utility framework.

The game engine is framework-free TypeScript, so the same code runs in the browser, in a Worker and
in the Node test harness. That matters: server-side verification has to replay exactly what the
client played.

---

## Repo layout

```
packages/
  core/          framework-free TS — PRNG, matching engine, ramp, wheel
  deck/          schema, validation, build pipeline (data is a private submodule)
apps/
  web/           Astro + Svelte
worker/          fetch handler, Durable Object, token signing
```

**The deck data lives in a private repository.** Ranked play is server-authoritative — the hidden
value is never sent to your browser before you guess — and publishing the dataset would make that
pointless. The schema, the validation and the engine that consumes it are all here; only the numbers
are not.

---

## Running it locally

```bash
pnpm install
pnpm dev          # Friendly Mode against the sample deck
pnpm test         # unit tests
pnpm simulate     # 10k-run difficulty simulation
pnpm build
```

A small sample deck is included so the game runs without access to the private data repo.

`pnpm simulate` is the interesting one — it runs the real engine ten thousand times and reports the
streak distribution and how often each stat actually fires after tie exclusion and gap filtering.
That's how the difficulty curve gets tuned, rather than by guessing.

---

## Found a wrong number?

Please tell us. There's a report link on the game-over screen, or open an issue.

Include the player, the stat, the correct value and a source. Every figure in the deck carries its
own source and a date it was checked, so a correction with a citation can be verified and applied
quickly. Corrections take effect at the next daily rollover — never mid-game, since that would shift
the sequence under players partway through.

Some figures are genuinely contested (career goals totals for older players especially). Where
sources disagree, the deck follows one named source consistently rather than picking the most
flattering number.

---

## Design docs

The full design and architecture documents are in this repo:

- **[DESIGN.md](DESIGN.md)** — what the game is. Modes, stats, the difficulty ramp, the matching
  engine, and a record of decisions with the reasoning behind them.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how it's built. Deployment, the round protocol, the
  latency budget, anti-cheat.

They're public because a documented design is a better design, and because the anti-cheat model
should hold whether or not it's written down. If it only works while it's secret, it doesn't work.

They also record _why_ decisions went the way they did, which is the part that usually gets lost.

---

## Contributing

**Issues only — code contributions aren't being accepted.**

Corrections, bug reports and suggestions are genuinely welcome and the fastest way to make the game
better. Please open an issue.

Pull requests will be closed unread, and that's not unfriendliness. Accepting code means the
contributor keeps copyright in their work, which tangles the licensing of a project that may become
commercial. Rather than run a contributor agreement for a project this size, the simpler answer is
to keep the code mine and the conversation open.

The deck isn't open to contributions either, for the reason above — though corrections to it are
very welcome via an issue.

---

## Images

Player photography is used under free licences only — Creative Commons or public domain, verified
per image. Author, licence and source are recorded for every one, and the full list is on the
[credits page](https://biggerthangame.com/credits).

No club badges, crests or kit marks: those are trademarks, and a photo licence doesn't cover them.

Players without a usable free image get a typographic card instead. That's a licensing constraint
turned into a design decision, and it tends to fall on the oldest legends, where it reads as an era
signal.

If you're a rights holder and something here shouldn't be, open an issue or email and it'll be
removed.

---

## Licence

Code is **source-available, not open source**:
[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/).

In short: read it, learn from it, run it, modify it, share it — for any **noncommercial** purpose.
Commercial use is not permitted. If you want to do something commercial with it, ask.

The deck data is not covered by this licence and is not distributed here. Images remain under their
own licences — see the [credits page](https://biggerthangame.com/credits).

_Not legal advice; read the licence itself rather than this summary._

---

## Colophon

Type is [Archivo](https://fonts.google.com/specimen/Archivo) and
[Cinzel](https://fonts.google.com/specimen/Cinzel). The look is meant to be a floodlit pitch at
night: deep teal, chalk lines, scoreboard gold.
