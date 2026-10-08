<!--
  The Daily Ranked card's live lines on the Legends page (DESIGN.md §17):
  "Game 12" and the countdown to the next game, then this device's result
  today ("15/20 · 312th of 2,400") or a Play pill. Before launch day, only
  "Game 1 starts in …".

  Worked out in the browser, never at build time, so a static page is never
  a day stale: nothing is drawn until the island has mounted, and the room
  for it is kept so the card doesn't jump. The result is asked for only when
  this device holds a run for today's game (`bt:daily`); the card is a link
  to the game whatever it says.
-->
<script lang="ts">
  import { gameNoAt, nextGameAt } from "@bt/core";
  import type { DailyResult } from "@bt/core";
  import { onMount } from "svelte";
  import { t } from "../i18n";
  import { browserStorage } from "../game/best";
  import {
    dailyScoreText,
    fetchDailyMine,
    gameLabel,
    nextGameText,
    rankLine,
    rememberedRun,
  } from "../game/daily";
  import { storedDeviceId } from "../game/device";

  let now = $state(0);
  let ready = $state(false);
  /** Today's result on this device, once the server has said. */
  let result = $state<DailyResult | null>(null);
  /** This device's run today is still going. */
  let playing = $state(false);

  const gameNo = $derived(gameNoAt(now));
  const nextAt = $derived(nextGameAt(now));
  const resultText = $derived(
    result === null
      ? ""
      : rankLine(result) === ""
        ? dailyScoreText(result.correct, result.bonus)
        : t("mode.ranked.result", {
            score: dailyScoreText(result.correct, result.bonus),
            rank: rankLine(result),
          }),
  );

  async function lookUp(game: number): Promise<void> {
    result = null;
    playing = false;
    const id = storedDeviceId(browserStorage);
    if (game < 1 || id === null || rememberedRun(browserStorage, game) === undefined) return;
    const mine = await fetchDailyMine((input, init) => fetch(input, init), id);
    if (mine === null || mine.gameNo !== game) return;
    if (mine.state === "finished") result = mine.result;
    else playing = mine.state === "playing";
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
  {#if ready}
    {#if gameNo < 1}
      <p class="next">{nextGameText(gameNo, nextAt, now)}</p>
    {:else}
      <p class="game">{gameLabel(gameNo)}</p>
      <p class="next">{nextGameText(gameNo, nextAt, now)}</p>
      {#if result !== null}
        <p class="result">{resultText}</p>
      {:else}
        <span class="play">{playing ? t("daily.resume") : t("mode.ranked.play")}</span>
      {/if}
    {/if}
  {/if}
</div>

<style>
  /* Room for the lines before they're drawn, so the card keeps its height. */
  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--daily-card-status-gap);
    min-height: var(--daily-card-status-h);
  }
  .status p {
    margin: 0;
  }
  .game {
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
    font-size: var(--fs-body);
    line-height: var(--lh-body);
    color: var(--card-body);
  }
  .result {
    font-size: var(--fs-body);
    line-height: var(--lh-body);
    font-variation-settings: var(--fv-caps);
    color: var(--gold);
  }
  /* Looks like the game's gold button; the whole card is the link. It glows
     as the other cards' buttons do on hover and focus, here when the card is
     hovered or its link focused, and stronger when the card is pressed. With
     reduced motion, no press scale: the glow alone, at once (base.css drops
     the transition). */
  .play {
    display: inline-flex;
    align-items: center;
    min-height: var(--target-min);
    margin-top: var(--daily-card-status-gap);
    padding: 0 var(--cta-pad-x);
    border-radius: var(--radius-pill);
    background: var(--gold);
    color: var(--ink);
    font-size: var(--fs-cta);
    font-variation-settings: var(--fv-cta);
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
</style>
