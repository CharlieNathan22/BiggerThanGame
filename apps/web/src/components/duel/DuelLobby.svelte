<!--
  1v1's lobby, in the start panel's place: the room's code in large,
  easy-to-read type, the invite link with Copy and Share, both players with
  where each stands (ready, not ready, away), what the room plays, and then
  Ready for each player and Start for the host once both are here and ready.
  The guest reads "Waiting for Ada to start".

  A player who drops out of the lobby keeps their seat and shows as away;
  nothing here counts them down. Only Leave gives a seat up.

  Colour never carries a state alone: each player's state is written out.
-->
<script lang="ts">
  import { t } from "../../i18n";
  import { count } from "../../game/publish";
  import { canStart, me, opponent } from "../../game/duel/room";
  import type { DuelView } from "../../game/duel/room";
  import type { LinkStatus } from "../../game/duel/socket";
  import { limitLine, linkText, linkTone } from "../../game/duel/view";

  interface Props {
    view: DuelView;
    link: LinkStatus;
    /** The invite link, in full. */
    invite: string;
    /** The pool's name: "Football Legends", "Barcelona legends". */
    poolName: string;
    /** The browser has a share sheet. */
    canShare: boolean;
    /** What the last copy or share did; "" for nothing. */
    note: string;
    noteFading: boolean;
    /** The room's last refusal, in words; "" for none. */
    refused: string;
    oncopy: () => void;
    onshare: () => void;
    onready: (ready: boolean) => void;
    onstart: () => void;
    onleave: () => void;
    startButton?: HTMLButtonElement | undefined;
  }

  let {
    view,
    link,
    invite,
    poolName,
    canShare,
    note,
    noteFading,
    refused,
    oncopy,
    onshare,
    onready,
    onstart,
    onleave,
    startButton = $bindable(),
  }: Props = $props();

  const mine = $derived(me(view));
  const theirs = $derived(opponent(view));
  const host = $derived(view.you === 0);
  const hostName = $derived(view.players.find((p) => p.seat === 0)?.name ?? "");
  const startable = $derived(canStart(view) && link.kind === "connected");
  /** The code a letter at a time, so a screen reader spells it rather than guessing a word. */
  const spelled = $derived([...view.code].join(" "));
  /** Both seats, in order: the host's, then the guest's (free until someone joins). */
  const seats = $derived([0, 1].map((seat) => view.players.find((p) => p.seat === seat)));

  function stateOf(player: NonNullable<(typeof seats)[number]>): {
    readonly text: string;
    readonly tone: "ok" | "wait" | "away";
  } {
    if (!player.connected) return { text: t("duel.lobby.away"), tone: "away" };
    return player.ready
      ? { text: t("duel.lobby.ready"), tone: "ok" }
      : { text: t("duel.lobby.notReady"), tone: "wait" };
  }
</script>

