<!--
  Twitch Mode's setup, in the start panel's place: a page of its own, not a
  panel, centred and scrolling. The mode with its tagline under it and a big
  Start, the channel (Connect inside its field) and its live status, the
  settings a row each, then the questions as cards and Start again under them,
  so nobody scrolls back up to begin.

  It holds no rules: the channel's form is checked by stream/channel.ts, the
  caps and limits are core's, and the island owns the state.
-->
<script lang="ts">
  import { STREAM_LENGTHS, STREAM_LIMITS } from "@bt/core";
  import type { StreamLength, StreamLimit, StreamPool } from "@bt/core";
  import type { Snippet } from "svelte";
  import { t } from "../../i18n";
  import type { ChatStatus as Status } from "../../game/stream/chat-source";
  import type { PoolOption } from "../../game/stream/settings";
  import { limitLabel, limitName } from "../../game/stream/view";
  import ChatStatus from "./ChatStatus.svelte";
  import PoolPicker from "./PoolPicker.svelte";

  interface Props {
    status: Status;
    channel: string;
    /** The channel field's problem, already in words; "" for none. */
    channelProblem: string;
    onconnect: () => void;
    onretry: () => void;
    options: readonly PoolOption[];
    colours: Readonly<Record<string, string>>;
    pool: StreamPool;
    onpool: (pool: StreamPool) => void;
    length: StreamLength;
    onlength: (length: StreamLength) => void;
    limit: StreamLimit;
    onlimit: (limit: StreamLimit) => void;
    /** The chosen pool's cap, when it's under the longest match. */
    cap: number | null;
    starting: boolean;
    /** Start is possible: chat is connected and the island is ready. */
    ready: boolean;
    onstart: () => void;
    /** Why the last start failed, in words; "" for none. */
    problem: string;
    startButton?: HTMLButtonElement | undefined;
    /** Where Turnstile's widget renders, should it ever need the streamer. */
    turnstile: Snippet;
  }

  let {
    status,
    channel = $bindable(),
    channelProblem,
    onconnect,
    onretry,
    options,
    colours,
    pool,
    onpool,
    length,
    onlength,
    limit,
    onlimit,
    cap,
    starting,
    ready,
    onstart,
    problem,
    startButton = $bindable(),
    turnstile,
  }: Props = $props();

  const connected = $derived(status.kind === "connected");
  /** The squad's cap, said only when it cuts the chosen length short. */
  const capped = $derived(cap !== null && cap < length);
</script>

