<!--
  The publish dialog, from Endless's game-over panel: a nickname (a generated
  one to start with, which most players keep), one line on what's stored,
  Turnstile, and Publish. Afterwards, where the device stands today, this week
  and this month, and a link to the board — and, if an earlier run of the
  device's still beats this one today, that the board keeps that run. Renders the flow's state and passes
  the player's input on; the rules are in ../../game/publish.ts. All text comes
  from ../../i18n.

  A modal dialog like the feedback form (FeedbackModal.svelte): focus moves in
  and is held there, Esc, the close button and a click on the backdrop shut it
  (not a press that starts inside, and not mid-publish), and the island puts
  focus back on whatever opened it. A name typed and left unpublished comes
  back next time (`ondraft`). Refusals are calm and say what to do next.
-->
<script lang="ts">
  import { NICKNAME_LIMITS, generateNickname } from "@bt/core";
  import type { SubmitResponse } from "@bt/core";
  import { onMount, tick, untrack } from "svelte";
  import { t } from "../../i18n";
  import { wrapFocus } from "../../game/feedback";
  import { createBackdropDismiss } from "../../game/modal";
  import {
    canRetry,
    cryptoRandom,
    nicknameText,
    outcomeText,
    publishedText,
    ranksText,
  } from "../../game/publish";
  import type { PublishOutcome } from "../../game/publish";
  import type { Turnstile } from "../../game/turnstile";

  interface Props {
    streak: number;
    /** A name to start with; a fresh one is generated when absent. */
    nickname?: string | undefined;
    siteKey: string;
    loadTurnstile: () => Promise<Turnstile>;
    /** Sends the run with this name and a fresh Turnstile token. */
    publish: (nickname: string, turnstileToken: string) => Promise<PublishOutcome>;
    /** The board page. */
    boardHref: string;
    /** Told once it's published, with the ranks. */
    onpublished: (response: SubmitResponse, nickname: string) => void;
    /** Told the name as it closes unpublished, or null once published. */
    ondraft?: (nickname: string | null) => void;
    onclose: () => void;
  }

  let {
    streak,
    nickname: initial,
    siteKey,
    loadTurnstile,
    publish,
    boardHref,
    onpublished,
    ondraft,
    onclose,
  }: Props = $props();

  const uid = $props.id();

  let dialog: HTMLDivElement | undefined = $state();
  let nameInput: HTMLInputElement | undefined = $state();
  let check: HTMLDivElement | undefined = $state();

  // The name to start from, once: after that the field is the player's.
  let nickname = $state(untrack(() => initial) ?? generateNickname(cryptoRandom));
  let token = $state<string | null>(null);
  let sending = $state(false);
  let tried = $state(false);
  let outcome = $state<PublishOutcome | null>(null);
  let checkFailed = $state(false);
  let closed = false;

  let turnstile: Turnstile | null = null;
  let widgetId: string | null = null;

  const problem = $derived(nicknameText(nickname));
  const published = $derived(outcome?.kind === "published" ? outcome.response : null);
  /** A refusal nothing on this form can fix: the form goes, the reason stays. */
  const final = $derived(outcome !== null && outcome.kind !== "published" && !canRetry(outcome));
  const message = $derived(
    published !== null
      ? publishedText(published)
      : outcome !== null && outcome.kind !== "published"
        ? outcomeText(outcome)
        : checkFailed
          ? t("publish.checkFailed")
          : tried && problem !== null
            ? problem
            : sending
              ? t("publish.sending")
              : "",
  );

  function close(): void {
    if (closed) return;
    closed = true;
    ondraft?.(published !== null ? null : nickname);
    onclose();
  }

  const backdrop = createBackdropDismiss({ canClose: () => !sending, close });

  onMount(() => {
    nameInput?.focus();
    nameInput?.select();
    let open = true;
    loadTurnstile()
      .then((api) => {
        if (!open || check === undefined) return;
        turnstile = api;
        widgetId =
          api.render(check, {
            sitekey: siteKey,
            action: "submit",
            theme: "dark",
            size: "flexible",
            callback: (value) => (token = value),
            "expired-callback": () => (token = null),
            "error-callback": () => (token = null),
          }) ?? null;
      })
      .catch(() => {
        if (open) checkFailed = true;
      });
    return () => {
      open = false;
      removeWidget();
    };
  });

  function removeWidget(): void {
    if (turnstile === null || widgetId === null) return;
    try {
      turnstile.remove(widgetId);
    } catch {
      // Already gone with the form.
    }
    widgetId = null;
  }

  function shuffle(): void {
    nickname = generateNickname(cryptoRandom);
    outcome = null;
    nameInput?.focus();
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (sending || published !== null) return;
    tried = true;
    if (problem !== null) {
      nameInput?.focus();
      return;
    }
    if (token === null) return;
    sending = true;
    outcome = null;
    const result = await publish(nickname, token);
    sending = false;
    outcome = result;
    if (result.kind === "published") {
      removeWidget();
      onpublished(result.response, result.response.nickname);
      await tick();
      dialog?.focus();
      return;
    }
    // A token is good for one try.
    token = null;
    if (turnstile !== null && widgetId !== null) turnstile.reset(widgetId);
    if (result.kind === "rejected") {
      await tick();
      nameInput?.focus();
      nameInput?.select();
    }
  }

  function focusables(): HTMLElement[] {
    if (dialog === undefined) return [];
    const selector = "a[href], button, input, textarea, select, iframe, [tabindex]";
    return [...dialog.querySelectorAll<HTMLElement>(selector)].filter(
      (el) => el.tabIndex >= 0 && !el.hasAttribute("disabled") && el.getClientRects().length > 0,
    );
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || dialog === undefined) return;
    const items = focusables();
    const active = document.activeElement;
    const index = items.findIndex((el) => el === active);
    if (index === -1 && active !== null && dialog.contains(active)) return;
    const to = wrapFocus(index, items.length, event.shiftKey);
    if (to !== null) {
      event.preventDefault();
      items[to]?.focus();
    }
  }

  function onFocusIn(event: FocusEvent): void {
    if (dialog === undefined || !(event.target instanceof Node)) return;
    if (!dialog.contains(event.target)) focusables()[0]?.focus();
  }