<div class="lobby" aria-label={t("duel.lobby.label")} role="region">
  <div class="head">
    <h1 class="title">{t("duel.subtitle")}</h1>
    <p class="tagline">{t("duel.tagline")}</p>
  </div>

  <div class="room">
    <p class="label" id="duel-code-label" aria-hidden="true">{t("duel.lobby.code")}</p>
    <p class="code num">
      <span class="sr">{t("duel.lobby.codeSpoken", { code: spelled })}</span>
      <span aria-hidden="true">{view.code}</span>
    </p>
    <label class="label" for="duel-invite">{t("duel.lobby.invite")}</label>
    <input
      id="duel-invite"
      class="invite"
      type="text"
      readonly
      value={invite}
      onfocus={(event) => event.currentTarget.select()}
    />
    <div class="twin" class:single={!canShare}>
      <button class="secondary" onclick={oncopy}>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9 9h10v11H9zM5 15V4h10" />
        </svg>
        {t("duel.lobby.copy")}
      </button>
      {#if canShare}
        <button class="secondary" onclick={onshare}>
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
          </svg>
          {t("duel.lobby.share")}
        </button>
      {/if}
    </div>
    <p class="status" class:fading={noteFading} role="status">{note}</p>
  </div>

  <section class="players" aria-labelledby="duel-players">
    <h2 class="stephead" id="duel-players">{t("duel.lobby.players")}</h2>
    <ul>
      {#each seats as player, seat (seat)}
        <li class="player" class:you={seat === view.you} class:free={player === undefined}>
          {#if player === undefined}
            <span class="name waiting">{t("duel.lobby.empty")}</span>
          {:else}
            {@const state = stateOf(player)}
            <span class="name">
              {player.name}
              {#if seat === view.you}<span class="tag">{t("duel.lobby.you")}</span>{/if}
              {#if seat === 0}<span class="tag">{t("duel.lobby.host")}</span>{/if}
            </span>
            <span class="state {state.tone}">
              <span class="dot" aria-hidden="true"></span>
              {state.text}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section class="plays" aria-labelledby="duel-plays">
    <h2 class="stephead" id="duel-plays">{t("duel.lobby.settings")}</h2>
    <p class="settings">
      <span>{poolName}</span>
      <span aria-hidden="true">{t("over.separator")}</span>
      <span>{t("duel.lobby.questions", { count: count(view.settings.questions) })}</span>
      <span aria-hidden="true">{t("over.separator")}</span>
      <span>{limitLine(view.settings.limit)}</span>
    </p>
  </section>

  <div class="actions">
    <!-- Ready is a toggle: pressed once in, pressed again to take it back. -->
    <button
      class="secondary ready"
      class:on={mine?.ready === true}
      aria-pressed={mine?.ready === true}
      disabled={link.kind !== "connected"}
      onclick={() => onready(mine?.ready !== true)}
    >
      <svg class="icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M2.2 6.4l2.6 2.6 5-5.8" />
      </svg>
      {t("duel.lobby.readyUp")}
    </button>
    {#if host}
      <button class="cta" bind:this={startButton} disabled={!startable} onclick={onstart}>
        {t("duel.lobby.start")}
      </button>
      {#if !startable}
        <p class="note">
          {theirs === undefined ? t("duel.lobby.empty") : t("duel.lobby.needBoth")}
        </p>
      {/if}
    {:else}
      <p class="waitinghost" role="status">{t("duel.lobby.waitingHost", { host: hostName })}</p>
    {/if}
    <p class="problem" role="alert">{refused}</p>
    <p class="link {linkTone(link)}" role="status">
      <span class="dot" aria-hidden="true"></span>
      {linkText(link, false, 0)}
    </p>
    <button class="ghost" onclick={onleave}>{t("duel.lobby.leave")}</button>
  </div>
</div>

<style>
  .lobby {
    display: flex;
    flex-direction: column;
    gap: var(--stream-head-gap);
    width: var(--duel-panel-w);
    margin: 0 auto;
    padding: var(--stream-page-pad);
    color: var(--chalk);
    text-align: center;
  }
  .head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .title {
    margin: 0;
    font-size: var(--fs-stream-score);
    font-variation-settings: var(--fv-caps);
    line-height: 1.05;
    color: var(--gold);
    text-shadow: var(--glow);
  }
  .tagline {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--fs-stream-side);
    letter-spacing: var(--tracking-sublegend);
  }
  .room {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: var(--stream-panel-pad);
    border: 1px solid var(--card-edge);
    border-radius: var(--card-radius);
    background: var(--card-surface);
    box-shadow: var(--card-shadow);
  }
  .label {
    margin: 0;
    font-size: var(--fs-stream-status);
    font-variation-settings: var(--fv-caps);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dim);
  }
  /* Large, spaced and in the figures' face: read out over a call, typed on a phone. */
  .code {
    margin: 0 0 6px;
    /* The tracking's last gap would push the code off centre. */
    padding-left: var(--duel-code-tracking);
    font-size: var(--fs-duel-code);
    font-variation-settings: var(--fv-caps);
    letter-spacing: var(--duel-code-tracking);
    line-height: 1.05;
    color: var(--gold);
    text-shadow: var(--glow);
    -webkit-user-select: all;
    user-select: all;
  }
  .invite {
    width: 100%;
    min-height: var(--target-min);
    padding: 0 var(--stream-field-pad-x);
    border: 1px solid var(--card-edge);
    border-radius: var(--stream-field-radius);
    background: rgba(var(--ink-rgb), 0.6);
    color: var(--chalk);
    font: inherit;
    font-size: var(--fs-stream-status);
    text-align: center;
    text-overflow: ellipsis;
  }
  .invite:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 1px;
  }
  .twin {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    width: 100%;
    margin-top: 2px;
  }
  .twin.single {
    grid-template-columns: 1fr;
  }
  .stephead {
    margin: 0 0 8px;
    font-size: var(--fs-stream-side);
    font-variation-settings: var(--fv-caps);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--gold);
    text-shadow: var(--glow);
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .player {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: var(--target-min);
    padding: 6px 14px;
    border: 1px solid var(--card-edge);
    border-radius: var(--stream-field-radius);
    background: var(--card-surface);
    text-align: left;
  }
  .player.free {
    justify-content: center;
    border-style: dashed;
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--fs-stream-hint);
    font-variation-settings: var(--fv-nav);
  }
  .player.you .name {
    color: var(--duel-you);
  }
  .player:not(.you) .name {
    color: var(--duel-them);
  }
  .name.waiting {
    color: var(--dim);
    font-size: var(--fs-stream-status);
    font-variation-settings: normal;
  }
  .tag {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 8px;
    border: 1px solid var(--card-edge);
    border-radius: var(--radius-pill);
    font-size: var(--fs-chip);
    font-variation-settings: var(--fv-caps);
    letter-spacing: var(--chip-tracking);
    text-transform: uppercase;
    color: var(--chalk);
    vertical-align: middle;
  }
  .state,
  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    font-size: var(--fs-stream-status);
    white-space: nowrap;
  }
  .dot {
    width: var(--duel-dot);
    height: var(--duel-dot);
    border-radius: 50%;
    background: currentColor;
  }
  .state.ok,
  .link.ok {
    color: var(--stream-status-ok);
  }
  .state.wait {
    color: var(--chalk);
  }
  .state.away,
  .link.busy {
    color: var(--stream-status-warn);
  }
  .link.bad {
    color: var(--stream-status-bad);
  }
  .link {
    justify-content: center;
    margin: 0;
  }
  .settings {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 2px 8px;
    margin: 0;
    font-size: var(--fs-stream-status);
  }
  .actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    width: min(var(--stream-start-w), 100%);
    margin: 0 auto;
  }
  .cta {
    min-height: var(--stream-start-h);
    padding: 0 var(--start-cta-pad-x);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--gold);
    color: var(--ink);
    font: inherit;
    font-size: var(--fs-stream-start);
    font-variation-settings: var(--fv-caps);
    box-shadow: var(--glow);
    cursor: pointer;
  }
  .cta:hover:not(:disabled),
  .cta:focus-visible {
    box-shadow: var(--glow-hover);
  }
  .cta:disabled {
    opacity: 0.5;
    cursor: default;
    box-shadow: none;
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
  .secondary:hover:not(:disabled),
  .secondary:focus-visible {
    background: var(--btn2-bg-hover);
    box-shadow: var(--glow-hover);
  }
  .secondary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  /* Ready, pressed: filled, with its tick showing. */
  .ready .icon {
    visibility: hidden;
  }
  .ready.on {
    border-color: var(--stream-status-ok);
    background: rgba(var(--stream-chat-rgb), 0.14);
    color: var(--chalk);
    text-shadow: none;
  }
  .ready.on .icon {
    visibility: visible;
    stroke: var(--stream-status-ok);
  }
  .cta:focus-visible,
  .secondary:focus-visible,
  .ghost:focus-visible {
    outline: 2px solid var(--chalk);
    outline-offset: 3px;
  }
  .ghost {
    min-height: var(--target-min);
    padding: 0 16px;
    border: 0;
    background: none;
    color: var(--chalk);
    font: inherit;
    font-size: var(--fs-stream-status);
    text-decoration: underline;
    cursor: pointer;
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
  .note,
  .waitinghost,
  .problem,
  .status {
    margin: 0;
    font-size: var(--fs-stream-status);
  }
  .note {
    color: var(--dim);
  }
  .waitinghost {
    color: var(--gold);
    font-size: var(--fs-stream-hint);
    text-shadow: var(--glow);
  }
  .problem {
    color: var(--stream-status-bad);
  }
  .problem:empty {
    display: none;
  }
  .status {
    min-height: 1.3em;
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
</style>
