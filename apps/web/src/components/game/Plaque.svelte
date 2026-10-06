<!--
  The stat plaque over the divide, and the reel that spins it (DESIGN.md §7).

  The reel is a drum: the labels sit round a cylinder (--drum-step apart,
  --drum-radius-ratio plaque-heights out) and the drum turns, so while it
  spins each label tilts away and shrinks towards the top and bottom edges,
  fading there, with the one in the middle flat. Once it lands the drum is
  swapped for a flat line, so the stat is crisp. The plaque is raised (an
  inner bevel), glazed (a gloss over its top half), rimmed in gold and glows
  in its tier's colour; a sheen sweeps across it when the wheel lands and as
  the title card hands over "Question 1 of 20". With reduced motion the
  label just changes, with no sheen; the gloss, rim and glow stay.

  `stat` is what the plaque shows at rest. When `spinIndex` is set, the reel
  runs once for that round and lands on `spinTo`: eleven other labels, then
  the target, with the tier colour changing part-way through and a pop as it
  settles. All of that is decoration; which stat, and whether to spin at all,
  come from the state machine.

  Before round one's wheel has spun it reads `lead` ("Question 1 of 20"), and
  the first spin starts from that line and scrolls on into the stat. At a
  run's start (`stage`) it fades in as the title card glides into it
  (`title`), then holds with a gold shimmer and a pulsing glow while round
  one's photos load (`hold`). With reduced motion it fades in and holds still.

  On the final question (`final`) the plaque wears a gold ring and a gold
  "Final question" tab sits on its top edge. The tab is hidden from screen
  readers, which hear "Final question" in the live region.

  In a timed mode (`clock`, Endless) a thin line along the plaque's bottom
  edge drains as the question's seconds go: faint, orange from five seconds
  out, red from three, the same as the big clock at the top (Clock.svelte),
  from the same `now`. With reduced motion it steps down a second at a time.
  It only draws time; the controller times out.
-->
<script lang="ts">
  import { STAT_KEYS } from "@bt/core";
  import type { NamedVariant, StatKey, StatPayload, Tier } from "@bt/core";
  import { untrack } from "svelte";
  import { statLabel, t } from "../../i18n";
  import { TIER_COLOUR } from "../../lib/tiers";
  import type { QuestionClock } from "../../game/machine";
  import type { Timings } from "../../game/timing";
  import { clockView, reelStrip } from "../../game/view";

  interface Props {
    stat: StatPayload | null;
    /** The round whose spin is showing, or null when the reel is at rest. */
    spinIndex: number | null;
    spinTo: StatPayload | null;
    timings: Timings;
    reducedMotion: boolean;
    /** The final question is on screen. */
    final?: boolean;
    /** What it reads before any stat is on it: "Question 1 of 20". */
    lead?: string | null;
    /** The title card gliding into it, or the hold for round one's photos. */
    stage?: "title" | "hold" | null;
    /** The question's clock, while it runs, in a timed mode. */
    clock?: QuestionClock | null;
    /** `performance.now()` this frame, from the game's one frame loop. */
    now?: number;
    /** The Endless variant: a squad reads club goals as "Total career club goals". */
    variant?: NamedVariant | undefined;
    /**
     * A line under the plaque once the stat is on it: in a squad, what club
     * goals count ("Whole career, not just Barcelona"). Empty for none.
     */
    note?: string;
  }

  let {
    stat,
    spinIndex,
    spinTo,
    timings,
    reducedMotion,
    final = false,
    lead = null,
    stage = null,
    clock = null,
    now = 0,
    variant,
    note = "",
  }: Props = $props();

  const label = (key: StatKey) => statLabel(key, variant);

  const time = $derived(clock === null ? null : clockView(clock, now, reducedMotion));

  let strip: StatKey[] = $state([]);
  /** The line the spin starts from, when it starts from `lead`. */
  let from: string | null = $state(null);
  let offset = $state(0);
  let moving = $state(false);
  let tint: Tier | null = $state(null);
  let pop = $state(false);
  /** The reel is at rest: drawn flat, not as a drum. */
  let landed = $state(true);
  /** Counts landings, to replay the sheen for each. */
  let sheen = $state(0);

  $effect(() => {
    if (spinIndex === null) {
      moving = false;
      landed = true;
      strip = [];
      from = null;
      tint = null;
      return;
    }
    const target = untrack(() => spinTo);
    if (target === null) return;

    const keys = reelStrip(target.key, STAT_KEYS, Math.random);
    const start = untrack(() => lead);
    // Starting from "Question 1 of 20", that line is the strip's first row.
    const last = keys.length - (start === null ? 1 : 0);
    from = start;
    strip = keys;
    moving = false;
    offset = 0;
    tint = null;

    if (untrack(() => reducedMotion)) {
      offset = last;
      tint = target.tier;
      landed = true;
      return;
    }
    landed = false;

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
    timers.push(
      setTimeout(() => {
        pop = true;
        landed = true;
        sheen += 1;
      }, spin + land),
    );

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  });

  /** The row facing the front: the one the reel is on. */
  const front = $derived(strip.length > 0 ? offset : 0);

  const rows: string[] = $derived(
    strip.length > 0
      ? [...(from === null ? [] : [from]), ...strip.map(label)]
      : stat
        ? [label(stat.key)]
        : lead !== null
          ? [lead]
          : [],
  );
