/**
 * Player image URLs.
 *
 * Lives in core, not the deck package, because the browser (card `srcset`,
 * prefetch) and the Worker (display payload) both need it, and neither can
 * import `@bt/deck`, which reads files with `node:fs`.
 *
 * Images are stored in R2 as untouched originals and resized at the edge by
 * Cloudflare Image Transformations. The manifest (`images.json`, written by
 * `pnpm images:sync`) supplies the key; the base URL comes from config. See
 * ARCHITECTURE.md §9.
 */

/** What a card needs to render a photo. Straight from the manifest entry. */
export interface PlayerImage {
  /** R2 key of the original, e.g. `originals/zidane-zinedine.a3f9c21e0b1d4e7f.jpg`. */
  readonly key: string;
  /** Intrinsic size of the original, so the card reserves its box. */
  readonly width: number;
  readonly height: number;
}

/**
 * The only widths the site ever requests.
 *
 * Mobile cards are ~400 CSS px (1200px at 3×), desktop ~720 (1440px at 2×), so
 * 1600 covers retina everywhere and 800 saves real bytes on phones.
 *
 * Fixed on purpose. Every distinct URL is a separate transformation against the
 * free allowance of 5,000 a month: 300 players × 2 widths is 600. Add widths
 * freely, but never compute them per device — `width=${innerWidth}` would burn
 * the allowance in an afternoon.
 */
export const DISPLAY_WIDTHS = [800, 1600] as const;
export type DisplayWidth = (typeof DISPLAY_WIDTHS)[number];

/** Output quality. 80 is visually lossless for photographs at these sizes. */
export const IMAGE_QUALITY = 80;

/**
 * The transformation URL for one width.
 *
 *   https://img.biggerthangame.com/cdn-cgi/image/width=800,quality=80,
 *     fit=scale-down,format=auto,onerror=redirect/originals/zidane.a3f9….jpg
 *
 * - `format=auto` serves AVIF or WebP by the browser's Accept header, and
 *   counts as **one** transformation however many formats it produces.
 * - `fit=scale-down` never enlarges past the original.
 * - `onerror=redirect` falls back to the untouched original if a
 *   transformation fails — including after the monthly allowance runs out —
 *   so a card never shows a broken image. Works because the original lives on
 *   the same host.
 *
 * `base` is the R2 custom domain, from config — never stored in the manifest.
 */
export function imageUrl(base: string, key: string, width: DisplayWidth): string {
  const options = [
    `width=${width}`,
    `quality=${IMAGE_QUALITY}`,
    "fit=scale-down",
    "format=auto",
    "onerror=redirect",
  ].join(",");
  return `${trimSlash(base)}/cdn-cgi/image/${options}/${key}`;
}

/** A complete `srcset` across every display width, smallest first. */
export function srcsetFor(base: string, key: string): string {
  return DISPLAY_WIDTHS.map((w) => `${imageUrl(base, key, w)} ${w}w`).join(", ");
}

/** The untouched original. For the credits page and debugging, not for cards. */
export function originalUrl(base: string, key: string): string {
  return `${trimSlash(base)}/${key}`;
}

function trimSlash(base: string): string {
  return base.replace(/\/+$/, "");
}
