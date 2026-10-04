# Bigger Than — Design Document

**Version 3** · biggerthangame.com · Football legends · September 2026

A higher-or-lower streak game for football fans, where the stat keeps changing underneath you.

> **For Claude Code:** this is the authoritative spec for v1. Where this document and existing
> code disagree, this document wins unless the code comment cites a later decision. Section 15
> lists genuinely undecided questions — ask rather than guessing. Section 16 lists things that
> are deliberately out of scope; do not build them speculatively.
>
> Infrastructure, data pipeline, API design and anti-cheat implementation live in
> `ARCHITECTURE.md`. This document covers what the game _is_, not how it is served.

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
17. [Site structure](#17-site-structure)

---

## 1. What it is

Two footballers are shown side by side. A wheel spins and lands on a stat — club goals, caps,
Instagram followers, highest transfer fee and others. One player's number is visible, the other is
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

- **Randomised sequence**, a random seed per run, unlimited attempts, play as much as you like.
- **One life, no finish line.** A run ends on a wrong answer (`wrong`), when the clock runs out
  (`timeout`), when the connection goes (`disconnected`: the streak so far is kept) or, in
  principle, when the engine can deal no more (`deck-exhausted`, capped at 150 rounds, which the
  simulation shows no run reaching).
- **The clock:** 15 seconds for question one, 10 for every question after (§9).
- Same server-authoritative protection as Daily Ranked: a signed progress token per question,
  spent once, and the server's own clock (ARCHITECTURE.md §8).
- A bit harder than Friendly, on its own ramp (§8), with its own streak titles (§13). Every stat
  can come up on every question.
- **Challenge links live here** (§13): a friend plays a fresh run of their own against your score.
- **Boards for today, this week and this month** (UTC; §13), each of a device's best published
  run, presented as personal-best boards rather than a ranking. Publishing is opt-in, under a
  nickname.

### Friendly Mode

Same randomised sequence style as Endless and **the same full deck**, minus the clock, the
leaderboards and the anti-cheat enforcement. It exists for two reasons: a hard 10-second clock
excludes players with motor or cognitive impairments, and it gives a low-stakes way to learn the
game. Because it can never be ranked, there is no incentive to abuse it.

One life still applies.

**Friendly is a 20-question challenge.** Answer all twenty correctly and the run ends, won — there
is no "keep going". A miss ends it as before. The score reads out of twenty everywhere it appears:
"7 / 20" in the title bar instead of "Streak 7", "7/20" on the game-over panel, in both shares and
in the local best ("Best 12/20"). **Friendly has no challenge links**: it is stateless, so a score
can be inflated by resending a round, which made "Beat n" misleading. They moved to Endless (§13). A win gets its own moment on
the game-over panel — a trophy, "You won" in gold, 20/20 — which is still, with the same content,
under reduced motion. A thin **progress track** under the title bar has one segment per question:
each answered round fills in gold, a miss in red, and the current round is lit.
It is never the only signal: the live region starts each question with "Question 7 of 20", and the
title bar carries the score in text. Round 20 is the **final question**: its segment is gold, and
while it is asked the plaque and the track carry a gold "Final question" tag, announced as "Final
question — question 20 of 20". Friendly has its own, compressed difficulty ramp (§8), its
own streak titles (§13) and holds the iconic preference for five rounds (§10). Endless and Ranked
keep the plain streak and no track; Endless has its own ramp and pair rules, Ranked the long ramp.
All of it is driven from per-mode settings in `@bt/core` (`WIN_ROUNDS`, `MAX_ROUNDS`,
`BAND_SCHEDULES`, `PAIR_RULES`, `WHEEL_VIABILITY`, `QUESTION_LIMITS`, `CHALLENGES`,
`STREAK_TITLES`, `ICONIC_ROUNDS`).

**Friendly is served per question, like the other modes.** It calls the same endpoint with the same
payloads; what it skips is the enforcement — no progress tokens, no replay check, no timer, no
Turnstile. The challenger's value is still withheld until the guess, purely so there is one code
path rather than two.

The reason is not anti-cheat. It is that **the deck is the asset.** Three hundred players, each
hand-entered and hand-verified, each with a licence-checked image, is weeks of work and the only
thing about this game that is genuinely hard to copy. A client-side mode publishes that dataset
wholesale — permanently, scrapeably, archived — and a competitor lifts it out of the JS bundle in
thirty seconds.

Per-question serving does not make the deck scrape-proof; it makes scraping expensive. Three
hundred players across ten stats is 3,000 values, and since the caller does not choose the pairing,
reconstructing it takes tens of thousands of requests. **Rate limiting is what does the real work
here**, not the request shape.

Note what this deliberately does _not_ claim. Hiding values buys very little against cheating,
because the stats are public facts — a bot scraping Wikipedia reaches near-perfect accuracy anyway.
What protects the leaderboards is the token chain, replay prevention, server-owned timing,
one-attempt enforcement and timing heuristics. None of those depend on the values being secret.

### Launch order

**Friendly Mode ships first**, publicly, on whatever the deck holds at the time. It needs one
stateless endpoint and none of the enforcement machinery — no Durable Object, no D1, no KV, no
tokens, no Turnstile — so it is still far cheaper than Ranked, and the endpoint it uses is the one
Phase 5 hardens rather than a throwaway.

Because it plays the full deck, Friendly now _does_ give a usable read on the difficulty ramp,
unlike the small-pool version it replaces. `simulation.md` remains the primary instrument, but
real play against a real deck is the check on it.

Endless follows, with its boards, once enforcement is complete; Daily Ranked after it. Target deck at full launch
is around 300 legends, with a couple of hundred entered early so simulation has something real to
work with.

### Why the framing differs

An endless leaderboard is structurally noisy _even with perfect anti-cheat_, because two players'
runs are not the same test — one gets a kind sequence, another gets three knife-edge pairs in a
row. It measures luck alongside knowledge and no amount of verification changes that. Daily Ranked
exists precisely to be the board where the number means something.

Do not present the Endless board as a fair contest. Copy should make the distinction obvious.

### Connectivity

**All three modes need a connection for every question.** Friendly gave up offline play when it
moved behind the endpoint; that was the cost of not shipping the deck. It is a real loss for the
no-signal case, though a small one for a game people reach through a shared link, and the
accessibility reason Friendly exists — no clock — is untouched. Latency is covered
by the existing reveal animation (see section 4) and should not be perceptible on a decent
connection.

**Offline continuation is impossible by construction, not by policy.** The client does not hold the
next hidden value and nothing can supply it while the network is down. So the behaviour on a drop
is: **retry visibly for a few seconds, then bank and end.** Every round up to the drop is already
verified, so the player keeps the streak they earned and it submits when connectivity returns. The
tube-tunnel case is covered by the retry window, which is the case that actually happens.

Being rate-limited is not a drop. A `429` shows a calm "slow down" note, waits the time the server
asks for, then carries on with the same round. It never ends a run.

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
   immediately on a 0, which counts up when the real value arrives.
6. Correct → the challenger becomes the new anchor, a fresh challenger is dealt.
   Wrong → run over.

Showing the players before the stat is the load-bearing detail. If the stat lands first, people
evaluate the cards already knowing the question and the dissonance never happens.

The ~2500ms count-up on reveal is what hides the network round trip. Keep it. Prefetch the next
card's _visible_ data during the current round so the between-round transition stays instant.

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

**Ten stats.**

| Stat                       | Tier     | Definition                                           | Eligibility                 |
| -------------------------- | -------- | ---------------------------------------------------- | --------------------------- |
| **Club goals**             | Basic    | Senior club goals, all competitions, all clubs       | Everyone except goalkeepers |
| **International caps**     | Basic    | Senior international appearances only                | All                         |
| **Club appearances**       | Basic    | Senior club appearances, all competitions, all clubs | All                         |
| **Instagram followers**    | Basic    | Follower count, snapshot-dated                       | All with an account         |
| **Highest transfer fee**   | Uncommon | Largest single reported fee, shown **with the year** | All with a reported fee     |
| **International goals**    | Uncommon | Senior international goals                           | Everyone except goalkeepers |
| **Club trophies**          | Rare     | See definition below                                 | All                         |
| **International trophies** | Rare     | Major international honours                          | All                         |
| **Clubs played for**       | Rare     | Count of senior clubs                                | All                         |
| **Age**                    | Rare     | Computed from date of birth                          | Living players only         |

**Never call anything but a senior international appearance a "cap" — fans will correct you.**

**Club goals and international goals are deliberately separate** rather than one combined career
total. A combined figure counts every international goal twice over — once in the total, once in the
international stat — so the wheel switching between the two would be asking half the same question.
Split, they are genuinely independent, and a prolific club scorer with a thin international record
is a real piece of football knowledge rather than an artefact of arithmetic.

International goals is kept at **uncommon** tier despite its wide range. Promoting it would give
five basic stats, three of which (club goals, international goals, club appearances) all ask a
variation of "how much did they play and score". Keeping it uncommon stops the wheel landing on
near-identical questions in succession. `viability.md` may argue otherwise once the deck is
populated.

Instagram followers is the signature stat: wide range, no ties, nearly everyone eligible. It
should fire often. Club appearances is the one wide-range stat goalkeepers keep, which is what
keeps them in the deck at all; it plays fair but flat, since few people have real intuitions about
appearance totals.

**Two different values must never read the same on a card** — that would look like a tie, which is
never dealt. Followers and fees are stored in millions and shown in thousands below a million
(`93k`, `€660k`) and in millions from there, with the decimals the stored value has, up to two
(`€10.75m`, `€10.7m`, `€36m`) — a stored decimal is never rounded away. A test holds every deck
value to this.

### Club trophies — the definition

Counts: **every trophy listed under the club section of the Honours part of the player's English
Wikipedia article, where the player's team won it.** That includes one-match trophies — the
Community Shield, domestic super cups and the UEFA Super Cup — alongside leagues, cups,
continental competitions and the Club World Cup.

Does not count: **runners-up and third places, individual awards, youth, reserve and B-team
honours, and international honours** (those are the international trophies stat).

This rule must be published in the UI. It is the stat most likely to be argued with.

### Position

Every player carries a position flag: **goalkeeper, defender, midfielder, striker**. Position is
assigned by where the player spent the majority of their career, recorded explicitly as a field
with a note where the call is arguable (Lahm across both flanks, Ramos at centre-back and
right-back, converted midfielders). It is never derived at runtime.

Position drives one eligibility rule today — **goalkeepers are excluded from club goals and
international goals** — and the field exists so further rules can be added without touching the
engine.

### Cut, and why

- **Height** — nobody knows any player's height, so it isn't a knowledge test. It's a coin flip
  with a 50% chance of ending the run.
- **World Cup goals and World Cup appearances** — too much of the deck sat on the same handful of
  values, so tie exclusion gutted both. International goals covers similar ground with a far wider
  spread.
- **Clean sheets** — a published stat for goalkeepers and essentially untracked for outfield
  defenders. No consistent source existed, so every defender figure would have been a guess.
- **Combined career goals** — replaced by club goals, for the double-counting reason above.
- **"International caps" as distinct from "Caps"** — the same stat under two names. Resolved to one,
  shown as "International caps" (its id stays `caps`).

---

## 6. Tiers and colour

Three tiers, three hues, readable in under a second on a phone.

| Tier     | Colour           | Target, per stat   | Character                        |
| -------- | ---------------- | ------------------ | -------------------------------- |
| Basic    | Gold `#FFC24D`   | 15% of rounds each | Wide range, large pool, reliable |
| Uncommon | Blue `#5AB9F0`   | 10% each           | Narrower, some tie exclusion     |
| Rare     | Violet `#C77DFF` | 5% each            | Tie-prone or restricted pool     |

**Weight by tier, not per stat.** Dividing the tier's share across its members is essential: with
four basic stats, two uncommon and four rare, a naive per-stat weighting would give basic twice the
share of uncommon and the uncommon stats would barely appear. This was a real bug in the prototype.

With ten stats split 4 / 2 / 4, the targets add up to 60% basic, 20% uncommon and 20% rare, and no
stat falls below 5%. Note that **highest transfer fee and international goals individually fire
twice as often as any single rare stat** — worth remembering when judging how much verification
each stat's data deserves.

The targets are the design; the tier **weights** that achieve them are a tuning result, and differ
sharply from the targets (§7).

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
- **The opening stat holds for exactly 2 rounds, so the first switch is always round 3 — on
  purpose.** Every player who gets two right sees the stat change, the mechanic the whole game is
  built on; a longer or random first hold meant many short runs ended without ever seeing it. The
  one predictable switch is a fair price: after it, the cadence is random again.
- Every later stat holds for **2 to 5 rounds, randomised**. Fixed cadence lets players pre-load
  their answer; switching every single round means they never settle into a rhythm, so the trap
  never springs.
- **No spin when the stat isn't changing.** A wheel that lands on the same stat twice reads as
  broken.
- **The opening stat is a wheel draw too**, over basic and uncommon stats only, with the same tier
  weights. **Rare stats never open a run** — a newcomer's first question should read at a glance —
  but the wheel can switch to them from the first switch, at round 3.
- **Which stats are viable, per mode** (`WHEEL_VIABILITY`). In Friendly and Ranked the wheel only
  switches to a stat that has a pair within the round's own band, so a stat with nothing in the
  band is skipped for that switch. **In Endless every stat can come up on every question**: the
  wheel may switch to any stat the anchor can be dealt at all, at any step of relaxation, and the
  late-round pair rules (§8) keep what it then deals hard rather than relaxing to an easy pair. If
  a held stat can't be dealt to the new anchor at all (a narrow stat at the edge of its values), the
  wheel switches rather than ending the run.
- **A rare stat is never followed directly by another rare stat**, unless nothing else is viable
  at that moment. Rare stats carry a heavy weight to make up for never opening a run; without this
  rule they would crowd the later rounds — measured at 45–49% of rounds from round 6 on.
- **Target mix, measured per round played:** 15% for each basic stat, 10% for each uncommon, 5% for
  each rare, none below 5%. The tier weights are tuned until `simulation.md` lands within about two
  points of every target. They are currently **basic 42, uncommon 15, rare 43**. Rare is weighted
  far above its target because rare stats never open a run, and rounds 1–2 — always on the
  opening stat — are about 30% of all rounds played, since most runs are short. **Rare stats
  together should stay under about 30% of rounds in every round range**; `simulation.md` reports
  the mix by range (1–5, 6–10, 11–20, 21+) for Friendly. Re-tune against both tables after
  substantial deck changes, never by reasoning about the weights.
- Spin duration around **1.8 seconds** with a long deceleration. The original sub-second spin was
  too quick to read.
- The switch must be **unmissable** — wheel, colour change on the plaque, and a settle animation.
  Too loud is the correct failure mode; people answering the previous question on autopilot feel
  robbed.

---

## 8. Difficulty ramp

Gap is expressed as **rank distance**: how far apart the two values sit in the deck's own spread
for that stat. Each value's percentile is its mid-rank among eligible players — 0 for the lowest
figure in the deck, 1 for the highest, tied values sharing one — and the gap is the difference. A
gap of 0.45 means the two players are nearly half the deck apart.

It replaced a raw ratio (`max / min - 1`). A ratio can't make an easy question from a stat whose
range is narrow: every legend has between 478 and 985 club appearances, so no pair ever reached the
opening band's 3×, and appearances never fired. Caps fared little better. Rank distance puts every
stat on the same 0–1 scale, whatever its units or range. It is computed from the deck and the
run's reference date alone — never from answers or from who was dealt recently — so the sequence
stays a pure function of seed and mode.

Rank distance could in principle pair two figures whose ranks are far apart but whose values are
close. Checked on the 77-player legends deck: across the basic and uncommon stats, the closest
pair the opening band admits is 18.6% apart (appearances, 663 v 786), and the closest early pair
8.7% (appearances, 689 v 749). No ratio floor is needed on top. Re-check it if the deck changes
shape — a minimum relative difference of 15% for rounds 1–10 and 8% for 11–18 is the planned
remedy if it's ever needed.

**Difficulty is controlled by a band, not a floor.** A floor alone does not create a ramp: it only
removes pairs that are too close, so the pool at round 46 with a 30% floor is a strict superset of
the pool at round 1 — every blowout that qualified early still qualifies late. Drawing randomly
from it keeps serving gifts, so expected difficulty barely moves. A ceiling is what makes a late
round actually hard.

| Rounds | Band (rank distance)  | Feel                                                        |
| ------ | --------------------- | ----------------------------------------------------------- |
| 1–10   | ≥0.45, **no ceiling** | Nearly free. Blowouts are the joke, so leave them uncapped. |
| 11–18  | 0.25–0.70             | Generous, no longer absurd.                                 |
| 19–26  | 0.15–0.50             | Requires some knowledge.                                    |
| 27–34  | 0.10–0.35             | Requires real knowledge.                                    |
| 35–42  | 0.05–0.25             | Hard.                                                       |
| 43+    | 0.02–0.12             | Knife edge.                                                 |

The first band keeps no ceiling deliberately — early rounds should actively favour the funniest
available pair (a squad player against someone with sixty million followers), not merely any pair
clearing the floor.

That table is Ranked's. **Endless** and **Friendly's twenty questions** have their own ramps.

**Endless** is a bit harder than Friendly, reaching its hard zone at round 16 (Friendly's is 18)
and still tightening past round 20 rather than levelling off. Rounds 1–5 are Friendly's exactly —
the same uncapped band and the same iconic window — and from round 5 it never gets easier:

| Rounds | Band (rank distance) | Plus, from round 16 (`PAIR_RULES`)                         |
| ------ | -------------------- | ---------------------------------------------------------- |
| 1–5    | ≥0.45, no ceiling    |                                                            |
| 6–10   | 0.12–0.25            |                                                            |
| 11–15  | 0.03–0.10            |                                                            |
| 16–20  | 0.02–0.04            | wide stats ≥10% apart; narrow stats by value, not the band |
| 21–30  | 0.01–0.04            | the same                                                   |
| 31+    | 0.01–0.03            | the same                                                   |

**From round 16, narrow stats are paired by value.** A rank band means little for a stat that
clusters on a few values, so a hard pair is defined by the figures: **age** — the two ages differ
and are within 10% of each other (50 and 54); **international trophies** and **clubs played for**
— the two figures differ by 1 or 2. **Club trophies** keep their band: their figures spread widely
enough that the band plus the 10% floor still holds pairs in every late round (`viability.md`).
**Wide stats** — every other — keep their band and must also be at least 10% apart, as in
Friendly's final stretch, on top of tie exclusion and Instagram's 2× floor. Neither rule ever
relaxes: only the band's ceiling, its floor and the seen queue give, in the usual order. Endless
lifts its ceiling gently when it relaxes (`RELAXATION_LADDERS`: half again at each step, rather
than doubling once and dropping it), so a dense stat whose nearest neighbours the 10% floor rules
out gets the next-closest pair, not a blowout.

Under the `fan` model (131 players, 20,000 runs; no clock, so real Endless plays harder): median
streak 10, 3.5% of runs reach 20 and 0.2% reach 30, none gets near the 150 cap, and rounds 16–20
are answered right 76% of the time (rounds 6–10 89%, 11–15 76%). Two of the targets it was tuned to can't both be met with the rest: reaching 30
in ~1% of runs needs late rounds answered right ~88% of the time, while 65–72% in rounds 16–20
needs them far harder, and bands that never get easier can't give both. And the fan model scores
the narrow stats' pairs (international trophies 1–2 apart sit a third of the deck apart) and the
dense stats' closest 10%-apart pairs as easier than a real fan would find them, which holds rounds
16–20 near 76% however tight the bands. `simulation.md` has the tables.

**Friendly's twenty questions**: It opens
on the same uncapped band for the five rounds that prefer iconic names, stays uncapped a little
lower for five more, then tightens quickly and **never gets easier**: from round 5 each band is at
least as hard as the one before — its floor and ceiling never rise — and round 20, the **final
question**, is strictly the hardest band in the run:

| Rounds | Band (rank distance)  | Feel                                                         |
| ------ | --------------------- | ------------------------------------------------------------ |
| 1–5    | ≥0.45, **no ceiling** | Nearly free — the rounds that prefer iconic names.           |
| 6–10   | ≥0.35, **no ceiling** | Still generous; blowouts still allowed.                      |
| 11–13  | 0.06–0.16             | Capped: a fan gets most of these, not all.                   |
| 14–17  | 0.02–0.08             | Close figures; real knowledge.                               |
| 18–19  | 0.02–0.04, ≥10% apart | The final stretch.                                           |
| 20     | 0.01–0.03, ≥10% apart | The final question: the hardest in the run, not a coin flip. |

**The final stretch is not a coin flip.** In rounds 18–20 the two figures must also differ by at
least 10% — the larger at least 1.10 times the smaller — on top of tie exclusion and Instagram's
volatility floor (`FINAL_STRETCH` in `packages/core`). Rank distance alone can pair two figures a
few percent apart. The floor is never relaxed: when nothing fits, the band relaxes in the usual
order (below) but never below 10% and never into a tie.

The final stretch's bands are narrow because the ratio floor does part of their work. For a dense
stat — appearances, age, caps, clubs — no pair 10% apart sits within a few hundredths of the deck,
so the band relaxes to an easier pair; for a stat that can go close — club goals, transfer fees,
international goals — the pair is genuinely close. A wider band would only make the second kind
easier. That is also why the final question's floor sits below Endless's knife edge: the ratio
floor, not the rank floor, is what keeps it answerable.

The final question is marked in the game: the track's last segment is gold, and on round 20 the
plaque and the track carry a gold "Final question" tag, which the live region also announces
("Final question — question 20 of 20").

`simulation.md` reports Friendly's win rate, how many runs reach each question and how many of
those answer it right. Friendly is tuned with the **`fan` model**, a keen football fan: accuracy
0.55 for two players at the same point in the deck, 0.65 at 0.03, 0.78 at 0.08, 0.88 at 0.15, 0.95
at 0.30 and 0.99 from 0.50, linear in between. The earlier ramp was tuned with a much weaker model
(0.5 rising to 0.95), and real players won it on their first or second run. On the 131-player
deck, over 20,000 runs, the fan model wins **4.8%** of runs; 12.8% reach question 18, and it
answers questions 18, 19 and 20 right 74.6%, 70.5% and 70.6% of the time. Its mean streak is 12.3,
most of it from rounds 1–10, which it gets right 98–99% of the time. The weaker model wins 0.5%.
Both are assumptions: re-tune once observed accuracy from real play replaces the fan's points
(`pnpm simulate --calibration`).

### Every stat is banded

Small-integer stats — clubs played for, international trophies, age — used to be matched on tie
exclusion alone, because a ratio band is meaningless when the whole range is 1 to 11. That made
them always maximally hard, so they were barred from the first 10 rounds.

Rank distance removes the problem: however few values a stat takes, they spread across the same
0–1 scale, so a band means what it means for any other stat. **All ten stats are banded, and none
is barred by round.** Rare stats still never open a run (§7), but can be dealt from round 3, as
easy a pair as any other stat at that round.

### Relaxation

When the candidate pool falls below a threshold, relax in this order:

1. **Iconic preference first** — in the early rounds that prefer an iconic challenger (§10), fall
   back to the whole deck at the same band before touching anything else.
2. **Then the ceiling** — a too-easy question beats a repeated player.
3. **Then the floor.**
4. **Then shorten the recently-seen queue.**
5. **Never relax tie exclusion**, nor Friendly's final-stretch ratio floor (below), nor Endless's
   pair rules from round 16 (its 10% floor for wide stats, and the value rules for narrow ones).

The recently-seen queue (the last ~12 players, excluded from selection) matters more here than it
did with floors, because bands and the queue shrink the pool at the same time.

### Run length

In Ranked, a 0.45 floor through round 10 pushes the knife-edge band out to roughly
round 43, so a strong run is 40-plus questions at 10 seconds each — six to eight minutes. Endless
reaches its hard zone at round 16, so a good run there is 15–25 questions and a very good one 30. Acceptable for a once-a-day puzzle,
long by the genre's norms. Sustaining it also needs the full 300-player deck; a 50-player test deck
will exhaust the pool long before then and sit permanently in relaxation. Friendly is capped at
twenty questions, so it never gets there.

**These numbers are a considered guess, not a finding.** `simulation.md` settles them.

### Accept the coin-flip ceiling

With one life and a timer, a good player eventually meets a pair they genuinely cannot know, and
the run ends on luck rather than skill. That's inherent to the genre. Don't over-tune the ramp
trying to design it away. Daily Ranked mitigates it socially: everyone hits the same coin flip.

---

## 9. Timer and scoring

- **10 seconds per question**, starting after the wheel lands so the animation doesn't eat
  thinking time (`QUESTION_LIMITS` in `@bt/core`).
- **15 seconds for question one**, while the player works out what they're looking at.
- **A big clock at the top of the pitch** counts the whole seconds down (15, then 10), centred
  where Friendly has its progress track (on a landscape phone, at the top left beside the plaque).
  Calm above five seconds; from five, orange with a soft glow; from three, urgent: the pill turns
  red, grows a little and gives one short shake as each of the last seconds ticks (3, 2, 1). It
  reaches 0 exactly as time runs out. A thin line along the plaque's bottom edge drains with it,
  in the same colours. When the player answers, the clock freezes on that second, dimmed, through
  the reveal, and starts again only when the next question can be answered; it steps aside while
  the score badge takes its spot after a right answer. Reduced motion: no growing or shaking (the
  urgent state is also marked by a heavier figure and an outline), and the line steps down a
  second at a time. Screen readers hear "5 seconds left" and "3 seconds left" once each, never a
  count. It never runs while the answer is in flight.
- **When it runs out**, the client sends a `timeout` so the player still sees the reveal; the run
  ends as `timeout`.
- **Start button before question one**, so the first timer doesn't run while the player is still
  orienting.
- **Timeout ends the run.** With one life this is the clean answer, and it's what stops people
  looking the answer up.
- **One point per question.** Points and streak are therefore the same number.
- **Time is a tiebreaker only**, never a headline metric — rewarding speed on near-ties rewards
  lucky guessing.
- **The server owns the clock.** Timing is measured from when the round token was issued, with a
  short network grace allowance: each token's deadline is its issue time plus the animation before
  the question is answerable (the longest an honest client plays), the limit, and 3 seconds. An
  answer after it ends the run as `timeout`, whatever it says. Client-reported timings are
  telemetry, never trusted.
- **Endless's start panel says so**: "Endless has a 10-second clock", with a link to Friendly for
  anyone who'd rather play without one.
- **Friendly Mode** (section 3) is the exception, and is excluded from all boards.

---

## 10. Matching engine

Rules the pair-selection logic must enforce:

- **Eligibility per player per stat.** No club goals or international goals for goalkeepers; no age
  for deceased legends; no stat at all where the figure is absent from the deck. Store a per-player
  eligibility map rather than inferring at runtime.
- **Exclude ties.** Equal values have no correct answer. Skip the pair rather than calling a tie
  correct.
- **Both players must be eligible for the stat** — including the carried-over anchor when the stat
  switches.
- **Respect the gap band** for the current round, relaxing in the order given in section 8 rather
  than ever failing to deal a pair. Every stat is banded, in rank distance (§8).
- **Recently-seen queue** so the same player doesn't reappear within roughly a dozen rounds.
- **Correlated-stat rule.** Two stats that order players the same way ask the same question twice,
  which undercuts the stat switch whose entire point is dissonance. The wheel must **not switch
  directly between a correlated pair**; it needs an intervening stat. **Club goals and
  international goals** are paired because the data says so (`viability.md`, ρ ≈ 0.84). **Caps
  and club appearances** are paired **by design**: both measure career length, and asking one
  straight after the other feels like the same question, even though they rank players only
  moderately alike. Confirm the data-driven pairs from the report after deck changes.
- **Volatility floor.** Any stat that can still move — chiefly followers — must also be at least
  2× apart as a ratio, on top of its rank band, so a near-tie can't silently flip between data
  refreshes. Rank distance says how far apart two players sit in the deck; it says nothing about
  whether a refresh could swap them.
- **Early rounds prefer iconic players, per mode.** Most people who open the link play one run and
  never return. Round one's stat is drawn by the wheel from basic and uncommon stats, never rare
  (§7), and its anchor from the `iconic` pool, at the opening band's wide gap. Then, for rounds 1
  to N, the challenger is
  drawn from iconic players whenever one is valid: eligible, not tied, within the round's band and
  not in the recently-seen queue. When none is, the whole deck is used at the same band — the
  preference is the first thing to give and never costs a wider band or a repeated player (§8).
  N is set per mode in `ICONIC_ROUNDS` in `packages/core`: **Friendly 5, Endless 5, Ranked 5.**
  Friendly held it for eight rounds until its difficulty retune; five is its opening band's length
  (§8), so the preference and the widest band end together. The run is a pure function of seed and
  mode; `simulation.md` reports how often each mode fell back.
- **Seeded PRNG, never `Math.random`.** Runs must be reproducible for testing, for the daily
  sequence, and for server-side verification.

The engine must be **framework-free TypeScript** so it can run in the browser, in a Worker, and in
a Node test harness without modification.

---

## 11. Data model

**Stat figures are stored as plain numbers, with no per-stat source recorded.** Citing each figure
individually would mean roughly 4,000 source fields across the deck, almost all of them repeating
the same reference, and the overhead was judged not to earn its keep. Corrections are handled by
re-checking the figure against current sources rather than by consulting a stored citation.

Two stats carry more than a number, because both display the extra field on the card:

- **Instagram followers** carries `as_of`, the snapshot date.
- **Highest transfer fee** carries `year`.

Each player also carries a **position flag** (goalkeeper, defender, midfielder, striker), assigned
by majority career position and recorded explicitly with a note where the call is arguable. It
drives stat eligibility and must never be inferred at runtime.

Players recognisable enough to open a run on are flagged **`iconic`**. Round one's anchor is drawn
from this pool, and the first few challengers of a run prefer it, for a number of rounds set per
mode (§10). The flag previously defined the client-side Friendly pool; that pool no longer exists,
so the name now says what it actually means.

Three optional fields describe a player for **future themed modes** and are **not yet used by any
mode**: **`era`**, the decade of the player's peak (`1990s`); **`main_clubs`**, the main senior
clubs; and **`leagues`**, the leagues played in. They are not stats and are never asked about.
`main_clubs` is distinct from the clubs-played-for stat, which counts every senior club. Nothing
reads them yet, and they stay server-side until a mode needs them.

Store **date of birth**, not age — age is computed, and the player is excluded from the age stat if
deceased.

**Images are the exception and keep full provenance.** Author, licence and source URL are required
per image, because a licence is a legal obligation rather than a convenience. See section 13. An
image may also carry an optional **crop focus**, `"x y"` percentages, for the few photos the
default crop cuts badly. It is display data, kept with the deck; it reaches the card in M4.

**The deck is entered by hand**, in a spreadsheet: `players.csv` is the master copy, with
`image-log.csv` and `focus.csv` beside it, and `pnpm deck:import` generates the per-player YAML the
build reads (ARCHITECTURE.md §6). Roughly 300 players at up to ten figures each is the largest
single piece of work in the project. Development runs on a 50-player deck; public launch of the
ranked modes needs around 100; the full deck is 300 and arrives incrementally.

Deck size is governed by **recognition**, not by how many players exist. A pair where neither name
is familiar is a coin flip and feels terrible, so the usable deck is a few hundred names at most.
Adding beyond that makes the game worse, not richer.

Add a **report-an-error form** on the game-over screen. It turns the most annoyed users into free
QA, and it means a wrong number gets fixed rather than screenshotted. It reports the round that
ended the run, which the server looks up for itself, and asks for nothing personal; a "Suggest a
legend" form sits beside it, and the footer of every page offers "Suggest a legend" and a general
"Report a problem" (ARCHITECTURE.md §8).

---

## 12. Visual direction

Floodlit night: deep teal-slate ground, chalk-white type, gold for numbers, black for the title
bar. **Not a card-based UI** — the two players occupy full-bleed halves of the screen, stacked on
mobile and side-by-side on desktop, with a coloured plaque floating over the divide carrying the
current stat.

- **Type:** Archivo variable for the interface, using the width axis so one family covers expanded
  scoreboard numerals and normal-width text. Cinzel for the word _Legends_ in the title bar, set
  in a gold gradient on black.
- **Player photography**, one image per card, treated as a background layer rather than a portrait
  crop: desaturated or duotoned toward the palette, darkened enough that the name and number stay
  legible over it. The text sits just under the middle of each half, below the face, with no panel
  behind it: a soft dark halo rings every glyph, and the name and country carry a deeper shadow that
  follows their letters, so the face and the rest of the photo stay clear. The monogram treatment
  stays as the **fallback** for any player without a usable free image — a gap that will exist,
  since Commons coverage is uneven for pre-2000 players.
- **The numbers are the hero.** The one piece of orchestrated motion is the count-up on reveal;
  everything else stays still. The photo must never compete with the number.
- **The plaque is the stat.** It changes colour with the tier and is the single most important
  thing on screen after the two names.
- **Persistent title bar** — "Bigger Than Game — Football Legends" stays visible during play.
  _Legends_ appears only on the Legends pages; elsewhere the bar is the brand alone (§17). The title
  bar and footer are raised surfaces with a gold hairline facing the page, and a soft gold glow sits
  on the brand, the links, the game's text and its buttons, growing on hover, press and focus. The
  game and the chrome don't select as text; content pages do.
- **Background:** the floodlit night itself — warm floodlight pools from the two top corners, a
  faint teal lift, a vignette and a fine grain, with soft gold shapes drifting slowly over it, up
  top and low down. The Legends page adds a few small drifting gold glows and a slow floodlight
  sweep. All of it sits behind the content at low contrast, so text stays easy to read. The game
  page keeps the floodlights, still, showing through the halves at rest and on the start and
  game-over panels: nothing moves behind the players. Reduced motion stills everything.
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

### What a finished run shares

- **Streak titles** mark milestones, one table per mode in `@bt/core` (`STREAK_TITLES`):
  - Endless: 5 Squad player, 10 Starter, 15 Fan favourite, 20 Captain, 30 Club legend, 40 World
    class, 50 Immortal. Shown mid-run too: the title the streak holds sits in a chip at the top of
    the pitch, and the score badge names each new one.
  - Ranked: 5 Squad player, 10 Starter, 20 Captain, 30 Legend, 45+ GOAT.
  - Friendly: 5 Squad player, 10 Starter, 15 Captain, 20 Legend — the win.

  Below 5 there is none. Shown on the game-over panel and in both shares.

- **Share text**, Wordle-style: score and title, one square per answered round in its tier colour
  (🟨 basic, 🟦 uncommon, 🟪 rare, ten to a line), ❌ for the round that ended the run, "Ended on:
  <stat>" ("Out of time on: <stat>" for a timeout), and the site's address. No values and no
  answers. In Endless the ending names the two players, never their figures ("Ended on: Caps —
  Zidane v Henry"); a challenge link is shared on its own, so a friend's run spoils nothing. In
  Friendly the score is "7/20", no player is named, and the grid is always two rows of ten, ⬛ for
  the questions the run didn't reach; a won run reads "🏆 20/20 · Legend", with no "Ended on".
- **Share image**: the same, plus the final round's two players and the figures the player has just
  seen, in the game's type and colours; in Friendly the score out of twenty, the twenty-cell grid
  (unreached rounds as empty outlines) and a gold trophy for a win. **No player photos** — their
  CC licences require attribution that can't travel with a shared image.
- **Challenge links, Endless only** (`CHALLENGES`): "Challenge a friend" on the game-over panel
  shares "Beat <score>" and a link. The friend plays **a fresh run of their own** — new players,
  new stats — framed as "Beat 23", and at the end sees whether they beat it, matched it or fell
  short. The link sets the score, never the sequence, so challenge runs are ordinary runs, published
  to the boards like any other. The score is signed with the run, so it can't be edited; a link that
  fails the check, or is more than 10 days old, opens a plain run with a short note. A link's score
  is at most 150. **This changes behaviour from Friendly**, whose links replayed the challenged run
  round for round: Friendly has no challenge links now, and an old one arriving there shows "This
  challenge link has expired — play Friendly" on the start panel, never an error. ARCHITECTURE.md
  §7 has the mechanics and the limits.
- **Local best** is kept on the device, one per deck and mode (§17), and works with storage blocked
  (it then lasts the visit). Friendly shows it as "Best 12/20". Beating it shows "New high score"
  in gold on the game-over panel, in the best line's place (with "You won" on a first win); equalling
  it, a quieter "Matched your best" (a win that equals it is just "You won"). Neither shows without a
  best to beat, so not on a device's first run. Mid-run, once the streak passes it, the title bar's
  Best counts with the streak and glows gold.

### Daily Ranked board

Resets daily. Same sequence for all players, so ranking is meaningful. Time taken breaks ties.
This is the headline board.

### Endless boards

Three boards: **Today**, **This week** and **This month**. Each is the top 100 of each device's
**best single published run** in the period — the highest streak, then the lower total answer time
the server measured, then who published first. Framed as personal-best boards, not a ranking —
see section 3 — and the board page says so plainly: "Personal bests — everyone gets a different
run, so luck plays a part." Nicknames are **not** required to be unique here.

- **Periods are UTC.** The day resets at 00:00 UTC; the week is the ISO week, Monday 00:00 UTC to
  Monday 00:00 UTC (so the week of 28 December 2026 is 2026-W53, into January); the month is the
  calendar month. The page shows a countdown to each reset, never a clock time.
- **A run counts in the periods of the day it started**, so a run started at 23:58 finishes on
  that day's boards, even if it is published after midnight. A run can be published for **30
  minutes** after it ends.
- **One entry per device per period.** A device is a random id kept in the browser (friction, not
  identity: clearing storage makes a new one). Publishing a worse run later doesn't replace a
  better one, so the game-over panel offers Publish only for a run that beats the best this
  device has published on the run's day (a run that can't beat the day's best can't beat the
  week's or the month's either); an equal score doesn't. Otherwise it says "Your best today is 18
  — beat it to move up the leaderboard", with a link to the board.
- **Previous winners.** At each reset the closing period's top 100 is kept, so the page can name
  "Yesterday's winner", "Last week's winner" and "Last month's winner".
- **Retention.** Scores are deleted 100 days after the day their run started; the snapshots stay.
- **Only fresh random runs are published.** A challenge link starts a fresh run against a score
  (above), so challenge runs are published like any other. The server checks a run was dealt by
  its own run start, so no sequence a player could have learned in advance reaches a board.

### Image licensing

Every image carries, in the deck: the **source URL**, the **author**, and the **licence** (CC-BY,
CC-BY-SA, public domain). Attribution is displayed on a **credits page** listing every image with
its author and licence link, reachable from the game — per-image credit on the card itself would
compete with the numbers.

Share-anything requirements travel with CC-BY-SA, so prefer CC-BY or public domain where a choice
exists, particularly for anything that might appear in a share card.

**This is launch-blocking work**, not a polish pass. Roughly 300 images, each needing a licence
verified by hand and its metadata recorded, on top of the stat entry. Budget for it accordingly, and
expect a meaningful number of legends to have no usable free image at all.

### Identity and submission

- **Anonymous nicknames** in v1; accounts later.
- The nickname is entered **after the run ends**, and publishing to the global board is **opt-in**.
  Anyone who wants to appear publicly provides a name — not only those reaching the top 100 — so
  that ranks and shares stay coherent. In Endless, "Publish to leaderboard" on the game-over panel
  opens a small dialog: the nickname (prefilled with the last name published from this device,
  or a generated one the first time), one line on what's stored — the nickname and
  the score, no account — and Publish. Afterwards it shows the three ranks ("412th of 3,208 today ·
  1,030th of 9,877 this week · …") and a link to the board, and the panel keeps the day's rank.
  If the device turns out to have a better run that day already (its storage was cleared, or it
  published from another tab), the dialog says "Your best today is still 18, so the leaderboard
  keeps that run" rather than "Published".
- **Nicknames** are 3 to 20 characters: Latin letters (accented ones included), digits, spaces
  and `_ - .`. Latin only because moderation can only read what its blocklist can; a name in
  another script gets the same calm "try another name" as a blocked one.
- **Daily Ranked nicknames are unique within that game only.** If a name is taken, the UI says so
  and asks for another. Uniqueness resets at rollover, so no name is ever owned and no account
  system is implied.
- **The local device board always records a finished run**, published or not. It works with no
  network and is the player's own history.
- Default to a **generated nickname** the player can change — an adjective, a football noun and
  a number, like "SwiftVolley42". Most people keep the suggestion, which shrinks the moderation
  surface to the minority who type their own.
- Moderation **normalises before checking** — strip zero-width characters, NFKC, fold homoglyphs
  and leetspeak to ASCII, allow for repeated letters — then applies the blocklist: slurs, sexual
  terms and impersonation ("admin", "moderator", "biggerthan"). A raw blocklist is defeated by
  leetspeak within a day. A refused name gets a calm "try another name". Flagged names are retired
  without deleting the score: the board shows "Retired name".
- **Shadow-flagging, not blocking.** A run whose answer times look automated is still published,
  and its player sees their entry and rank as normal; it is left out of everyone else's view of
  the boards and of the totals.

### What the player sees

The board page shows the **top 100**. Every published player is also told **their own rank out of
the period's total** — "412th of 3,208" is a real result and a reason to come back, where a bare
"not in the top 100" is not. Their own row is highlighted, and shows straight away, from their own
device, even before the board (cached for up to a minute) has caught up.

The page also shows **this device's 10 best Endless runs**, with their dates and scores, published
or not. They are kept in the browser, and need no network.

All-time views come later, and only for Daily Ranked, where cross-day comparison is defensible.

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
and anyone can look them up. But the _casual_ cheat (open devtools, read the value) is entirely
preventable by never sending the challenger's value before the guess. The cost is one edge request
per question, fully masked by the existing reveal animation. Obfuscation and WASM were rejected:
an afternoon's work to defeat, and real debugging pain forever.

### An endless leaderboard cannot be fair

Different players get different sequences, so the board measures luck alongside knowledge. This is
a property of the format, not of the anti-cheat. Hence two boards with two different promises.

### Endless gets weekly and monthly boards too

Weekly and longer boards were to be Daily Ranked's alone. Endless now has **today, this week and
this month**: a week or a month gives a player more to come back for than one day, and the
boards stay what they always were — personal bests, each device's best run in the period, framed
plainly as luck plus knowledge. They are still not a fair ranking, and the page says so. An
all-time Endless board is still out: over months, whoever plays most wins.

---

## 15. Open questions

- **Ramp validation.** The bands in section 8 are a considered guess. `simulation.md` must confirm
  the streak distribution, and in particular whether the knife-edge band is populated at all once
  the recently-seen queue and tie exclusion have taken their cut. Its skill models — `fan`, which
  Friendly and Endless are tuned with, and the weaker `rank`, which Ranked was — are assumptions
  until a calibration from real play (`--calibration`) replaces them.
- **Whether "clubs played for" survives** the first playtest. Retained for now, banded like every
  other stat.
- **Friendly endpoint rate limit** numbers. This is the only thing standing between the deck and a
  determined scraper, so it deserves more thought than the others — tight enough to make
  reconstruction impractical, loose enough that a fast player never notices.

### Resolved

Modes and their protection, game numbering and rollover, nickname identity and uniqueness, the
club-trophy definition, position flags and stat eligibility, age as a rare stat, deck size and
entry method, timer authority, disconnection behaviour, board size and rank display, launch order,
bands versus floors, relaxation order, rank distance over ratio gaps, the per-round stat mix, the
final ten-stat set, dropping per-stat sources,
error-report routing (email), and the Endless submission rate limit (set with the endpoint).

---

## 16. Deliberately not building

- **Multiplayer** — not until single-player retention is proven.
- **Other sports** — not until the football deck is genuinely good. The name permits it; the
  roadmap doesn't yet.
- **Current players** — they reintroduce the refresh burden that legends-only removes.
- **Club badges, crests and kit marks** — trademarks, and not covered by any photo licence.
- **Agency photography** (Getty, PA, Reuters) — aggressively enforced and not worth the exposure.
- **Weekly and all-time boards for Daily Ranked** — after it proves out. Endless has today, this
  week and this month (§13, §14) and no all-time board.

---

## 17. Site structure

Bigger Than is the brand; football higher or lower is its first game. No trailing slashes anywhere.

```
/                                  homepage: the brand, one line on the idea, a card per game
│                                  (Football Legends today, straight to its deck; Football
│                                  Managers as a "Coming soon" card). Static, no JS.
└── /football-higher-or-lower      football hub: football higher or lower in general, and a
    │                              card per deck (Legends today). Static, no JS.
    └── /legends                   the Legends deck: its intro and the three modes. Static,
        │                          no JS. Where "Play" goes.
        ├── /friendly              the game: Friendly Mode. Fixed-height, no scroll.
        └── /endless               the game: Endless. The same screen, with a clock.
            └── /leaderboard       Endless's boards: today, this week, this month, and this
                                   device's own best runs. A page that scrolls.

/about  /credits  /privacy         the stats and how to play; photo credits; what the site keeps
```

- **The football hub is general.** It says what football higher or lower is — two footballers,
  one stat, and the stat keeps changing — and nothing specific to one deck. Each deck is a card
  linking to its page; more decks become more cards. Below the cards it is the main page for
  "football higher or lower": a long read on how the game works, which every deck shares — a
  round, the changing stat, the ten stats, why the players are retired, Friendly, tips. The
  Legends page has its own long read about its deck, and neither repeats the other.
- **Search.** Every page has its own title and description written for what people search for,
  preview tags with one shared image and the game page's own (no player photos), and structured
  data (`WebSite`
  everywhere; the game and a breadcrumb trail from the homepage on the football pages). The copy
  is visible text below the cards, which stay the first thing on screen. No player stat pages,
  records articles or "coming soon" pages, and no player's figure anywhere on the site.
- **Modes on a deck's page.** Friendly and Endless link to their game pages; the Endless card
  also links to its leaderboard, as does the Endless start panel. Daily Ranked is shown as a
  "Coming soon" card: not a link, not focusable, visibly dimmed, with "Coming soon" written out
  rather than carried by tint alone, and every piece of text still at WCAG AA. It is a card on the
  Legends page, not a page of its own.
- **Canonical rule.** Every page is canonical to itself, with its own title and meta description;
  the 404 has none and is `noindex`. The sitemap lists exactly the canonical pages.
- **Breadcrumb.** The Legends page shows "Football › Legends" above its heading, in a `nav`
  labelled "Breadcrumb" with `aria-current` on the last item. The game page has none: its
  fixed-height screen has no row to spare on a phone, and its title bar already says "Football
  _Legends_".
- **Title bar.** The word _Legends_ (Cinzel, gold) appears only on
  `/football-higher-or-lower/legends` and the pages under it, as "Bigger Than Game — Football
  _Legends_". Everywhere else the bar shows the brand alone. One component; the page decides. On
  very short landscape screens (500px tall or less) the game page's bar drops "— Football Legends"
  too, so it stays one row and the game fits.
- **Navigation** is in the title bar on every page: the brand to `/`, then Play (the Legends
  page), Leaderboards (Endless's), How to play and About, with the current page marked. Play is
  marked current on the football hub and every page under it but the leaderboard, where
  Leaderboards is. Inline on desktop (from 860px); a "Menu" on phones, tablets and short
  landscape screens, which opens over the page rather than pushing it down.
  The footer keeps Leaderboards, Credits, Privacy, GitHub, "Suggest a legend" and "Report a
  problem", on one row down to 320px: below 440px Leaderboards steps out (it is in the Menu and
  on the Endless card), and below 360px GitHub, so it still fits.
- **The Legends page's modes**: Endless first, on a row of its own, with a "See leaderboards"
  button on the right of its card from 900px wide (under its text below that, so the text stays
  centred like the other cards') — a second link beside the card's own, never inside it; then Friendly, then Daily Ranked, each on a full row of its own.
- **Local best** is kept per deck and mode — `bt:best:<deck>:<mode>`, `bt:best:legends:friendly`
  today — and shown only on the game pages under `/legends`.
- **Challenge links** point at the Endless page:
  `/football-higher-or-lower/legends/endless?challenge=…`. That page is indexed like Friendly's,
  with its own title, description, canonical, preview tags (the site's default image) and JSON-LD;
  so is the leaderboard page under it, with a breadcrumb. The footer's "Suggest a legend" and
  "Report a problem" open the form in place on the game page, and go to its `#suggest` and
  `#problem` from everywhere else.

---

## A note on the working prototype

The figures in the HTML prototype are **approximate and from memory**. They are adequate for
feeling out the difficulty curve and useless for shipping. Every number needs checking against a
real source before it enters the deck. The prototype also predates the current stat set — it still
has clean sheets, World Cup stats and a combined career-goals figure, and it is fully client-side,
so it does not reflect the server-authoritative model described in section 3.

---

_Bigger Than — design document, version 3. Captures decisions taken to September 2026._
