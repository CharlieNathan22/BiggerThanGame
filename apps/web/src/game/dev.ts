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

/** Puts the delay switch on the page. Returns a function that removes it. */
export function mountDevPanel(): () => void {
  const panel = mount(DevPanel, { target: document.body });
  return () => void unmount(panel);
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
