<!--
  Twitch Mode's full-time panel, in the game-over panel's place: the final
  score, who won (or a draw), the question-by-question strip for both sides,
  the shares, then Play again (the same settings), Change questions, Change
  channel, and Try other modes. There's no Publish, no challenge link and no
  local best: a match isn't a run.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import { LEGENDS_PATH } from "../../lib/paths";
  import type { EndReason } from "../../game/machine";
  import type { MatchScore, QuestionResult } from "../../game/stream/match";
  import { stripLabel, winnerOf, winnerText } from "../../game/stream/match";

  interface Props {
    channel: string;
    score: MatchScore;
    results: readonly QuestionResult[];
    /** The match's questions, for the strip's length. */
    questions: number;
    end: EndReason | null;
    touch: boolean;
    drawing: boolean;
    note: string;
    noteFading: boolean;
    copyByHand: string | null;
    onshare: () => void;
    onimage: () => void;
    onagain: () => void;
    onquestions: () => void;
    onchannel: () => void;
    againButton?: HTMLElement | undefined;
  }

  let {
    channel,
    score,
    results,
    questions,
    end,
    touch,
    drawing,
    note,
    noteFading,
    copyByHand,
    onshare,
    onimage,
    onagain,
    onquestions,
    onchannel,
    againButton = $bindable(),
  }: Props = $props();

  const winner = $derived(winnerOf(score));
  const rows = $derived([
    { side: "chat" as const, label: t("stream.score.chat") },
    { side: "streamer" as const, label: channel },
  ]);
  const cells = $derived(Array.from({ length: questions }, (_, i) => results[i] ?? null));
</script>

<div class="panel">
  <p class="heading">{t("stream.result.heading")}</p>
  <p class="score num">
    <span class="sr">
      {t("stream.scoreboard.label", { chat: score.chat, channel, streamer: score.streamer })}
    </span>
    <span class="chat" aria-hidden="true">{score.chat}</span>
    <span class="dash" aria-hidden="true">–</span>
    <span class="you" aria-hidden="true">{score.streamer}</span>
  </p>
  <p class="sides" aria-hidden="true">
    <span class="chat">{t("stream.score.chat")}</span>
    <span class="you">{channel}</span>
  </p>
  <h2 class="winner" class:draw={winner === "draw"} class:chatwin={winner === "chat"}>
    {winnerText(score, channel)}
  </h2>
  {#if end === "network" || end === "disconnected"}
    <p class="note">{t("stream.result.disconnected")}</p>
  {:else if end === "deck-exhausted"}
    <p class="note">{t("stream.result.exhausted")}</p>
  {/if}

  <div class="strip" role="img" aria-label={stripLabel(results, channel)}>
    <p class="striphead" aria-hidden="true">{t("stream.result.strip")}</p>
    {#each rows as row (row.side)}
      <div class="row" aria-hidden="true">
        <span class="label {row.side}">{row.label}</span>
        <span class="cells" style:--cells={questions}>
          {#each cells as cell, i (i)}
            <span
              class="cell {row.side}"
              class:hit={cell !== null && cell[row.side] === "right"}
              class:miss={cell !== null && cell[row.side] !== "right"}
            ></span>
          {/each}
        </span>
      </div>
    {/each}
  </div>

  <div class="actions">
    <button class="cta" bind:this={againButton} onclick={onagain}>{t("stream.result.again")}</button
    >
    <div class="twin">
      <button class="secondary" onclick={onquestions}>{t("stream.result.changeQuestions")}</button>
      <button class="secondary" onclick={onchannel}>{t("stream.result.changeChannel")}</button>
    </div>
    <div class="twin">
      <button class="secondary" onclick={onshare}>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
        {t("over.share")}
      </button>
      <button class="secondary" onclick={onimage} disabled={drawing} aria-busy={drawing}>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {#if touch}
            <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
          {:else}
            <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M5 20h14" />
          {/if}
        </svg>
        {touch ? t("over.shareImage") : t("over.saveImage")}
      </button>
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
    width: var(--stream-panel-w);
    max-width: 640px;
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
  .score {
    margin: 0;
    font-size: calc(var(--fs-stream-score) * 1.2);
    line-height: 1;
  }
  .chat {
    color: var(--stream-chat);
  }
  .you {
    color: var(--stream-you);
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
    gap: 2em;
    margin: 0;
    font-size: var(--fs-stream-side);
    font-variation-settings: var(--fv-caps);
  }
  .sides .chat {
    text-transform: uppercase;
  }
  .winner {
    margin: 2px 0 0;
    font-family: var(--font-display);
    font-size: var(--fs-stream-hint);
    font-weight: var(--fw-legends);
    color: var(--gold);
    text-shadow: var(--heading-glow);
  }
  .winner.chatwin {
    color: var(--stream-chat);
    text-shadow: none;
  }
  .winner.draw {
    color: var(--chalk);
    text-shadow: none;
  }
  .note {
    margin: 0;
    font-size: var(--fs-stream-status);
    color: var(--dim);
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
    grid-template-columns: minmax(0, 7.5em) minmax(0, 1fr);
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
  .cell.chat.hit {
    background: var(--stream-chat);
  }
  .cell.streamer.hit {
    background: var(--stream-you);
  }
  .cell.miss {
    background: var(--miss);
  }
  .actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    width: 100%;
    margin-top: 6px;
  }
  /* Short screens (a 720p capture): the actions a little lower, so they all fit. */
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
  .cta:hover,
  .cta:focus-visible {
    box-shadow: var(--glow-hover);
  }
  .cta:focus-visible,
  .secondary:focus-visible {
    outline: 2px solid var(--chalk);
    outline-offset: 3px;
  }
  .othermodes {
    background: var(--chrome-band, var(--btn2-bg));
    color: var(--chalk);
    border: var(--btn2-border) solid var(--card-edge);
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
  .secondary:disabled {
    opacity: 0.6;
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
  .copy {
    width: 100%;
    font: inherit;
    font-size: var(--fs-stream-status);
    -webkit-user-select: text;
    user-select: text;
  }
</style>
