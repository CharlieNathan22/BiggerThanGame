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
    <div class="who">
      <div class="name">{player.name}</div>
      <div class="meta">{player.country}</div>
    </div>
    <div class="value">
      {@render value?.()}
      <div class="qual">{qualifier}</div>
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
    justify-content: center;
    padding: 16px 20px;
    text-align: center;
    transition: background-color var(--dur-side) var(--ease);
    /* The photo blends into this half's colour and nothing behind it. */
    isolation: isolate;
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
  .who {
    position: relative;
    max-width: var(--who-w);
  }
  .name {
    font-size: var(--fs-name);
    line-height: var(--lh-name);
    font-variation-settings: var(--fv-name);
    letter-spacing: var(--tracking-name);
  }
  .meta {
    margin-top: 6px;
    font-size: var(--fs-meta);
    color: var(--dim);
    font-variation-settings: var(--fv-meta);
  }
  .value {
    position: relative;
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
