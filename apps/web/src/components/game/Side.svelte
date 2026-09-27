<!--
  One full-bleed half of the pitch: a player's photo (or monogram), name,
  country and figure.

  On the first deal (`entrance`) the half slides in from its own edge, to
  meet the other in the middle, with its text held back; the text then
  appears in the beat before the first spin. No slide with reduced motion.
-->
<script lang="ts">
  import type { PlayerCard } from "@bt/core";
  import type { Snippet } from "svelte";
  import { initial } from "../../game/view";
  import type { Entrance } from "../../game/view";
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
    /** The first deal's kick-off, if it's playing. */
    entrance?: Entrance;
  }

  let {
    side,
    player,
    verdict = null,
    qualifier = "",
    value,
    children,
    entrance = null,
  }: Props = $props();
</script>

<div
  class="side {side}"
  class:hit={verdict === "hit"}
  class:miss={verdict === "miss"}
  class:intro={entrance === "intro"}
  class:enter={entrance === "enter"}
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
    <div class="text">
      <div class="who">
        <div class="name">{player.name}</div>
        <div class="meta">{player.country}</div>
      </div>
      <div class="value">
        {@render value?.()}
        <div class="qual">{qualifier}</div>
      </div>
    </div>
    {@render children?.()}
  {/if}
</div>

<style>
  .side {
    flex: 1;
    min-height: 0;
    position: relative;
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
  /* The first deal. Each half starts off its own edge (above and below when
     stacked, left and right side by side) and slides to meet the other. */
  .side.a {
    --intro-from: translateY(calc(-1 * var(--intro-slide-from)));
  }
  .side.b {
    --intro-from: translateY(var(--intro-slide-from));
  }
  @media (min-width: 780px), (orientation: landscape) and (max-height: 500px) {
    .side.a {
      --intro-from: translateX(calc(-1 * var(--intro-slide-from)));
    }
    .side.b {
      --intro-from: translateX(var(--intro-slide-from));
    }
  }
  .side.intro {
    animation: slide-in var(--dur-intro-slide) var(--ease-intro) var(--intro-slide-delay) both;
  }
  .side.intro .text {
    opacity: 0;
  }
  .side.enter .text {
    animation: names-in var(--dur-intro-names) var(--ease) both;
  }
  @keyframes slide-in {
    from {
      transform: var(--intro-from);
    }
  }
  @keyframes names-in {
    from {
      opacity: 0;
      transform: translateY(var(--intro-names-rise));
    }
  }

  .qual {
    margin-top: var(--qual-gap);
    font-size: var(--fs-qual);
    color: var(--dim);
    font-variation-settings: var(--fv-caption);
  }
</style>
