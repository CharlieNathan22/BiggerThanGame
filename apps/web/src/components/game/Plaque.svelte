<!--
  The stat plaque over the divide, and the reel that spins it (DESIGN.md §7).

  `stat` is what the plaque shows at rest. When `spinIndex` is set, the reel
  runs once for that round and lands on `spinTo`: eleven other labels, then
  the target, with the tier colour changing part-way through and a pop as it
  settles. All of that is decoration; which stat, and whether to spin at all,
  come from the state machine.

  On the first deal (`entrance`) the plaque is hidden while the cards slide
  in, then drops into place before the first spin.

  On the final question (`final`) the plaque wears a gold ring and a gold
  "Final question" tab sits on its top edge. The tab is hidden from screen
  readers, which hear "Final question" in the live region.
-->
<script lang="ts">
  import { STAT_KEYS } from "@bt/core";
  import type { StatKey, StatPayload, Tier } from "@bt/core";
  import { untrack } from "svelte";
  import { statLabel, t } from "../../i18n";
  import { TIER_COLOUR } from "../../lib/tiers";
  import type { Timings } from "../../game/timing";
  import { reelStrip } from "../../game/view";
  import type { Entrance } from "../../game/view";

  interface Props {
    stat: StatPayload | null;
    /** The round whose spin is showing, or null when the reel is at rest. */
    spinIndex: number | null;
    spinTo: StatPayload | null;
    timings: Timings;
    reducedMotion: boolean;
    /** The final question is on screen. */
    final?: boolean;
    /** The first deal's kick-off, if it's playing. */
    entrance?: Entrance;
  }

  let {
    stat,
    spinIndex,
    spinTo,
    timings,
    reducedMotion,
    final = false,
    entrance = null,
  }: Props = $props();

  let strip: StatKey[] = $state([]);
  let offset = $state(0);
  let moving = $state(false);
  let tint: Tier | null = $state(null);
  let pop = $state(false);

  $effect(() => {
    if (spinIndex === null) {
      moving = false;
      strip = [];
      tint = null;
      return;
    }
    const target = untrack(() => spinTo);
    if (target === null) return;

    const keys = reelStrip(target.key, STAT_KEYS, Math.random);
    const last = keys.length - 1;
    strip = keys;
    moving = false;
    offset = 0;
    tint = null;

    if (untrack(() => reducedMotion)) {
      offset = last;
      tint = target.tier;
      return;
    }

    const { spin, land, spinTintAt } = untrack(() => timings);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let raf = 0;
    // Two frames, so the strip is laid out at the top before it starts to move.
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        moving = true;
        offset = last;
      });
    });
    timers.push(setTimeout(() => (tint = target.tier), spin * spinTintAt));
    timers.push(setTimeout(() => (pop = true), spin + land));

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  });

  const rows = $derived(strip.length > 0 ? strip : stat ? [stat.key] : []);
</script>

{#if final}
  <span class="finaltag" aria-hidden="true">{t("final.tag")}</span>
{/if}
<div
  class="plaque"
  class:final
  class:intro={entrance === "intro"}
  class:enter={entrance === "enter"}
  class:pop
  style:--tier={tint ? TIER_COLOUR[tint] : undefined}
  onanimationend={() => (pop = false)}
>
  <div class="reel" class:moving style:--offset={strip.length > 0 ? offset : 0}>
    {#each rows as key, i (i)}
      <span>{statLabel(key)}</span>
    {/each}
  </div>
</div>

<style>
  .plaque {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 4;
    width: var(--plaque-w);
    height: var(--plaque-h);
    border-radius: var(--radius-pill);
    background: var(--tier);
    color: var(--ink);
    overflow: hidden;
    box-shadow: var(--shadow-plaque);
    transition:
      background-color var(--dur-tint) var(--ease),
      box-shadow var(--dur-tint) var(--ease);
  }
  .plaque.final {
    box-shadow: var(--shadow-plaque-final);
  }
  /* Centred on the plaque's top edge, over its halo, above the reel. */
  .finaltag {
    position: absolute;
    left: 50%;
    top: calc(50% - var(--plaque-h) / 2);
    transform: translate(-50%, -50%);
    z-index: 5;
    padding: var(--final-tag-pad);
    border-radius: var(--radius-pill);
    background: var(--final-tag-bg);
    color: var(--final-tag-text);
    font-size: var(--fs-final-tag);
    font-variation-settings: var(--fv-caps);
    letter-spacing: var(--final-tag-tracking);
    text-transform: uppercase;
    white-space: nowrap;
    box-shadow:
      0 0 0 var(--final-tag-halo) var(--night),
      var(--glow-hover);
    pointer-events: none;
    animation: finaltag-in var(--dur-pop) var(--ease) both;
  }
  @keyframes finaltag-in {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(var(--win-from-scale));
    }
  }
  .plaque::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: var(--radius-pill);
    background: var(--plaque-gloss);
  }
  /* Short landscape screens: at the top of the divide, clear of both cards
     (Side.svelte reserves the strip). The pop's translate still centres it. */
  @media (orientation: landscape) and (max-height: 500px) {
    .plaque {
      top: calc(var(--plaque-h) / 2 + var(--plaque-top-gap));
    }
    .finaltag {
      top: var(--plaque-top-gap);
    }
  }
  .plaque.pop {
    animation: pop var(--dur-pop) var(--ease);
  }
  /* The first deal: out of sight while the cards slide in, then dropping
     into place, with a little overshoot. */
  .plaque.intro {
    opacity: 0;
  }
  .plaque.enter {
    animation: drop var(--dur-intro-drop) var(--ease-win) var(--intro-drop-delay) both;
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% - var(--intro-drop)));
    }
  }
  @keyframes pop {
    0% {
      transform: translate(-50%, -50%) scale(1);
    }
    38% {
      transform: translate(-50%, -50%) scale(var(--pop-scale));
    }
    100% {
      transform: translate(-50%, -50%) scale(1);
    }
  }

  .reel {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    will-change: transform;
    transform: translateY(calc(var(--plaque-h) * var(--offset) * -1));
  }
  .reel.moving {
    transition: transform var(--dur-spin) var(--ease-spin);
  }
  .reel span {
    height: var(--plaque-h);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    text-align: center;
    font-size: var(--fs-plaque);
    font-variation-settings: var(--fv-plaque);
    line-height: var(--lh-plaque);
    /* If a label ever needs two lines, split it evenly. */
    text-wrap: balance;
    text-shadow: var(--glow);
  }
</style>
