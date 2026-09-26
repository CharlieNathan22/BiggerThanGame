/**
 * Player photos: what a card's `<img>` gets, and the preload that fetches the
 * next challenger's photo before it is dealt. ARCHITECTURE.md §9.
 *
 * URLs come only from `imageUrl` / `srcsetFor` in `@bt/core`. The card and the
 * preload share one `srcset` and one `sizes`, so the browser picks the same
 * candidate for both and never fetches a photo twice.
 */

import { DISPLAY_WIDTHS, imageUrl, srcsetFor } from "@bt/core";
import type { CardImage } from "@bt/core";

export interface PhotoSources {
  /** Only for browsers that ignore `srcset`: the smaller width. */
  readonly src: string;
  readonly srcset: string;
  readonly sizes: string;
}

/**
 * The layout breakpoint in `Game.svelte`: halves side by side from here, stacked
 * below. A media query can't read a custom property, so it's repeated here.
 */
const SIDE_BY_SIDE_FROM = 780;

/**
 * How wide a photo is drawn, for `sizes`. The photo covers its half
 * (`object-fit: cover`), so a wide photo in a tall half is drawn wider than the
 * half: at least the half's width, and at least its height times the photo's
 * aspect. Side by side, a half is half the viewport wide and nearly all of it
 * tall; stacked, the full width and about half the height. The height is
 * slightly overstated (the title bar and footer take some), which only ever
 * rounds towards the sharper of the two widths.
 */
export function photoSizes(image: Pick<CardImage, "width" | "height">): string {
  const aspect = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
  const vh = (share: number) => `${Number((aspect * share).toFixed(1))}vh`;
  return [
    `(min-width: ${SIDE_BY_SIDE_FROM}px) max(50vw, ${vh(100)})`,
    `max(100vw, ${vh(50)})`,
  ].join(", ");
}

export function photoSources(base: string, image: CardImage): PhotoSources {
  return {
    src: imageUrl(base, image.key, DISPLAY_WIDTHS[0]),
    srcset: srcsetFor(base, image.key),
    sizes: photoSizes(image),
  };
}

/**
 * The deck's `"x y"` focus as a CSS `object-position`, or undefined — and the
 * card's default of `50% 25%` — when there is none or it isn't one.
 */
export function focusPosition(focus: string | undefined): string | undefined {
  const match = focus === undefined ? null : /^(\d{1,3}) (\d{1,3})$/.exec(focus);
  if (match === null) return undefined;
  const [x, y] = [Number(match[1]), Number(match[2])];
  return x <= 100 && y <= 100 ? `${x}% ${y}%` : undefined;
}

/** Something that can load an image off-screen, as the browser's `Image` does. */
export interface ImageLike {
  sizes: string;
  srcset: string;
  src: string;
  decoding: "async" | "sync" | "auto";
  onload: ((event: Event) => void) | null;
  onerror: ((event: Event | string) => void) | null;
}

/**
 * Starts fetching a photo into the browser's cache, with the card's own
 * `sizes` and `srcset` so the card reuses the fetch. `sizes` is set before
 * `srcset`, as the browser picks a candidate as soon as `srcset` is set.
 *
 * Each image is held until it has loaded or failed, so it can't be collected
 * mid-fetch; a URL already loading or loaded isn't fetched again.
 */
export function createPreloader(
  base: string,
  make: () => ImageLike,
): (image: CardImage | undefined) => void {
  const started = new Set<string>();
  const inFlight = new Set<ImageLike>();
  return (image) => {
    if (image === undefined) return;
    const sources = photoSources(base, image);
    const id = `${sources.srcset}|${sources.sizes}`;
    if (started.has(id)) return;
    started.add(id);
    const img = make();
    const done = () => {
      inFlight.delete(img);
      img.onload = null;
      img.onerror = null;
    };
    img.onload = done;
    img.onerror = () => {
      done();
      // A failed photo may be tried again by a later card.
      started.delete(id);
    };
    img.decoding = "async";
    img.sizes = sources.sizes;
    img.srcset = sources.srcset;
    img.src = sources.src;
    inFlight.add(img);
  };
}
