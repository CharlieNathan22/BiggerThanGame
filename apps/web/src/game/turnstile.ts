/**
 * Cloudflare Turnstile in the browser, for the feedback forms.
 *
 * The script is Cloudflare's own and must be loaded from Cloudflare, unproxied
 * and uncached. It is only loaded when a feedback form first opens — never for
 * someone who only plays — and rendered explicitly into the form. The document
 * and the global are injected so the loader runs under test in Node.
 */

export const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The parts of `turnstile.render`'s options the forms use. */
export interface TurnstileOptions {
  readonly sitekey: string;
  readonly action?: string;
  readonly theme?: "light" | "dark" | "auto";
  readonly size?: "normal" | "flexible" | "compact";
  readonly callback: (token: string) => void;
  readonly "expired-callback"?: () => void;
  readonly "error-callback"?: () => void;
}

/** The parts of `window.turnstile` the forms use. */
export interface Turnstile {
  render(container: HTMLElement, options: TurnstileOptions): string | null | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
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
