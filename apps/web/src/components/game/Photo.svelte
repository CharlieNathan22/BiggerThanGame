<!--
  A card's background layer: the player's photo, or the monogram when there's
  no photo or it won't load — including a 403 when photos are blocked on
  purpose. Decoration only; the name beside it carries the meaning, so the
  photo has empty alt text. ARCHITECTURE.md §9, DESIGN.md §12.

  While the photo loads the monogram shows, and the photo fades up over it
  when it arrives (--dur-photo-in), so a slow photo never leaves a blank half
  and nothing moves. A photo already in the cache — the usual case, as each
  one is preloaded a round early — shows at once, with no fade.
-->
<script lang="ts">
  import type { CardImage } from "@bt/core";
  import { IMAGE_BASE } from "../../config";
  import { focusPosition, photoSources } from "../../game/photos";

  interface Props {
    image: CardImage | undefined;
    /** The monogram letter. */
    initial: string;
  }

  let { image, initial }: Props = $props();

  // Reset by the parent's {#key}: one card, one attempt.
  let failed = $state(false);
  let loaded = $state(false);
  /** It was already loaded when the card appeared: no fade. */
  let instant = $state(false);
  const sources = $derived(image ? photoSources(IMAGE_BASE, image) : null);

  /** A cached photo can be complete before `load` would fire. */
  function cached(node: HTMLImageElement): void {
    if (node.complete && node.naturalWidth > 0) {
      loaded = true;
      instant = true;
    }
  }
</script>

{#if !loaded || failed || !image}
  <div class="monogram" aria-hidden="true">{initial}</div>
{/if}
{#if image && sources && !failed}
  <img
    class="photo"
    class:loaded
    class:instant
    src={sources.src}
    srcset={sources.srcset}
    sizes={sources.sizes}
    width={image.width}
    height={image.height}
    alt=""
    decoding="async"
    draggable="false"
    style:--focus={focusPosition(image.focus)}
    use:cached
    onload={() => (loaded = true)}
    onerror={() => (failed = true)}
  />
{/if}

<style>
  .photo {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: var(--focus, var(--photo-focus));
    filter: var(--photo-filter);
    mix-blend-mode: var(--photo-blend);
    opacity: 0;
    transition: opacity var(--dur-photo-in) var(--ease);
    pointer-events: none;
    user-select: none;
  }
  .photo.loaded {
    opacity: var(--photo-opacity);
  }
  .photo.instant {
    transition: none;
  }
  .monogram {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-display);
    font-weight: var(--fw-monogram);
    font-size: var(--fs-monogram);
    color: var(--monogram);
    pointer-events: none;
    user-select: none;
    line-height: var(--lh-tight);
  }
</style>
