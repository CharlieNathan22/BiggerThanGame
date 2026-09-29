/**
 * Cloudflare Turnstile in the browser: the feedback forms, and Endless's run
 * start.
 *
 * The script is Cloudflare's own and must be loaded from Cloudflare, unproxied
 * and uncached. It is never in a page's `<head>`:
 *
 * - for the feedback forms, it loads when a form first opens, and renders into
 *   the form;
 * - on the Endless page only, it loads once the page has rendered and gone idle
 *   (`loadWhenIdle`), or on the first Start press if that comes sooner. The
 *   check runs on the Start press (`createHumanCheck`), invisibly for most
 *   players: the widget only shows when Turnstile wants an interaction.
 *
 * Friendly's players never load it unless they open a form. The document, the
 * window and the global are injected so all of it runs under test in Node.
 */

export const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The parts of `turnstile.render`'s options the forms and the run start use. */
export interface TurnstileOptions {
  readonly sitekey: string;
  readonly action?: string;
  readonly theme?: "light" | "dark" | "auto";
  readonly size?: "normal" | "flexible" | "compact";
  /** `interaction-only`: the widget shows only when the visitor must act. */
  readonly appearance?: "always" | "execute" | "interaction-only";
  /** `execute`: the check runs when `turnstile.execute` is called, not on render. */
  readonly execution?: "render" | "execute";
  readonly callback: (token: string) => void;
  readonly "expired-callback"?: () => void;
  readonly "error-callback"?: () => void;
}

/** The parts of `window.turnstile` the forms and the run start use. */
export interface Turnstile {
  render(container: HTMLElement, options: TurnstileOptions): string | null | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
  execute(widgetId: string): void;
}

/** Where the script puts `turnstile`: the window, in the browser. */
export interface TurnstileHost {
  turnstile?: Turnstile;
}

interface ScriptLike {
  src: string;
  async: boolean;
  defer: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove(): void;
}

export interface ScriptDocument {
  createElement(tag: "script"): ScriptLike;
  head: { append(node: ScriptLike): void };
}

/**
 * A loader that adds the script on its first call and hands every call the
 * same `turnstile`. A failed load (offline, or a content blocker) is forgotten,
 * so opening the form again tries again.
 */
export function createTurnstileLoader(
  doc: ScriptDocument,
  host: TurnstileHost,
): () => Promise<Turnstile> {
  let pending: Promise<Turnstile> | null = null;
  return () => {
    if (host.turnstile !== undefined) return Promise.resolve(host.turnstile);
    pending ??= new Promise<Turnstile>((resolve, reject) => {
      const script = doc.createElement("script");
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (host.turnstile !== undefined) resolve(host.turnstile);
        else fail();
      };
      script.onerror = fail;
      doc.head.append(script);

      function fail(): void {
        script.remove();
        pending = null;
        reject(new Error("Turnstile didn't load"));
      }
    });
    return pending;
  };
}

/** The window, as `loadWhenIdle` needs it. */
export interface IdleHost {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => unknown;
  addEventListener(type: "load", listener: () => void, options?: { once: boolean }): void;
  readonly document: { readonly readyState: string };
  setTimeout(callback: () => void, ms: number): unknown;
}

/**
 * Loads Turnstile's script once the page has rendered and gone idle — the
 * browser's idle callback, or the window's `load` where there is none — so it
 * never competes with the game page's own first paint. A failure is forgotten:
 * the Start press asks the loader again.
 */
export function loadWhenIdle(win: IdleHost, load: () => Promise<unknown>): void {
  const run = (): void => void load().catch(() => {});
  if (typeof win.requestIdleCallback === "function") {
    win.requestIdleCallback(run, { timeout: 5000 });
  } else if (win.document.readyState === "complete") {
    win.setTimeout(run, 0);
  } else {
    win.addEventListener("load", run, { once: true });
  }
}

/** How long the Start press waits for the check before calling it a failure. */
export const HUMAN_CHECK_TIMEOUT_MS = 30_000;

/**
 * The run start's check, as a function that resolves with a fresh Turnstile
 * token: the widget is rendered into `container` on first use, invisible
 * unless Turnstile wants an interaction, and executed on each call (reset
 * first, since a token is spent by the server once). Rejects if the script
 * won't load, the check errors or times out; the start panel then offers a
 * calm retry.
 */
export function createHumanCheck(
  load: () => Promise<Turnstile>,
  container: () => HTMLElement | null,
  siteKey: string,
  schedule: (fn: () => void, ms: number) => () => void,
): () => Promise<string> {
  let widget: string | null = null;
  let waiting: { resolve: (token: string) => void; reject: (err: Error) => void } | null = null;

  const settle = (outcome: string | Error): void => {
    const pending = waiting;
    waiting = null;
    if (pending === null) return;
    if (typeof outcome === "string") pending.resolve(outcome);
    else pending.reject(outcome);
  };

  return async () => {
    const turnstile = await load();
    const box = container();
    if (box === null) throw new Error("no place for the check");
    if (widget === null) {
      widget =
        turnstile.render(box, {
          sitekey: siteKey,
          action: "run-start",
          appearance: "interaction-only",
          execution: "execute",
          callback: (token) => settle(token),
          "error-callback": () => settle(new Error("the check failed")),
          "expired-callback": () => settle(new Error("the check expired")),
        }) ?? null;
      if (widget === null) throw new Error("the check didn't render");
    } else {
      turnstile.reset(widget);
    }
    const id = widget;
    return new Promise<string>((resolve, reject) => {
      const cancel = schedule(
        () => settle(new Error("the check timed out")),
        HUMAN_CHECK_TIMEOUT_MS,
      );
      waiting = {
        resolve: (token) => {
          cancel();
          resolve(token);
        },
        reject: (err) => {
          cancel();
          reject(err);
        },
      };
      turnstile.execute(id);
    });
  };
}
