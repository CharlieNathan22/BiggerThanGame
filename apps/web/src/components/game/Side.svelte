<!--
  One full-bleed half of the pitch: a player's photo (or monogram), name,
  country and figure.

  A card is drawn at its `place` by transform: 0 the anchor's half, 1 the
  challenger's, -1 just off the anchor's side. Moving place is a slide:
  - the carousel to the next pair (`gliding`): the challenger's card moves
    into the anchor's place, the anchor's slides off, and the next
    challenger's comes in (`incoming`) from beyond the far edge. The moving
    card's text glides to where the anchor's text sits, so nothing jumps;
  - the first deal (`intro`): each half slides in from its own edge, name and
    country on it, to meet the other in the middle.
  With reduced motion nothing slides: the intro's text fades in, and the
  carousel is skipped (the pair simply changes).
-->
<script lang="ts">
  import type { PlayerCard } from "@bt/core";
  import { untrack } from "svelte";
  import type { Snippet } from "svelte";
  import { initial } from "../../game/view";
  import type { CardPlace } from "../../game/view";
  import Photo from "./Photo.svelte";

  interface Props {
    side: "a" | "b";
    player: PlayerCard | null;
    /** The verdict colour, on the challenger's half only. */
    verdict?: "hit" | "miss" | null;
    /** The small print under the figure. */
    qualifier?: string;
    /** The figure: a number, a count-up or the "?". */
    value?: Snippet;
    /** Anything below the figure — the challenger's Higher / Lower. */
    children?: Snippet;
    /** The first deal's kick-off is playing. */
    intro?: boolean;
    /** Where the card sits: 0 the anchor's half, 1 the challenger's, -1 off the anchor's side. */
    place?: CardPlace;
    /** The carousel slide's length in ms while it runs, else 0. */
    gliding?: number;
    /** The next challenger, coming in during the slide. */
    incoming?: boolean;
    /** The figure and its qualifier fade out (the anchor's, on a stat change). */
    fading?: boolean;
  }

  let {
    side,
    player,
    verdict = null,
    qualifier = "",
    value,
    children,
    intro = false,
    place = side === "a" ? 0 : 1,
    gliding = 0,
    incoming = false,
    fading = false,
  }: Props = $props();

  let text: HTMLDivElement | undefined = $state();

  // The anchor's and the challenger's halves place their text differently
  // (stacked, the anchor's sits above the plaque, the challenger's below it).
  // When the carousel carries a card into the anchor's place its layout
  // changes; the text is moved back to where it was by a transform and glides
  // to its new place with the card (FLIP), so it never jumps.
  // The layout the text was last measured in; starts as the first one.
  let laidOut = untrack(() => side);
  let before: number | null = null;
  $effect.pre(() => {
    if (side !== laidOut && text !== undefined) before = text.offsetTop;
  });
  $effect(() => {
    if (side === laidOut) return;
    laidOut = side;
    const from = before;
    before = null;
    if (from === null || text === undefined || gliding <= 0) return;
    const shift = from - text.offsetTop;
    if (Math.abs(shift) < 1) return;
    const easing = getComputedStyle(text).getPropertyValue("--ease-slide").trim() || "ease-in-out";
    text.animate([{ transform: `translateY(${shift}px)` }, { transform: "none" }], {
      duration: gliding,
      easing,
    });
  });
</script>

<div
  class="side {side}"
  class:hit={verdict === "hit"}
  class:miss={verdict === "miss"}
  class:intro
  class:gliding={gliding > 0}
  class:incoming
  style:--place={place}
