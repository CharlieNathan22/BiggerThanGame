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
 * token: the widget is rendered into `container`, invisible unless Turnstile
 * wants an interaction, and executed on each call (reset first, since a token
 * is spent by the server once and never sent twice). Rejects if the script
 * won't load, the check errors or times out; the start panel then offers a
 * calm retry, which runs a new check.
 *
 * **Every call checks where the widget lives.** The start panel is unmounted
 * while a run is played and mounted afresh for the next start (Play again, or
 * a retry), so the element the widget was rendered into can be gone. Resetting
 * a widget whose element has gone fails ("Cannot find Widget"), and every start
 * after it would fail the same way. So when the container is a different
 * element, or detached, or the widget won't reset, the old widget is removed
 * and a new one rendered into the current container.
 *
 * `release()` removes the widget while its element is still in the page: the
 * game calls it as the start panel unmounts, so no widget is left behind for
 * Turnstile to look for, and the next start renders a fresh one.
 */
export interface HumanCheck {
  /** A fresh Turnstile token, never one handed out before. */
  (): Promise<string>;
  /** Removes the widget; the next check renders a new one. */
  release(): void;
}

export function createHumanCheck(
  load: () => Promise<Turnstile>,
  container: () => HTMLElement | null,
  siteKey: string,
  schedule: (fn: () => void, ms: number) => () => void,
): HumanCheck {
  /** Turnstile, once it has loaded. */
  let api: Turnstile | null = null;
  /** The widget, and the element it was rendered into. */
  let widget: { readonly id: string; readonly box: HTMLElement } | null = null;
  /** The check in progress: only its widget's callbacks can settle it. */
  let waiting: {
    readonly id: string;
    readonly resolve: (token: string) => void;
    readonly reject: (err: Error) => void;
  } | null = null;

  const settle = (from: string, outcome: string | Error): void => {
    const pending = waiting;
    // A callback from a widget since removed, or with no check waiting, is ignored.
    if (pending === null || pending.id !== from) return;
    waiting = null;
    if (typeof outcome === "string") pending.resolve(outcome);
    else pending.reject(outcome);
  };

  const discard = (turnstile: Turnstile): void => {
    if (widget === null) return;
    try {
      turnstile.remove(widget.id);
    } catch {
      // Gone with its element already.
    }
    widget = null;
  };

  const render = (turnstile: Turnstile, box: HTMLElement): string => {
    let id: string | null = null;
    const from = (): string => id ?? "";
    id =
      turnstile.render(box, {
        sitekey: siteKey,
        action: "run-start",
        appearance: "interaction-only",
        execution: "execute",
        callback: (token) => settle(from(), token),
        "error-callback": () => settle(from(), new Error("the check failed")),
        "expired-callback": () => settle(from(), new Error("the check expired")),
      }) ?? null;
    if (id === null) throw new Error("the check didn't render");
    widget = { id, box };
    return id;
  };

  const check = async (): Promise<string> => {
    const turnstile = await load();
    api = turnstile;
    const box = container();
    if (box === null) throw new Error("no place for the check");
    // A check still waiting (a start abandoned mid-check) can't take this one's token.
    if (waiting !== null) settle(waiting.id, new Error("superseded"));

    if (widget !== null && (widget.box !== box || widget.box.isConnected === false)) {
      discard(turnstile);
    }
    let id: string;
    if (widget === null) {
      id = render(turnstile, box);
    } else {
      try {
        turnstile.reset(widget.id);
        id = widget.id;
      } catch {
        discard(turnstile);
        id = render(turnstile, box);
      }
    }

    return new Promise<string>((resolve, reject) => {
      const cancel = schedule(
        () => settle(id, new Error("the check timed out")),
        HUMAN_CHECK_TIMEOUT_MS,
      );
      waiting = {
        id,
        resolve: (token) => {
          cancel();
          resolve(token);
        },
        reject: (err) => {
          cancel();
          reject(err);
        },
      };
      try {
        turnstile.execute(id);
      } catch {
        // The widget won't run: forget it, so the next start renders a new one.
        discard(turnstile);
        settle(id, new Error("the check didn't run"));
      }
    });
  };

  return Object.assign(check, {
    release: (): void => {
      if (api !== null) discard(api);
    },
  });
}