</script>

<svelte:document onfocusin={onFocusIn} />

<!-- A click on the backdrop is a pointer shortcut; the keyboard has Esc and the close button. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="scrim"
  onpointerdown={(event) => backdrop.pointerdown(event.target === event.currentTarget)}
  onclick={(event) => backdrop.click(event.target === event.currentTarget)}
>
  <div
    bind:this={dialog}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="{uid}-title"
    aria-describedby="{uid}-intro"
    tabindex="-1"
    onkeydown={onKeydown}
  >
    <button type="button" class="close" aria-label={t("publish.close")} onclick={close}>
      <span aria-hidden="true">×</span>
    </button>
    <h2 id="{uid}-title">{t("publish.title")}</h2>
    <p id="{uid}-intro" class="intro">{t("publish.intro", { streak })}</p>

    {#if published === null && !final}
      <form onsubmit={submit} novalidate>
        <label for="{uid}-name">{t("publish.nickname")}</label>
        <div class="namerow">
          <input
            id="{uid}-name"
            type="text"
            bind:this={nameInput}
            bind:value={nickname}
            maxlength={NICKNAME_LIMITS.max + 10}
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            required
            aria-invalid={(tried && problem !== null) || outcome?.kind === "rejected"}
            aria-describedby="{uid}-stored {uid}-status"
          />
          <button type="button" class="ghost shuffle" onclick={shuffle}>
            {t("publish.shuffle")}
          </button>
        </div>
        <p class="stored" id="{uid}-stored">{t("publish.stored")}</p>

        <div class="check" bind:this={check}></div>
        {#if token === null && !checkFailed}
          <p class="hint">{t("publish.checking")}</p>
        {/if}

        <div class="actions">
          <button
            type="submit"
            class="cta"
            disabled={token === null || sending}
            aria-busy={sending}
          >
            {sending ? t("publish.sending") : t("publish.send")}
          </button>
          <button type="button" class="ghost" onclick={close}>{t("publish.cancel")}</button>
        </div>
      </form>
    {/if}

    <p class="status" class:done={published !== null} id="{uid}-status" role="status">
      {message}
    </p>
    {#if published !== null}
      <p class="ranks">{ranksText(published)}</p>
      <div class="actions">
        <a class="cta" href={boardHref}>{t("publish.see")}</a>
        <button type="button" class="ghost" onclick={close}>{t("publish.close")}</button>
      </div>
    {:else if final}
      <div class="actions">
        <button type="button" class="ghost" onclick={close}>{t("publish.close")}</button>
      </div>
    {/if}
  </div>
</div>

<style>
  /* The feedback dialog's look (FeedbackModal.svelte), from the same tokens. */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    padding: var(--modal-gutter);
    background: var(--modal-backdrop);
    overflow-y: auto;
    animation: fade var(--dur-modal) var(--ease);
  }
  .dialog {
    position: relative;
    width: 100%;
    max-width: var(--modal-w);
    margin: auto;
    padding: var(--modal-pad);
    border: var(--border) solid var(--modal-edge);
    border-radius: var(--modal-radius);
    background: var(--modal-bg);
    box-shadow: var(--shadow-modal);
  }
  .dialog:focus {
    outline: none;
  }
  .close {
    position: absolute;
    top: 6px;
    right: 6px;
    width: var(--target-min);
    height: var(--target-min);
    border-radius: var(--radius-pill);
    font-size: var(--fs-heading);
    line-height: var(--lh-tight);
    color: var(--dim);
  }
  .close:hover {
    color: var(--chalk);
  }
  h2 {
    padding-right: var(--target-min);
    font-size: var(--fs-heading);
    line-height: var(--lh-name);
    font-variation-settings: var(--fv-heading);
  }
  .intro {
    margin-top: 8px;
    font-size: var(--fs-body);
    line-height: var(--lh-body);
    color: var(--dim);
  }
  form {
    display: flex;
    flex-direction: column;
  }
  label {
    margin-top: 16px;
    margin-bottom: 6px;
    font-size: var(--fs-lab);
    color: var(--dim);
    font-variation-settings: var(--fv-caps);
  }
  .namerow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
  }
  input {
    flex: 1 1 12em;
    min-width: 0;
    min-height: var(--target-min);
    padding: var(--field-pad);
    border: var(--border) solid var(--field-edge);
    border-radius: var(--field-radius);
    background: var(--field-bg);
    color: var(--chalk);
    font: inherit;
    font-size: var(--fs-field);
  }
  input:focus-visible {
    outline: var(--focus-ring-thin) solid var(--gold);
    outline-offset: var(--focus-offset);
  }
  input[aria-invalid="true"] {
    border-color: var(--flare);
  }
  .stored,
  .hint {
    margin-top: 8px;
    font-size: var(--fs-lab);
    color: var(--dim);
    font-variation-settings: var(--fv-meta);
  }
  .check {
    margin-top: 14px;
    min-height: var(--check-min-h);
  }
  .status {
    margin-top: 10px;
    min-height: 1.4em;
    font-size: var(--fs-caption);
    line-height: var(--lh-body);
    color: var(--chalk);
    font-variation-settings: var(--fv-caption);
  }
  .status.done {
    margin-top: 18px;
    font-size: var(--fs-body);
    color: var(--gold);
  }
  .ranks {
    margin-top: 6px;
    font-size: var(--fs-body);
    line-height: var(--lh-body);
    color: var(--chalk);
  }
  .actions {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    min-height: var(--target-min);
    margin-top: 12px;
    padding: 12px 30px;
    border-radius: var(--radius-pill);
    background: var(--gold);
    color: var(--ink);
    font-size: var(--fs-cta);
    font-variation-settings: var(--fv-cta);
    text-decoration: none;
  }
  .actions .cta {
    margin-top: 0;
  }
  .cta:disabled {
    cursor: default;
    opacity: var(--disabled-opacity);
  }
  .cta:focus-visible {
    outline: var(--focus-ring) solid var(--chalk);
    outline-offset: var(--focus-offset);
  }
  .ghost {
    min-height: var(--target-min);
    padding: 0 12px;
    font-size: var(--fs-ghost);
    color: var(--dim);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .shuffle {
    padding: 0 6px;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .scrim {
      animation: none;
    }
  }
</style>
