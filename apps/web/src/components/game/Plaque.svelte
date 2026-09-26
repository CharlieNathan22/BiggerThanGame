<!--
  The stat plaque over the divide, and the reel that spins it (DESIGN.md §7).

  `stat` is what the plaque shows at rest. When `spinIndex` is set, the reel
  runs once for that round and lands on `spinTo`: eleven other labels, then
  the target, with the tier colour changing part-way through and a pop as it
  settles. All of that is decoration; which stat, and whether to spin at all,
  come from the state machine.
-->
<script lang="ts">
  import { STAT_KEYS } from "@bt/core";
  import type { StatKey, StatPayload, Tier } from "@bt/core";
  import { untrack } from "svelte";
  import { statLabel } from "../../i18n";
  import { TIER_COLOUR } from "../../lib/tiers";
  import type { Timings } from "../../game/timing";
  import { reelStrip } from "../../game/view";

  interface Props {
    stat: StatPayload | null;
    /** The round whose spin is showing, or null when the reel is at rest. */
    spinIndex: number | null;
    spinTo: StatPayload | null;
    timings: Timings;
    reducedMotion: boolean;
  }

  let { stat, spinIndex, spinTo, timings, reducedMotion }: Props = $props();

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

<div
  class="plaque"
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
    transition: background-color var(--dur-tint) var(--ease);
  }
  .plaque::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: var(--radius-pill);
    background: var(--plaque-gloss);
  }
  .plaque.pop {
    animation: pop var(--dur-pop) var(--ease);
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
  }
</style>
