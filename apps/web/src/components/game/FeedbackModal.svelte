<!--
  The feedback modal: "Suggest a legend", "Report an error" (the card that
  ended the run) or "Report a problem" (anything else). Renders the
  form's state and passes the player's input on; the rules are in
  ../../game/feedback.ts. Turnstile's script loads when the modal opens, never
  before. All text comes from ../../i18n.

  A modal dialog: focus moves in when it opens and is held there (Tab wraps,
  and focus that lands outside is brought back); Esc, the close button and a
  click on the backdrop shut it (a press that starts inside the dialog doesn't,
  and nothing closes it mid-send); the island puts focus back on whatever
  opened it. What was typed is handed back on the way out (`ondraft`) and
  comes back as `draft` when the form opens again; a send clears it. After a send goes
  through, "Thanks" is announced and stays up for `--dur-thanks`, then the
  modal closes itself; Esc, the close button or a click anywhere closes it
  straight away.
-->
<script lang="ts">
  import { FEEDBACK_LIMITS } from "@bt/core";
  import type { FeedbackRequest, SitePage } from "@bt/core";
  import { onMount, tick, untrack } from "svelte";
  import { statLabel, t } from "../../i18n";
  import {
    afterSent,
    draftProblem,
    feedbackRequest,
    shownFigureText,
    statusText,
    wrapFocus,
  } from "../../game/feedback";
  import type {
    Draft,
    FeedbackKind,
    FormStatus,
    ReportedRound,
    SendOutcome,
  } from "../../game/feedback";
  import { createBackdropDismiss } from "../../game/modal";
  import type { Timings } from "../../game/timing";
  import type { Turnstile } from "../../game/turnstile";
  import type { MessageKey } from "../../i18n";

  interface Props {
    kind: FeedbackKind;
    /** The round a report is about. Null for the other forms. */
    report: ReportedRound | null;
    /** The page a problem report names. */
    page: SitePage;
    timings: Pick<Timings, "thanks" | "modal">;
    reducedMotion: boolean;
    siteKey: string;
    loadTurnstile: () => Promise<Turnstile>;
    send: (body: FeedbackRequest) => Promise<SendOutcome>;
    /** What was typed last time this form closed unsent. */
    draft?: Draft | undefined;
    /** Told what's typed as the form closes, or null once it has been sent. */
    ondraft?: (draft: Draft | null) => void;
    onclose: () => void;
  }

  let {
    kind,
    report,
    page,
    timings,
    reducedMotion,
    siteKey,
    loadTurnstile,
    send,
    draft,
    ondraft,
    onclose,
  }: Props = $props();

  const TEXT: Readonly<
    Record<FeedbackKind, { title: MessageKey; intro: MessageKey; note: MessageKey }>
  > = {
    suggest: {
      title: "feedback.suggest.title",
      intro: "feedback.suggest.intro",
      note: "feedback.suggest.note",
    },
    correction: {
      title: "feedback.report.title",
      intro: "feedback.report.intro",
      note: "feedback.report.note",
    },
    problem: {
      title: "feedback.problem.title",
      intro: "feedback.problem.intro",
      note: "feedback.problem.note",
    },
  };

  const uid = $props.id();

  let dialog: HTMLDivElement | undefined = $state();
  let nameInput: HTMLInputElement | undefined = $state();
  let noteInput: HTMLTextAreaElement | undefined = $state();
  let check: HTMLDivElement | undefined = $state();

  /**
   * Where this form's draft goes, as the form was opened: a send that ends
   * after the form has closed still clears this form's draft.
   */
  const keepDraft = untrack(() => ondraft);

  // From the draft, once: after that the fields are the player's.
  let name = $state(untrack(() => draft?.name) ?? "");
  let note = $state(untrack(() => draft?.note) ?? "");
  let token = $state<string | null>(null);
  let status = $state<FormStatus>("editing");
  /** Problems with the draft show once the player has tried to send it. */
  let tried = $state(false);
  /** Fading out after "Thanks". */
  let closing = $state(false);
  let timers: ReturnType<typeof setTimeout>[] = [];
  /** Closed already: every way out (Esc, ×, a click, the timer) closes once. */
  let closed = false;

  let turnstile: Turnstile | null = null;
  let widgetId: string | null = null;

  const problem = $derived(draftProblem(kind, { name, note }));
  const message = $derived(statusText(status, tried ? problem : null));
  const sending = $derived(status === "sending");
  const nameInvalid = $derived(tried && (problem === "nameRequired" || problem === "nameTooLong"));
  const noteInvalid = $derived(tried && (problem === "noteRequired" || problem === "noteTooLong"));

  /**
   * Closes the modal, once. A click on × would otherwise close it twice — the
   * button, then the click reaching the backdrop — and the second close would
   * no longer know which button to put focus back on.
   */
  function close(): void {
    if (closed) return;
    closed = true;
    for (const timer of timers) clearTimeout(timer);
    keepDraft?.(status === "sent" ? null : { name, note });
    onclose();
  }

  const backdrop = createBackdropDismiss({ canClose: () => !sending, close });

  /**
   * A click on the backdrop closes the form, as long as the press began there
   * too and nothing is being sent. Once "Thanks" is up, a click anywhere does,
   * rather than waiting.
   */
  function onBackdropClick(event: MouseEvent): void {
    if (status === "sent") {
      close();
      return;
    }
    backdrop.click(event.target === event.currentTarget);
  }

  onMount(() => {
    (kind === "suggest" ? nameInput : noteInput)?.focus();

    let open = true;
    loadTurnstile()
      .then((api) => {
        if (!open || check === undefined) return;
        turnstile = api;
        widgetId =
          api.render(check, {
            sitekey: siteKey,
            action: kind,
            theme: "dark",
            size: "flexible",
            callback: (value) => (token = value),
            "expired-callback": () => (token = null),
            "error-callback": () => (token = null),
          }) ?? null;
      })
      .catch(() => {
        if (open) status = "checkFailed";
      });

    return () => {
      open = false;
      for (const timer of timers) clearTimeout(timer);
      removeWidget();
    };
  });

  function removeWidget(): void {
    if (turnstile === null || widgetId === null) return;
    try {
      turnstile.remove(widgetId);
    } catch {
      // Already gone with the form: nothing to clean up.
    }
    widgetId = null;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (sending || status === "sent") return;
    tried = true;
    if (problem !== null) {
      status = "editing";
      (kind === "suggest" && problem !== "noteTooLong" ? nameInput : noteInput)?.focus();
      return;
    }
    if (token === null) return;

    status = "sending";
    const outcome = await send(feedbackRequest(kind, { name, note }, { report, page }, token));
    status = outcome;
    if (outcome === "sent") {
      keepDraft?.(null);
      removeWidget();
      // The form has gone; keep focus in the dialog while "Thanks" is read out.
      await tick();
      dialog?.focus();
      const { fadeAt, closeAt } = afterSent(timings, reducedMotion);
      if (closeAt > fadeAt) timers.push(setTimeout(() => (closing = true), fadeAt));
      timers.push(setTimeout(close, closeAt));
      return;
    }
    // A token is good for one try: whatever happened, the next send needs a fresh one.
    token = null;
    if (turnstile !== null && widgetId !== null) turnstile.reset(widgetId);
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
    // Somewhere inside we can't list, like Turnstile's widget: let the browser move on.
    if (index === -1 && active !== null && dialog.contains(active)) return;
    const to = wrapFocus(index, items.length, event.shiftKey);
    if (to !== null) {
      event.preventDefault();
      items[to]?.focus();
    }
  }

  /** Focus that escapes the dialog — out of the widget's frame, say — comes back. */
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
  class:closing
  class:sent={status === "sent"}
  onpointerdown={(event) => backdrop.pointerdown(event.target === event.currentTarget)}
  onclick={onBackdropClick}
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
    <button type="button" class="close" aria-label={t("feedback.close")} onclick={close}>
      <span aria-hidden="true">×</span>
    </button>
    <h2 id="{uid}-title">{t(TEXT[kind].title)}</h2>
    <p id="{uid}-intro" class="intro">{t(TEXT[kind].intro)}</p>

    {#if status !== "sent"}
      <form onsubmit={submit} novalidate>
        {#if kind === "suggest"}
          <label for="{uid}-name">{t("feedback.suggest.name")}</label>
          <input
            id="{uid}-name"
            type="text"
            bind:this={nameInput}
            bind:value={name}
            maxlength={FEEDBACK_LIMITS.name}
            autocomplete="off"
            required
            aria-invalid={nameInvalid}
            aria-describedby="{uid}-status"
          />
        {:else if report !== null}
          <div class="card">
            <span class="lab">{t("feedback.report.card")}</span>
            <p class="stat">{statLabel(report.stat)}</p>
            <p>{shownFigureText(report.stat, report.anchor)}</p>
            <p>{shownFigureText(report.stat, report.challenger)}</p>
          </div>
        {/if}

        <label for="{uid}-note">{t(TEXT[kind].note)}</label>
        <textarea
          id="{uid}-note"
          bind:this={noteInput}
          bind:value={note}
          maxlength={FEEDBACK_LIMITS.note}
          rows="4"
          required={kind === "problem"}
          aria-invalid={noteInvalid}
          aria-describedby="{uid}-status"></textarea>
        <p class="privacy">
          {kind === "problem" ? t("feedback.problem.page", { page }) : t("feedback.privacy")}
        </p>

        <div class="check" bind:this={check}></div>
        {#if token === null && status !== "checkFailed"}
          <p class="hint">{t("feedback.checking")}</p>
        {/if}

        <div class="actions">
          <button
            type="submit"
            class="cta"
            disabled={token === null || sending}
            aria-busy={sending}
          >
            {sending ? t("feedback.sending") : t("feedback.send")}
          </button>
          <button type="button" class="ghost" onclick={close}>{t("feedback.cancel")}</button>
        </div>
      </form>
    {/if}

    <!-- Always present, so every change (sending, a problem, "Thanks") is announced. -->
    <p class="status" class:done={status === "sent"} id="{uid}-status" role="status">
      {message}
    </p>
  </div>
</div>

<style>
  /* Not `.backdrop`: that's the site background's global class (background.css),
     whose `pointer-events: none` would leak in and make the form unclickable. */
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
    /* Centres, and still scrolls from the top when it's taller than the screen. */
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
  /* "Thanks" closes on a click anywhere. */
  .scrim.sent {
    cursor: pointer;
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
    /* Clear of the close button. */
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
  input,
  textarea {
    width: 100%;
    min-height: var(--target-min);
    padding: var(--field-pad);
    border: var(--border) solid var(--field-edge);
    border-radius: var(--field-radius);
    background: var(--field-bg);
    color: var(--chalk);
    font: inherit;
    font-size: var(--fs-field);
  }
  textarea {
    min-height: var(--note-rows-h);
    resize: vertical;
  }
  input:focus-visible,
  textarea:focus-visible {
    outline: var(--focus-ring-thin) solid var(--gold);
    outline-offset: var(--focus-offset);
  }
  input[aria-invalid="true"],
  textarea[aria-invalid="true"] {
    border-color: var(--flare);
  }

  .card {
    margin-top: 16px;
    padding: 12px 14px;
    border-top: var(--border) solid var(--rule);
    border-bottom: var(--border) solid var(--rule);
    font-size: var(--fs-reason);
    line-height: var(--lh-reason);
  }
  .card .lab {
    display: block;
    font-size: var(--fs-lab);
    color: var(--dim);
    font-variation-settings: var(--fv-caps);
  }
  .card .stat {
    color: var(--chalk);
    font-variation-settings: var(--fv-strong);
  }

  .privacy,
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
  }

  .actions {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .cta {
    min-height: var(--target-min);
    margin-top: 12px;
    padding: 12px 30px;
    border-radius: var(--radius-pill);
    background: var(--gold);
    color: var(--ink);
    font-size: var(--fs-cta);
    font-variation-settings: var(--fv-cta);
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

  /* After "Thanks": the same fade, out. */
  .scrim.closing {
    animation: fade-out var(--dur-modal) var(--ease) forwards;
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes fade-out {
    to {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .scrim.closing {
      animation: none;
    }
  }
</style>
