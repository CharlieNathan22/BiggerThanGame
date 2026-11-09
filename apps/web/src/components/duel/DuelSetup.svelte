<!--
  1v1's setup, in the start panel's place: a page of its own over the pitch,
  centred and scrolling, as Twitch Mode's is. Two ways in, as two radio pills:
  create a room (the name, the settings a row each, the questions as cards from
  Twitch Mode's own picker, and Create above and under them), or join one (the
  code, the name, Join). An invite link opens it on Join with the code filled
  in and whose room it is.

  Built for a phone first: most invites are opened from a chat app. One
  column, 44px targets, nothing wider than the screen at 320.

  It holds no rules: the name's form is checked by publish.ts, the caps and
  limits are core's, and the island owns the state.
-->
<script lang="ts">
  import { DUEL_LENGTHS, DUEL_LIMITS, NICKNAME_LIMITS, ROOM_CODE_LENGTH } from "@bt/core";
  import type { DuelLength, DuelLimit, DuelPool } from "@bt/core";
  import type { Snippet } from "svelte";
  import { t } from "../../i18n";
  import { limitLabel, limitName, limitSeconds } from "../../game/duel/view";
  import type { PoolOption } from "../../game/stream/settings";
  import PoolPicker from "../stream/PoolPicker.svelte";

  interface Props {
    /** Which way in is showing. */
    tab: "create" | "join";
    ontab: (tab: "create" | "join") => void;
    options: readonly PoolOption[];
    colours: Readonly<Record<string, string>>;
    pool: DuelPool;
    onpool: (pool: DuelPool) => void;
    length: DuelLength;
    onlength: (length: DuelLength) => void;
    limit: DuelLimit;
    onlimit: (limit: DuelLimit) => void;
    /** The chosen pool's cap, when it's under the longest match. */
    cap: number | null;
    name: string;
    /** The name's problem, already in words; "" for none. */
    nameProblem: string;
    onshuffle: () => void;
    oninput: () => void;
    /** The room code as typed. */
    code: string;
    codeProblem: string;
    /** From an invite link: whose room it is, once the room has said. */
    invitedBy: string | null;
    /** The invite's room is being looked up. */
    checking: boolean;
    /** A create or a join is in flight. */
    busy: boolean;
    /** The island is ready to make one. */
    ready: boolean;
    oncreate: () => void;
    onjoin: () => void;
    /** Why the last try failed, in words; "" for none. */
    problem: string;
    goButton?: HTMLButtonElement | undefined;
    /** Where Turnstile's widget renders, should it ever need the player. */
    turnstile: Snippet;
  }

  let {
    tab,
    ontab,
    options,
    colours,
    pool,
    onpool,
    length,
    onlength,
    limit,
    onlimit,
    cap,
    name = $bindable(),
    nameProblem,
    onshuffle,
    oninput,
    code = $bindable(),
    codeProblem,
    invitedBy,
    checking,
    busy,
    ready,
    oncreate,
    onjoin,
    problem,
    goButton = $bindable(),
    turnstile,
  }: Props = $props();

  /** The squad's cap, said only when it cuts the chosen length short. */
  const capped = $derived(cap !== null && cap < length);
  const creating = $derived(tab === "create");
</script>

