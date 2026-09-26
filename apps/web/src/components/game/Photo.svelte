<!--
  A card's background layer: the player's photo, or the monogram when there's
  no photo or it won't load — including a 403 when photos are blocked on
  purpose. Decoration only; the name beside it carries the meaning, so the
  photo has empty alt text. ARCHITECTURE.md §9, DESIGN.md §12.
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
  const sources = $derived(image ? photoSources(IMAGE_BASE, image) : null);
</script>

{#if image && sources && !failed}
  <img
    class="photo"
    src={sources.src}
    srcset={sources.srcset}
    sizes={sources.sizes}
    width={image.width}
    height={image.height}
    alt=""
    decoding="async"
    draggable="false"
    style:--focus={focusPosition(image.focus)}
    onerror={() => (failed = true)}
  />
  <div class="scrim" aria-hidden="true"></div>
{:else}
  <div class="monogram" aria-hidden="true">{initial}</div>
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
    opacity: var(--photo-opacity);
    pointer-events: none;
    user-select: none;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--photo-scrim);
    pointer-events: none;
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
