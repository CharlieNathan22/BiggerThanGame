<!--
  Twitch Mode's progress track: one segment per question of the match (10 or
  20), each split in two rows, chat's on top and the streamer's below. A
  question one side got fills in that side's colour; one it missed, the miss
  red; one to come is faint; the question on screen is lit.

  Colour never carries it alone: the track is a progressbar whose value text
  is "Question 7 of 20", the scoreboard says both scores in text, and the
  result panel's strip is labelled question by question.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import type { QuestionResult } from "../../game/stream/match";

  interface Props {
    /** The match's questions. */
    questions: number;
    results: readonly QuestionResult[];
    /** The question on screen, or null between questions. */
    current: number | null;
    label: string;
  }

  let { questions, results, current, label }: Props = $props();

  const steps = $derived(
    Array.from({ length: questions }, (_, i) => {
      const result = results.find((r) => r.index === i + 1);
      return {
        chat: result === undefined ? "todo" : result.chat === "right" ? "hit" : "miss",
        you: result === undefined ? "todo" : result.streamer === "right" ? "hit" : "miss",
        current: current === i + 1,
        final: i + 1 === questions,
      };
    }),
  );
</script>

<div
  class="track"
  role="progressbar"
  aria-label={t("stream.track.region")}
  aria-valuemin={0}
  aria-valuemax={questions}
  aria-valuenow={results.length}
  aria-valuetext={label}
  style:--steps={questions}
>
  {#each steps as step, i (i)}
    <span class="step" class:current={step.current} class:final={step.final}>
      <span class="half chat {step.chat}"></span>
      <span class="half you {step.you}"></span>
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