{#snippet nameField()}
  <div class="field">
    <label for="duel-name">{t("duel.name.label")}</label>
    <div class="namerow">
      <input
        id="duel-name"
        type="text"
        bind:value={name}
        {oninput}
        maxlength={NICKNAME_LIMITS.max + 10}
        autocomplete="nickname"
        autocapitalize="off"
        spellcheck="false"
        required
        aria-invalid={nameProblem !== ""}
        aria-describedby="duel-name-problem duel-name-note"
      />
      <!-- "Another name": a shuffle icon in the field's right edge. -->
      <button
        type="button"
        class="shuffle"
        aria-label={t("publish.shuffle")}
        title={t("publish.shuffle")}
        onclick={onshuffle}
      >
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
        </svg>
      </button>
    </div>
    <p class="problem" id="duel-name-problem" role="alert">{nameProblem}</p>
    <p class="note" id="duel-name-note">{t("duel.name.note")}</p>
  </div>
{/snippet}

{#snippet go(first: boolean)}
  <div class="go">
    {#if first}
      <button type="submit" class="cta" bind:this={goButton} disabled={!ready || busy}>
        {#if creating}
          {busy ? t("duel.creating") : t("duel.create")}
        {:else}
          {busy ? t("duel.joining") : t("duel.join")}
        {/if}
      </button>
      {@render turnstile()}
      <p class="problem" role="alert">{problem}</p>
    {:else}
      <button type="submit" class="cta" disabled={!ready || busy}>
        {busy ? t("duel.creating") : t("duel.create")}
      </button>
      <!-- The same problem by the lower button; announced once, by the upper. -->
      <p class="problem" aria-hidden="true">{problem}</p>
    {/if}
  </div>
{/snippet}

<div class="setup" aria-label={t("duel.setup.label")} role="region">
  <!-- The title bar already carries the brand: the mode, its tagline under it. -->
  <div class="head">
    <h1 class="title">{t("duel.subtitle")}</h1>
    <p class="tagline">{t("duel.tagline")}</p>
  </div>

  <fieldset class="ways">
    <legend class="sr">{t("duel.tabs.label")}</legend>
    <div class="pills">
      {#each ["create", "join"] as const as way (way)}
        <label class="pill wide" class:chosen={tab === way}>
          <input
            type="radio"
            name="duel-way"
            value={way}
            checked={tab === way}
            onchange={() => ontab(way)}
          />
          {t(`duel.tab.${way}`)}
        </label>
      {/each}
    </div>
  </fieldset>

  {#if creating}
    <form
      class="form"
      novalidate
      onsubmit={(event) => {
        event.preventDefault();
        oncreate();
      }}
    >
      {@render nameField()}
      {@render go(true)}

      <section class="step" aria-labelledby="duel-step-settings">
        <h2 class="stephead" id="duel-step-settings">{t("duel.step.settings")}</h2>
        <div class="choices">
          <fieldset class="choice">
            <legend>{t("duel.settings.questions")}</legend>
            <div class="pills">
              {#each DUEL_LENGTHS as n (n)}
                <label class="pill" class:chosen={length === n}>
                  <input
                    type="radio"
                    name="duel-length"
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
            <legend>{t("duel.settings.timer")}</legend>
            <div class="pills">
              {#each DUEL_LIMITS as n (n)}
                <label class="pill timer" class:chosen={limit === n}>
                  <input
                    type="radio"
                    name="duel-limit"
                    value={n}
                    checked={limit === n}
                    aria-label={limitLabel(n)}
                    onchange={() => onlimit(n)}
                  />
                  <span aria-hidden="true">{limitName(n)}</span>
                  <span class="seconds" aria-hidden="true">{limitSeconds(n)}</span>
                </label>
              {/each}
            </div>
          </fieldset>
        </div>
      </section>

      <section class="step" aria-labelledby="duel-step-questions">
        <h2 class="stephead" id="duel-step-questions">{t("duel.step.questions")}</h2>
        <PoolPicker {options} {colours} value={pool} onchange={onpool} />
      </section>

      {@render go(false)}
    </form>
  {:else}
    <form
      class="form"
      novalidate
      onsubmit={(event) => {
        event.preventDefault();
        onjoin();
      }}
    >
      <p class="invited" role="status">
        {#if checking}
          {t("duel.join.checking")}
        {:else if invitedBy !== null}
          {t("duel.join.invited", { host: invitedBy })}
        {/if}
      </p>
      <div class="field">
        <label for="duel-code">{t("duel.code.label")}</label>
        <input
          id="duel-code"
          class="code"
          type="text"
          bind:value={code}
          {oninput}
          placeholder={t("duel.code.placeholder")}
          maxlength={ROOM_CODE_LENGTH + 4}
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          inputmode="text"
          required
          aria-invalid={codeProblem !== ""}
          aria-describedby="duel-code-problem"
        />
        <p class="problem" id="duel-code-problem" role="alert">{codeProblem}</p>
      </div>
      {@render nameField()}
      {@render go(true)}
    </form>
  {/if}
</div>

<style>
  /* A page, not a panel: no frame of its own, on the veil's ground, centred. */
  .setup {
    display: flex;
    flex-direction: column;
    gap: var(--stream-head-gap);
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
  .ways {
    margin: 0;
    padding: 0;
    border: 0;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--stream-section-gap);
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
  .field {
    width: min(var(--stream-field-w), 100%);
    margin: 0 auto;
  }
  .field label {
    display: block;
    margin-bottom: 6px;
    font-size: var(--fs-stream-status);
    color: var(--chalk);
  }
  .namerow {
    position: relative;
  }
  input[type="text"] {
    display: block;
    width: 100%;
    min-height: var(--stream-field-h);
    padding: 0 var(--stream-field-pad-x);
    border: 1px solid var(--card-edge);
    border-radius: var(--stream-field-radius);
    background: rgba(var(--ink-rgb), 0.6);
    color: var(--chalk);
    font: inherit;
    font-size: var(--fs-stream-hint);
    text-align: center;
    -webkit-user-select: text;
    user-select: text;
  }
  /* Room either side for the shuffle button, so the name stays centred. */
  .namerow input {
    padding: 0 calc(var(--target-min) + var(--stream-connect-inset));
  }
  /* The code: large, spaced and upper case, as the lobby shows it. */
  .code {
    font-variation-settings: var(--fv-caps);
    letter-spacing: var(--duel-code-tracking);
    text-transform: uppercase;
  }
  .code::placeholder {
    letter-spacing: 0;
    text-transform: none;
    font-variation-settings: normal;
  }
  input[type="text"]:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 1px;
  }
  input[aria-invalid="true"] {
    border-color: var(--stream-status-bad);
  }
  .shuffle {
    position: absolute;
    top: 50%;
    right: var(--stream-connect-inset);
    display: grid;
    place-items: center;
    width: var(--target-min);
    height: var(--target-min);
    padding: 0;
    border: 0;
    border-radius: var(--radius-pill);
    background: none;
    color: var(--gold);
    transform: translateY(-50%);
    cursor: pointer;
  }
  .shuffle:hover,
  .shuffle:focus-visible {
    background: var(--btn2-bg-hover);
  }
  .shuffle:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 1px;
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
  .invited {
    min-height: 1.3em;
    margin: 0;
    font-size: var(--fs-stream-hint);
    color: var(--gold);
    text-shadow: var(--glow);
  }
  .invited:empty {
    min-height: 0;
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
  .pill.wide {
    flex: 1 1 0;
    max-width: 240px;
    min-width: 0;
    padding: 0 10px;
  }
  /* A timer's name over its seconds. */
  .pill.timer {
    flex-direction: column;
    gap: 0;
    min-width: 84px;
    padding: 4px 14px;
    line-height: 1.15;
  }
  .seconds {
    font-size: var(--fs-stream-status);
    font-variation-settings: normal;
    opacity: 0.8;
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
  /* Create or Join: big and centred; Create again under the cards. */
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