{#snippet go(first: boolean)}
  <div class="go">
    {#if first}
      <button
        class="cta"
        bind:this={startButton}
        disabled={!ready || !connected || starting}
        onclick={onstart}
      >
        {starting ? t("start.starting") : t("stream.start")}
      </button>
    {:else}
      <button class="cta" disabled={!ready || !connected || starting} onclick={onstart}>
        {starting ? t("start.starting") : t("stream.start")}
      </button>
    {/if}
    {#if !connected}
      <p class="note">{t("stream.connectFirst")}</p>
    {/if}
    {#if first}
      {@render turnstile()}
      <p class="problem" role="alert">{problem}</p>
    {:else}
      <!-- The same problem by the lower button; announced once, by the upper. -->
      <p class="problem" aria-hidden="true">{problem}</p>
    {/if}
  </div>
{/snippet}

<div class="setup" aria-label={t("stream.setup.label")} role="region">
  <!-- The title bar already carries the brand: the mode, its tagline under it. -->
  <div class="head">
    <h1 class="title">{t("stream.subtitle")}</h1>
    <p class="tagline">{t("stream.tagline")}</p>
  </div>

  {@render go(true)}

  <section class="step" aria-labelledby="stream-step-channel">
    <h2 class="stephead" id="stream-step-channel">{t("stream.step.channel")}</h2>
    <form
      class="channel"
      novalidate
      onsubmit={(event) => {
        event.preventDefault();
        onconnect();
      }}
    >
      <label for="stream-channel">{t("stream.channel.label")}</label>
      <div class="field">
        <input
          id="stream-channel"
          type="text"
          bind:value={channel}
          placeholder={t("stream.channel.placeholder")}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          maxlength={120}
          aria-invalid={channelProblem !== ""}
          aria-describedby="stream-channel-problem stream-channel-note"
        />
        <button type="submit" class="secondary">{t("stream.channel.connect")}</button>
      </div>
      <p class="problem" id="stream-channel-problem" role="alert">{channelProblem}</p>
    </form>
    <ChatStatus {status} {onretry} />
    <p class="note" id="stream-channel-note">{t("stream.channel.readOnly")}</p>
  </section>

  <section class="step" aria-labelledby="stream-step-settings">
    <h2 class="stephead" id="stream-step-settings">{t("stream.step.settings")}</h2>
    <div class="choices">
      <fieldset class="choice">
        <legend>{t("stream.settings.questions")}</legend>
        <div class="pills">
          {#each STREAM_LENGTHS as n (n)}
            <label class="pill" class:chosen={length === n}>
              <input
                type="radio"
                name="stream-length"
                value={n}
                checked={length === n}
                onchange={() => onlength(n)}
              />
              {n}
            </label>
          {/each}
        </div>
        {#if capped}
          <p class="note">{t("stream.settings.capped", { count: cap ?? 0 })}</p>
        {/if}
      </fieldset>
      <fieldset class="choice">
        <legend>{t("stream.settings.timer")}</legend>
        <div class="pills">
          {#each STREAM_LIMITS as n (n)}
            <label class="pill" class:chosen={limit === n}>
              <input
                type="radio"
                name="stream-limit"
                value={n}
                checked={limit === n}
                aria-label={limitName(n)}
                onchange={() => onlimit(n)}
              />
              <span aria-hidden="true">{limitLabel(n)}</span>
            </label>
          {/each}
        </div>
        {#if limit === 10}
          <p class="note hint">{t("stream.settings.lowLatency")}</p>
        {/if}
      </fieldset>
    </div>
  </section>

  <section class="step" aria-labelledby="stream-step-questions">
    <h2 class="stephead" id="stream-step-questions">{t("stream.step.questions")}</h2>
    <PoolPicker {options} {colours} value={pool} onchange={onpool} />
  </section>

  {@render go(false)}
</div>

<style>
  /* A page, not a panel: no frame of its own, on the veil's ground, centred. */
  .setup {
    display: flex;
    flex-direction: column;
    gap: var(--stream-section-gap);
    width: var(--stream-panel-w);
    margin: 0 auto;
    padding: var(--stream-page-pad);
    color: var(--chalk);
    text-align: center;
    -webkit-user-select: none;
    user-select: none;
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
    color: var(--chalk);
  }
  .step {
    min-width: 0;
  }
  .stephead {
    margin: 0 0 var(--stream-head-gap);
    font-size: var(--fs-stream-side);
    font-variation-settings: var(--fv-caps);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--gold);
    text-shadow: var(--glow);
  }
  .channel {
    width: min(var(--stream-field-w), 100%);
    margin: 0 auto;
  }
  .channel label {
    display: block;
    margin-bottom: 6px;
    font-size: var(--fs-stream-status);
    color: var(--chalk);
  }
  /* The field with Connect inside it, at its right end; the text centred in
     the room left of it on a phone, in the whole field from 560px. */
  .field {
    position: relative;
  }
  input[type="text"] {
    display: block;
    width: 100%;
    min-height: var(--stream-field-h);
    padding: 0 calc(var(--stream-connect-w) + var(--stream-connect-inset) * 2) 0 12px;
    border: 1px solid var(--card-edge);
    border-radius: 10px;
    background: rgba(var(--ink-rgb), 0.6);
    color: var(--chalk);
    font: inherit;
    font-size: var(--fs-stream-status);
    text-align: center;
    -webkit-user-select: text;
    user-select: text;
  }
  input[type="text"]:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 1px;
  }
  input[aria-invalid="true"] {
    border-color: var(--stream-status-bad);
  }
  .secondary {
    position: absolute;
    top: var(--stream-connect-inset);
    right: var(--stream-connect-inset);
    bottom: var(--stream-connect-inset);
    width: var(--stream-connect-w);
    padding: 0;
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
  /* The live status, centred under the field. */
  .step :global(.status) {
    justify-content: center;
    margin-top: 4px;
  }
  .problem {
    min-height: 1.2em;
    margin: 4px 0 0;
    font-size: var(--fs-stream-status);
    color: var(--stream-status-bad);
  }
  .problem:empty {
    min-height: 0;
    margin: 0;
  }
  .note {
    margin: 4px 0 0;
    font-size: var(--fs-stream-status);
    color: var(--dim);
  }
  .hint {
    color: var(--stream-status-warn);
  }
  /* The two settings a row each, centred. */
  .choices {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--stream-choice-gap);
  }
  .choice {
    flex: 0 1 auto;
    max-width: 100%;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .choice legend {
    width: 100%;
    padding: 0;
    margin-bottom: var(--stream-legend-gap);
    font-size: var(--fs-stream-status);
    color: var(--chalk);
  }
  .pills {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
  .pill {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 64px;
    min-height: var(--target-min);
    padding: 0 16px;
    border: var(--btn2-border) solid var(--card-edge);
    border-radius: var(--radius-pill);
    background: var(--btn2-bg);
    color: var(--chalk);
    font-variation-settings: var(--fv-nav);
    cursor: pointer;
  }
  .pill input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .pill:focus-within {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }
  .pill.chosen {
    border-color: var(--gold);
    color: var(--ink);
    background: var(--gold);
    box-shadow: var(--glow-hover);
  }
  /* Start: big and centred, above the cards and again under them. */
  .go {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .cta {
    width: min(var(--stream-start-w), 100%);
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
  .cta:focus-visible {
    outline: 2px solid var(--chalk);
    outline-offset: 3px;
  }
  .cta:disabled {
    opacity: 0.5;
    cursor: default;
    box-shadow: none;
  }
  /* Room for the text both sides: centred in the whole field, not beside Connect. */
  @media (min-width: 560px) {
    input[type="text"] {
      padding-left: calc(var(--stream-connect-w) + var(--stream-connect-inset) * 2);
    }
  }
</style>
