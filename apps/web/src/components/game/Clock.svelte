<!--
  The question's clock, big, at the top of the pitch (Endless; Ranked will
  reuse it). Renders `topClock` (../../game/view.ts): the whole seconds left,
  counting down from the question's limit once it can be answered.

  - Calm above five seconds; from five, orange with a soft glow; from three,
    urgent: the pill turns red (the miss colour), grows a little and gives one
    short shake as each of the last seconds ticks over (3, 2, 1).
  - At the player's answer it freezes on that second and dims, and stays so
    through the reveal until the next question can be answered. A timeout
    freezes it on 0, in red.
  - While the score badge takes its spot (`aside`), it steps out of the way
    and comes back as the badge goes. Where the badge has its own spot
    (landscape phones, under the plaque), it stays.
  - Reduced motion: no growing and no shake; the colours and glow stay, and
    the urgent state also gets a heavier figure and an outline, so it never
    rests on colour.

  Only transform and opacity animate. It is a `timer`, not a live region:
  screen readers hear "5 seconds left" and "3 seconds left" once each, from
  the polite region beside it, never a count.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import { clockAnnouncement } from "../../game/view";
  import type { TopClock } from "../../game/view";

  interface Props {
    clock: TopClock | null;
    reducedMotion: boolean;
    /** The score badge is showing where the clock sits. */
    aside?: boolean;
  }

  let { clock, reducedMotion, aside = false }: Props = $props();

  /** A new value for each of the last three seconds while it runs: replays the shake. */
  const tick = $derived(
    clock !== null && clock.running && clock.level === "urgent" && clock.seconds > 0
      ? clock.seconds
      : 0,
  );
  const announcement = $derived(clockAnnouncement(clock));
</script>

{#if clock !== null}
  <div
    class="clock"
    class:warning={clock.level === "warning"}
    class:urgent={clock.level === "urgent"}
    class:frozen={clock.frozen}
    class:aside
    class:still={reducedMotion}
    role="timer"
    aria-label={t("clock.label")}
  >
    <span class="face">
      {#key tick}
        <span class="digits" class:shake={tick > 0 && !reducedMotion}>{clock.seconds}</span>
      {/key}
    </span>
  </div>
{/if}
<p class="sr" aria-live="polite">{announcement}</p>

<style>
  /* Placed by tokens: centred at the top of the pitch, or, on a landscape
     phone (where the plaque holds the top centre), at the top left beside it. */
  .clock {
    position: absolute;
    top: var(--game-clock-top);
    left: var(--game-clock-left);
    z-index: 5;
    pointer-events: none;
    transform: translateX(var(--game-clock-shift));
    transition:
      opacity var(--dur-game-clock-aside) var(--ease),
      transform var(--dur-game-clock-aside) var(--ease);
  }
  /* The score badge has the spot: out of the way, up and smaller. */
  .clock.aside {
    opacity: 0;
    transform: translateX(var(--game-clock-shift)) translateY(var(--game-clock-aside-y))
      scale(var(--game-clock-aside-scale));
  }
  /* Stopped at the answer: dimmed. */
  .clock.frozen {
    opacity: var(--game-clock-frozen-opacity);
  }
  .clock.frozen.aside {
    opacity: 0;
  }

  .face {
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--game-clock-h);
    padding: var(--game-clock-pad);
    border: var(--border) solid var(--game-clock-edge);
    border-radius: var(--radius-pill);
    background: var(--game-clock-bg);
    color: var(--game-clock-text);
    text-shadow: var(--game-clock-glow);
    font-size: var(--fs-game-clock);
    font-variation-settings: var(--fv-num);
    font-variant-numeric: tabular-nums;
    line-height: var(--lh-tight);
    box-shadow: var(--game-clock-shadow);
    transition: transform var(--dur-game-clock-grow) var(--ease);
  }
  /* Two figures' width, whatever they are, so 10 to 9 doesn't move a thing. */
  .digits {
    display: inline-block;
    min-width: 2ch;
    text-align: center;
  }

  .warning .face {
    color: var(--game-clock-warn);
    text-shadow: var(--game-clock-warn-glow);
    box-shadow: var(--game-clock-shadow), var(--game-clock-warn-halo);
  }
  .urgent .face {
    text-shadow: none;
    border-color: var(--game-clock-urgent-edge);
    background: var(--game-clock-urgent-bg);
    color: var(--game-clock-urgent-text);
    box-shadow: var(--game-clock-shadow), var(--game-clock-urgent-halo);
    transform: scale(var(--game-clock-urgent-scale));
  }
  .shake {
    animation: clock-shake var(--dur-game-clock-shake) var(--ease) both;
  }
  @keyframes clock-shake {
    0%,
    100% {
      transform: none;
    }
    20% {
      transform: translateX(calc(-1 * var(--game-clock-shake)));
    }
    40% {
      transform: translateX(var(--game-clock-shake));
    }
    60% {
      transform: translateX(calc(-0.6 * var(--game-clock-shake)));
    }
    80% {
      transform: translateX(calc(0.6 * var(--game-clock-shake)));
    }
  }

  /* Reduced motion: nothing grows, shakes or slides; the urgent state is
     marked by a heavier figure and an outline as well as the red. */
  .still,
  .still .face {
    transition: none;
  }
  .still.aside {
    transform: translateX(var(--game-clock-shift));
  }
  .still.urgent .face {
    transform: none;
    font-variation-settings: var(--fv-display);
    outline: var(--game-clock-still-outline) solid var(--game-clock-urgent-text);
    outline-offset: calc(-1 * var(--game-clock-still-outline) - 2px);
  }
  @media (prefers-reduced-motion: reduce) {
    .clock,
    .face {
      transition: none;
    }
    .shake {
      animation: none;
    }
  }

  /* Landscape phones: the badge sits under the plaque, so the clock stays put. */
  @media (orientation: landscape) and (max-height: 500px) {
    .clock.aside,
    .clock.frozen.aside {
      transform: translateX(var(--game-clock-shift));
    }
    .clock.aside {
      opacity: 1;
    }
    .clock.frozen.aside {
      opacity: var(--game-clock-frozen-opacity);
    }
  }
</style>
