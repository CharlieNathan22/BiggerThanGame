<!--
  Twitch Mode's progress track: one segment per question of the match (10 or
  20), each split in two rows, chat's on top and the streamer's below. A
  question one side got fills in that side's colour; one it missed, the miss
  red; one to come is faint; the question on screen is lit.

  Colour never carries it alone: the track is a progressbar whose value text
  is "Question 7 of 20", the scoreboard says both scores in text, and the
  result panel's strip is labelled question by question.

  1v1 uses it too (`region` names it), with this player's row on top, as
  they come first on its scoreboard (`flip`), and its sudden-death questions
  as further segments after the match's own (`extra`), set a little apart.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import type { QuestionResult } from "../../game/stream/match";

  interface Props {
    /** The match's questions. */
    questions: number;
    /** Each question as it ended: the top row's side (`chat`), and the bottom row's (`streamer`). */
    results: readonly Pick<QuestionResult, "index" | "chat" | "streamer">[];
    /** The question on screen, or null between questions. */
    current: number | null;
    label: string;
    /** The track's name for a screen reader. Twitch Mode's by default. */
    region?: string;
    /** Questions past the match's own (1v1's sudden death), drawn after them. */
    extra?: number;
    /** The bottom row's side on top instead, and the top's below. */
    flip?: boolean;
  }

  let { questions, results, current, label, region, extra = 0, flip = false }: Props = $props();

  const steps = $derived(
    Array.from({ length: questions + extra }, (_, i) => {
      const result = results.find((r) => r.index === i + 1);
      return {
        chat: result === undefined ? "todo" : result.chat === "right" ? "hit" : "miss",
        you: result === undefined ? "todo" : result.streamer === "right" ? "hit" : "miss",
        current: current === i + 1,
        final: i + 1 === questions,
        sudden: i + 1 > questions,
        first: i === questions,
      };
    }),
  );
</script>

<div
  class="track"
  role="progressbar"
  aria-label={region ?? t("stream.track.region")}
  aria-valuemin={0}
  aria-valuemax={questions + extra}
  aria-valuenow={results.length}
  aria-valuetext={label}
  style:--steps={questions + extra}
>
  {#each steps as step, i (i)}
    <span
      class="step"
      class:current={step.current}
      class:final={step.final}
      class:sudden={step.sudden}
      class:first={step.first}
    >
      {#if flip}
        <span class="half you {step.you}"></span>
        <span class="half chat {step.chat}"></span>
      {:else}
        <span class="half chat {step.chat}"></span>
        <span class="half you {step.you}"></span>
      {/if}
    </span>
  {/each}
</div>

<style>
  .track {
    flex: none;
    display: grid;
    grid-template-columns: repeat(var(--steps), 1fr);
    gap: var(--track-gap);
    padding: 3px var(--track-pad-x);
    background: var(--track-bg);
  }
  .step {
    display: grid;
    grid-template-rows: var(--dual-track-row) var(--dual-track-row);
    gap: var(--dual-track-gap);
    border-radius: var(--track-radius);
    transition: box-shadow var(--dur-tint);
  }
  .half {
    border-radius: var(--track-radius);
    background: var(--track-todo);
    transition: background-color var(--dur-tint);
  }
  .final .half.todo {
    background: var(--track-final);
  }
  .chat.hit {
    background: var(--stream-chat);
  }
  .you.hit {
    background: var(--stream-you);
  }
  .half.miss {
    background: var(--miss);
  }
  .step.current {
    box-shadow: var(--track-current-glow);
  }
  /* Sudden death: after the match's own questions, a little apart. */
  .step.first {
    margin-left: var(--track-gap);
  }
  .current .half.todo {
    background: var(--track-current);
    animation: pulse var(--dur-track-pulse) var(--ease-drift) infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: var(--track-pulse-low);
    }
  }
</style>
