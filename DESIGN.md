# Bigger Than — Design Document

**Version 2** · biggerthangame.com · Football legends · September 2026

A higher-or-lower streak game for football fans, where the stat keeps changing underneath you.

> **For Claude Code:** this is the authoritative spec for v1. Where this document and existing
> code disagree, this document wins unless the code comment cites a later decision. Section 15
> lists genuinely undecided questions — ask rather than guessing. Section 16 lists things that
> are deliberately out of scope; do not build them speculatively.
>
> Infrastructure, data pipeline, API design and anti-cheat implementation live in
> `ARCHITECTURE.md`. This document covers what the game *is*, not how it is served.

---

## Contents

1. [What it is](#1-what-it-is)
2. [Scope of version 1](#2-scope-of-version-1)
3. [Game modes](#3-game-modes)
4. [Core loop](#4-core-loop)
5. [The stats](#5-the-stats)
6. [Tiers and colour](#6-tiers-and-colour)
7. [The wheel](#7-the-wheel)
8. [Difficulty ramp](#8-difficulty-ramp)
9. [Timer and scoring](#9-timer-and-scoring)
10. [Matching engine](#10-matching-engine)
11. [Data model](#11-data-model)
12. [Visual direction](#12-visual-direction)
13. [Sharing and leaderboards](#13-sharing-and-leaderboards)
14. [Decisions and reasoning](#14-decisions-and-reasoning)
15. [Open questions](#15-open-questions)
16. [Deliberately not building](#16-deliberately-not-building)

---

## 1. What it is

Two footballers are shown side by side. A wheel spins and lands on a stat — goals, caps,
Instagram followers, club appearances and others. One player's number is visible, the other is
hidden. Guess whether the hidden one is higher or lower, and keep the run alive.

The difference from every other game in this genre is that **the stat changes mid-run**. You beat
someone on caps, which primes you to think of them as a decorated international, and then the
question flips to Instagram followers and the veteran loses to a winger with a boot deal. The gap
between football importance and internet fame is the joke, and only a mixed-stat game can tell it.

Audience is football fans, not casual quizzers. That's a deliberate narrowing — it means the deck
can include Pirlo, Casillas and Cannavaro without apology.

---

## 2. Scope of version 1

- **Football only.** The name allows expansion to other sports later; v1 does not attempt it.
- **Legends only.** Retired players have frozen data — caps, goals, trophies and transfer fees
  never change again. This removes almost the entire data-refresh burden.
- **Single player.** Multiplayer is on the roadmap but not until single-player retention is proven.
- **Two modes**, both with one life. See section 3.
- **Player photography ships in v1.** Stats are facts and not copyrightable; photos are. Every
  image must be freely licensed (Wikimedia Commons or equivalent), verified per image, and
  attributed. **Club badges and kit crests stay out** — those are trademarks, and a free photo
  licence does not cover them.

Two exceptions to frozen data survive. Instagram followers still creep up, though slowly enough
that reorderings are rare. And age changes on birthdays — so **store date of birth and compute age
at runtime** rather than storing a number that silently goes stale.

---

## 3. Game modes

Both modes share the same deck, matching engine, ramp and stat set. They differ in sequence,
attempts and what the leaderboard claims.

### Daily Ranked

- **One fixed sequence per day**, identical for every player worldwide.
- **One attempt.** Once the run ends, that's the day's score.
- Rollover is **00:00 UTC**. Puzzles are labelled **"Game 123", never by date** — a date label
  disagrees with the local calendar for anyone west of UTC, where rollover lands the previous
  evening. Show a countdown to the next game rather than a clock time.
- A run belongs to the game it was minted against, so a run started at 23:58 UTC finishes on
  that game's board. The sequence never changes mid-game.
- Server-authoritative: the hidden value is never sent to the client before the guess.
- This is the competitive board. Because everyone faces the same cards, the score is a fair
  comparison — which is the whole point of ranking it.

**One attempt is not fully enforceable without accounts.** Until accounts exist, it rests on a
signed device-day token plus Turnstile, which stops the casual retry but not someone clearing
storage. That is friction, not prevention, and the doc should stay honest about it.

### Endless Casual

- **Randomised sequence**, unlimited attempts, play as much as you like.
- Same server-authoritative protection as Daily Ranked.
- Leaderboard is **best streak, reset daily**, and is presented as a personal-best board rather
  than a ranking.

### Friendly Mode

Same randomised sequence style as Endless, minus the clock, the leaderboards and the anti-cheat.
Fully client-side. It exists for two reasons: a hard 10-second clock excludes players with motor or
cognitive impairments, and it gives a low-stakes way to learn the game. Because it can never be
ranked, there is no incentive to abuse it, so it needs no protection.

One life still applies.

**Friendly Mode draws from a permanently smaller pool** — roughly the 80 to 100 most recognisable
names — and that subset is the only part of the deck that ever ships to the browser. Ranked and
Endless use the full deck, held server-side and revealed one anchor value at a time.

The reason is exposure. A client-side mode publishes its entire dataset: permanently, scrapeable,
archived. That matters more than "the stats are public facts" — public facts are not the problem,
*our specific values* are. A bot working from Wikipedia might disagree with the deck on a 35% call
and get it wrong; a bot working from our shipped deck never does. Slow reconstruction through normal
play is unavoidable; handing the whole thing over on day one is not.

Framing it as a permanent warm-up pool rather than a temporary restriction means Friendly Mode never
has to move behind the API later.

### Launch order

**Friendly Mode ships first**, publicly, on its permanent 80-to-100 player pool. It is client-side
and leaderboard-exempt by design, so nothing about it needs reworking when the backend lands.

**What this does and does not tell you.** Friendly Mode gives real feedback on feel, comprehension,
the stat switch and whether people share it. It is **not** a reliable test of the difficulty ramp:
a pool that small exhausts the later bands quickly and will sit permanently in relaxation past the
mid rounds. Ramp validation comes from `simulation.md` against the full deck, and then from Ranked
once it is live.

Daily Ranked and Endless follow together, once the backend is complete. Target deck at full launch
is around 400, with a couple of hundred entered early so simulation has something real to work
with.

### Why the framing differs

An endless leaderboard is structurally noisy *even with perfect anti-cheat*, because two players'
runs are not the same test — one gets a kind sequence, another gets three knife-edge pairs in a
row. It measures luck alongside knowledge and no amount of verification changes that. Daily Ranked
exists precisely to be the board where the number means something.

Do not present the Endless board as a fair contest. Copy should make the distinction obvious.

### Connectivity

Server-authoritative play means both modes need a connection for every question. Latency is covered
by the existing reveal animation (see section 4) and should not be perceptible on a decent
connection.

**Offline continuation is impossible by construction, not by policy.** The client does not hold the
next hidden value and nothing can supply it while the network is down. So the behaviour on a drop
is: **retry visibly for a few seconds, then bank and end.** Every round up to the drop is already
verified, so the player keeps the streak they earned and it submits when connectivity returns. The
tube-tunnel case is covered by the retry window, which is the case that actually happens.

This is also why **hidden values must never be prefetched**, not even one round ahead. Buffering
rounds for latency would put several readable answers in memory at all times, which is the exact
leak the server-authoritative model exists to close.

---

## 4. Core loop

1. Both players appear first, with names and nationality. **No stat is named yet.**
2. A beat passes, then the wheel spins and lands on a stat. The plaque takes the stat's tier colour.
3. The anchor player's value is revealed. The challenger's is hidden — and genuinely absent from
   the client, not merely hidden in the DOM.
4. A 10-second timer starts **after** the wheel lands.
5. Player picks higher or lower. The guess goes to the server; the reveal animation begins
   immediately on a scrambling number and settles when the real value arrives.
6. Correct → the challenger becomes the new anchor, a fresh challenger is dealt.
   Wrong → run over.

Showing the players before the stat is the load-bearing detail. If the stat lands first, people
evaluate the cards already knowing the question and the dissonance never happens.

The ~640ms count-up on reveal is what hides the network round trip. Keep it. Prefetch the next
card's *visible* data during the current round so the between-round transition stays instant.

### The winner does not stay on

The challenger **always** becomes the next anchor, regardless of whether it was higher or lower.

King-of-the-hill — keeping whichever player had the bigger number — was considered and rejected:
it ratchets upward until the anchor holds the largest value in the deck, at which point "guess
lower" becomes a winning strategy. Stat switching does not fix this, because the stats are
positively correlated: players with the most goals tend to also have the most caps, trophies and
followers, so the bias leaks across the switch.

---

## 5. The stats

Stats are judged on **range behaviour**, not on how interesting they sound. A wide-range stat has
big gaps between players, so a guess is a judgement. A narrow-range stat is a small integer where
most legends cluster on the same few values — which produces constant ties, and **a tie has no
right answer**.

| Stat | Tier | Definition | Eligibility |
|---|---|---|---|
| **Goals** | Basic | Senior career goals, club and country combined | Everyone except goalkeepers |
| **Caps** | Basic | Senior international appearances only | All |
| **Club appearances** | Basic | Senior club appearances, all competitions, all clubs | All |
| **Instagram followers** | Basic | Follower count, snapshot-dated | All with an account |
| **Highest transfer fee** | Uncommon | Largest single reported fee, shown **with the year** | All with a reported fee |
| **World Cup appearances** | Uncommon | Total World Cup finals matches played | All who qualified |
| **International goals** | Uncommon | Senior international goals | Everyone except goalkeepers |
| **Club trophies** | Rare | See definition below | All |
| **International trophies** | Rare | Major international honours | All |
| **Clean sheets** | Rare | Career clean sheets | Goalkeepers and defenders |
| **Clubs played for** | Rare | Count of senior clubs | All |
| **Age** | Rare | Computed from date of birth | Living players only |

**Never call anything but a senior international appearance a "cap" — fans will correct you.**

**International goals replaced World Cup goals.** World Cup goals had most of the deck clustered
between 0 and 5, so it lost pairs to tie exclusion constantly and rarely fired. International goals
spreads far wider — Klose on 71 down to a defender on single figures — and behaves like a workhorse.

It is kept at **uncommon** tier despite that range. Promoting it would give five basic stats, three
of which (goals, international goals, club appearances) all ask a variation of "how much did they
play and score". Keeping it uncommon stops the wheel landing on near-identical questions in
succession. `viability.md` may argue otherwise once the deck is populated.

Instagram followers is the signature stat: wide range, no ties, nearly everyone eligible. It
should fire often. Club appearances is the one wide-range stat goalkeepers keep, which is what
keeps them in the deck at all; it plays fair but flat, since few people have real intuitions about
appearance totals.

### Club trophies — the definition

Counts: **domestic leagues, domestic cups, and continental competitions and cups** (Champions
League, Europa League, Copa Libertadores and equivalents), plus the **Club World Cup**.

Does not count: **single-match trophies** — Community Shield, UEFA Super Cup, domestic super cups
and equivalents.

This rule must be published in the UI. It is the stat most likely to be argued with.

### Position

Every player carries a position flag: **goalkeeper, defender, midfielder, striker**. Position is
assigned by where the player spent the majority of their career, recorded explicitly as a field
with a note where the call is arguable (Lahm across both flanks, Ramos at centre-back and
right-back, converted midfielders). It is never derived at runtime.

Position drives stat eligibility today and gives room to extend it later.

### Clean sheets

Goalkeepers and defenders only. Defenders are those whose majority career position was LB, LWB,
CB, RB or RWB.

Clean sheets is a published stat for goalkeepers and is **not systematically tracked for outfield
defenders**. Defender figures are therefore **sourced manually, player by player**, like the rest of
the deck. Each figure must record the competition scope it covers in its `source` field so the stat
stays internally consistent, and the scope rule must be published in the UI alongside the
club-trophy rule.

### Cut, and why

- **Height** — nobody knows any player's height, so it isn't a knowledge test. It's a coin flip
  with a 50% chance of ending the run.
- **World Cup goals** — too many of the deck sat between 0 and 5, so tie exclusion gutted it.
  Replaced by international goals.
- **"International caps" as distinct from "Caps"** — the same stat under two names. Resolved to one.

---

## 6. Tiers and colour

Three tiers, three hues, readable in under a second on a phone.

| Tier | Colour | Roughly | Character |
|---|---|---|---|
| Basic | Gold `#FFC24D` | 70% of spins | Wide range, large pool, reliable |
| Uncommon | Blue `#5AB9F0` | 22% | Narrower, some tie exclusion |
| Rare | Violet `#C77DFF` | 8% | Tie-prone or restricted pool |

**Weight by tier, not per stat.** Dividing the tier's share across its members is essential: with
four basic stats and three uncommon, a naive per-stat weighting gives basic four times its intended
share and the uncommon stats effectively never appear. This was a real bug in the prototype.

The percentages above are a starting guess, not a finding — tune them once the deck is populated
and you can see how often each stat actually clears the tie and gap filters.

### Rarity does not pay more

Scoring stays flat at **one point per question**. Rarity tiers describe how often a stat appears,
not how much it is worth. Making rare stats worth double would stack three difficulty multipliers
at once — harder question, thinner pool, same 10-second clock — which is where people rage-quit.

Plain white was rejected for the basic tier: white is already the default text colour on a dark
background, so basic stats would read as untinted rather than as a tier.

Because colour carries meaning, **always pair it with the written stat name**. Colour alone fails
for colourblind players.

---

## 7. The wheel

- Spins **after** both players are shown, never before.
- Runs on question one too, so the mechanic introduces itself.
- Stat holds for **2 to 5 rounds, randomised**. Fixed cadence lets players pre-load their answer;
  switching every single round means they never settle into a rhythm, so the trap never springs.
- **No spin when the stat isn't changing.** A wheel that lands on the same stat twice reads as
  broken.
- Spin duration around **1.3 seconds** with a long deceleration. The original sub-second spin was
  too quick to read.
- The switch must be **unmissable** — wheel, colour change on the plaque, and a settle animation.
  Too loud is the correct failure mode; people answering the previous question on autopilot feel
  robbed.

---

## 8. Difficulty ramp

Gap is expressed as a ratio between the two values: `max / min - 1`.

**Difficulty is controlled by a band, not a floor.** A floor alone does not create a ramp: it only
removes pairs that are too close, so the pool at round 46 with a 30% floor is a strict superset of
the pool at round 1 — every blowout that qualified early still qualifies late. Drawing randomly
from it keeps serving gifts, so expected difficulty barely moves. A ceiling is what makes a late
round actually hard.

| Rounds | Band | Feel |
|---|---|---|
| 1–10 | ≥200%, **no ceiling** | Nearly free. Blowouts are the joke, so leave them uncapped. |
| 11–18 | 150–800% | Generous, no longer absurd. |
| 19–26 | 100–400% | Requires some knowledge. |
| 27–34 | 75–250% | Requires real knowledge. |
| 35–42 | 50–150% | Hard. |
| 43+ | 30–80% | Knife edge. |

The first band keeps no ceiling deliberately — early rounds should actively favour the funniest
available pair (a squad player against someone with sixty million followers), not merely any pair
clearing the floor.

### Narrow stats are exempt from bands

Small-integer stats — clubs played for, and any other stat where most of the deck clusters on a few
values — are matched on tie-exclusion alone, with no band. A band is meaningless when the whole
range is 1 to 11.

The consequence is that they are always maximally hard, which is acceptable at rare-tier frequency
but **not** during the confidence-building phase. Band-exempt stats are therefore **barred from the
first 10 rounds**.

### Relaxation

When the candidate pool falls below a threshold, relax in this order:

1. **Ceiling first** — a too-easy question beats a repeated player.
2. **Then the floor.**
3. **Then shorten the recently-seen queue.**
4. **Never relax tie exclusion.**

The recently-seen queue (the last ~12 players, excluded from selection) matters more here than it
did with floors, because bands and the queue shrink the pool at the same time.

### Run length

A 200% floor through round 10 pushes the knife-edge band out to roughly round 43, so a strong run is
40-plus questions at 10 seconds each — six to eight minutes. Acceptable for a once-a-day puzzle,
long by the genre's norms. Sustaining it also needs the full 400-player deck; a 50-player test deck
will exhaust the pool long before then and sit permanently in relaxation.

**These numbers are a considered guess, not a finding.** `simulation.md` settles them.

### Accept the coin-flip ceiling

With one life and a timer, a good player eventually meets a pair they genuinely cannot know, and
the run ends on luck rather than skill. That's inherent to the genre. Don't over-tune the ramp
trying to design it away. Daily Ranked mitigates it socially: everyone hits the same coin flip.

---

## 9. Timer and scoring

- **10 seconds per question**, starting after the wheel lands so the animation doesn't eat
  thinking time.
- **15 seconds for question one**, while the player works out what they're looking at.
- **Start button before question one**, so the first timer doesn't run while the player is still
  orienting.
- **Timeout ends the run.** With one life this is the clean answer, and it's what stops people
  looking the answer up.
- **One point per question.** Points and streak are therefore the same number.
- **Time is a tiebreaker only**, never a headline metric — rewarding speed on near-ties rewards
  lucky guessing.
- **The server owns the clock.** Timing is measured from when the round token was issued, with a
  short network grace allowance. Client-reported timings are telemetry, never trusted.
- **Friendly Mode** (section 3) is the exception, and is excluded from all boards.

---

## 10. Matching engine

Rules the pair-selection logic must enforce:

- **Eligibility per player per stat.** No goals stat for goalkeepers; no clean sheets for outfield
  players other than defenders; no age for deceased legends. Store a per-player eligibility map
  rather than inferring at runtime.
- **Exclude ties.** Equal values have no correct answer. Skip the pair rather than calling a tie
  correct.
- **Both players must be eligible for the stat** — including the carried-over anchor when the stat
  switches.
- **Respect the gap band** for the current round, relaxing in the order given in section 8 rather
  than ever failing to deal a pair. Band-exempt stats are barred from the first 10 rounds.
- **Recently-seen queue** so the same player doesn't reappear within roughly a dozen rounds.
- **Correlated-stat rule.** Caps and international goals move together — a player who just won on
  caps will usually win on international goals too, which undercuts the stat switch whose entire
  point is dissonance. The wheel must **not switch directly between caps and international goals**;
  it needs an intervening stat. Apply the same rule to any pair `viability.md` later shows to be
  strongly correlated.
- **Volatility floor.** Any stat that can still move — chiefly followers — needs a wider gap than a
  frozen one, so a near-tie can't silently flip between data refreshes.
- **Round one is curated, not random.** Most people who open the link play one run and never
  return. Guarantee a recognisable name and an easy question first; don't let the shuffler open on
  obscure club appearances.
- **Seeded PRNG, never `Math.random`.** Runs must be reproducible for testing, for the daily
  sequence, and for server-side verification.

The engine must be **framework-free TypeScript** so it can run in the browser, in a Worker, and in
a Node test harness without modification.

---

## 11. Data model

Every figure carries its provenance. This costs almost nothing to fill in as the deck is built and
is miserable to retrofit across hundreds of players.

- `value` — the number
- `source` — where it came from
- `as_of` — snapshot date, displayed on the card for followers

Each player also carries a **position flag** (goalkeeper, defender, midfielder, striker), assigned
by majority career position and recorded explicitly with a note where the call is arguable. It
drives stat eligibility and must never be inferred at runtime.

Store **date of birth**, not age — age is computed, and the player is excluded from the age stat if
deceased. Store the transfer fee's **year** alongside the amount, since it is shown on the card.

**The deck is entered by hand.** Roughly 400 players at eight or more sourced figures each is the
largest single piece of work in the project. Development runs on a 50-player deck; public launch of
the ranked modes needs around 100; the full deck is 400 and arrives incrementally.

Deck size is governed by **recognition**, not by how many players exist. A pair where neither name
is familiar is a coin flip and feels terrible, so the usable deck is a few hundred names at most.
Adding beyond that makes the game worse, not richer.

Add a **report-an-error link** on the game-over screen. It turns the most annoyed users into free
QA, and it means a wrong number gets fixed rather than screenshotted.

---

## 12. Visual direction

Floodlit night: deep teal-slate ground, chalk-white type, gold for numbers, black for the title
bar. **Not a card-based UI** — the two players occupy full-bleed halves of the screen, stacked on
mobile and side-by-side on desktop, with a coloured plaque floating over the divide carrying the
current stat.

- **Type:** Archivo variable for the interface, using the width axis so one family covers expanded
  scoreboard numerals and normal-width text. Cinzel for the word *Legends* in the title bar, set
  in a gold gradient on black.
- **Player photography**, one image per card, treated as a background layer rather than a portrait
  crop: desaturated or duotoned toward the palette, darkened enough that the name and number stay
  legible over it. The monogram treatment stays as the **fallback** for any player without a usable
  free image — a gap that will exist, since Commons coverage is uneven for pre-2000 players.
- **The numbers are the hero.** The one piece of orchestrated motion is the count-up on reveal;
  everything else stays still. The photo must never compete with the number.
- **The plaque is the stat.** It changes colour with the tier and is the single most important
  thing on screen after the two names.
- **Persistent title bar** — "Bigger Than Game — Football Legends" stays visible during play.
- **Quality floor:** responsive to mobile, visible keyboard focus, reduced motion respected,
  colour never the sole carrier of meaning.

The prototype's styling is plain CSS with custom properties and should be **ported as-is**, not
rewritten into a utility framework. Converting it would cost days and guarantee visual drift.

---

## 13. Sharing and leaderboards

**Build the share card before the leaderboards.** Sharing is growth; leaderboards are retention for
people who already arrived. The shared artefact should carry the score, the stat that ended the
run, and the two players involved — that last detail is what makes it a conversation rather than
a number.

### Daily Ranked board
Resets daily. Same sequence for all players, so ranking is meaningful. Time taken breaks ties.
This is the headline board.

### Endless board
**Best single submitted run**, reset daily. Framed as a personal-best board, not a ranking — see
section 3. Nicknames are **not** required to be unique here.

### Image licensing

Every image carries, in the deck: the **source URL**, the **author**, and the **licence** (CC-BY,
CC-BY-SA, public domain). Attribution is displayed on a **credits page** listing every image with
its author and licence link, reachable from the game — per-image credit on the card itself would
compete with the numbers.

Share-anything requirements travel with CC-BY-SA, so prefer CC-BY or public domain where a choice
exists, particularly for anything that might appear in a share card.

**This is launch-blocking work**, not a polish pass. Roughly 400 images, each needing a licence
verified by hand and its metadata recorded, on top of the stat entry. Budget for it accordingly, and
expect a meaningful number of legends to have no usable free image at all.

### Identity and submission

- **Anonymous nicknames** in v1; accounts later.
- The nickname is entered **after the run ends**, and publishing to the global board is **opt-in**.
  Anyone who wants to appear publicly provides a name — not only those reaching the top 100 — so
  that ranks and shares stay coherent.
- **Daily Ranked nicknames are unique within that game only.** If a name is taken, the UI says so
  and asks for another. Uniqueness resets at rollover, so no name is ever owned and no account
  system is implied.
- **The local device board always records a finished run**, published or not. It works with no
  network and is the player's own history.
- Default to a **generated nickname** the player can change. Most people keep the suggestion, which
  shrinks the moderation surface to the minority who type their own.
- Moderation **normalises before checking** — strip zero-width characters, fold homoglyphs to
  ASCII, collapse repeats — then applies the blocklist. A raw blocklist is defeated by leetspeak
  within a day. Flagged names are retired without deleting the score.

### What the player sees

The board page shows the **top 100**. Every published player is also told **their own rank out of
the day's total** — "412th of 3,208" is a real result and a reason to come back, where a bare
"not in the top 100" is not.

Weekly and all-time views come later, and only for Daily Ranked, where cross-day comparison is
defensible.

---

## 14. Decisions and reasoning

Recorded so they don't get relitigated.

### Name and domain
**biggerthangame.com.** "Bigger than" is the literal question every round asks, whichever stat is
live, and "bigger" means both a larger number and more famous — the ambiguity is the game.
Descriptive alternatives (footballhigherorlower, sportshigherorlower, thehigherorlowergame) were
rejected: they're unsayable, they compete directly with an established incumbent on its own
category name, and one was close enough to that incumbent to invite a passing-off claim. "Higher
or lower" still appears in the tagline and title tag, where it does the comprehension work without
costing shareability.

### Exact-match domains don't rank
Google stopped rewarding keyword domains in 2012. A redirect from a domain with no links or
history passes essentially nothing. If keyword traffic is wanted, the correct move is a page at
`/football-higher-or-lower` on the main domain — it competes properly and consolidates authority
instead of splitting it.

### King-of-the-hill rejected
Keeping the larger value ratchets toward the deck maximum, making "lower" a winning strategy. The
classic chain is 50/50 every round, so knowledge is the only edge.

### Inflation adjustment rejected
Football fees have risen far faster than consumer prices, so a CPI-adjusted 1980s fee still looks
trivial next to a modern one — the work would barely change any answer while claiming a rigour it
doesn't have. Raw fee with the year shown is factual, sourceable and unarguable.

### Narrow-range stats demoted, not deleted
The problem with small-integer stats isn't difficulty, it's ties. They still earn a place as
occasional spice, but they can't carry the game.

### Rarity colouring without rarity rewards
Rarity colouring normally signals reward, which would make a rare stat lighting up before a hard
loss feel like a bait-and-switch. Keeping scoring flat resolves it: the colour communicates what
kind of question is coming, not what it pays.

### Both modes are server-authoritative
Hiding the deck client-side is not possible in any meaningful sense — the stats are public facts
and anyone can look them up. But the *casual* cheat (open devtools, read the value) is entirely
preventable by never sending the challenger's value before the guess. The cost is one edge request
per question, fully masked by the existing reveal animation. Obfuscation and WASM were rejected:
an afternoon's work to defeat, and real debugging pain forever.

### An endless leaderboard cannot be fair
Different players get different sequences, so the board measures luck alongside knowledge. This is
a property of the format, not of the anti-cheat. Hence two boards with two different promises.

---

## 15. Open questions

- **Ramp validation.** The bands in section 8 are a considered guess. `simulation.md` must confirm
  the streak distribution, and in particular whether the 30–80% band is populated at all once the
  recently-seen queue and tie exclusion have taken their cut.
- **Whether "clubs played for" survives** the first playtest. Retained for now, band-exempt.
- **Endless submission rate limit** numbers. Agreed in principle; set when the endpoint is built.

### Resolved

Modes and their protection, game numbering and rollover, nickname identity and uniqueness, the
club-trophy definition, position flags and stat eligibility, age as a rare stat, deck size and
entry method, timer authority, disconnection behaviour, board size and rank display, launch order,
bands versus floors, relaxation order, clean-sheet sourcing, and error-report routing (email).

---

## 16. Deliberately not building

- **Multiplayer** — not until single-player retention is proven.
- **Other sports** — not until the football deck is genuinely good. The name permits it; the
  roadmap doesn't yet.
- **Current players** — they reintroduce the refresh burden that legends-only removes.
- **Club badges, crests and kit marks** — trademarks, and not covered by any photo licence.
- **Agency photography** (Getty, PA, Reuters) — aggressively enforced and not worth the exposure.
- **Weekly and all-time boards** — after Daily Ranked proves out.

---

## A note on the working prototype

The figures in the HTML prototype are **approximate and from memory**. They are adequate for
feeling out the difficulty curve and useless for shipping. Every number needs verifying against a
cited source before launch, per section 11. The prototype is also fully client-side and therefore
does not reflect the server-authoritative model described in section 3.

---

*Bigger Than — design document, version 2. Captures decisions taken to September 2026.*