>
  {#if player}
    {#key player.id}
      <Photo image={player.image} initial={initial(player.name)} />
    {/key}
    <!--
      The text sits just under the half's middle, below the face at the
      default photo focus. A dark halo rings every glyph, and the name and
      country carry a deeper shadow that follows their letters, so the photo
      stays open around them (DESIGN.md §12).
    -->
    <div class="text" bind:this={text}>
      <div class="who">
        <div class="name">{player.name}</div>
        <div class="meta">{player.country}</div>
      </div>
      <div class="value" class:fading>
        {@render value?.()}
        <div class="qual">{qualifier}</div>
      </div>
    </div>
    {@render children?.()}
  {/if}
</div>

<style>
  /* Every card has the same box, the first half of the pitch, and is moved to
     its place along the pitch by transform: down when stacked, across side
     by side. --before and --after are one place either side, where a card
     slides in from or out to. */
  .side {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 50%;
    --along: calc(var(--place) * 100%);
    --before: translateY(calc((var(--place) - 1) * 100%));
    --after: translateY(calc((var(--place) + 1) * 100%));
    transform: translateY(var(--along));
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: 16px 20px var(--text-bottom);
    text-align: center;
    transition: background-color var(--dur-side) var(--ease);
    /* The photo blends into this half's colour and nothing behind it. */
    isolation: isolate;
  }
  /* Puts the text just under the half's middle (--text-top-gap below it),
     clear of the plaque and below the face. On a half too short for that it
     gives way, so the text sits as low as fits and is never cut off. */
  .side::before {
    content: "";
    flex: 0 1 calc(50% + var(--text-top-gap));
    min-height: 0;
  }
  /* Stacked halves (phones): the plaque straddles the divide, so the top
     half's text stops short of it, and the bottom half's starts below it. */
  .side.a {
    padding-bottom: var(--plaque-clear);
  }
  .side.b {
    padding-top: var(--plaque-clear-below);
  }
  /* Side by side: the anchor keeps an empty slot the size of the challenger's
     Higher / Lower, so on a short screen both texts give way alike and the
     names stay level across the divide. */
  @media (min-width: 780px) {
    .side.a {
      padding-bottom: var(--text-bottom);
    }
    .side.b {
      padding-top: 16px;
    }
    .side.a::after {
      content: "";
      flex: none;
      height: var(--picks-slot);
    }
  }
  /* Short landscape screens: keep the strip under the plaque clear (Plaque.svelte). */
  @media (orientation: landscape) and (max-height: 500px) {
    .side,
    .side.a,
    .side.b {
      padding-top: calc(var(--plaque-h) + var(--plaque-top-gap) * 2);
      padding-bottom: var(--text-bottom-short);
    }
    .side.a::after {
      content: "";
      flex: none;
      height: var(--picks-slot);
    }
  }
  /* At rest the pitch's background shows through (tokens.css); the verdict
     colours are solid. */
  .side.a {
    background: var(--side-a-rest);
  }
  .side.b {
    background: var(--side-b-rest);
  }
  .side.hit {
    background: var(--hit);
  }
  .side.miss {
    background: var(--miss);
  }
  .text {
    position: relative;
    /* Never squeezed: on a short half the space above it gives way instead. */
    flex: none;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-shadow: var(--halo);
  }
  /* The tint: a soft dark shadow that follows the letters of the name and
     country, drawn from their own shapes (--tint-*), so there is no box. Only
     over a photo; the monogram's plain half doesn't need it. The figure, "?"
     and qualifier have the halo only. */
  .side:has(:global(.photo)) .who {
    filter: var(--tint);
  }
  /* Never narrower than the name's longest word (min-width wins over
     max-width), so a long one-word name isn't clipped and stays centred. */
  .who {
    max-width: var(--who-w);
    min-width: min-content;
  }
  /* At most --name-lines lines, ending in an ellipsis; the whole name stays in
     the page for screen readers. The clip would cut a text-shadow, so the halo
     is drawn as a filter, which comes after it. The padding keeps accents and
     descenders clear of the clip without moving anything. */
  .name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--name-lines);
    line-clamp: var(--name-lines);
    overflow: hidden;
    padding-block: var(--name-clip-pad);
    margin-block: calc(-1 * var(--name-clip-pad));
    font-size: var(--fs-name);
    line-height: var(--lh-name);
    font-variation-settings: var(--fv-name);
    letter-spacing: var(--tracking-name);
    text-shadow: none;
    /* The dark halo, then the gold glow outside it. */
    filter: var(--halo-filter) var(--glow-filter);
  }
  .meta {
    margin-top: var(--name-rule-gap);
    font-size: var(--fs-meta);
    color: var(--dim);
    font-variation-settings: var(--fv-meta);
  }
  /* An optional gold hairline under the name (--name-rule-*). */
  .meta::before {
    content: "";
    display: var(--name-rule-display);
    width: var(--name-rule-w);
    height: var(--name-rule-h);
    margin: 0 auto var(--meta-gap);
    background: var(--name-rule-colour);
  }
  .value {
    margin-top: var(--value-gap);
    min-height: var(--value-min-h);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  @media (min-width: 780px), (orientation: landscape) and (max-height: 500px) {
    .side {
      width: 50%;
      height: 100%;
      --before: translateX(calc((var(--place) - 1) * 100%));
      --after: translateX(calc((var(--place) + 1) * 100%));
      transform: translateX(var(--along));
    }
  }
  /* The first deal. Each half starts off its own edge (above and below when
     stacked, left and right side by side) and slides to meet the other. */
  .side.a.intro {
    animation: slide-from var(--dur-intro-slide) var(--ease-intro) both;
    --slide-from: var(--before);
  }
  .side.b.intro {
    animation: slide-from var(--dur-intro-slide) var(--ease-intro) both;
    --slide-from: var(--after);
  }
  /* The carousel: a card changing place slides there, and its verdict colour
     fades back to the resting look on the way. The next challenger comes in
     from beyond the far edge. Reduced motion never gets here. */
  .side.gliding {
    transition:
      transform var(--dur-slide) var(--ease-slide),
      background-color var(--dur-slide) var(--ease);
  }
  .side.gliding.incoming {
    animation: slide-from var(--dur-slide) var(--ease-slide) both;
    --slide-from: var(--after);
  }
  @keyframes slide-from {
    from {
      transform: var(--slide-from);
    }
  }
  /* Reduced motion stops every animation (base.css): no slide, and the text
     fades in instead. */
  @media (prefers-reduced-motion: reduce) {
    .side.intro .text {
      animation: text-in var(--dur-intro-fade) var(--ease) both !important;
    }
  }
  @keyframes text-in {
    from {
      opacity: 0;
    }
  }

  /* Fades out; when it stops fading (the new figure is in) it is simply there. */
  .value.fading {
    opacity: 0;
    transition: opacity var(--dur-figure-out) var(--ease);
  }
  .qual {
    margin-top: var(--qual-gap);
    font-size: var(--fs-qual);
    color: var(--dim);
    font-variation-settings: var(--fv-caption);
  }
</style>
