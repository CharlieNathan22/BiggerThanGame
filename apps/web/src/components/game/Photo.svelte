<!--
  A card's background layer: the player's photo, or the monogram when there's
  no photo or it won't load — including a 403 when photos are blocked on
  purpose. Decoration only; the name beside it carries the meaning, so the
  photo has empty alt text. ARCHITECTURE.md §9, DESIGN.md §12.

  Every photo "develops" in as soon as it has loaded, on its own, on every
  card of every round (a cached one as soon as the card appears): it fades up
  behind the text and settles from a slight zoom (--dur-photo-develop,
  --photo-develop-scale). Until then the half is its plain tinted panel. The
  monogram waits: it shows at once for a card with no photo or one that
  failed, but for a photo still loading only after --photo-wait; a photo that
  arrives after that develops over it. With reduced motion the photo and the
  monogram fade, and nothing scales.
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
  const sources = $derived(image ? photoSources(IMAGE_BASE, image) : null);
  /** A photo is on its way: the monogram holds back for --photo-wait. */
  const waiting = $derived(image !== undefined && !failed);

  /** A cached photo can be complete before `load` would fire. */
  function cached(node: HTMLImageElement): void {
    if (node.complete && node.naturalWidth > 0) loaded = true;
  }
</script>

{#if !loaded}
  <div class="monogram" class:waiting aria-hidden="true">{initial}</div>
{/if}
{#if image && sources && !failed}
  <img
    class="photo"
    class:loaded
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
    transform: scale(var(--photo-develop-scale));
    pointer-events: none;
    user-select: none;
  }
  /* An animation, not a transition, so a photo that was already cached (the
     usual case after round one) develops too. */
  .photo.loaded {
    opacity: var(--photo-opacity);
    transform: none;
    animation: develop var(--dur-photo-develop) var(--ease-photo-develop) both;
  }
  @keyframes develop {
    from {
      opacity: 0;
      transform: scale(var(--photo-develop-scale));
    }
  }
  @keyframes develop-fade {
    from {
      opacity: 0;
    }
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
  /* Hidden while a photo may still arrive; after --photo-wait it fades in. */
  .monogram.waiting {
    animation: monogram-in var(--dur-monogram-in) var(--ease) var(--photo-wait) both;
  }
  @keyframes monogram-in {
    from {
      opacity: 0;
    }
  }
  /* Reduced motion stops every animation and transition (base.css). These are
     fades only, so they stay; the settle's scale goes. */
  @media (prefers-reduced-motion: reduce) {
    .photo {
      transform: none;
    }
    .photo.loaded {
      animation: develop-fade var(--dur-photo-develop) var(--ease) both !important;
    }
    .monogram.waiting {
      animation: monogram-in var(--dur-monogram-in) var(--ease) var(--photo-wait) both !important;
    }
  }
</style>
