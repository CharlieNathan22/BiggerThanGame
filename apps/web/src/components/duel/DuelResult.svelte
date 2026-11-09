<!--
  1v1's full-time panel, in the game-over panel's place: who won (or a draw),
  the final score, how it was decided when it wasn't simply the higher score
  (sudden death, a forfeit), the series so far, the question-by-question strip
  for both players with sudden death after a gap, then Share, Rematch, New
  room and Try other modes. There is no Publish, no challenge link and no
  local best: a match isn't a run.

  A rematch starts when both have asked: until then the button says who it is
  waiting for. With the other player gone there is none.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import { LEGENDS_PATH } from "../../lib/paths";
  import {
    canRematch,
    duelOutcome,
    duelQuestions,
    duelScore,
    opponentSeat,
  } from "../../game/duel/room";
  import type { DuelView } from "../../game/duel/room";
  import {
    opponentName,
    resultNote,
    resultText,
    seriesText,
    stripLabel,
  } from "../../game/duel/view";

  interface Props {
    view: DuelView;
    /** What the last share did; "" for nothing. */
    note: string;
    noteFading: boolean;
    copyByHand: string | null;
    /** The room's last refusal, in words; "" for none. */
    refused: string;
    /** The connection is up: a rematch can be asked for. */
    connected: boolean;
    onshare: () => void;
    onrematch: () => void;
    onnewroom: () => void;
    againButton?: HTMLElement | undefined;
  }

  let {
    view,
    note,
    noteFading,
    copyByHand,
    refused,
    connected,
    onshare,
    onrematch,
    onnewroom,
    againButton = $bindable(),
  }: Props = $props();

  const outcome = $derived(duelOutcome(view));
  const score = $derived(duelScore(view));
  const name = $derived(opponentName(view));
  const questions = $derived(duelQuestions(view));
  /** The match's own questions, then sudden death's, apart. */
  const regular = $derived(view.result?.questions ?? view.settings.questions);
  const rematchable = $derived(canRematch(view));
  const asked = $derived(view.rematch.includes(view.you));
  const theyAsked = $derived(view.rematch.includes(opponentSeat(view)));
  const detail = $derived(resultNote(view));
  const rows = $derived([
    { side: "you" as const, label: t("duel.score.you") },
    { side: "them" as const, label: name },
  ]);
  const cells = $derived(
    Array.from({ length: Math.max(regular, questions.length) }, (_, i) => questions[i] ?? null),
  );
</script>

