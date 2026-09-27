<!--
  One full-bleed half of the pitch: a player's photo (or monogram), name,
  country and figure.
-->
<script lang="ts">
  import type { PlayerCard } from "@bt/core";
  import type { Snippet } from "svelte";
  import { initial } from "../../game/view";
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
  }

  let { side, player, verdict = null, qualifier = "", value, children }: Props = $props();
</script>

<div class="side {side}" class:hit={verdict === "hit"} class:miss={verdict === "miss"}>
  {#if player}
    {#key player.id}
      <Photo image={player.image} initial={initial(player.name)} />
    {/key}
    <!--
      The text sits just under the half's middle, below the face at the
      default photo focus. A scrim darkens only the band behind it and a halo rings the
      glyphs, so the photo stays open above (DESIGN.md §12).
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
     half's text stops short of it. */
  .side.a {
    padding-bottom: var(--plaque-clear);
  }
  /* Side by side: the anchor keeps an empty slot the size of the challenger's
     Higher / Lower, so on a short screen both texts give way alike and the
     names stay level across the divide. */
  @media (min-width: 780px) {
    .side.a {
      padding-bottom: var(--text-bottom);
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
    .side.a {
      padding-top: calc(var(--plaque-h) + var(--plaque-top-gap) * 2);
      padding-bottom: var(--text-bottom-short);
    }
    .side.a::after {
      content: "";
      flex: none;
      height: var(--picks-slot);
    }
  }
  .side.a {
    background: var(--night);
  }
  .side.b {
    background: var(--night-2);
  }
  .side.hit {
    background: var(--hit);
  }
  .side.miss {
    background: var(--miss);
  }
  .text {
    position: relative;
    /* Its own layer, so the scrim below goes over the photo and under the text. */
    z-index: 0;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-shadow: var(--halo);
  }
  /* The scrim: full strength from the top of the text down to the half's
     bottom edge (the half clips it), fading to nothing over --scrim-fade above.
     Only over a photo; the monogram's plain half doesn't need it. */
  .side:has(:global(.photo)) .text::before {
    content: "";
    position: absolute;
    z-index: -1;
    top: calc(-1 * var(--scrim-fade));
    bottom: -100vh;
    left: -100vw;
    right: -100vw;
    background: linear-gradient(
      to bottom,
      transparent,
      rgba(var(--ink-rgb), var(--scrim-opacity)) var(--scrim-fade)
    );
    pointer-events: none;
  }
  .who {
    max-width: var(--who-w);
  }
  .name {
    font-size: var(--fs-name);
    line-height: var(--lh-name);
    font-variation-settings: var(--fv-name);
    letter-spacing: var(--tracking-name);
  }
  /* An optional gold hairline under the name (--name-rule-*). */
  .name::after {
    content: "";
    display: var(--name-rule-display);
    width: var(--name-rule-w);
    height: var(--name-rule-h);
    margin: var(--name-rule-gap) auto 0;
    background: var(--name-rule-colour);
  }
  .meta {
    margin-top: 6px;
    font-size: var(--fs-meta);
    color: var(--dim);
    font-variation-settings: var(--fv-meta);
  }
  .value {
    margin-top: 14px;
    min-height: var(--value-min-h);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .qual {
    margin-top: 5px;
    font-size: var(--fs-qual);
    color: var(--dim);
    font-variation-settings: var(--fv-caption);
  }
</style>
