<!--
  1v1's strip over the pitch, always there during a match: the scoreboard
  ("You 7 – 6 Sam"), what is happening on the question (the other player has
  locked in, never which way; at the reveal, both picks), a "Sudden death" tag
  once the match has gone there, and the connection: this page's own, with the
  seconds left when it is trying to get back, and the other player's. On a
  phone the other player's takes a line only when it has something to say
  (dropped out, left): connected is the usual state, and the strip stays short.

  Nothing here is a live region: the seconds count down, and a reader would
  hear every one. The island announces what matters once: the other player
  locking in, each reveal with both picks and the score, and a player
  dropping out or coming back.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import { duelScore, opponent, opponentSeat } from "../../game/duel/room";
  import type { DuelView, RevealView } from "../../game/duel/room";
  import type { LinkStatus } from "../../game/duel/socket";
  import { linkText, linkTone, opponentText, revealPicks } from "../../game/duel/view";

  interface Props {
    view: DuelView;
    link: LinkStatus;
    /** `performance.now()`, a couple of times a second: what the countdowns are read against. */
    now: number;
    /** The question on screen is sudden death. */
    suddenDeath: boolean;
    /** The question just revealed, while its verdict shows; null otherwise. */
    revealed: RevealView | null;
    /** A question is waiting for answers. */
    open: boolean;
  }

  let { view, link, now, suddenDeath, revealed, open }: Props = $props();

  const score = $derived(duelScore(view));
  const them = $derived(opponent(view));
  const name = $derived(them?.name ?? "");
  const theyLocked = $derived(view.locked.includes(opponentSeat(view)));
  const iLocked = $derived(view.picked !== null);
  const picks = $derived(revealed === null ? null : revealPicks(view, revealed));
  const mineRight = $derived(revealed?.correct[view.you] === true);
  const theirsRight = $derived(revealed?.correct[opponentSeat(view)] === true);
  /** What is happening on the question, in a line. */
  const line = $derived.by(() => {
    if (!open) return "";
    if (theyLocked) return t("duel.locked.them", { name });
    return iLocked ? t("duel.locked.waiting", { name }) : "";
  });
  const themTone = $derived(
    them === undefined || them.left === true ? "bad" : them.connected ? "ok" : "busy",
  );
</script>

<section class="hud" aria-label={t("duel.subtitle")}>
  <p class="board">
    <span class="sr">
      {t("duel.scoreboard.label", { you: score.you, name, them: score.them })}
    </span>
    <span class="side you" aria-hidden="true">{t("duel.score.you")}</span>
    <span class="figures num" aria-hidden="true">
      <span class="youfig">{score.you}</span>
      <span class="dash">–</span>
      <span class="themfig">{score.them}</span>
    </span>
    <span class="side them" aria-hidden="true">{name}</span>
  </p>

  <div class="middle">
    {#if suddenDeath}
      <p class="sudden">{t("duel.suddenDeath")}</p>
    {/if}
    {#if picks !== null}
      <p class="said">
        <span class="pick you" class:right={mineRight}>{picks.you}</span>
        <span class="sep" aria-hidden="true">{t("over.separator")}</span>
        <span class="pick them" class:right={theirsRight}>{picks.them}</span>
      </p>
    {:else}
      <p class="line" class:locked={theyLocked}>{line}</p>
    {/if}
  </div>

  <div class="right">
    <p class="conn mine {linkTone(link)}">
      <span class="dot" aria-hidden="true"></span>
      <span class="sr">{t("duel.status.label")}: </span>{linkText(link, true, now)}
    </p>
    <p class="conn them {themTone}" class:usual={themTone === "ok"}>
      <span class="dot" aria-hidden="true"></span>
      {opponentText(them, now - view.playersAt)}
    </p>
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
    min-width: 0;
    margin: 0;
    white-space: nowrap;
  }
  .side {
    font-size: var(--fs-stream-side);
    font-variation-settings: var(--fv-caps);
  }
  .side.you {
    color: var(--duel-you);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  /* The other player's name as they wrote it, with room for the longest one. */
  .side.them {
    max-width: 20ch;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--duel-them);
  }
  .figures {
    font-size: var(--fs-stream-score);
    font-variation-settings: var(--fv-score, normal);
    line-height: 1;
  }
  .youfig {
    color: var(--duel-you);
    text-shadow: var(--glow);
  }
  .themfig {
    color: var(--duel-them);
  }
  .dash {
    margin: 0 0.1em;
    color: var(--dim);
  }
  .middle {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 0;
    text-align: center;
  }
  .sudden {
    margin: 0;
    padding: var(--chip-pad);
    border: 1px solid var(--stream-status-warn);
    border-radius: var(--radius-pill);
    font-size: var(--fs-chip);
    font-variation-settings: var(--fv-caps);
    letter-spacing: var(--chip-tracking);
    text-transform: uppercase;
    color: var(--stream-status-warn);
  }
  .line,
  .said {
    min-height: 1.3em;
    margin: 0;
    font-size: var(--fs-stream-hint);
    font-variation-settings: var(--fv-nav);
  }
  .line {
    color: var(--dim);
  }
  .line.locked {
    color: var(--duel-them);
  }
  .said {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0 0.4em;
  }
  /* A miss in the miss red, a hit in the status green: the word says which pick it was. */
  .pick {
    color: var(--stream-status-bad);
  }
  .pick.right {
    color: var(--stream-status-ok);
  }
  .sep {
    color: var(--dim);
  }
  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    min-width: 0;
  }
  .conn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    margin: 0;
    font-size: var(--fs-stream-status);
  }
  .dot {
    flex: none;
    width: var(--duel-dot);
    height: var(--duel-dot);
    border-radius: 50%;
    background: currentColor;
  }
  .conn.ok {
    color: var(--stream-status-ok);
  }
  .conn.busy {
    color: var(--stream-status-warn);
  }
  .conn.bad {
    color: var(--stream-status-bad);
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
  /* A phone: the score and this page's connection on one row, the line under
     them. The score keeps its width; a long status wraps beside it. The other
     player's status has a row of its own between the two when they are not
     simply connected, and is left to screen readers when they are. */
  @media (max-width: 699px) {
    .hud {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas: "board mine" "them them" "middle middle";
      gap: 2px 10px;
      padding: 6px 10px;
    }
    .board {
      grid-area: board;
    }
    .middle {
      grid-area: middle;
    }
    .right {
      display: contents;
    }
    .side.them {
      max-width: 12ch;
    }
    .conn.mine {
      grid-area: mine;
      justify-self: end;
      text-align: right;
    }
    .conn.them {
      grid-area: them;
      justify-self: center;
      text-align: center;
    }
    .conn.them.usual {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  }
</style>