<div class="panel">
  <p class="heading">{t("duel.result.heading")}</p>
  <h2 class="winner" class:lost={outcome === "lost"} class:draw={outcome === "draw"}>
    {resultText(view)}
  </h2>
  <p class="score num">
    <span class="sr">{t("duel.scoreboard.label", { you: score.you, name, them: score.them })}</span>
    <span class="you" aria-hidden="true">{score.you}</span>
    <span class="dash" aria-hidden="true">–</span>
    <span class="them" aria-hidden="true">{score.them}</span>
  </p>
  <p class="sides" aria-hidden="true">
    <span class="you">{t("duel.score.you")}</span>
    <span class="them">{name}</span>
  </p>
  {#if detail !== ""}
    <p class="note">{detail}</p>
  {/if}
  <p class="series">{seriesText(view)}</p>

  {#if questions.length > 0}
    <div class="strip" role="img" aria-label={stripLabel(view)}>
      <p class="striphead" aria-hidden="true">{t("duel.result.strip")}</p>
      {#each rows as row (row.side)}
        <div class="row" aria-hidden="true">
          <span class="label {row.side}">{row.label}</span>
          <span class="cells" style:--cells={cells.length}>
            {#each cells as cell, i (i)}
              <span
                class="cell {row.side}"
                class:hit={cell !== null && cell[row.side]}
                class:miss={cell !== null && !cell[row.side]}
                class:sudden={i >= regular}
                class:first={i === regular}
              ></span>
            {/each}
          </span>
        </div>
      {/each}
    </div>
  {/if}

  <div class="actions">
    <button
      class="cta"
      bind:this={againButton}
      disabled={!rematchable || asked || !connected}
      onclick={onrematch}
    >
      {asked && rematchable ? t("duel.result.rematchWaiting", { name }) : t("duel.result.rematch")}
    </button>
    <p class="hint" role="status">
      {#if !rematchable}
        {t("duel.result.noRematch", { name })}
      {:else if theyAsked && !asked}
        {t("duel.result.rematchAsked", { name })}
      {/if}
    </p>
    <p class="problem" role="alert">{refused}</p>
    <div class="twin">
      <button class="secondary" onclick={onshare}>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
        {t("over.share")}
      </button>
      <button class="secondary" onclick={onnewroom}>{t("duel.result.newRoom")}</button>
    </div>
    <p class="status" class:fading={noteFading} role="status">{note}</p>
    {#if copyByHand !== null}
      <textarea class="copy" readonly rows="3" aria-label={t("over.shareText")}
        >{copyByHand}</textarea
      >
    {/if}
    <a class="cta othermodes" href={LEGENDS_PATH}>{t("over.otherModes")}</a>
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: var(--duel-panel-w);
    max-height: 100%;
    overflow-y: auto;
    padding: var(--stream-panel-pad);
    border: 1px solid var(--card-edge);
    border-radius: var(--card-radius);
    background: var(--card-surface);
    box-shadow: var(--card-shadow);
    color: var(--chalk);
    text-align: center;
    -webkit-user-select: none;
    user-select: none;
  }
  .heading {
    margin: 0;
    font-size: var(--fs-stream-side);
    font-variation-settings: var(--fv-caps);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
  }
  .winner {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--fs-stream-start);
    font-weight: var(--fw-legends);
    color: var(--gold);
    text-shadow: var(--heading-glow);
  }
  .winner.lost {
    color: var(--duel-them);
    text-shadow: none;
  }
  .winner.draw {
    color: var(--chalk);
    text-shadow: none;
  }
  .score {
    margin: 0;
    font-size: calc(var(--fs-stream-score) * 1.2);
    line-height: 1;
  }
  .you {
    color: var(--duel-you);
  }
  .them {
    color: var(--duel-them);
  }
  .score .you {
    text-shadow: var(--glow);
  }
  .dash {
    margin: 0 0.15em;
    color: var(--dim);
  }
  .sides {
    display: flex;
    justify-content: center;
    gap: 2em;
    max-width: 100%;
    margin: 0;
    font-size: var(--fs-stream-side);
    font-variation-settings: var(--fv-caps);
  }
  .sides .you {
    text-transform: uppercase;
  }
  .sides .them {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note,
  .series,
  .hint,
  .problem {
    margin: 0;
    font-size: var(--fs-stream-status);
  }
  .note {
    color: var(--chalk);
  }
  .series {
    color: var(--gold);
    font-variation-settings: var(--fv-nav);
  }
  .hint {
    min-height: 1.3em;
    color: var(--duel-them);
  }
  .hint:empty,
  .problem:empty {
    display: none;
  }
  .problem {
    color: var(--stream-status-bad);
  }
  .strip {
    width: 100%;
    margin-top: 6px;
  }
  .striphead {
    margin: 0 0 4px;
    font-size: var(--fs-stream-status);
    color: var(--dim);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 6.5em) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    font-size: var(--fs-stream-status);
    font-variation-settings: var(--fv-caps);
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(var(--cells), 1fr);
    gap: 3px;
  }
  .cell {
    aspect-ratio: 1;
    max-height: 22px;
    border-radius: 4px;
    background: var(--track-todo);
  }
  .cell.you.hit {
    background: var(--duel-you);
  }
  .cell.them.hit {
    background: var(--duel-them);
  }
  .cell.miss {
    background: var(--miss);
  }
  /* Sudden death's questions: rounder, and apart from the match's own. */
  .cell.sudden {
    border-radius: 50%;
  }
  .cell.first {
    margin-left: 4px;
  }
  .actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    width: 100%;
    margin-top: 6px;
  }
  .twin {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--cta-h);
    padding: 0 var(--cta-pad-x);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--gold);
    color: var(--ink);
    font: inherit;
    font-variation-settings: var(--fv-caps);
    text-decoration: none;
    box-shadow: var(--glow);
    cursor: pointer;
  }
  .cta:hover:not(:disabled),
  .cta:focus-visible {
    box-shadow: var(--glow-hover);
  }
  .cta:disabled {
    opacity: 0.6;
    cursor: default;
    box-shadow: none;
  }
  .cta:focus-visible,
  .secondary:focus-visible {
    outline: 2px solid var(--chalk);
    outline-offset: 3px;
  }
  /* The game-over panel's last button: Play again's gold, in a band of chrome
     with a sheen that sweeps across the band on hover. */
  .othermodes {
    padding: 0 calc(var(--cta-pad-x) - var(--chrome-band-w));
    border: var(--chrome-band-w) solid transparent;
    background:
      linear-gradient(var(--gold), var(--gold)) padding-box,
      var(--chrome-sheen) border-box 100% 0 / 300% 100% no-repeat,
      var(--chrome-band) border-box;
  }
  .othermodes:hover {
    animation: chrome-sheen var(--dur-chrome-sheen) var(--ease) 1;
  }
  @keyframes chrome-sheen {
    from {
      background-position:
        0 0,
        100% 0,
        0 0;
    }
    to {
      background-position:
        0 0,
        0% 0,
        0 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .othermodes:hover {
      animation: none;
    }
  }
  .secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--btn2-icon-gap);
    min-height: var(--cta-h);
    padding: 0 var(--btn2-pad-x);
    border: var(--btn2-border) solid var(--btn2-edge);
    border-radius: var(--radius-pill);
    background: var(--btn2-bg);
    color: var(--btn2-text);
    font: inherit;
    font-variation-settings: var(--fv-caps);
    text-shadow: var(--glow);
    cursor: pointer;
  }
  .secondary:hover,
  .secondary:focus-visible {
    background: var(--btn2-bg-hover);
    box-shadow: var(--glow-hover);
  }
  .icon {
    width: var(--btn2-icon);
    height: var(--btn2-icon);
    fill: none;
    stroke: currentColor;
    stroke-width: var(--btn2-icon-stroke);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .status {
    min-height: 1.3em;
    margin: 0;
    font-size: var(--fs-stream-status);
    color: var(--gold);
  }
  .status.fading {
    opacity: 0;
    transition: opacity var(--dur-notice-fade);
  }
  .copy {
    width: 100%;
    font: inherit;
    font-size: var(--fs-stream-status);
    -webkit-user-select: text;
    user-select: text;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  /* Short screens: the actions a little lower, so they all fit. */
  @media (max-height: 760px) {
    .panel {
      gap: 2px;
      padding-top: 12px;
      padding-bottom: 12px;
    }
    .cta,
    .secondary {
      min-height: var(--target-min);
    }
  }
</style>
