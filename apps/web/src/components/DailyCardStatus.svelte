<!--
  The Daily Ranked card's live lines on the Legends page (DESIGN.md §17):
  "Game 12" and the countdown to the next game, then one action area in the
  button's place:

  - while this device is looked up (`/api/board/daily/me`), a dimmed
    placeholder the size of Play, so nothing swaps or jumps when it answers;
  - "Play today's game", or "Carry on" for a run still going: the gold pill;
  - once today's game is done, the result ("13/20 · 19th of 30") and a muted
    "Today's game completed — come back tomorrow", status text, not a button.

  A device with no id (nothing ever played or published), or storage
  blocked, is shown Play at once; a lookup that fails shows Play too. The
  action area keeps one height in every state, and the lines above it keep
  theirs before they're filled, so the card never changes size. Worked out
  in the browser, never at build time, so a static page is never a day
  stale. The whole card is the link to the game whatever it says.
-->
<script lang="ts">
  import { gameNoAt, nextGameAt } from "@bt/core";
  import { onMount } from "svelte";
  import { t } from "../i18n";
  import { browserStorage } from "../game/best";
  import {
    cardAction,
    cardNeedsLookup,
    cardResultText,
    fetchDailyMine,
    gameLabel,
    nextGameText,
  } from "../game/daily";
  import type { CardAction } from "../game/daily";
  import { storedDeviceId } from "../game/device";

  let now = $state(0);
  let ready = $state(false);
  let action = $state<CardAction>({ kind: "pending" });

  const gameNo = $derived(gameNoAt(now));
  const nextAt = $derived(nextGameAt(now));

  async function lookUp(game: number): Promise<void> {
    const id = storedDeviceId(browserStorage);
    if (!cardNeedsLookup(game, id) || id === null) {
      action = cardAction(game, null);
      return;
    }
    action = cardAction(game, undefined);
    const mine = await fetchDailyMine((input, init) => fetch(input, init), id);
    // A lookup overtaken by midnight's is dropped.
    if (game === gameNo) action = cardAction(game, mine);
  }

  onMount(() => {
    now = Date.now();
    ready = true;
    void lookUp(gameNo);
    const timer = setInterval(() => {
      const before = gameNo;
      now = Date.now();
      // Past midnight it's a new game, and nobody has played it yet.
      if (gameNo !== before) void lookUp(gameNo);
    }, 30_000);
    return () => clearInterval(timer);
  });
</script>

<div class="status">
  <p class="game">{ready && gameNo >= 1 ? gameLabel(gameNo) : ""}</p>
  <p class="next">{ready ? nextGameText(gameNo, nextAt, now) : ""}</p>
  <div class="action">
    {#if ready && gameNo < 1}
      <!-- Before launch day: the countdown above, and nothing to press. -->
    {:else if action.kind === "done"}
      <p class="result">{cardResultText(action.result)}</p>
      <p class="done" role="status">{t("daily.cardDone")}</p>
    {:else if action.kind === "play" || action.kind === "resume"}
      <span class="pill play">
        {action.kind === "resume" ? t("daily.resume") : t("mode.ranked.play")}
      </span>
    {:else}
      <!-- Still asking: Play's size, dimmed and empty, so the answer swaps nothing. -->
      <span class="pill pending" aria-hidden="true"
        ><span class="ghost">{t("mode.ranked.play")}</span></span
      >
    {/if}
  </div>
</div>

<style>
  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--daily-card-status-gap);
  }
  .status p {
    margin: 0;
  }
  /* Each line keeps its height while it's still empty, before mount. */
  .game {
    min-height: 1lh;
    font-family: var(--font-display);
    font-size: var(--fs-daily-card-game);
    letter-spacing: var(--tracking-display);
    background: var(--legends-gradient);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: var(--legends-shadow);
  }
  .next {
    min-height: 1lh;
    font-size: var(--fs-body);
    line-height: var(--lh-body);
    color: var(--card-body);
  }
  /* The narrowest phones: the countdown can take two lines ("Next game in
     23 hours 59 minutes"), so two are kept for it from the start, and a
     shorter one sits in their middle. */
  @media (max-width: 359px) {
    .next {
      min-height: 2lh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }
  /* The button's place: one height whatever is in it (the result and the
     "come back tomorrow" line need the most), so the card never jumps. */
  .action {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--daily-card-status-gap);
    min-height: var(--daily-card-action-h);
    margin-top: var(--daily-card-status-gap);
  }
  .result {
    font-size: var(--fs-body);
    line-height: var(--lh-body);
    font-variation-settings: var(--fv-caps);
    color: var(--gold);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    min-height: var(--target-min);
    padding: 0 var(--cta-pad-x);
    border-radius: var(--radius-pill);
    font-size: var(--fs-cta);
    font-variation-settings: var(--fv-cta);
  }
  /* Looks like the game's gold button; the whole card is the link. It glows
     as the other cards' buttons do on hover and focus, here when the card is
     hovered or its link focused, and stronger when the card is pressed. With
     reduced motion, no press scale: the glow alone, at once (base.css drops
     the transition). */
  .play {
    background: var(--gold);
    color: var(--ink);
    box-shadow: var(--glow);
    transition:
      box-shadow var(--dur-hover),
      transform var(--dur-press);
  }
  :global(.card.open:hover) .play,
  :global(.card.open:has(a:focus-visible)) .play {
    box-shadow: var(--glow-hover);
  }
  :global(.card.open:active) .play {
    box-shadow: var(--glow-strong);
    transform: scale(var(--press-scale));
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.card.open:active) .play {
      transform: none;
    }
  }
  /* While asking: Play's size, a faint gold, no glow, no words. */
  .pending {
    background: var(--daily-card-pending-bg);
  }
  .ghost {
    visibility: hidden;
  }
  /* Today's game is done: status text in a muted pill, not a button. No glow,
     nothing on hover or press, the card's own body colour (AA on the card). */
  .done {
    max-width: 100%;
    padding: var(--daily-card-done-pad);
    border-radius: var(--radius-pill);
    background: var(--daily-card-done-bg);
    color: var(--card-body);
    font-size: var(--fs-caption);
    line-height: var(--daily-card-done-lh);
    text-align: center;
  }
</style>
