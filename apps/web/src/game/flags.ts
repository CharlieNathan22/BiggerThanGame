/**
 * Country flags on the leaderboards (DESIGN.md §13): round SVGs from
 * circle-flags (MIT), vendored in public/flags at HatScripts/circle-flags@379588b5,
 * one per code in @bt/core `FLAG_COUNTRIES`. Served from this site; no CDN.
 * A flag is named for screen readers by its country's name. A board entry
 * with no country (left off, or none known) shows a "?" mark in the flag's
 * place, named "Country not shown". Display only: nothing stored or sent.
 */

import { LOCALE, t } from "../i18n";

/** What goes in a flag's place: the country's flag, or with none the "?" mark. */
export type FlagMark =
  | { readonly kind: "flag"; readonly src: string; readonly name: string }
  | { readonly kind: "unknown"; readonly name: string };

/** The flag for a country, or the "?" mark ("Country not shown") for none. */
export function flagMark(country: string | null): FlagMark {
  return country === null
    ? { kind: "unknown", name: t("flag.unknown") }
    : { kind: "flag", src: flagSrc(country), name: countryName(country) };
}

/** Where a flag's SVG is: `/flags/gb.svg`. */
export function flagSrc(country: string): string {
  return `/flags/${country.toLowerCase()}.svg`;
}

let names: Intl.DisplayNames | null | undefined;

/** "United Kingdom" for GB, from the browser's own names; the code where there's none. */
export function countryName(country: string): string {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([LOCALE], { type: "region" });
    } catch {
      names = null;
    }
  }
  try {
    return names?.of(country.toUpperCase()) ?? country.toUpperCase();
  } catch {
    return country.toUpperCase();
  }
}

/**
 * A thinking time as the board shows it on a tied streak, m:ss.s: 102,345 ms
 * is "1:42.3", 9,870 ms is "0:09.8". Tenths are cut, never rounded up, so a
 * time never reads longer than it was.
 */
export function formatThink(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}