</script>

{#if final}
  <span class="finaltag" aria-hidden="true">{t("final.tag")}</span>
{/if}
{#if stage === "hold"}
  <span class="aura" aria-hidden="true"></span>
{/if}
{#if note !== "" && landed && stat !== null}
  <!-- Under the plaque, once the wheel has landed: what the stat counts here. -->
  <span class="note">{note}</span>
{/if}
<div
  class="plaque"
  data-plaque
  class:final
  class:arriving={stage === "title"}
  class:holding={stage === "hold"}
  class:pop
  style:--tier={tint ? TIER_COLOUR[tint] : undefined}
  onanimationend={(event) => {
    if (event.target === event.currentTarget) pop = false;
  }}
>
  <div class="window" class:spinning={!landed}>
    <div
      class="reel"
      class:moving
      class:flat={landed}
      style:--offset={strip.length > 0 ? offset : 0}
    >
      {#each rows as label, i (i)}
        <span class:front={i === front} style:--i={i}>{label}</span>
      {/each}
    </div>
  </div>
  {#key sheen}
    {#if sheen > 0}
      <span class="sheen" aria-hidden="true"></span>
    {/if}
  {/key}
  {#if stage === "title"}
    <span class="sheen handoff" aria-hidden="true"></span>
  {/if}
  {#if stage === "hold"}
    <span class="shimmer" aria-hidden="true"></span>
  {/if}
  {#if time !== null}
    <span
      class="clock"
      class:warning={time.level === "warning"}
      class:urgent={time.level === "urgent"}
      aria-hidden="true"
    >
      <span class="fill" style:--left={time.fraction}></span>
    </span>
  {/if}
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
    /* The rim and the dark halo. */
    box-shadow: var(--shadow-plaque);
    transition:
      background-color var(--dur-tint) var(--ease),
      box-shadow var(--dur-tint) var(--ease);
  }
  /* And the glow, in the plaque's own tier colour (--plaque-glow-colour, set
     on the plaque in tokens.css so it follows the tier as the wheel changes
     it). Only where color-mix is understood: elsewhere the rim and halo stay
     and there is simply no glow. */
  @supports (color: color-mix(in srgb, red 50%, transparent)) {
    .plaque {
      box-shadow:
        var(--shadow-plaque),
        0 0 var(--plaque-glow-blur) var(--plaque-glow-spread)
          color-mix(in srgb, var(--plaque-glow-colour) var(--plaque-glow-strength), transparent);
    }
  }
  .plaque.final {
    box-shadow: var(--shadow-plaque-final);
  }
  /* A run's start. The title card (Game.svelte) glides into the plaque over
     the pitch's --title-dur; the plaque fades in over the last fifth of it,
     so the one becomes the other. */
  .plaque.arriving {
    animation: plaque-arrive calc(var(--title-dur) * 0.2) var(--ease) calc(var(--title-dur) * 0.8)
      both;
  }
  @keyframes plaque-arrive {
    from {
      opacity: 0;
    }
  }
  /* The hold: a band of light sweeping across, and a gold glow round the
     plaque breathing in and out, so it never looks stuck. */
  .shimmer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: var(--plaque-shimmer);
    transform: translateX(-100%);
    animation: shimmer var(--dur-shimmer) var(--ease-shimmer) infinite;
  }
  @keyframes shimmer {
    to {
      transform: translateX(100%);
    }
  }
  .aura {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
    width: var(--plaque-w);
    height: var(--plaque-h);
    border-radius: var(--radius-pill);
    box-shadow: var(--plaque-aura);
    opacity: var(--plaque-aura-low);
    pointer-events: none;
    animation: aura var(--dur-aura) var(--ease-drift) infinite alternate;
  }
  @keyframes aura {
    to {
      opacity: 1;
    }
  }
  /* Reduced motion stops every animation (base.css); the plaque still fades
     in as the title fades out, and the hold is still. */
  @media (prefers-reduced-motion: reduce) {
    .plaque.arriving {
      animation: plaque-arrive calc(var(--title-dur) * 0.2) var(--ease) calc(var(--title-dur) * 0.8)
        both !important;
    }
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
  /* Straddling the plaque's bottom edge, as the final tag does its top. */
  .note {
    position: absolute;
    left: 50%;
    top: calc(50% + var(--plaque-h) / 2);
    transform: translate(-50%, -50%);
    z-index: 5;
    max-width: calc(100% - 2 * var(--final-tag-inset));
    padding: var(--plaque-note-pad);
    border-radius: var(--radius-pill);
    background: var(--plaque-note-bg);
    color: var(--plaque-note-text);
    font-size: var(--fs-plaque-note);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 0 0 var(--final-tag-halo) var(--night);
    pointer-events: none;
    animation: finaltag-in var(--dur-pop) var(--ease) both;
  }
  @keyframes finaltag-in {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(var(--win-from-scale));
    }
  }
  /* The gold rim, inside the edge: the rim's gradient shows only in a ring
     --plaque-rim-w wide (the box minus its padding). */
  .plaque::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: var(--radius-pill);
    padding: var(--plaque-rim-w);
    background: var(--plaque-rim);
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
  }
  .plaque::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: var(--radius-pill);
    /* The glaze: the drum's shading and reflection, and the raised bevel. */
    background: var(--plaque-gloss);
    box-shadow: var(--plaque-bevel);
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
    .note {
      top: calc(var(--plaque-h) + var(--plaque-top-gap));
    }
    .aura {
      top: calc(var(--plaque-h) / 2 + var(--plaque-top-gap));
    }
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

  /* The drum's window: its perspective, and while it spins a fade at the top
     and bottom edges. */
  .window {
    position: absolute;
    inset: 0;
    perspective: var(--drum-perspective);
  }
  .window.spinning {
    -webkit-mask-image: var(--drum-fade);
    mask-image: var(--drum-fade);
  }
  /* Each label on the cylinder, --i steps round; the drum turns --offset
     steps. The one facing front sits exactly where a flat label would. */
  .reel {
    position: absolute;
    inset: 0;
    --drum-r: calc(var(--plaque-h) * var(--drum-radius-ratio));
    transform-style: preserve-3d;
    will-change: transform;
    transform: translateZ(calc(-1 * var(--drum-r))) rotateX(calc(var(--offset) * var(--drum-step)));
  }
  .reel.moving:not(.flat) {
    transition: transform var(--dur-spin) var(--ease-spin);
  }
  .reel span {
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
    transform: rotateX(calc(var(--i) * -1 * var(--drum-step))) translateZ(var(--drum-r));
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
  /* At rest: a flat line, only the landed label, crisp. */
  .reel.flat,
  .reel.flat span {
    transform: none;
  }
  .reel.flat span:not(.front) {
    visibility: hidden;
  }

  /* The sheen: one streak of light across the glass, when the wheel lands
     and as the title card becomes the plaque's line. Nothing with reduced
     motion (base.css stops it, and at rest it is invisible). */
  .sheen {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: var(--plaque-sheen);
    opacity: 0;
    transform: translateX(-100%);
    animation: sheen var(--dur-sheen) var(--ease-sheen) both;
  }
  .sheen.handoff {
    animation-delay: calc(var(--title-dur) * 0.85);
  }
  @keyframes sheen {
    from {
      opacity: 1;
      transform: translateX(-100%);
    }
    to {
      opacity: 1;
      transform: translateX(100%);
    }
  }

  /* The clock: a bar along the bottom edge, clipped to the pill by the plaque,
     draining from the right. Transform only, so it costs no layout. */
  .clock {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: var(--clock-bar-h);
    pointer-events: none;
    background: var(--clock-track);
  }
  .clock .fill {
    position: absolute;
    inset: 0;
    background: var(--clock-bar);
    transform-origin: left center;
    transform: scaleX(var(--left));
  }
  /* The same colours as the big clock: orange from five seconds, red from three. */
  .clock.warning .fill {
    background: var(--clock-bar-warn);
  }
  .clock.urgent .fill {
    background: var(--clock-bar-urgent);
  }
</style>
