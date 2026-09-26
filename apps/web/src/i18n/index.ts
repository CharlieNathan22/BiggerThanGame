/**
 * Text lookup. English is the only language; adding one means adding a file
 * shaped like `en.ts` and choosing it here. No switching is built yet.
 */

import type { StatKey } from "@bt/core";
import { en } from "./en";
import type { MessageKey } from "./en";

export type { MessageKey } from "./en";

/** What any language file must provide: every key English has. */
export type Messages = Readonly<Record<MessageKey, string>>;

export type Params = Readonly<Record<string, string | number>>;

const messages: Messages = en;

/** BCP 47 tag for number and date formatting in the current language. */
export const LOCALE = "en-GB";

/**
 * The text for `key`, with each `{name}` replaced from `params`. A placeholder
 * with no matching param is left as written, so a missing value shows up on
 * screen rather than as an empty gap.
 */
export function t(key: MessageKey, params: Params = {}): string {
  return interpolate(messages[key], params);
}

export function interpolate(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export function statLabel(key: StatKey): string {
  return t(`stat.${key}`);
}

/** `2026-09-17` → `17 Sept 2026`. Anything unparseable is returned as given. */
export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
