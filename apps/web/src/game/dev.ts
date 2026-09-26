/**
 * Developer tools for `pnpm dev`: an artificial delay on every round request,
 * to watch the reveal hold and settle on a slow connection (ARCHITECTURE.md §9).
 *
 * Only ever loaded behind `import.meta.env.DEV` with a dynamic import, so a
 * production build drops this module, and the panel with it, entirely. Its
 * labels are for developers, not players, so they stay here rather than in
 * i18n/en.ts, which ships.
 *
 * The setting survives a reload (localStorage), and `?delay=800` in the URL
 * sets it, which is handy in a headless browser.
 *
 * It also runs an accessibility check: axe-core against the page as it
 * stands, from the panel's "a11y" button or `window.__btAxe()` in a headless
 * browser. Violations are logged to the console. axe-core is a root
 * devDependency and, like the rest of this module, never ships.
 */

import { mount, unmount } from "svelte";
import DevPanel from "../components/game/DevPanel.svelte";
import type { Fetch } from "./api";

export const DEV_DELAYS = [0, 200, 800, 3000] as const;
export type DevDelay = (typeof DEV_DELAYS)[number];

const STORAGE_KEY = "bt:dev:delay";

let delay: DevDelay = initialDelay();

export function devDelay(): DevDelay {
  return delay;
}

export function setDevDelay(ms: DevDelay): void {
  delay = ms;
  try {
    localStorage.setItem(STORAGE_KEY, String(ms));
  } catch {
    // Storage unavailable: the setting lasts until reload.
  }
}

/** `fetchFn`, but each request waits the current delay before it goes. */
export function withDevDelay(fetchFn: Fetch): Fetch {
  return async (input, init) => {
    const ms = delay;
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    return fetchFn(input, init);
  };
}

/** One axe finding, trimmed to what's worth reading in a console. */
export interface AxeFinding {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly targets: readonly string[];
}

/** Runs axe-core over the page and logs the violations. Dev only. */
export async function runAxe(): Promise<AxeFinding[]> {
  const axe = (await import("axe-core")).default;
  const results = await axe.run(document, { resultTypes: ["violations"] });
  const findings = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? null,
    help: v.help,
    targets: v.nodes.map((n) => n.target.join(" ")),
  }));
  if (findings.length === 0) console.info("axe: no violations");
  else console.warn(`axe: ${findings.length} violation(s)`, findings);
  return findings;
}

declare global {
  interface Window {
    /** `pnpm dev` only: see `runAxe`. */
    __btAxe?: () => Promise<AxeFinding[]>;
  }
}

/** Puts the delay switch on the page. Returns a function that removes it. */
export function mountDevPanel(): () => void {
  window.__btAxe = runAxe;
  const panel = mount(DevPanel, { target: document.body });
  return () => {
    delete window.__btAxe;
    void unmount(panel);
  };
}

function initialDelay(): DevDelay {
  const fromUrl = parseDelay(new URLSearchParams(location.search).get("delay"));
  if (fromUrl !== undefined) return fromUrl;
  try {
    return parseDelay(localStorage.getItem(STORAGE_KEY)) ?? 0;
  } catch {
    return 0;
  }
}

function parseDelay(raw: string | null): DevDelay | undefined {
  const n = Number(raw);
  return raw !== null && (DEV_DELAYS as readonly number[]).includes(n)
    ? (n as DevDelay)
    : undefined;
}
