<!--
  The progress track, in a play with a win target (Friendly's twenty, a
  squad's questions): a thin row of segments under the title bar, one per
  round. An answered round fills in gold, the miss in red, and the round on
  screen is lit. Thin enough to cost the game almost no height on a phone.
  Past `DENSE_STEPS` (a big squad's 68) the segments close up into one
  continuous bar, rather than crowding into slivers.

  The last segment, the final question, is gold. While the final question is
  on screen a gold "Final question" tag hangs under the track's end, over the
  pitch rather than pushing it down.

  Colour never carries it alone: the bar is a progressbar whose value text is
  "Question 7 of 20" ("Final question — question 20 of 20"), the live region
  says the same with each question, and the title bar shows the score as
  "7 / 20". The tag is decoration for sighted players, hidden from screen
  readers, which hear it in the live region.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import type { TrackStep } from "../../game/view";

  interface Props {
    steps: readonly TrackStep[];
    /** Rounds answered so far. */
    answered: number;
    /** "Question 7 of 20". */
    label: string;
    /** The final question is on screen. */
    final: boolean;
  }

  let { steps, answered, label, final }: Props = $props();

  /** More steps than this and the track is one continuous bar. */
  const DENSE_STEPS = 20;
</script>

<div
  class="track"
  role="progressbar"
  aria-label={t("progress.label")}
  aria-valuemin={0}
  aria-valuemax={steps.length}
  aria-valuenow={answered}
  aria-valuetext={label}
  class:dense={steps.length > DENSE_STEPS}
  style:--steps={steps.length}
>
  {#each steps as step, i (i)}
    <span class="step {step.kind}" class:current={step.current} class:final={step.final}></span>
  {/each}
  {#if final}
    <span class="tag" aria-hidden="true">{t("final.tag")}</span>
  {/if}
</div>

<style>
  .track {
    position: relative;
    flex: none;
    display: grid;
    grid-template-columns: repeat(var(--steps), 1fr);
    gap: var(--track-gap);
    height: var(--track-h);
    padding: 0 var(--track-pad-x);
    background: var(--track-bg);
  }
  .track.dense {
    gap: 0;
  }
  .step {
    border-radius: var(--track-radius);
    background: var(--track-todo);
    transition:
      background-color var(--dur-tint),
      box-shadow var(--dur-tint);
  }
  .dense .step {
    border-radius: 0;
  }
  .dense .step:first-child {
    border-radius: var(--track-radius) 0 0 var(--track-radius);
  }
  .dense .step:last-of-type {
    border-radius: 0 var(--track-radius) var(--track-radius) 0;
  }
  .step.hit {
    background: var(--track-hit);
  }
  .step.miss {
    background: var(--miss);
  }
  /* The round on screen: lit and glowing, pulsing while it waits for an
     answer. Once answered it keeps its glow over its colour until the next
     round is dealt. No pulse with reduced motion. */
  .step.current {
    box-shadow: var(--track-current-glow);
  }
  .step.todo.current {
    background: var(--track-current);
    animation: pulse var(--dur-track-pulse) var(--ease-drift) infinite alternate;
  }
  /* The final question's segment: gold before it is reached, lit gold while
     it is asked, and ringed in gold once answered. */
  .step.final.todo {
    background: var(--track-final);
  }
  .step.final.todo.current {
    background: var(--gold);
  }
  .step.final.current {
    box-shadow: var(--track-final-glow);
  }
  .tag {
    position: absolute;
    z-index: 6;
    top: calc(100% + var(--final-tag-gap));
    right: var(--final-tag-inset);
    padding: var(--final-tag-pad);
    border-radius: var(--radius-pill);
    background: var(--final-tag-bg);
    color: var(--final-tag-text);
    font-size: var(--fs-final-tag);
    font-variation-settings: var(--fv-caps);
    letter-spacing: var(--final-tag-tracking);
    text-transform: uppercase;
    white-space: nowrap;
    box-shadow: var(--glow-hover);
    pointer-events: none;
    animation: tag-in var(--dur-pop) var(--ease) both;
  }
  @keyframes tag-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
  @keyframes pulse {
    from {
      opacity: 1;
    }
    to {
      opacity: var(--track-pulse-low);
    }
  }
</style>
