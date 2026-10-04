/**
 * What the game's dialogs share (the feedback forms, FeedbackModal.svelte, and
 * the publish dialog, PublishModal.svelte), as plain logic so it runs under
 * test:
 *
 * - **A click on the backdrop closes the dialog**, as Esc and the close
 *   button do — but only when the press began on the backdrop too, so
 *   selecting text in a field and letting go outside the dialog doesn't close
 *   it; and never while something is being sent.
 * - **Focus goes back to whatever opened the dialog**, or, if that has gone
 *   from the page, to the first fallback still there.
 * - **Drafts outlive the dialog.** Text typed into a form that is closed
 *   without sending comes back when it is opened again, for as long as the
 *   page is open (memory only, never storage). A send that goes through
 *   clears it.
 */

/**
 * Tracks a press on a dialog's backdrop. Give it each `pointerdown` and each
 * `click` on the backdrop element, with whether the event's target was the
 * backdrop itself (not something inside the dialog).
 */
export function createBackdropDismiss(options: {
  /** Whether the dialog may close now: false while a send is in flight. */
  readonly canClose: () => boolean;
  readonly close: () => void;
}): {
  pointerdown(onBackdrop: boolean): void;
  click(onBackdrop: boolean): void;
} {
  let pressedOnBackdrop = false;
  return {
    pointerdown(onBackdrop) {
      pressedOnBackdrop = onBackdrop;
    },
    click(onBackdrop) {
      const both = pressedOnBackdrop && onBackdrop;
      pressedOnBackdrop = false;
      if (both && options.canClose()) options.close();
    },
  };
}

/** Something focus can go back to. */
export interface Focusable {
  readonly isConnected: boolean;
  focus(): void;
}

/**
 * Where focus goes when a dialog closes: the element that opened it, if it's
 * still in the page, or else the first fallback that is.
 */
export function focusAfterClose<T extends Focusable>(
  opener: T | null | undefined,
  ...fallbacks: (T | null | undefined)[]
): T | null {
  for (const candidate of [opener, ...fallbacks]) {
    if (candidate !== null && candidate !== undefined && candidate.isConnected) return candidate;
  }
  return null;
}

/** Drafts by form, kept for the page's lifetime. */
export interface DraftStore<T> {
  get(key: string): T | undefined;
  /** Keeps a draft, or forgets it when it's empty or null (after a send). */
  keep(key: string, draft: T | null): void;
}

export function createDraftStore<T>(isEmpty: (draft: T) => boolean): DraftStore<T> {
  const drafts = new Map<string, T>();
  return {
    get: (key) => drafts.get(key),
    keep: (key, draft) => {
      if (draft === null || isEmpty(draft)) drafts.delete(key);
      else drafts.set(key, draft);
    },
  };
}
