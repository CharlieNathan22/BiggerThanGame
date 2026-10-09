<!--
  Twitch Mode's strip over the pitch, sized for a captured stream: the
  scoreboard ("Chat 7 – 9 shroud"), the command hint, and while voting is
  open how many have voted (never the split, so chat can't follow the
  majority). At the reveal the split shows as a bar with percentages, and
  what chat said and how both sides did. Chat's status sits under the hint.

  The bar only grows into place, and not at all with reduced motion (the
  global rule stops it): the numbers beside it say the same.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import type { ChatStatus as Status } from "../../game/stream/chat-source";
  import type { MatchScore, QuestionResult } from "../../game/stream/match";
  import { chatPickText } from "../../game/stream/match";
  import { hintText, votesText } from "../../game/stream/view";
  import { splitPercent } from "../../game/stream/votes";
  import type { VoteCounts } from "../../game/stream/votes";
  import ChatStatus from "./ChatStatus.svelte";

  interface Props {
    channel: string;
    score: MatchScore;
    /** The votes on the question on screen. */
    counts: VoteCounts;
    /** Voting is open: the count shows. */
    voting: boolean;
    /** The question just revealed: the split shows. */
    revealed: QuestionResult | null;
    status: Status;
    onretry: () => void;
  }

  let { channel, score, counts, voting, revealed, status, onretry }: Props = $props();
  const split = $derived(revealed === null ? null : splitPercent(revealed.counts));
</script>

<section class="hud" aria-label={t("stream.subtitle")}>
  <p class="board">
    <span class="sr">
      {t("stream.scoreboard.label", { chat: score.chat, channel, streamer: score.streamer })}
    </span>
    <span class="side chat" aria-hidden="true">{t("stream.score.chat")}</span>
    <span class="figures num" aria-hidden="true">
      <span class="chatfig">{score.chat}</span>
      <span class="dash">–</span>
      <span class="youfig">{score.streamer}</span>
    </span>
    <span class="side you" aria-hidden="true">{channel}</span>
  </p>

  <div class="middle">
    <p class="hint">{hintText()}</p>
    <ChatStatus {status} {onretry} compact />
  </div>

  <div class="right" aria-live="polite">
    {#if revealed !== null && split !== null}
      <div class="reveal">
        <p class="said" class:right={revealed.chat === "right"}>
          {chatPickText(revealed.counts)}
          <span class="sep" aria-hidden="true">{t("over.separator")}</span>
          {revealed.chat === "right" ? t("stream.reveal.chatRight") : t("stream.reveal.chatWrong")}
        </p>
        {#if revealed.counts.voters > 0}
          <div class="bar" aria-hidden="true">
            <span class="higher" style:width="{split.higher}%"></span>
            <span class="lower" style:width="{split.lower}%"></span>
          </div>
          <p class="percents">
            <span>{t("stream.reveal.higher", { percent: split.higher })}</span>
            <span>{t("stream.reveal.lower", { percent: split.lower })}</span>
          </p>
        {/if}
      </div>
    {:else}
      <p class="votes" class:closed={!voting}>{votesText(counts.voters)}</p>
    {/if}
  </div>
</section>

<style>
  .hud {
    position: relative;
    z-index: 5;
    flex: none;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--stream-hud-gap);
    padding: var(--stream-hud-pad);
    background: var(--stream-hud-bg);
    border-bottom: 1px solid var(--stream-hud-edge);
    color: var(--chalk);
  }
  .board {
    display: flex;
    align-items: baseline;
    gap: 0.4em;
    margin: 0;
    white-space: nowrap;
  }
  .side {
    font-size: var(--fs-stream-side);
    font-variation-settings: var(--fv-caps);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .side.chat {
    color: var(--stream-chat);
  }
  /* The channel as it is typed, lower case, with room for Twitch's longest names. */
  .side.you {
    max-width: 22ch;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: none;
    letter-spacing: 0;
    color: var(--stream-you);
  }
  .figures {
    font-size: var(--fs-stream-score);
    font-variation-settings: var(--fv-score, normal);
    line-height: 1;
  }
  .chatfig {
    color: var(--stream-chat);
  }
  .youfig {
    color: var(--stream-you);
    text-shadow: var(--glow);
  }
  .dash {
    color: var(--dim);
    margin: 0 0.1em;
  }
  .middle {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 0;
    text-align: center;
  }
  .hint {
    margin: 0;
    font-size: var(--fs-stream-hint);
    font-variation-settings: var(--fv-nav);
    color: var(--chalk);
  }
  .right {
    min-width: var(--stream-split-w);
    text-align: right;
  }
  .votes {
    margin: 0;
    font-size: var(--fs-stream-hint);
    color: var(--gold);
    text-shadow: var(--glow);
  }
  .votes.closed {
    color: var(--dim);
    text-shadow: none;
  }
  .said {
    margin: 0 0 4px;
    font-size: var(--fs-stream-status);
    color: var(--stream-status-bad);
  }
  .said.right {
    color: var(--stream-status-ok);
  }
  .sep {
    margin: 0 0.3em;
    color: var(--dim);
  }
  .bar {
    display: flex;
    width: var(--stream-split-w);
    height: var(--stream-split-h);
    margin-left: auto;
    border-radius: var(--radius-pill);
    overflow: hidden;
    background: var(--track-todo);
  }
  .bar span {
    height: 100%;
    animation: grow var(--dur-stream-bar) var(--ease) both;
    transform-origin: left;
  }
  .higher {
    background: var(--stream-split-higher);
  }
  .lower {
    background: var(--stream-split-lower);
  }
  .percents {
    display: flex;
    justify-content: space-between;
    width: var(--stream-split-w);
    margin: 2px 0 0 auto;
    font-size: var(--fs-stream-status);
  }
  .percents span:first-child {
    color: var(--stream-chat);
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
  @keyframes grow {
    from {
      transform: scaleX(0);
    }
  }
  /* A phone: the score and the votes on one row, the hint and status under them. */
  @media (max-width: 699px) {
    .hud {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas: "board right" "middle middle";
    }
    .board {
      grid-area: board;
    }
    .middle {
      grid-area: middle;
    }
    .right {
      grid-area: right;
      min-width: 0;
    }
    .bar,
    .percents {
      width: 100%;
    }
  }
</style>
